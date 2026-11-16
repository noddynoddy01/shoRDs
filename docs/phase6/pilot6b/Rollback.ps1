<#
.SYNOPSIS
  ROLLBACK / CLEANUP for Phase 6B. Windows PowerShell 5.1. Deletes only things this package created, only under the root folder (default D:\llm).

.DESCRIPTION
  -Scope Server     Stops the server that Step D started (same as Step-D-Run.ps1 -Action Stop). Deletes nothing.
  -Scope Install    Deletes exactly the files that Step D Install extracted, as listed in install-record.json, then the folders it created
                    (only when they are empty), then install-record.json and server.pid.json. Anything else found in those folders is LEFT IN PLACE
                    and reported. If there is no install record, nothing is deleted. Does NOT touch downloads, the model or the Phase 6A kit.
  -Scope Logs       Deletes only the log and report files Step D wrote (server-*, version-*, help-*, health-*, loadlog-extract-*) in <root>\logs and
                    <root>\health, then those two folders if they are empty.
  -Scope StepD      Install + Logs. This is the full undo of Step D. It never touches the downloaded zips or the model.
  -Scope Models     Deletes the .gguf model files listed in this package (<root>\models) and their entries in verified-artifacts.json.
  -Scope Downloads  Deletes only the two runtime zips and any *.part files this package downloaded, from <root>\downloads (the Phase 6A kit zip
                    and the r2/r3 scripts zips are not touched) and their entries in verified-artifacts.json.
  -Scope All        StepD + Models + Downloads. The Phase 6A kit and the scripts folders are removed only with -IncludeKit.

  -List             Show what would be deleted and how big it is, then stop. Nothing is changed. Does not ask anything.
  Deleting needs you to type the word DELETE. A running llama-server must not exist (the one Step D started is stopped first).
  Every path is checked with the same path guard as the other scripts: it must be inside the root folder and neither the root nor any
  folder on the way may be a junction or symbolic link. Deletion is by exact file name; no folder tree is ever deleted recursively.
  Never touched: PATH, registry, services, execution policy, firewall rules, Git, D:\shords, D:\Tools, anything outside the root folder.
  NOT EXECUTED by its author on any PowerShell: run the parser check and Test-PathGuard first.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Server', 'Install', 'Logs', 'StepD', 'Models', 'Downloads', 'All')][string]$Scope,
  [switch]$List,
  [switch]$IncludeKit,
  [string]$Root = 'D:\llm'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
if ($Root -match '\s') { Write-Host 'The root folder must not contain spaces.'; exit 2 }
$cfg = $script:Cfg

$script:Targets = New-Object System.Collections.ArrayList
$script:Notes = New-Object System.Collections.ArrayList

# Kind = 'file' (deleted by exact name) or 'dir' (removed only if it is empty at that moment)
function Add-Target {
  param([string]$Path, [string]$Kind, [string]$Marker)
  $canon = Assert-UnderRoot $Path
  if (-not (Test-Path -LiteralPath $canon)) { return }
  $item = Get-Item -LiteralPath $canon -Force
  if ($Kind -eq 'file' -and $item.PSIsContainer) { [void]$script:Notes.Add('Skipped (expected a file, found a folder): ' + $canon); return }
  if ($Kind -eq 'dir' -and -not $item.PSIsContainer) { [void]$script:Notes.Add('Skipped (expected a folder, found a file): ' + $canon); return }
  foreach ($t in $script:Targets) { if ($t.Path -ieq $canon) { return } }
  $bytes = 0
  if ($Kind -eq 'file') { $bytes = [int64]$item.Length }
  [void]$script:Targets.Add(@{ Path = $canon; Kind = $Kind; Bytes = $bytes; Marker = $Marker })
}

