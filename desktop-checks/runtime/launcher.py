#!/usr/bin/env python3
"""Validated, read-only loopback server for the Cantonese desktop package."""

import sys

if sys.version_info < (3, 9):
    sys.exit("需要 Python 3.9 或更新版本。请先安装 Python 3，再运行启动文件。")

import argparse
import errno
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import socket
import stat
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote


DEFAULT_PORT = 8779
IS_WINDOWS = os.name == "nt"
CHUNK_SIZE = 128 * 1024
CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
       "worker-src 'self'; style-src 'self'; img-src 'self' data:; "
       "media-src 'self' blob:; connect-src 'self'; object-src 'none'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def valid_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    if any(c in value for c in "\\:%?#"):
        return False
    parts = value.split("/")
    return all(part not in ("", ".", "..") and not part.endswith((" ", ".")) for part in parts)


def no_link(path):
    info = path.lstat()
    # Windows junctions/reparse points also redirect a path outside the package.
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("不允许符号链接或目录联接：" + path.name)
    return info


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def path_matches_descriptor(path_info, descriptor_info):
    # CPython on Windows can report creation time for lstat, change time for fstat.
    # Compare ctime only within the same API; retain file identity, size and mtime.
    if IS_WINDOWS:
        return signature(path_info)[:4] == signature(descriptor_info)[:4]
    return signature(path_info) == signature(descriptor_info)


def open_checked(root, relative):
    """Open a regular file without following package symlinks."""
    if not valid_path(relative):
        raise ValueError("无效的包内路径")
    current = root
    no_link(current)
    parts = relative.split("/")
    for part in parts:
        current = current / part
        before = no_link(current)
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("包内资源不是普通文件：" + relative)
    descriptor = None
    directory = None
    try:
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            directory = os.open(root, flags)
            for part in parts[:-1]:
                next_directory = os.open(part, flags, dir_fd=directory)
                os.close(directory)
                directory = next_directory
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        else:
            descriptor = os.open(current, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or not path_matches_descriptor(before, opened):
            raise ValueError("资源在读取前已改变：" + relative)
        current = root
        no_link(current)
        for part in parts:
            current = current / part
            after = no_link(current)
        if signature(before) != signature(after) or not path_matches_descriptor(after, opened):
            raise ValueError("资源在打开时已改变：" + relative)
        if current.resolve() != root / relative:
            raise ValueError("资源路径离开了下载包")
        stream = os.fdopen(descriptor, "rb")
        descriptor = None
        return stream
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory is not None:
            os.close(directory)


def validate_package(root):
    root = Path(root).absolute()
    try:
        no_link(root)
        root = root.resolve(strict=True)
        with open_checked(root, "manifest.json") as stream:
            if os.fstat(stream.fileno()).st_size > 1024 * 1024:
                raise ValueError("文件清单过大")
            manifest = json.load(stream)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("version"), str):
            raise ValueError("文件清单格式错误")
        files = manifest.get("files")
        if not isinstance(files, list) or not files or len(files) > 10000:
            raise ValueError("文件清单为空或格式错误")
        verified = {}
        for entry in files:
            if not isinstance(entry, dict):
                raise ValueError("文件清单条目错误")
            name, size, digest = entry.get("path"), entry.get("size"), entry.get("sha256")
            if not valid_path(name) or name == "manifest.json" or name in verified:
                raise ValueError("文件清单存在非法或重复路径")
            if type(size) is not int or size < 0 or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("文件清单缺少有效大小或 SHA256：" + name)
            with open_checked(root, name) as stream:
                before = os.fstat(stream.fileno())
                if before.st_size != size:
                    raise ValueError("文件大小不一致：" + name)
                hasher = hashlib.sha256()
                for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
                    hasher.update(chunk)
                if hasher.hexdigest() != digest or signature(before) != signature(os.fstat(stream.fileno())):
                    raise ValueError("文件校验失败：" + name)
            verified[name] = signature(before)
        if "site/index.html" not in verified:
            raise ValueError("下载包缺少 site/index.html")
        return root, verified
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("无法校验下载包：" + str(error)) from error


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    # Unix permits immediate restart without permitting a second live listener.
    # Windows uses exclusive binding instead of SO_REUSEADDR.
    allow_reuse_address = os.name != "nt"
    request_queue_size = 8

    def __init__(self, root, verified, port, max_connections, connection_timeout):
        self.root = root
        self.public_files = {name[5:]: value for name, value in verified.items() if name.startswith("site/")}
        self.connection_timeout = connection_timeout
        self._slots = threading.BoundedSemaphore(max_connections)
        self._active_lock = threading.Lock()
        self.active_connections = 0
        super().__init__(("127.0.0.1", port), Handler)

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(self.connection_timeout)
        return connection, address

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(0.1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\nRetry-After: 1\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        with self._active_lock:
            self.active_connections += 1
        try:
            super().process_request(request, client_address)
        except Exception:
            self.release_slot()
            raise

    def release_slot(self):
        with self._active_lock:
            self.active_connections -= 1
        self._slots.release()

    def process_request_thread(self, request, client_address):
        def expire():
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        # An absolute deadline also bounds clients that trickle bytes forever.
        deadline = threading.Timer(self.connection_timeout, expire)
        deadline.daemon = True
        deadline.start()
        try:
            super().process_request_thread(request, client_address)
        finally:
            deadline.cancel()
            self.release_slot()

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = "CantoneseLocal/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Connection", "close")
        self.close_connection = True
        super().end_headers()

    def error_response(self, status, message):
        body = (message + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if status == 405:
            self.send_header("Allow", "GET, HEAD")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return False

    def parse_request(self):
        if not super().parse_request():
            return False
        host = "127.0.0.1:" + str(self.server.server_port)
        for header, allowed, required in [
            ("Host", {host}, True),
            ("Origin", {"http://" + host}, False),
            ("Sec-Fetch-Site", {"same-origin", "none"}, False),
        ]:
            values = self.headers.get_all(header, [])
            if (required and not values) or len(values) > 1 or (values and values[0] not in allowed):
                return self.error_response(403, "仅允许从本机学习页面读取")
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Expect") or len(lengths) > 1 or (lengths and lengths[0] != "0"):
            return self.error_response(400, "不接受请求正文")
        if self.command not in {"GET", "HEAD"}:
            return self.error_response(405, "仅提供 GET 和 HEAD 只读访问")
        # BaseHTTPRequestHandler normalizes a leading //; inspect the original target.
        target = self.requestline.split()[1]
        if not target.startswith("/") or target.startswith("//") or "#" in target:
            return self.error_response(400, "无效的资源路径")
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        raw_path = self.path.split("?", 1)[0]
        if re.search(r"%(?![0-9a-fA-F]{2})|%2f|%5c", raw_path, re.IGNORECASE):
            return self.error_response(400, "无效的资源路径")
        try:
            path = unquote(raw_path, encoding="utf-8", errors="strict")
        except UnicodeError:
            return self.error_response(400, "无效的资源路径")
        if path != "/" and path.endswith("/"):
            return self.error_response(404, "找不到此内容")
        name = "index.html" if path == "/" else path[1:]
        if not valid_path(name):
            return self.error_response(400, "无效的资源路径")
        expected = self.server.public_files.get(name)
        if expected is None:
            return self.error_response(404, "找不到此内容")
        try:
            stream = open_checked(self.server.root, "site/" + name)
            if signature(os.fstat(stream.fileno())) != expected:
                stream.close()
                return self.error_response(409, "资源已改变，请重新校验并启动")
        except (ValueError, OSError):
            return self.error_response(404, "资源不可用，请重新校验并启动")
        with stream:
            suffix = Path(name).suffix.lower()
            mime = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}.get(suffix)
            mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
            if mime.startswith("text/") or mime == "application/json":
                mime += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(expected[2]))
            self.end_headers()
            if self.command == "GET":
                for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
                    self.wfile.write(chunk)


