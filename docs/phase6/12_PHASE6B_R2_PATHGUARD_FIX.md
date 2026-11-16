# Phase 6B r2 - path-guard fix (2026-11-04)

Status: **fixed and tested here; NOT EXECUTED on any PowerShell.** I downloaded, installed, extracted and ran nothing on your PC. Step C needs a fresh approval after r2 passes your verification. Step D remains unapproved.

## 1. What happened

Step C Download stopped with `STOPPED: Refusing to touch a path outside D:\llm : D:\llm` before any file was written. Preflight had passed, because Preflight never called the path check; only Download did, so I missed it in review. Fail-safe outcome: nothing downloaded and, as far as the code goes, nothing created (the check runs before the first `New-Item`). The "APPROVE C" phrase you typed was consumed by that run.

## 2. Exact cause

The old `Assert-UnderRoot` built the allowed prefix as the root **plus a trailing backslash** and required the path to start with it:

```powershell
$rootFull = [System.IO.Path]::GetFullPath($script:Cfg.Root).TrimEnd('\') + '\'    # "D:\llm\"
if (-not $full.StartsWith($rootFull, OrdinalIgnoreCase)) { throw ... }            # $full is "D:\llm"
```

The first call in Step C's folder loop is for the root itself (`D:\llm`). `"D:\llm"` does not start with `"D:\llm\"` (it is one character shorter), so the root was rejected as outside itself. Children such as `D:\llm\downloads` would have passed; `D:\llm-evil` was correctly refused. The trailing backslash was added to stop the sibling-prefix problem, but the equal-to-root case was never allowed. (The message you pasted shows the root without the trailing backslash, while this code would print `D:\llm\`; I think that is a transcription detail, and either way it is the same defect. If your screen really showed no trailing backslash, tell me, because it would mean a different build was run.)

## 3. The fix (Phase6B.Common.ps1)

* `ConvertTo-CanonPath` (pure string logic, no disk access, no `GetFullPath`): accepts only absolute drive paths; `/` becomes `\`; empty and `.` segments dropped; `..` resolved and refused if it climbs above the drive; drive letter upper-cased; no trailing separator. **Refuses** empty, non-ASCII/control characters, `* ? " < > |`, UNC (`\\server`), device (`\\?\`, `\\.\`), relative and drive-relative (`D:llm`) forms, a colon after the drive (alternate data streams) and segments ending in a dot or space.
* `Test-PathWithinRoot`: equal to the root, **or** starts with root + `\` (whole-segment boundary), compared with OrdinalIgnoreCase. So `D:\llm`, `D:\llm\downloads`, `d:\LLM\Models` pass; `D:\llm-evil`, `D:\llmx`, `D:\other` fail.
* `Resolve-UnderRoot`: canonicalises both, refuses a drive as root, applies the boundary test, then walks root, each folder down to the path, and refuses if any **existing** one is a junction or symbolic link (reparse point). Parts that do not exist yet are fine. `Assert-UnderRoot` wraps it with the real `Test-Path` / `Get-Item` calls (read-only).
* Nothing weakened: every earlier refusal still holds and four classes are new (reparse points anywhere on the chain, UNC/device/ADS forms, trailing dot/space, non-ASCII). One residual limit: a link created between the check and the file operation (a race) is not caught.
* `Step-C-Acquire.ps1` Preflight now runs the guard (read-only) on the root, sub-folders and every target file and prints `Path guard : OK ...`, so this class of defect appears before any approval.
* Unchanged: Step-D-Run.ps1, Rollback.ps1, Parse-Check.ps1, Verify-Kit.ps1 (identical hashes). `Rollback.ps1` and Step D inherit the stricter guard through `Assert-UnderRoot`.

## 4. Tests

| Test | Where it runs | Status |
|------|---------------|--------|
| `Test-PathGuard.ps1`: 60 cases (root, root with trailing slash, children, forward slashes, doubled separators, `.`/`..`, lower/upper-case, sibling prefix `D:\llm-evil` / `D:\llmx`, `D:\other`, parent traversal to sibling/parent/above the drive, drive-relative, relative, UNC, `\\?\`, `\\.\`, ADS, trailing dot/space, wildcard, non-ASCII, empty, drive-as-root, 7 junction/symlink cases with fake answers, and every configured path and artifact path from `Phase6B.Common.ps1`) | Your PC, Windows PowerShell 5.1; touches no disk | **NOT EXECUTED** |
| `tests/test_pathguard_mirror.py`: line-by-line Python port of the three functions, run against the **same case table parsed out of `Test-PathGuard.ps1`**, plus source checks (old pattern gone, no `GetFullPath`, guard still called by Step C/D/Rollback, preflight calls it) | Here | **9 tests pass.** Proves the algorithm, not PowerShell |
| `backend/tests/node/pilot6bPathGuard.test.js` (registered in `npm run test:node`; runs the Python mirror when python3 exists, plus static checks incl. ASCII and no PowerShell-7-only operators) | Here / CI | **4 tests pass.** Full suite: 635 tests, 634 pass, 0 fail, 1 expected todo, on Node 22 and 24.22.1 |
| Mutation check (mirror): old defect reinserted fails 3 root cases; no segment boundary fails 4; case-sensitive compare fails 7; broken `..` handling fails 5 | Here | Done, as expected |

Static checks on all 7 `.ps1` files: ASCII only, braces/parentheses/brackets balanced, no `?.`, `??`, `&&`, `||`, no automatic-variable collisions, no duplicate function names, CRLF consistent inside the zip, manifest verified (8 of 8). I cannot parse them with the real PowerShell parser; `Parse-Check.ps1` on your PC does.

## 5. Complete diff against the withdrawn zip (the only two files that changed besides the new test file, README and builder)

```diff
--- Phase6B.Common.ps1 (zip 1, withdrawn)
+++ Phase6B.Common.ps1 (r2)
@@ -54,12 +54,78 @@
   if ($answer -cne $Phrase) { Write-Host 'Cancelled. Nothing was changed.'; exit 3 }
 }
 
