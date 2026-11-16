<#
.SYNOPSIS
  STEP C of the Phase 6B approval package: ACQUIRE AND VERIFY. Windows PowerShell 5.1.
  C downloads files and checks their hashes. It does NOT extract anything and does NOT run any downloaded program.

.DESCRIPTION
  -Action Preflight   read-only checks and a printed plan. Writes nothing, downloads nothing.
  -Action Download    needs you to type APPROVE C. Downloads (resumable, to a .part file) with curl.exe over https, checks the SHA-256 of each
                      file against the expected value, and only then renames .part to the final name. Writes D:\llm\verified-artifacts.json.
  -Action Verify      read-only: re-computes the hashes of files already downloaded and compares them.
  -Group              runtime (the two llama.cpp zips) | model8b | model4b | all  (default: runtime + model8b; the 4B fallback only when asked)

  Network: github.com (llama.cpp zips) and huggingface.co (model; Hugging Face redirects to its own download host, which curl follows).
  Files written: only under the root folder (default D:\llm). No setting, PATH, registry or policy is changed.
  Rollback: Rollback.ps1 -Scope Downloads (and -Scope Models), or delete D:\llm.
  NOT EXECUTED by its author on any PowerShell. Run the parser check from 10_PHASE6B_APPROVAL_PACKAGE.md first.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'Download', 'Verify')][string]$Action,
  [ValidateSet('default', 'runtime', 'model8b', 'model4b', 'all')][string]$Group = 'default',
  [string]$Root = 'D:\llm'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')

function Select-Artifacts {
  $all = $script:Artifacts
  switch ($Group) {
    'default' { return @($all | Where-Object { $_.Group -eq 'runtime' -or $_.Group -eq 'model8b' }) }
    'all'     { return @($all) }
    default   { return @($all | Where-Object { $_.Group -eq $Group }) }
  }
}

function Test-One {
  param($A)
  $path = Get-ArtifactPath $A
  if (-not (Test-Path -LiteralPath $path)) { return @{ Status = 'MISSING'; Path = $path } }
  $len = (Get-Item -LiteralPath $path).Length
  if ($A.Bytes -gt 0 -and $len -ne $A.Bytes) { return @{ Status = 'WRONG_SIZE'; Path = $path; Length = $len } }
  $h = Get-FileSha256 $path
  if ($h -ne $A.Sha256) { return @{ Status = 'HASH_MISMATCH'; Path = $path; Length = $len; Actual = $h } }
  return @{ Status = 'OK'; Path = $path; Length = $len; Actual = $h }
}

