"""Smoke-test the exact patch embedded in the public HTML, without the large model."""

import argparse
import base64
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import zipfile


PATCH_FILES = {"start-windows.cmd", "launcher-windows-fix.py"}
INDEX = "<!doctype html><meta charset=utf-8><h1>粤语测试</h1>".encode("utf-8")


def extract_patch(page, root):
    text = page.read_text(encoding="utf-8")
    payloads = re.findall(r'href="data:application/zip;base64,([A-Za-z0-9+/=]+)"', text)
    hashes = re.findall(r"SHA256：([a-f0-9]{64})", text)
    assert len(payloads) == len(hashes) == 1, "Expected one downloadable ZIP and one SHA256"
    body = base64.b64decode(payloads[0], validate=True)
    assert hashlib.sha256(body).hexdigest() == hashes[0], "Embedded ZIP checksum mismatch"
    assert len(body) < 256 * 1024, "Unexpectedly large startup patch"
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        assert len(archive.infolist()) == 2 and set(archive.namelist()) == PATCH_FILES
        for name in PATCH_FILES:
            assert archive.getinfo(name).file_size < 256 * 1024
            (root / name).write_bytes(archive.read(name))
    wrapper = (root / "start-windows.cmd").read_bytes()
    assert wrapper.isascii() and wrapper.endswith(b"\r\n")
    assert b"\r" not in wrapper.replace(b"\r\n", b"")
    assert b"\n" not in wrapper.replace(b"\r\n", b"")
    print("Embedded patch SHA256:", hashes[0], flush=True)


def make_fixture(root):
    contents = {
        "site/index.html": INDEX,
        "launcher.py": b"# Original launcher fixture; preserved by additive patch.\n",
        "old-start.cmd": b"@echo off\nrem Original old wrapper fixture\n",
        "private.txt": b"Private package metadata; must never be served.\n",
    }
    records = []
    for name, body in contents.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        records.append({"path": name, "size": len(body), "sha256": hashlib.sha256(body).hexdigest()})
    (root / "manifest.json").write_text(json.dumps({"version": "1.0.0", "files": records}), encoding="utf-8")
    # ZIP extraction restores mtime after creating a file. Exercise that Windows case.
    time.sleep(0.02)
    for path in (root / name for name in list(contents) + ["manifest.json"]):
        os.utime(path, (1577836800, 1577836800))
    return contents


def environment():
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PY_PYTHON3"] = f"{sys.version_info.major}.{sys.version_info.minor}"
    return env


def check_command(command, root, expected=0):
    result = subprocess.run(command, cwd=root.parent, env=environment(), input=b"\r\n",
                            capture_output=True, timeout=20)
    output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
    print(output, flush=True)
    assert result.returncode == expected, f"Exit {result.returncode}, expected {expected}"
    if expected == 0:
        assert "完整性校验通过" in output
    else:
        assert "文件大小不一致" in output or "文件校验失败" in output


def request(port, path="/", headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def check_server(root):
    with socket.socket() as reserve:
        reserve.bind(("127.0.0.1", 0))
        port = reserve.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-B", str(root / "launcher-windows-fix.py"), "--no-open", "--port", str(port)],
        cwd=root.parent, env=environment(), stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 15
        while True:
            assert process.poll() is None, "Server exited before serving the fixture"
            try:
                status, headers, body = request(port)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise AssertionError("Local server did not become ready")
                time.sleep(0.1)
        assert (status, body) == (200, INDEX)
        assert "charset=utf-8" in headers["Content-Type"]
        for path in ("/manifest.json", "/launcher.py", "/private.txt", "/start-windows.cmd", "/launcher-windows-fix.py"):
            assert request(port, path)[0] == 404, path
        assert request(port, headers={"Host": "attacker.invalid"})[0] == 403
        print("HTTP content, private-file whitelist and foreign Host checks passed", flush=True)
    finally:
        # Stop only the child created by this test, including on failed assertions.
        if process.poll() is None:
            process.terminate()
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate(timeout=5)
        print(output.decode("utf-8", errors="replace"), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("page", type=Path)
    parser.add_argument("--skip-cmd", action="store_true", help="Run only portable checks locally; not a Windows acceptance test")
    args = parser.parse_args()
    if os.name != "nt" and not args.skip_cmd:
        parser.error("Windows is required; --skip-cmd is for explicitly limited local checks")
    print("Interpreter:", sys.version, flush=True)
    with tempfile.TemporaryDirectory(prefix="cantonese-windows-smoke-") as temporary:
        root = Path(temporary) / "粤语 学习 (test) !"
        root.mkdir()
        extract_patch(args.page, root)
        originals = make_fixture(root)
        direct = [sys.executable, "-B", str(root / "launcher-windows-fix.py"), "--check"]
        wrapper = f'cmd.exe /d /v:off /c call "{root / "start-windows.cmd"}" --check'
        check_command(direct, root)
        if not args.skip_cmd:
            check_command(wrapper, root)
        check_server(root)
        for name, content in originals.items():
            assert (root / name).read_bytes() == content, "Original package file was modified"
        (root / "site/index.html").write_bytes(b"tampered")
        check_command(direct, root, expected=1)
        if not args.skip_cmd:
            check_command(wrapper, root, expected=1)
    if args.skip_cmd:
        print("Portable checks passed; Windows CMD was explicitly skipped.")
    else:
        print("Windows patch smoke test passed: CMD, Python, HTTP, tamper rejection and preservation.")


if __name__ == "__main__":
    main()