function Add-InstallTargets {
  $rec = Read-Json $cfg.InstallRecord
  if (-not $rec) {
    [void]$script:Notes.Add('There is no install-record.json, so I cannot tell which files Step D created. Nothing under the program folder is deleted. If ' + $cfg.LlamaDir + ' exists, remove it yourself after checking what is in it.')
    return
  }
  $destCanon = ConvertTo-CanonPath $rec.dest
  if ($destCanon -ine (ConvertTo-CanonPath $cfg.LlamaDir)) { throw ('install-record.json names a different folder (' + $rec.dest + '). Refusing; nothing was deleted.') }
  [void](Assert-UnderRoot $destCanon)
  foreach ($rel in @($rec.files)) {
    $p = ConvertTo-CanonPath (Join-Path $destCanon ([string]$rel))
    if (-not (Test-PathWithinRoot $p $destCanon) -or $p -ieq $destCanon) { throw ('install-record.json lists a path outside the install folder: ' + $rel + '. Refusing; nothing was deleted.') }
    Add-Target $p 'file' $null
  }
  $dirs = @()
  foreach ($d in @($rec.createdDirs)) {
    if ($d) {
      $p = ConvertTo-CanonPath (Join-Path $destCanon ([string]$d))
      if (-not (Test-PathWithinRoot $p $destCanon) -or $p -ieq $destCanon) { throw ('install-record.json lists a folder outside the install folder: ' + $d + '. Refusing; nothing was deleted.') }
      $dirs += $p
    }
  }
  foreach ($p in ($dirs | Sort-Object { $_.Length } -Descending)) { Add-Target $p 'dir' $null }
  Add-Target $destCanon 'dir' $null
  if ($rec.parentCreatedByInstall) { Add-Target (Split-Path -Path $destCanon -Parent) 'dir' $null }
  Add-Target $cfg.InstallRecord 'file' $null
  Add-Target $cfg.PidFile 'file' $null
}

function Add-LogTargets {
  foreach ($dir in @($cfg.Logs, $cfg.Health)) {
    $canon = Assert-UnderRoot $dir
    if (-not (Test-Path -LiteralPath $canon)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $canon -File -Force)) {
      if ($f.Name -like 'server-*' -or $f.Name -like 'version-*' -or $f.Name -like 'help-*' -or $f.Name -like 'health-*' -or $f.Name -like 'loadlog-extract-*') { Add-Target $f.FullName 'file' $null }
    }
    Add-Target $canon 'dir' $null
  }
}

function Add-ModelTargets {
  foreach ($a in @($script:Artifacts | Where-Object { $_.Group -like 'model*' })) { Add-Target (Get-ArtifactPath $a) 'file' $a.Id }
}

function Add-DownloadTargets {
  foreach ($a in @($script:Artifacts | Where-Object { $_.Group -eq 'runtime' })) { Add-Target (Get-ArtifactPath $a) 'file' $a.Id }
  foreach ($a in @($script:Artifacts)) { Add-Target ((Get-ArtifactPath $a) + '.part') 'file' $null }
}