try {
  $items = Select-Artifacts

  if ($Action -eq 'Preflight') {
    Write-Host 'STEP C - PREFLIGHT (read-only; nothing is written or downloaded)'
    Write-Host ('PowerShell version      : ' + $PSVersionTable.PSVersion.ToString())
    if ($PSVersionTable.PSVersion.Major -ne 5) { Write-Host '  WARNING: these scripts were written for Windows PowerShell 5.1.' }
    $drive = Split-Path -Path $Root -Qualifier
    Write-Host ('Drive ' + $drive + ' present       : ' + (Test-Path ($drive + '\')))
    Write-Host ('Free disk on ' + $drive + '        : ' + (Get-GiBFree $Root) + ' GiB (needs at least ' + $script:Cfg.MinFreeDiskGiB + ' GiB)')
    $curl = Get-CurlPath
    Write-Host ('curl.exe                : ' + $(if ($curl) { $curl } else { 'NOT FOUND - Step C cannot download without it' }))
    Write-Host ('Available RAM now       : ' + (Get-AvailRamGiB) + ' GiB (not needed for step C; step D needs at least ' + $script:Cfg.MinAvailRamGiB + ' GiB)')
    try {
      $sac = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
      Write-Host ('Smart App Control state : ' + $sac + '  (0 = off, 1 = on, 2 = evaluation; recalled registry value, read-only). If 1 or 2, Windows may block the unsigned llama-server.exe in step D; do not switch it off without asking first, because it cannot be turned back on.')
    } catch { Write-Host 'Smart App Control state : could not be read (that is fine)' }
    $guardPaths = @($script:Cfg.Root, $script:Cfg.Downloads, $script:Cfg.Models)
    foreach ($a in $items) { $guardPaths += (Get-ArtifactPath $a) }
    foreach ($g in $guardPaths) { [void](Assert-UnderRoot $g) }
    Write-Host ('Path guard              : OK for the root, its sub-folders and ' + @($items).Count + ' target file(s); no junction or link found (read-only check)')
    Write-Host ''
    Write-Host 'Planned downloads:'
    $total = 0
    foreach ($a in $items) {
      $existing = Test-Path -LiteralPath (Get-ArtifactPath $a)
      Write-Host ('  ' + $a.File + '  (about ' + $a.ApproxMB + ' MiB)  ' + $(if ($existing) { '[already present - will be verified, not downloaded again]' } else { '' }))
      Write-Host ('    from     : ' + $a.Url)
      Write-Host ('    to       : ' + (Get-ArtifactPath $a))
      Write-Host ('    expected : sha256 ' + $a.Sha256 + $(if ($a.Bytes -gt 0) { ', size ' + $a.Bytes + ' bytes' } else { '' }))
      $total += $a.ApproxMB
    }
    Write-Host ('  Total about ' + [math]::Round($total / 1024, 2) + ' GiB')
    exit 0
  }

  if ($Action -eq 'Verify') {
    $bad = 0
    foreach ($a in $items) {
      $r = Test-One $a
      Write-Host ($r.Status.PadRight(14) + $a.File)
      if ($r.Status -ne 'OK') { $bad++ }
    }
    if ($bad -gt 0) { Write-Host ''; Write-Host ('PROBLEM: ' + $bad + ' file(s) missing or different. See 10_PHASE6B_APPROVAL_PACKAGE.md, section "If a hash does not match".'); exit 1 }
    Write-Host ''; Write-Host 'All selected files match their expected hashes.'
    exit 0
  }

  # ---- Download
  $curl = Get-CurlPath
  if (-not $curl) { throw 'curl.exe was not found (it ships with Windows 10 1803 and later). Nothing was downloaded.' }
  $free = Get-GiBFree $Root
  if ($free -lt $script:Cfg.MinFreeDiskGiB) { throw ('Only ' + $free + ' GiB free; at least ' + $script:Cfg.MinFreeDiskGiB + ' GiB are required. Nothing was downloaded.') }
  $names = ($items | ForEach-Object { $_.File }) -join ', '
  Confirm-Approval 'APPROVE C' ('STEP C will download over https and verify: ' + $names + ' into ' + $Root + '. Nothing will be extracted or run.')

  foreach ($d in @($script:Cfg.Root, $script:Cfg.Downloads, $script:Cfg.Models)) {
    [void](Assert-UnderRoot $d)
    if (-not (Test-Path -LiteralPath $d)) { [void](New-Item -ItemType Directory -Path $d) }
  }
  $marker = Read-Json $script:Cfg.Marker
  $records = @{}
  if ($marker -and $marker.files) { foreach ($p in $marker.files.PSObject.Properties) { $records[$p.Name] = $p.Value } }

  foreach ($a in $items) {
    $final = Get-ArtifactPath $a
    [void](Assert-UnderRoot $final)
    $part = $final + '.part'
    if (Test-Path -LiteralPath $final) {
      $r = Test-One $a
      if ($r.Status -ne 'OK') { throw ($a.File + ' already exists but is ' + $r.Status + '. It was left untouched; move or delete it (Rollback.ps1) and run again.') }
      Write-Host ('Already present and verified: ' + $a.File)
    } else {
      Write-Host ''
      Write-Host ('Downloading ' + $a.File + ' ...')
      & $curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --retry-delay 5 --continue-at - --output $part $a.Url
      if ($LASTEXITCODE -ne 0) { throw ('curl.exe failed with exit code ' + $LASTEXITCODE + ' for ' + $a.File + '. The partial file ' + $part + ' was kept; run the same command again to resume.') }
      $len = (Get-Item -LiteralPath $part).Length
      if ($a.Bytes -gt 0 -and $len -ne $a.Bytes) { throw ('Size mismatch for ' + $a.File + ': got ' + $len + ', expected ' + $a.Bytes + '. The .part file was kept.') }
      Write-Host 'Computing SHA-256 ...'
      $h = Get-FileSha256 $part
      if ($h -ne $a.Sha256) {
        throw ('HASH MISMATCH for ' + $a.File + "`n  expected " + $a.Sha256 + "`n  actual   " + $h + "`n  The file was NOT renamed (kept as .part). Compare the expected value with the one shown on the source page before concluding it is damaged; see the package document.")
      }
      Move-Item -LiteralPath $part -Destination $final
      Write-Host ('Verified and saved: ' + $final)
    }
    $fi = Get-Item -LiteralPath $final
    $records[$a.Id] = @{ file = $a.File; path = $final; sha256 = $a.Sha256; length = $fi.Length; lastWriteUtc = $fi.LastWriteTimeUtc.ToString('o'); verifiedAtUtc = (Get-Date).ToUniversalTime().ToString('o') }
  }
  Write-JsonFile @{ phase = '6B'; note = 'written by Step-C-Acquire.ps1 after each file matched its expected SHA-256'; files = $records } $script:Cfg.Marker
  Write-Host ''
  Write-Host 'STEP C finished. Nothing was extracted or run. Marker file: ' $script:Cfg.Marker
  exit 0
}
catch {
  Write-Host ''
  Write-Host ('STOPPED: ' + $_.Exception.Message)
  exit 1
}
