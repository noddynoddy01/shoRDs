<#
.SYNOPSIS
  Phase 6C file-mailbox agent for the shoRDs local inference pilot. Windows PowerShell 5.1. ONE window, started by you, ends by itself.

.DESCRIPTION
  Watches <root>\jobs\inbox for small signed job files written by the builder (Claude) and runs ONLY the eight allowlisted job types:
  preflight, verify-integrity, server-start, server-stop, health, sweep, run-suite, collect. It opens NO port, runs NO command text from a job,
  reaches only http://127.0.0.1:8080, touches only files under <root>, and starts only the hash-checked llama-server.exe.
  Resource gates before every start and an emergency brake while the server runs can not be changed by a job.

  -Mode DryRun (default)  needs the phrase  APPROVE E-DRYRUN.  Validates every job, measures real RAM/VRAM/disk/port, hashes files, plans
                          server jobs WITHOUT starting anything, and records which job types it exercised (jobs\dryrun-complete.json).
  -Mode Live              needs the phrase  APPROVE E-LIVE  AND a completed dry run of this exact version. Starts/stops the local server.
  -Hours N                lease length (0.25 to 8, default 2). When it ends the agent stops the server and exits.

  End it any time: press Ctrl+C, close the window (Windows then also ends llama-server), or create an empty file  <root>\jobs\STOP .
  Not changed: PATH, registry, services, scheduled tasks, firewall, Defender, execution policy, Git, production, credentials.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 2
#>
[CmdletBinding()]
param(
  [ValidateSet('DryRun', 'Live')][string]$Mode = 'DryRun',
  [ValidateRange(0.25, 8)][double]$Hours = 2,
  [ValidateRange(2, 30)][int]$PollSeconds = 3,
  [string]$Root = 'D:\llm'
)
$ErrorActionPreference = 'Stop'
if ($Root -match '\s') { Write-Host 'The root folder must not contain spaces.'; exit 2 }
if (-not [Environment]::Is64BitProcess) { Write-Host 'This must run in 64-bit Windows PowerShell (not the x86 shortcut).'; exit 2 }
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Lib.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Runtime.ps1')

$leaseEnd = (Get-NowEpoch) + [long]($Hours * 3600)
Initialize-PilotContext -Mode $Mode -LeaseEndEpoch $leaseEnd
$P = $script:Ctx.P

if (Test-Path -LiteralPath $P.Stop) { Write-Host ('A STOP file exists (' + $P.Stop + '). Delete it when you want the agent to run again. Nothing was started.'); exit 3 }
if (Test-Path -LiteralPath $P.Lease) {
  try {
    $old = Get-Content -LiteralPath $P.Lease -Raw | ConvertFrom-Json
    $oldProc = Get-Process -Id ([int]$old.pid) -ErrorAction SilentlyContinue
    if ($old.state -ceq 'running' -and $oldProc -and $oldProc.ProcessName -match 'powershell|pwsh' -and ((ConvertTo-UtcDate $old.lease_end_utc) -gt (Get-Date).ToUniversalTime())) {
      Write-Host ('Another agent window seems to be running (process ' + $old.pid + '). Close it first. Nothing was started.'); exit 3
    }
  } catch { }
}

$required = $script:LiveRequired.agent
if ($Mode -ceq 'Live') {
  $mk = Test-DryRunMarker $required
  if (-not $mk.Ok) { Write-Host ('LIVE MODE REFUSED: ' + $mk.Why); Write-Host 'Run -Mode DryRun first and send every job type, then ask the builder for the next approval.'; exit 4 }
}

Write-Host ''
Write-Host ('shoRDs Phase 6C agent ' + $script:P6C.Version + '  mode ' + $Mode + '  root ' + $script:Cfg.Root + '  lease ' + $Hours + ' h')
Write-Host ('Job types it will run (nothing else is possible): ' + ($script:P6C.Types -join ', '))
Write-Host ('Resource gates: RAM >= ' + $script:P6C.RamBaseGiB + ' GiB at ctx 4096 (more for larger ctx), free VRAM >= estimate + ' + $script:P6C.VramMarginMiB + ' MiB, disk >= ' + $script:P6C.DiskMinGiB + ' GiB, port ' + $script:P6C.Port + ' free.')
Write-Host ('Emergency brake while a server runs: RAM < ' + $script:P6C.RamFloorGiB + ' GiB, VRAM > ' + $script:P6C.VramHardLimitMiB + ' MiB, any non-loopback listener or external connection, fatal log text, job time budget, STOP file, lease end.')
if ($Mode -ceq 'DryRun') {
  Confirm-Approval 'APPROVE E-DRYRUN' ('DRY RUN: this window will read your RAM/VRAM/disk, hash files under ' + $script:Cfg.Root + ', write job results, an audit log and a throw-away test key under ' + $script:Cfg.Root + '\jobs, \runs and \secrets. It will NOT start llama-server and will send no HTTP request.')
} else {
  Confirm-Approval 'APPROVE E-LIVE' ('LIVE: this window may start and stop llama-server (127.0.0.1:8080 only, API key, no web UI) on the jobs the builder sends, within the gates above, until ' + $Hours + ' hour(s) pass or you stop it.')
}

$orphan = Get-ServerState
if ($orphan) {
  if ($Mode -ceq 'Live') { Write-Host 'A server from an earlier session is still running; stopping it first.'; [void](Stop-PilotServer 'orphan-at-agent-start') }
  else { Write-Host ('NOTE: a llama-server (process ' + $orphan.Process.Id + ') is already running; the dry run will not touch it, and the start gate will report it.') }
}

$key = New-RandomHex 32
Write-AtomicText $P.SessionKey $key
$script:St.Key = $key
if (Test-Path -LiteralPath $P.SeenIds) { foreach ($l in @(Get-Content -LiteralPath $P.SeenIds)) { if ($l) { $script:St.Seen[[string]$l.Trim()] = $true } } }
Add-Audit 'agent-start' @{ version = $script:P6C.Version; pid = $PID; hours = $Hours; ps = $PSVersionTable.PSVersion.ToString(); root = $script:Cfg.Root }

Write-Host ''
Write-Host ('Agent is running. Inbox: ' + $P.Inbox)
Write-Host ('Stop it with Ctrl+C, by closing this window, or by creating the file ' + $P.Stop)
Write-Host '--------------------------------------------------------------------------'

$exitReason = 'lease-ended'
try {
  Update-Lease 'running'
  while ($true) {
    if (Test-Path -LiteralPath $P.Stop) { $exitReason = 'stop-file'; break }
    if ((Get-NowEpoch) -gt $script:St.LeaseEnd) { break }
    if ($script:St.Server) {
      $v = Get-MonitorVerdict $script:St.Server.Mon
      if ($v) { [void](Invoke-EmergencyShutdown $v 'between-jobs') } else { Test-ServerIdle }
    }
    $n = Invoke-InboxCycle
    Update-Lease 'running'
    if ($n -eq 0) { Start-Sleep -Seconds $PollSeconds }
  }
} finally {
  if ($script:St.Server) { [void](Stop-PilotServer ('agent-exit:' + $exitReason)) }
  try { Update-Lease 'ended' } catch { }
  Add-Audit 'agent-end' @{ reason = $exitReason; jobs_done = $script:St.JobsDone; jobs_rejected = $script:St.JobsRejected }
  Write-Host ''
  Write-Host ('Agent ended (' + $exitReason + '). Jobs run ' + $script:St.JobsDone + ', rejected ' + $script:St.JobsRejected + '. Port 8080 free: ' + (Test-PortFree))
}
