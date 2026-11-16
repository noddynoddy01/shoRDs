#!/usr/bin/env python3
"""Mirror test for the Phase 6B path guard (Phase6B.Common.ps1: ConvertTo-CanonPath, Test-PathWithinRoot, Resolve-UnderRoot).

WHAT THIS IS: a line-by-line Python port of the PowerShell functions, run against the SAME case table that Test-PathGuard.ps1 contains
(the table is parsed out of that file, so the two cannot drift apart). It proves the ALGORITHM. It does NOT prove that the PowerShell
text parses or behaves identically on Windows PowerShell 5.1 - only Test-PathGuard.ps1 run on the owner's PC can show that.
It also checks the PowerShell source for the old defect and for structure that must stay.
Run: python3 -I docs/phase6/pilot6b/tests/test_pathguard_mirror.py
"""
import os, re, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PS = os.path.join(HERE, '..')


def _read(name):
    with open(os.path.join(PS, name), encoding='ascii') as f:
        return f.read()


class GuardError(Exception):
    pass


def canon(path):  # ConvertTo-CanonPath
    if path is None or path == '':
        raise GuardError('empty')
    for ch in path:
        if ord(ch) < 32 or ord(ch) > 126:
            raise GuardError('non-ascii/control')
    if re.search(r'[*?"<>|]', path):
        raise GuardError('reserved char')
    p = path.replace('/', '\\')
    if not re.match(r'^[A-Za-z]:\\', p):
        raise GuardError('not absolute drive path')
    if p.find(':', 2) >= 0:
        raise GuardError('colon after drive')
    parts = []
    for seg in p[3:].split('\\'):
        if seg == '' or seg == '.':
            continue
        if seg == '..':
            if not parts:
                raise GuardError('above drive root')
            parts.pop()
            continue
        if seg.endswith('.') or seg.endswith(' '):
            raise GuardError('trailing dot/space')
        if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$', seg.split('.')[0].upper()):
            raise GuardError('reserved device name')
        parts.append(seg)
    return p[0].upper() + ':\\' + '\\'.join(parts)


def within(cp, cr):  # Test-PathWithinRoot (OrdinalIgnoreCase ~ casefold for ASCII)
    if cp.lower() == cr.lower():
        return True
    prefix = cr if cr.endswith('\\') else cr + '\\'
    return cp.lower().startswith(prefix.lower())


def resolve(path, root, exists, is_reparse):  # Resolve-UnderRoot
    cr = canon(root)
    if len(cr) <= 3:
        raise GuardError('root is a whole drive')
    cp = canon(path)
    if not within(cp, cr):
        raise GuardError('outside root')
    chain = [cr]
    if len(cp) > len(cr):
        acc = cr
        for seg in cp[len(cr) + 1:].split('\\'):
            acc = acc + '\\' + seg
            chain.append(acc)
    for c in chain:
        if exists(c) and is_reparse(c):
            raise GuardError('reparse point')
    return cp


def zip_entry(name, dest='D:\\llm\\llama.cpp\\b11669'):  # Test-ZipEntryName
    if name is None or name == '':
        raise GuardError('empty')
    if re.match(r'^[\\/]', name) or ':' in name:
        raise GuardError('absolute/colon')
    if '..' in name.replace('\\', '/').split('/'):
        raise GuardError('traversal')
    target = canon(dest.rstrip('\\') + '\\' + name)  # Join-Path
    if not within(target, dest):
        raise GuardError('outside')
    return target


def old_assert(path, root):  # the defect: Assert-UnderRoot as shipped in zip 69864c2b... (root + '\' prefix only)
    full = path.rstrip('\\')
    root_full = root.rstrip('\\') + '\\'
    return full.lower().startswith(root_full.lower())


ALL = lambda p: True
NONE = lambda p: False
BLOCKS = {
    'allExist': ALL, 'noneExists': NONE, 'noReparse': NONE,
    'reparseDownloads': lambda p: p.lower() == 'd:\\llm\\downloads',
    'reparseRoot': lambda p: p.lower() == 'd:\\llm',
    'reparseLeaf': lambda p: p.lower() == 'd:\\llm\\models\\qwen3-8b-q4_k_m.gguf',
}


