"""Materialize the reviewed static-only release after hash and path checks."""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, io, json, re, stat, zipfile

EXPECTED_ARCHIVE_SHA256 = '6b4104028bc3b02d36a16aa9a5047a19b82947a4d57f5759e33042f8758ab252'
EXPECTED_ARCHIVE_BYTES = 37223106
EXPECTED_FILE_COUNT = 470
ROOT_FILES = {'.nojekyll','THIRD_PARTY.md','app.mjs','asr-config.json','asr-worker.js','asr.mjs','curriculum.json','index.html','lesson-engine.mjs','lesson-view.mjs','pitch.mjs','platform.mjs','progress.mjs','style.css','transcript.mjs','course-audio.mjs'}
AUDIO_DOCS = {'audio/manifest.json','audio/LICENSE.txt','audio/README.md'}

def allowed(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and '..' not in path.parts and '\\' not in name
            and (name in ROOT_FILES or name in AUDIO_DOCS or bool(re.fullmatch(r'audio/[0-9a-f]{64}\.wav',name))))

def verify(base):
    paths = sorted(base.glob('part-*.b64'))
    assert [p.name for p in paths] == [f'part-{n:03d}.b64' for n in range(50)], 'unexpected/missing parts'
    encoded = b''.join(p.read_bytes() for p in paths)
    assert len(encoded) == 49630808, 'base64 length'
    data = base64.b64decode(encoded, validate=True)
    assert len(data) == EXPECTED_ARCHIVE_BYTES, 'archive length'
    assert hashlib.sha256(data).hexdigest() == EXPECTED_ARCHIVE_SHA256, 'archive checksum'
    manifest = json.loads((base/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['archiveSha256'] == EXPECTED_ARCHIVE_SHA256
    records = manifest['files']; assert len(records) == EXPECTED_FILE_COUNT
    expected = {r['path']:r for r in records}
    assert len(expected) == len(records) and all(allowed(n) for n in expected), 'path allowlist'
    output = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        assert len(entries) == len(expected) and {e.filename for e in entries} == set(expected), 'zip members'
        assert sum(e.file_size for e in entries) < 80000000, 'expanded size limit'
        for info in entries:
            name = info.filename; record = expected[name]
            assert not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16), 'file type'
            assert 0 <= info.file_size == record['bytes'] <= 8000000, 'file size'
            content = archive.read(info)
            assert hashlib.sha256(content).hexdigest() == record['sha256'], name
            if name.endswith('.wav'):
                assert content[:4] == b'RIFF' and content[8:12] == b'WAVE', name
                assert name == 'audio/'+record['sha256']+'.wav', 'audio filename hash'
            output[name] = content
    audio = json.loads(output['audio/manifest.json'])
    assert len(audio['clips']) == 1692 and len({c['file'] for c in audio['clips'].values()}) == 451
    for clip in audio['clips'].values():
        assert 'audio/'+clip['file'] in output
        assert hashlib.sha256(output['audio/'+clip['file']]).hexdigest() == clip['sha256']
    assert audio['clips']['w01-s1-p1']['sha256'] == '83414bfe75bb12b00baebb3eec62bc6e8c460a67a774d7f5f54f38a9f901b606'
    assert audio['clips']['w01-s1-p1']['sourceKind'] == 'human-syllable-sequence'
    return output

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
    base=Path(__file__).resolve().parent;files=verify(base)
    if not args.check_only:
        root=base.parent
        assert (root/'.git').is_dir(), 'must run in checkout'
        for name,content in files.items():
            target=root/name
            assert all(not p.is_symlink() for p in [target,*target.parents] if p!=root.parent), 'symlink'
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(content)
        (base/'files.txt').write_text('\n'.join(sorted(files))+'\n',encoding='utf-8')
    print(json.dumps({'verifiedFiles':len(files),'archiveSha256':EXPECTED_ARCHIVE_SHA256,'expandedBytes':sum(map(len,files.values()))}))

if __name__=='__main__':main()
