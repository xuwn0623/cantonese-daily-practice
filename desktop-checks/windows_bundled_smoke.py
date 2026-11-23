"""Exercise the release launcher with official portable Python and no Python on PATH."""
import argparse
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import zipfile

ARCHIVES = {
    'amd64': '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159',
    'arm64': 'bbe116bb1248820359cbf25127ac5c7794ea161869d83686cfbc9a45203ff836',
}
INDEX = '<!doctype html><meta charset="utf-8"><h1>粤语学习台测试</h1>'.encode('utf-8')


def get(port, path='/'):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def check(command, cwd, env, expected=0):
    result = subprocess.run(command, cwd=cwd, env=env, input=b'\r\n', capture_output=True, timeout=45)
    output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
    print(output, flush=True)
    assert result.returncode == expected, (result.returncode, expected, output)
    if expected == 0:
        assert '完整性校验通过' in output
    else:
        assert '校验失败' in output or '文件大小不一致' in output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', type=Path)
    args = parser.parse_args()
    assert os.name == 'nt', 'This acceptance test requires native Windows.'
    arch = os.environ.get('PROCESSOR_ARCHITEW6432', os.environ.get('PROCESSOR_ARCHITECTURE', '')).lower()
    assert arch in ARCHIVES, arch
    url = f'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-{arch}.zip'
    body = urllib.request.urlopen(url, timeout=60).read()
    assert hashlib.sha256(body).hexdigest() == ARCHIVES[arch]
    with tempfile.TemporaryDirectory(prefix='cantonese-bundled-') as temp:
        root = Path(temp) / '粤语 学习 (test) !'
        root.mkdir()
        runtime = root / 'runtime' / ('windows-' + arch)
        runtime.mkdir(parents=True)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            for entry in archive.infolist():
                assert '/' not in entry.filename and '\\' not in entry.filename
                (runtime / entry.filename).write_bytes(archive.read(entry))
        assert (runtime / 'LICENSE.txt').is_file()
        shutil.copyfile(args.sources / 'launcher.py', root / 'launcher.py')
        shutil.copyfile(args.sources / 'start-windows.cmd', root / '启动Windows.cmd')
        wrapper = (root / '启动Windows.cmd').read_bytes()
        assert wrapper.isascii() and b'\n' not in wrapper.replace(b'\r\n', b'')
        (root / 'site/audio').mkdir(parents=True)
        (root / 'site/index.html').write_bytes(INDEX)
        wav = b'RIFF' + bytes(4) + b'WAVEfixture'
        (root / 'site/audio/test.wav').write_bytes(wav)
        files = []
        for path in sorted(root.rglob('*')):
            if path.is_file():
                content = path.read_bytes()
                files.append({'path': path.relative_to(root).as_posix(), 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        (root / 'manifest.json').write_text(json.dumps({'version': '1.0.2-fixture', 'files': files}), encoding='utf-8')
        for path in root.rglob('*'):
            if path.is_file():
                os.utime(path, (1577836800, 1577836800))
        env = os.environ.copy()
        env['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
        env['PYTHONIOENCODING'] = 'utf-8'
        command = f'cmd.exe /d /v:off /c call "{root / "启动Windows.cmd"}" --check'
        check(command, root.parent, env)
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            port = reserve.getsockname()[1]
        server_command = f'cmd.exe /d /v:off /c call "{root / "启动Windows.cmd"}" --no-open --port {port}'
        process = subprocess.Popen(server_command, cwd=root.parent, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while True:
                assert process.poll() is None, 'Launcher exited before HTTP became ready'
                try:
                    status, content = get(port)
                    break
                except OSError:
                    assert time.monotonic() < deadline, 'HTTP startup timed out'
                    time.sleep(0.1)
            assert (status, content) == (200, INDEX)
            assert get(port, '/audio/test.wav') == (200, wav)
            for path in ('/manifest.json', '/launcher.py', f'/runtime/windows-{arch}/python.exe'):
                assert get(port, path)[0] == 404
            print('Portable Python startup, HTTP audio and private runtime checks passed.', flush=True)
        finally:
            # Only terminate this test-created cmd.exe and its child server.
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
            output, _ = process.communicate(timeout=10)
            print(output.decode('utf-8', errors='replace'))
        (root / 'site/audio/test.wav').write_bytes(b'tampered')
        check(command, root.parent, env, expected=1)
    print('Windows bundled-runtime checks passed without Python on PATH.', flush=True)


if __name__ == '__main__':
    main()
