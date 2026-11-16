#!/usr/bin/env python3
"""Builds shords-pilot-kit.zip from the repository: the pilot driver, the exact set of backend modules it requires (computed, not guessed),
the PowerShell helpers and a SHA-256 manifest. Run from anywhere: python3 docs/phase6/kit/build_kit.py OUT.zip"""
import hashlib, os, re, sys, zipfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
KIT = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else 'shords-pilot-kit.zip'
seen, stack = set(), ['scripts/native_pilot.js']
while stack:
    f = stack.pop()
    if f in seen: continue
    seen.add(f)
    src = open(os.path.join(ROOT, f), encoding='utf8').read()
    for m in re.finditer(r'require\((?:"|\')(\.[^"\']+)(?:"|\')\)', src):
        p = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        for cand in (p, p + '.js', p + '.json', os.path.join(p, 'index.js')):
            if os.path.isfile(os.path.join(ROOT, cand)): stack.append(cand); break
        else: raise SystemExit('unresolved require %s in %s' % (m.group(1), f))
files = {}
for f in sorted(seen): files[f] = open(os.path.join(ROOT, f), 'rb').read()
for name in ('Probe-Hardware.ps1', 'Verify-Kit.ps1', 'README_FIRST.txt', 'papers.template.json'):
    files[name] = open(os.path.join(KIT, name), 'rb').read()
files['package.json'] = b'{\n  "name": "shords-pilot-kit",\n  "version": "0.0.0",\n  "private": true,\n  "description": "Local pilot kit. No dependencies."\n}\n'
manifest = ''.join('%s  %s\r\n' % (hashlib.sha256(b).hexdigest(), n) for n, b in sorted(files.items()))
files['MANIFEST.sha256.txt'] = manifest.encode()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in sorted(files.items()):
        zi = zipfile.ZipInfo('shords-pilot-kit/' + n, date_time=(2026, 11, 4, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
        z.writestr(zi, b)
print('files:', len(files)); print('zip sha256:', hashlib.sha256(open(out, 'rb').read()).hexdigest())
