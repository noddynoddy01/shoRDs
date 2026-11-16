#!/usr/bin/env python3
"""Builds shords-pilot6c-scripts-r6.zip: Phase 6C scripts (CRLF, ASCII), conformance vectors (byte-exact), Linux-side tools and tests (LF),
README_FIRST.txt and MANIFEST.sha256.txt (SHA-256 of every file). Then re-opens the zip, re-hashes every member and runs the static analyser on the
CRLF copies. Usage: python3 -I docs/phase6/pilot6c_r6/build_pilot6c.py OUT.zip"""
import hashlib, io, os, sys, tempfile, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tests'))
FOLDER = 'shords-pilot6c-r6'
out = sys.argv[1] if len(sys.argv) > 1 else 'shords-pilot6c-scripts-r6.zip'
crlf = ['Phase6B.Common.ps1', 'Phase6C.Lib.ps1', 'Phase6C.Runtime.ps1', 'Pilot-Agent.ps1', 'Invoke-PilotRun.ps1', 'Rollback-6C.ps1', 'Test-AgentLogic.ps1',
        'Parse-Check.ps1', 'Verify-Kit.ps1', 'Test-Orchestrator.ps1', 'Test-FileOps.ps1', 'README_FIRST.txt', 'CHANGELOG_r6.txt', 'CHANGELOG_r5.txt']
lf = ['linux/pilot_core.py', 'linux/pilot_submit.py', 'linux/gen_vectors.py', 'tests/ps_static_check.py', 'tests/test_pilot6c.py']
files = {}
for n in crlf:
    b = open(os.path.join(HERE, n), 'rb').read().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    b.decode('ascii'); files[n] = b
for n in lf:
    b = open(os.path.join(HERE, n), 'rb').read().replace(b'\r\n', b'\n'); b.decode('ascii'); files[n] = b
for n in sorted(os.listdir(os.path.join(HERE, 'vectors'))):
    if n.endswith('.json'):
        files['vectors/' + n] = open(os.path.join(HERE, 'vectors', n), 'rb').read()
manifest = ''.join('%s  %s\r\n' % (hashlib.sha256(b).hexdigest(), n) for n, b in sorted(files.items()))
files['MANIFEST.sha256.txt'] = manifest.encode()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in sorted(files.items()):
        zi = zipfile.ZipInfo(FOLDER + '/' + n, date_time=(2026, 11, 4, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
        z.writestr(zi, b)
# verify the zip as the owner's Verify-Kit.ps1 would
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    for line in z.read(FOLDER + '/MANIFEST.sha256.txt').decode().splitlines():
        h, rel = line.split('  ', 1)
        assert hashlib.sha256(z.read(FOLDER + '/' + rel)).hexdigest() == h, rel
    names = {i.filename[len(FOLDER) + 1:] for i in z.infolist()}
    assert names == set(files), names ^ set(files)
    with tempfile.TemporaryDirectory() as d:        # static analysis of exactly the bytes that ship (CRLF)
        for n in crlf:
            if n.endswith('.ps1'):
                open(os.path.join(d, n), 'wb').write(z.read(FOLDER + '/' + n))
        import ps_static_check as sc
        found = sc.check_package(d)
        assert found == [], found
print('files:', len(files))
for n, b in sorted(files.items()): print('  %8d  %s  %s' % (len(b), hashlib.sha256(b).hexdigest(), n))
print('zip bytes:', os.path.getsize(out)); print('zip sha256:', hashlib.sha256(open(out, 'rb').read()).hexdigest())