def load_cases():
    src = open(os.path.join(PS, 'Test-PathGuard.ps1'), encoding='ascii').read()
    rx = re.compile(r"^Test-Case '([^']*)'\s+(\(.*?\)|'[^']*')\s+'([^']*)' \$(true|false)(?: +\$(\w+)(?: +\$(\w+))?)?(?: +'([^']*)')?\s*$", re.M)
    out = []
    for name, path, root, ok, ex, rp, expcanon in rx.findall(src):
        if path.startswith('('):
            path = 'D:\\llm\\\u00fc'  # the only computed path in the table
        else:
            path = path[1:-1]
        out.append((name, path, root, ok == 'true', BLOCKS[ex or 'allExist'], BLOCKS[rp or 'noReparse'], expcanon))
    return out


def load_zip_cases():
    src = open(os.path.join(PS, 'Test-PathGuard.ps1'), encoding='ascii').read()
    rx = re.compile(r"^Test-ZipCase '([^']*)'\s+(\(.*?\)|'[^']*')\s+\$(true|false)\s*$", re.M)
    out = []
    for name, entry, ok in rx.findall(src):
        entry = 'bin/\u00fc.dll' if entry.startswith('(') else entry[1:-1]
        out.append((name, entry, ok == 'true'))
    return out


class Mirror(unittest.TestCase):
    def test_zip_entry_cases(self):
        cases = load_zip_cases()
        self.assertEqual(len(cases), len(re.findall(r"^Test-ZipCase '", open(os.path.join(PS, 'Test-PathGuard.ps1')).read(), re.M)))
        self.assertGreaterEqual(len(cases), 20)
        for name, entry, ok in cases:
            with self.subTest(name):
                try:
                    zip_entry(entry)
                    accepted = True
                except GuardError:
                    accepted = False
                self.assertEqual(accepted, ok, name)

    def test_table_is_complete(self):
        src = open(os.path.join(PS, 'Test-PathGuard.ps1'), encoding='ascii').read()
        n_lines = len(re.findall(r"^Test-Case '", src, re.M))
        self.assertEqual(len(load_cases()), n_lines, 'every Test-Case line must be parsed')
        self.assertGreaterEqual(n_lines, 55)

    def test_all_cases(self):
        for name, path, root, ok, ex, rp, expcanon in load_cases():
            with self.subTest(name):
                try:
                    got = resolve(path, root, ex, rp)
                    accepted = True
                except GuardError:
                    accepted = False
                    got = None
                self.assertEqual(accepted, ok, name)
                if ok and expcanon:
                    self.assertEqual(got, expcanon, name)

    def test_required_examples_from_the_owner(self):
        for good in ('D:\\llm', 'D:\\llm\\downloads', 'D:\\llm\\models'):
            self.assertEqual(resolve(good, 'D:\\llm', NONE, NONE), good)
        for bad in ('D:\\llm-evil', 'D:\\other', 'D:\\llm\\..\\other', 'D:\\llm\\..\\llm-evil'):
            with self.assertRaises(GuardError, msg=bad):
                resolve(bad, 'D:\\llm', NONE, NONE)
        with self.assertRaises(GuardError):
            resolve('D:\\llm\\downloads\\a.zip', 'D:\\llm', ALL, BLOCKS['reparseDownloads'])

    def test_old_check_reproduces_the_reported_failure(self):
        # D:\llm (no trailing separator) was refused as "outside" itself; the siblings were correctly refused.
        self.assertFalse(old_assert('D:\\llm', 'D:\\llm'))
        self.assertTrue(old_assert('D:\\llm\\models', 'D:\\llm'))
        self.assertFalse(old_assert('D:\\llm-evil', 'D:\\llm'))

    def test_every_case_class_has_a_case(self):
        names = ' | '.join(c[0] for c in load_cases()).lower()
        for needle in ('root itself', 'sibling', 'traversal', 'lower-case', 'upper-case', 'junction', 'symbolic', 'unc', 'device', 'com1', 'conin'):
            self.assertIn(needle, names, needle)