try {
  if ($Scope -eq 'Server') {
    & (Join-Path $PSScriptRoot 'Step-D-Run.ps1') -Action Stop -Root $Root
    exit 0
  }

  switch ($Scope) {
    'Install'   { Add-InstallTargets }
    'Logs'      { Add-LogTargets }
    'StepD'     { Add-InstallTargets; Add-LogTargets }
    'Models'    { Add-ModelTargets }
    'Downloads' { Add-DownloadTargets }
    'All'       { Add-InstallTargets; Add-LogTargets; Add-ModelTargets; Add-DownloadTargets }
  }
  if ($IncludeKit -and $Scope -eq 'All') {
    Add-Target (Join-Path $cfg.Root 'downloads\shords-pilot-kit.zip') 'file' $null
  }

  Write-Host ('Scope: ' + $Scope + '   Root: ' + $cfg.Root)
  foreach ($n in $script:Notes) { Write-Host ('NOTE: ' + $n) }
  $files = @($script:Targets | Where-Object { $_.Kind -eq 'file' })
  $dirsT = @($script:Targets | Where-Object { $_.Kind -eq 'dir' })
  if ($files.Count -eq 0 -and $dirsT.Count -eq 0) { Write-Host 'Nothing to delete for this scope (nothing of it exists).'; exit 0 }
  [int64]$total = 0
  foreach ($x in $files) { $total += $x.Bytes }
  if ($files.Count -le 40) { foreach ($x in $files) { Write-Host ('  file  ' + ('{0,10:N1} MiB  ' -f ($x.Bytes / 1MB)) + $x.Path) } }
  else {
    foreach ($x in ($files | Select-Object -First 15)) { Write-Host ('  file  ' + ('{0,10:N1} MiB  ' -f ($x.Bytes / 1MB)) + $x.Path) }
    Write-Host ('  ... and ' + ($files.Count - 15) + ' more files')
  }
  foreach ($x in $dirsT) { Write-Host ('  folder (removed only if empty)  ' + $x.Path) }
  Write-Host ('  Total: ' + $files.Count + ' files, ' + [math]::Round($total / 1GB, 2) + ' GiB')
  Write-Host ('  Not on this list and never touched by this scope: the Phase 6A kit, the scripts folders' + $(if ($Scope -in @('Install', 'Logs', 'StepD')) { ', the downloaded zips, the model and verified-artifacts.json' } else { '' }))
  if ($List) { Write-Host 'List only. Nothing was changed.'; exit 0 }

  if (Get-ServerState) {
    Write-Host 'The server that Step D started is still running; stopping it first.'
    & (Join-Path $PSScriptRoot 'Step-D-Run.ps1') -Action Stop -Root $Root
  }
  if (Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue) { throw 'A llama-server process is still running (not started by this script). Close it yourself, then run this again. Nothing was deleted.' }

  Confirm-Approval 'DELETE' ('This will permanently delete the ' + $files.Count + ' file(s) listed above (' + [math]::Round($total / 1GB, 2) + ' GiB) and then remove the listed folders if they are empty. Nothing goes to the Recycle Bin.')

  $failed = @()
  foreach ($x in $files) {
    try { Remove-Item -LiteralPath $x.Path -Force; Write-Host ('Deleted ' + $x.Path) }
    catch { $failed += $x.Path; Write-Host ('COULD NOT DELETE ' + $x.Path + ' : ' + $_.Exception.Message) }
  }
  foreach ($x in $dirsT) {
    if (-not (Test-Path -LiteralPath $x.Path)) { continue }
    $left = @(Get-ChildItem -LiteralPath $x.Path -Force)
    if ($left.Count -eq 0) {
      try { Remove-Item -LiteralPath $x.Path -Force; Write-Host ('Removed empty folder ' + $x.Path) } catch { $failed += $x.Path; Write-Host ('COULD NOT REMOVE ' + $x.Path + ' : ' + $_.Exception.Message) }
    } else { Write-Host ('Left in place (not empty, ' + $left.Count + ' item(s) this package did not create): ' + $x.Path) }
  }

  # Keep the verification marker honest: drop the entries of files that were deleted.
  $ids = @($files | Where-Object { $_.Marker } | ForEach-Object { $_.Marker })
  if ($ids.Count -gt 0 -and (Test-Path -LiteralPath $cfg.Marker)) {
    $m = Read-Json $cfg.Marker
    if ($m -and $m.files) {
      $keep = [ordered]@{}
      foreach ($p in $m.files.PSObject.Properties) { if ($ids -notcontains $p.Name) { $keep[$p.Name] = $p.Value } }
      $o = [ordered]@{}
      foreach ($p in $m.PSObject.Properties) { if ($p.Name -ne 'files') { $o[$p.Name] = $p.Value } }
      $o['files'] = $keep
      Write-JsonFile $o $cfg.Marker
      Write-Host 'Updated verified-artifacts.json.'
    }
  }

  Write-Host ''
  Write-Host ('Free space on the drive now: ' + (Get-GiBFree $cfg.Root) + ' GiB')
  if ($failed.Count -gt 0) { Write-Host ('Some items could not be removed (' + $failed.Count + '). Close any program using them and run this again.'); exit 1 }
  Write-Host 'Rollback finished.'
  Write-Host 'Not removed by design: the NVIDIA shader cache (%LOCALAPPDATA%\NVIDIA\ComputeCache, may not exist), Windows Defender scan history, PowerShell command history, and any Windows Firewall rule you created yourself. See the rollback section of the approval package.'
}
catch {
  Write-Host ''
  Write-Host ('STOPPED: ' + $_.Exception.Message)
  exit 1
}