+# ---- Path safety (rewritten after the first Step C run: the old check required "root + backslash" as a prefix, so the root folder itself was refused) ----
+# ConvertTo-CanonPath is pure string logic (no file system access, no .NET GetFullPath), so it behaves the same everywhere and can be tested
+# without touching the disk. It accepts only absolute drive paths such as D:\llm\models, turns / into \, removes empty and "." segments,
+# resolves ".." (refusing to climb above the drive), upper-cases the drive letter, and removes trailing separators.
+# It REFUSES: empty text, non-ASCII or control characters, * ? " < > |, UNC (\\server), device (\\?\ and \\.\), relative and drive-relative
+# (D:llm) forms, a colon after the drive (NTFS alternate data streams), and segments ending in "." or a space (Windows would silently drop them).
+function ConvertTo-CanonPath {
+  param([string]$Path)
+  if ([string]::IsNullOrEmpty($Path)) { throw 'Refusing an empty path.' }
+  foreach ($ch in $Path.ToCharArray()) {
+    $code = [int]$ch
+    if ($code -lt 32 -or $code -gt 126) { throw ('Refusing a path with a control or non-ASCII character: ' + $Path) }
+  }
+  if ($Path -match '[*?"<>|]') { throw ('Refusing a path with a wildcard or reserved character: ' + $Path) }
+  $p = $Path.Replace('/', '\')
+  if ($p -notmatch '^[A-Za-z]:\\') { throw ('Refusing a path that is not an absolute drive path such as D:\llm (UNC, device, relative and drive-relative forms are refused): ' + $Path) }
+  if ($p.IndexOf(':', 2) -ge 0) { throw ('Refusing a path with a colon after the drive letter (alternate data stream): ' + $Path) }
+  $parts = New-Object System.Collections.ArrayList
+  foreach ($seg in $p.Substring(3).Split('\')) {
+    if ($seg -eq '' -or $seg -eq '.') { continue }
+    if ($seg -eq '..') {
+      if ($parts.Count -eq 0) { throw ('Refusing a path that climbs above the drive root: ' + $Path) }
+      $parts.RemoveAt($parts.Count - 1)
+      continue
+    }
+    if ($seg.EndsWith('.') -or $seg.EndsWith(' ')) { throw ('Refusing a path segment that ends with a dot or a space: ' + $Path) }
+    [void]$parts.Add($seg)
+  }
+  return ($p.Substring(0, 1).ToUpperInvariant() + ':\' + ($parts -join '\'))
+}
+
+# True when CanonPath is the root itself or lies below it. Both arguments must already be canonical. The boundary is a whole path segment:
+# D:\llm\models and D:\llm are inside D:\llm; D:\llm-evil and D:\llmx are not. Windows file names are case-insensitive, so the compare is too.
+function Test-PathWithinRoot {
+  param([string]$CanonPath, [string]$CanonRoot)
+  if ([string]::Equals($CanonPath, $CanonRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
+  $prefix = $CanonRoot
+  if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
+  return $CanonPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
+}
+
+# Full check. Throws unless Path is inside Root AND neither Root nor any existing folder/file on the way from Root down to Path is a
+# junction or symbolic link (reparse point). Exists/IsReparse are script blocks so the test script can supply fakes without touching the disk.
+# Returns the canonical path. A path whose later parts do not exist yet is fine (the scripts create them under a checked parent).
+function Resolve-UnderRoot {
+  param([string]$Path, [string]$Root, [scriptblock]$Exists, [scriptblock]$IsReparse)
+  $cr = ConvertTo-CanonPath $Root
+  if ($cr.Length -le 3) { throw ('The root folder must not be a whole drive: ' + $Root) }
+  $cp = ConvertTo-CanonPath $Path
+  if (-not (Test-PathWithinRoot $cp $cr)) { throw ('Refusing to touch a path outside ' + $cr + ' : ' + $cp) }
+  $chain = New-Object System.Collections.ArrayList
+  [void]$chain.Add($cr)
+  if ($cp.Length -gt $cr.Length) {
+    $acc = $cr
+    foreach ($seg in $cp.Substring($cr.Length + 1).Split('\')) {
+      $acc = $acc + '\' + $seg
+      [void]$chain.Add($acc)
+    }
+  }
+  foreach ($c in $chain) {
+    if (& $Exists $c) {
+      if (& $IsReparse $c) { throw ('Refusing ' + $c + ': it is a junction or symbolic link (reparse point).') }
+    }
+  }
+  return $cp
+}
+
 function Assert-UnderRoot {
   param([string]$Path)
-  $full = [System.IO.Path]::GetFullPath($Path)
-  $rootFull = [System.IO.Path]::GetFullPath($script:Cfg.Root).TrimEnd('\') + '\'
-  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Refusing to touch a path outside ' + $rootFull + ' : ' + $full) }
-  return $full
+  $exists = { param($p) Test-Path -LiteralPath $p }
+  $isReparse = { param($p) [bool]((Get-Item -LiteralPath $p -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) }
+  return (Resolve-UnderRoot -Path $Path -Root $script:Cfg.Root -Exists $exists -IsReparse $isReparse)
 }
 
 function Get-AvailRamGiB {
```

```diff
--- Step-C-Acquire.ps1 (zip 1, withdrawn)
+++ Step-C-Acquire.ps1 (r2)
@@ -61,6 +61,10 @@
       $sac = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
       Write-Host ('Smart App Control state : ' + $sac + '  (0 = off, 1 = on, 2 = evaluation; recalled registry value, read-only). If 1 or 2, Windows may block the unsigned llama-server.exe in step D; do not switch it off without asking first, because it cannot be turned back on.')
     } catch { Write-Host 'Smart App Control state : could not be read (that is fine)' }
+    $guardPaths = @($script:Cfg.Root, $script:Cfg.Downloads, $script:Cfg.Models)
+    foreach ($a in $items) { $guardPaths += (Get-ArtifactPath $a) }
+    foreach ($g in $guardPaths) { [void](Assert-UnderRoot $g) }
+    Write-Host ('Path guard              : OK for the root, its sub-folders and ' + @($items).Count + ' target file(s); no junction or link found (read-only check)')
     Write-Host ''
     Write-Host 'Planned downloads:'
     $total = 0
```

New files: `Test-PathGuard.ps1`, `tests/test_pathguard_mirror.py` (not in the zip), `backend/tests/node/pilot6bPathGuard.test.js`. Edited: `README_FIRST.txt` (r2 note, new check), `build_pilot6b.py` (r2 name and folder, includes the self-test), `package.json` (test registered), docs 10 and 11.

## 6. Replacement instructions (no deletion, nothing overwritten)

r2 extracts into its **own folder**, `D:\llm\shords-pilot6b-r2`. The old `shords-pilot6b` folder and zip stay where they are, unused. Please do not run anything from them.

1. Save `shords-pilot6b-scripts-r2.zip` (attached) into `D:\llm\downloads`.
2. Fresh verification commands:

```powershell
# a) the zip itself - must print exactly this value
(Get-FileHash -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r2.zip -Algorithm SHA256).Hash.ToLower()
# expected: 0e4c38adea936c53e4e5e020e868ca4555b6c6852871570df967cd39cfce9108      (size 25,313 bytes)

# b) extract into the new folder (creates D:\llm\shords-pilot6b-r2, 9 small files)
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r2.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6b-r2

# c) read-only checks (no network, nothing is run)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1       # expect: Kit verified: 8 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1      # expect: 7 lines "OK" then: All 7 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-PathGuard.ps1   # expect: All 60 path-guard cases behaved as expected.

# d) optional, read-only: confirm the failed run left nothing behind
Get-ChildItem -LiteralPath D:\llm -Force | Select-Object Name, Mode
Test-Path D:\llm\models ; Test-Path D:\llm\verified-artifacts.json     # expect False and False
```

3. Send me the output of (a), (c) and (d). If any line differs, stop; do not run Step C.
4. Optional second look (read-only): `.\Step-C-Acquire.ps1 -Action Preflight` should now also print `Path guard : OK for the root, its sub-folders and 3 target file(s) ...`. Run it from the **r2** folder.

If `Test-PathGuard.ps1` or the Preflight guard line fails on your PC, the output will name the case, and I will fix it before asking for anything else. If `D:\llm` or `D:\llm\downloads` turns out to be a junction or link (for example a cloud-synced folder), the guard will refuse it on purpose; tell me and we will pick a plain folder.

## 7. Approval scope

Unchanged. Step C is **not** authorised by your earlier approval; it needs a fresh message from you after (c) and (d) look right. Step D remains unapproved. Nothing downloaded, installed, extracted, executed, launched or processed on your PC by me; no Git change, credentials, production, GPU rental or spend.