class PowerShellSource(unittest.TestCase):
    def setUp(self):
        self.common = _read('Phase6B.Common.ps1')

    def test_old_pattern_is_gone(self):
        self.assertNotIn("TrimEnd('\\') + '\\'\n  if (-not $full.StartsWith", self.common)
        self.assertNotIn('GetFullPath', re.sub(r'#.*', '', self.common), 'guard must not depend on .NET GetFullPath')

    def test_guard_structure_present(self):
        for token in ('function ConvertTo-CanonPath', 'function Test-PathWithinRoot', 'function Resolve-UnderRoot', 'function Assert-UnderRoot',
                      '[System.StringComparison]::OrdinalIgnoreCase', 'ReparsePoint', "-ge 0) { throw", 'whole drive'):
            self.assertIn(token, self.common, token)

    def test_every_caller_still_uses_the_guard(self):
        counts = {}
        for f in ('Step-C-Acquire.ps1', 'Step-D-Run.ps1', 'Rollback.ps1'):
            counts[f] = open(os.path.join(PS, f), encoding='ascii').read().count('Assert-UnderRoot')
        self.assertGreaterEqual(counts['Step-C-Acquire.ps1'], 3)  # preflight loop, folder creation, final path
        self.assertGreaterEqual(counts['Step-D-Run.ps1'], 3)
        self.assertGreaterEqual(counts['Rollback.ps1'], 1)

    def test_preflight_exercises_the_guard(self):
        c = _read('Step-C-Acquire.ps1')
        i = c.index("if ($Action -eq 'Preflight')")
        j = c.index("if ($Action -eq 'Verify')")
        self.assertIn('Assert-UnderRoot', c[i:j])


class StepDAndRollbackSource(unittest.TestCase):
    def setUp(self):
        self.d = _read('Step-D-Run.ps1')
        self.r = _read('Rollback.ps1')

    def fn(self, text, name):
        i = text.index('function ' + name)
        j = text.index('\n}\n', i) + 3          # a function ends at the first closing brace in column 0
        return text[i:j]

    def test_install_validates_before_writing_and_never_overwrites(self):
        inst = self.fn(self.d, 'Invoke-Install')
        self.assertLess(inst.index('PASS 1'), inst.index('PASS 2'))
        self.assertLess(inst.index('Test-ZipEntryName'), inst.index('ExtractToFile'))
        self.assertIn('ExtractToFile($item.Entry, $item.Target, $false)', inst)
        for token in ('Two archive entries map to the same file', 'Target already exists', 'Assert-UnderRoot $targetCanon', '6GB', 'APPROVE D'):
            self.assertIn(token, inst, token)
        self.assertLess(inst.index('Write-JsonFile $record'), inst.index('ExtractToFile'), 'record must be written before the first file')
        self.assertNotIn('-Force', re.sub(r'New-Item[^\n]*', '', inst.split('PASS 2')[1].split('ExtractToFile')[0]).replace('-Recurse -Filter', ''))

    def test_install_refuses_when_vc_runtime_missing_before_extracting(self):
        inst = self.fn(self.d, 'Invoke-Install')
        self.assertLess(inst.index('Get-VcRuntimeStatus'), inst.index('Confirm-Approval'))

    def test_rollback_install_scope_is_record_driven_and_never_touches_artifacts(self):
        body = self.fn(self.r, 'Add-InstallTargets')
        for forbidden in ('Downloads', 'Models', 'Artifacts', 'Get-ArtifactPath', 'gguf', '.zip'):
            self.assertNotIn(forbidden, body, forbidden)
        self.assertIn('$rec.files', body)
        self.assertNotRegex(self.r, r'Remove-Item[^\n]*-Recurse')
        self.assertIn("'StepD'     { Add-InstallTargets; Add-LogTargets }", self.r)

    def test_rollback_downloads_scope_names_only_runtime_zips(self):
        body = self.fn(self.r, 'Add-DownloadTargets')
        self.assertIn("$_.Group -eq 'runtime'", body)
        self.assertNotIn('kit', body.lower())

    def test_listener_and_brake_present(self):
        self.assertIn('Test-LoopbackOnly', self.d)
        self.assertGreaterEqual(self.d.count('EMERGENCY BRAKE'), 2)
        self.assertIn("'127.0.0.1'", self.d)
        self.assertIn('--host', self.d)

    def test_firewall_and_security_settings_are_never_changed(self):
        for token in ('New-NetFirewallRule', 'Set-NetFirewall', 'Remove-NetFirewall', 'Set-ExecutionPolicy', 'Set-MpPreference', 'Add-MpPreference', 'netsh', 'reg add', 'setx', 'Set-ItemProperty', 'New-ItemProperty', 'SetEnvironmentVariable'):
            for name, text in (('Step-D', self.d), ('Rollback', self.r)):
                self.assertNotIn(token, text, name + ' must not use ' + token)


if __name__ == '__main__':
    unittest.main(verbosity=2)
