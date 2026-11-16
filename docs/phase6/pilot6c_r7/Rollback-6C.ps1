<#
.SYNOPSIS
  Undo for Phase 6C: removes ONLY files this package's agent/orchestrator created under <root>, by known folder and file-name pattern.
  Windows PowerShell 5.1. Lists first; deleting needs the typed word DELETE. Never recursive. Never touches llama.cpp, models, downloads,
  install-record.json, verified-artifacts.json, health reports from Phase 6B, the r3 kit, or D:\shords. (Rollback.ps1 of the r3 kit undoes Phase 6B.)

.DESCRIPTION
  -Scope Jobs     jobs\inbox|work|outbox|rejected|archive files, jobs\audit.jsonl, seen-ids.txt, .session-key, dryrun-complete.json, agent.lease.json, STOP
  -Scope Runs     runs\<id>\*.json  (one level) and the empty run folders
  -Scope Secrets  secrets\server.key and secrets\dryrun.key
  -Scope Suites   suites\*.json
  -Scope Logs     logs\agent-server-*.log, logs\agent-monitor-*.csv, health\health-agent-*.json, health\sweep-*.json
  -Scope All      all of the above, then the empty folders jobs\*, jobs, runs, secrets, suites
  -List           show what would be removed and change nothing (shows the list and changes nothing; without -List it lists, then asks you to type DELETE)
  Refuses while a llama-server started by this package is running (stop it first: Step-D-Run.ps1 -Action Stop).
  A file that does not match the expected name pattern is left alone and reported.
#>
[CmdletBinding()]
param(
  [ValidateSet('Jobs', 'Runs', 'Secrets', 'Suites', 'Logs', 'All')][string]$Scope = 'All',
  [switch]$List,
  [string]$Root = 'D:\llm'
)
$ErrorActionPreference = 'Stop'
# ValidateSet ignores case and keeps the typed spelling; the rules below compare case-sensitively, so settle the exact spelling first.
foreach ($known in @('Jobs', 'Runs', 'Secrets', 'Suites', 'Logs', 'All')) { if ($known.ToLowerInvariant() -ceq $Scope.ToLowerInvariant()) { $Scope = $known } }
if ($Root -match '\s') { Write-Host 'The root folder must not contain spaces.'; exit 2 }
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
if (Get-ServerState) { Write-Host 'A llama-server started by this package is running. Stop it first (Step-D-Run.ps1 -Action Stop). Nothing was changed.'; exit 3 }

$jobs = Join-Path $Root 'jobs'
# each rule: folder, file-name pattern (case-sensitive regex), recurse one level into sub-folders?
$rules = @()
if ($Scope -ceq 'Jobs' -or $Scope -ceq 'All') {
  foreach ($d in @('inbox', 'work', 'outbox', 'rejected', 'archive')) { $rules += @{ Dir = (Join-Path $jobs $d); Pattern = '\A[A-Za-z0-9._-]{1,120}\z' } }
  $rules += @{ Dir = $jobs; Pattern = '\A(audit\.jsonl|seen-ids\.txt|\.session-key|dryrun-complete\.json|agent\.lease\.json|STOP)(\.tmp-[0-9a-f]+)?\z' }
}
if ($Scope -ceq 'Runs' -or $Scope -ceq 'All') { $rules += @{ Dir = (Join-Path $Root 'runs'); Pattern = '\A[A-Za-z0-9._-]{1,120}\.json\z'; Sub = $true } }
if ($Scope -ceq 'Secrets' -or $Scope -ceq 'All') { $rules += @{ Dir = (Join-Path $Root 'secrets'); Pattern = '\A(server|dryrun)\.key\z' } }
if ($Scope -ceq 'Suites' -or $Scope -ceq 'All') { $rules += @{ Dir = (Join-Path $Root 'suites'); Pattern = '\A[a-z0-9][a-z0-9_-]{1,40}\.json\z' } }
if ($Scope -ceq 'Logs' -or $Scope -ceq 'All') {
  $rules += @{ Dir = (Join-Path $Root 'logs'); Pattern = '\A(agent-server-[0-9-]+\.(out|err)\.log|agent-monitor-[0-9-]+\.csv)\z' }
  $rules += @{ Dir = (Join-Path $Root 'health'); Pattern = '\A(health-agent|sweep)-[0-9-]+\.json\z' }
}

$del = New-Object System.Collections.ArrayList
$keep = New-Object System.Collections.ArrayList
$dirs = New-Object System.Collections.ArrayList
foreach ($r in $rules) {
  $dir = $r.Dir
  [void](Assert-UnderRoot $dir)
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  $targets = @(Get-Item -LiteralPath $dir)
  if ($r.Sub) {
    foreach ($sd in @(Get-ChildItem -LiteralPath $dir -Directory -Force)) { [void](Assert-UnderRoot $sd.FullName); $targets += $sd; [void]$dirs.Add($sd.FullName) }
  }
  foreach ($t in $targets) {
    foreach ($f in @(Get-ChildItem -LiteralPath $t.FullName -File -Force)) {
      [void](Assert-UnderRoot $f.FullName)
      if ($f.Name -cmatch $r.Pattern) { [void]$del.Add($f.FullName) } else { [void]$keep.Add($f.FullName) }
    }
  }
}
Write-Host ('Scope ' + $Scope + ': ' + $del.Count + ' file(s) match the Phase 6C patterns; ' + $keep.Count + ' other file(s) will be left alone.')
foreach ($f in $del) { Write-Host ('  remove  ' + $f) }
foreach ($f in $keep) { Write-Host ('  KEEP    ' + $f + '   (does not match the expected pattern)') }
if ($List -or $del.Count -eq 0) { Write-Host 'Listed only. Nothing was changed.'; exit 0 }
$answer = Read-Host 'Type exactly  DELETE  to remove the files listed above (anything else cancels)'
if ($answer -cne 'DELETE') { Write-Host 'Cancelled. Nothing was changed.'; exit 3 }
foreach ($f in $del) { Remove-Item -LiteralPath $f -Force }
$allDirs = @($dirs | Sort-Object -Descending)
if ($Scope -ceq 'All') {
  foreach ($d in @('inbox', 'work', 'outbox', 'rejected', 'archive')) { $allDirs += (Join-Path $jobs $d) }
  $allDirs += $jobs; $allDirs += (Join-Path $Root 'runs'); $allDirs += (Join-Path $Root 'secrets'); $allDirs += (Join-Path $Root 'suites')
}
foreach ($d in $allDirs) {
  [void](Assert-UnderRoot $d)
  if ((Test-Path -LiteralPath $d) -and @(Get-ChildItem -LiteralPath $d -Force).Count -eq 0) { [System.IO.Directory]::Delete($d); Write-Host ('  removed empty folder ' + $d) }
}
Write-Host ('Removed ' + $del.Count + ' file(s).')
