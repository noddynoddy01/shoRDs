#!/usr/bin/env python3
"""Builds shords-pilot6b-scripts-r3.zip: the Phase 6B scripts (CRLF, ASCII), Verify-Kit.ps1 (generic manifest checker from the 6A kit),
README_FIRST.txt and a SHA-256 manifest. Usage: python3 docs/phase6/pilot6b/build_pilot6b.py OUT.zip"""
import hashlib, os, sys, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, '..', 'kit')
out = sys.argv[1] if len(sys.argv) > 1 else 'shords-pilot6b-scripts-r3.zip'
names = ['Phase6B.Common.ps1', 'Step-C-Acquire.ps1', 'Step-D-Run.ps1', 'Rollback.ps1', 'Parse-Check.ps1', 'Test-PathGuard.ps1', 'README_FIRST.txt']
files = {}
for n in names:
    b = open(os.path.join(HERE, n), 'rb').read().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    b.decode('ascii')  # fail if any non-ASCII byte
    files[n] = b
files['Verify-Kit.ps1'] = open(os.path.join(KIT, 'Verify-Kit.ps1'), 'rb').read()
manifest = ''.join('%s  %s\r\n' % (hashlib.sha256(b).hexdigest(), n) for n, b in sorted(files.items()))
files['MANIFEST.sha256.txt'] = manifest.encode()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in sorted(files.items()):
        zi = zipfile.ZipInfo('shords-pilot6b-r3/' + n, date_time=(2026, 11, 4, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
        z.writestr(zi, b)
print('files:', len(files))
for n, b in sorted(files.items()): print('  %8d  %s  %s' % (len(b), hashlib.sha256(b).hexdigest(), n))
print('zip bytes:', os.path.getsize(out)); print('zip sha256:', hashlib.sha256(open(out, 'rb').read()).hexdigest())