def make_server(root, port=DEFAULT_PORT, *, max_connections=8, connection_timeout=15):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("端口必须为 0 到 65535 的整数")
    if type(max_connections) is not int or not 1 <= max_connections <= 64 or not 0 < connection_timeout <= 300:
        raise ValueError("无效的连接上限或超时")
    root, verified = validate_package(root)
    return LocalServer(root, verified, port, max_connections, connection_timeout)


def main():
    parser = argparse.ArgumentParser(description="楠哥粤语学习台下载版：仅本机、只读，无需服务器账户")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="本机端口，默认 8779；改变端口会使用另一份浏览器进度")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--check", action="store_true", help="仅检查完整性，不启动服务")
    args = parser.parse_args()
    root = Path(__file__).absolute().parent
    try:
        if args.check:
            _, files = validate_package(root)
            print("完整性校验通过，共 %d 个文件。" % len(files))
            return 0
        if not 1 <= args.port <= 65535:
            raise ValueError("启动端口必须为 1 到 65535")
        print("正在校验下载包，请稍候……", flush=True)
        server = make_server(root, args.port)
    except ValueError as error:
        print("无法启动：%s。请重新解压完整下载包。" % error, file=sys.stderr)
        return 1
    except OSError as error:
        if error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) == 10048:
            print("端口 %d 已被占用。若学习台已启动，请打开 http://127.0.0.1:%d/；否则请确认并自行关闭占用程序后重试。启动器不会结束其他进程或自动换端口。" % (args.port, args.port), file=sys.stderr)
        else:
            print("本机服务无法启动：%s" % error, file=sys.stderr)
        return 1
    url = "http://127.0.0.1:%d/" % server.server_port
    print("楠哥粤语学习台已启动：" + url, flush=True)
    print("请保留此窗口；按 Ctrl+C 停止。进度保存在此地址对应的浏览器中。", flush=True)
    if not args.no_open:
        try:
            if not webbrowser.open(url):
                print("浏览器未自动打开，请复制上面的地址。", flush=True)
        except webbrowser.Error:
            print("浏览器未自动打开，请复制上面的地址。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n楠哥粤语学习台已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
