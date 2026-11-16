<#
.SYNOPSIS
  Phase 6C one-command orchestrator: preflight -> integrity (quick) -> server-start -> health -> server-stop, in this window, with the
  same handlers, gates and emergency brake as Pilot-Agent.ps1, and one consolidated JSON report. Windows PowerShell 5.1.

.DESCRIPTION
  -Mode DryRun (default)  needs  APPROVE E-DRYRUN : plans the server steps without starting anything (see Pilot-Agent.ps1).
  -Mode Live              needs  APPROVE E-LIVE   and a completed dry run of this version that covered these five job types.
  -Ngl / -ContextSize     GPU layers (0-20) and context (4096, 8192, 12288). -Ctx still works as an alias of -ContextSize (the script parameter
                          is NOT called $Ctx: Phase6C.Runtime.ps1 owns the script-scope variable $script:Ctx, the pilot context; r4 clashed there). The gates decide whether the combination is allowed.
  Report: <root>\runs\<run id>\report.json . The server is always stopped at the end (also on Ctrl+C or an error); the window closing ends it too.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096
#>
[CmdletBinding()]
param(
  [ValidateSet('DryRun', 'Live')][string]$Mode = 'DryRun',
  [ValidateRange(0, 20)][int]$Ngl = 8,
  [Alias('Ctx')][ValidateSet(4096, 8192, 12288)][int]$ContextSize = 4096,
  [string]$Root = 'D:\llm',
  [switch]$BindingTest
)
$ErrorActionPreference = 'Stop'
# ValidateSet ignores case and keeps the spelling that was typed (for example 'live'); everything below compares case-sensitively, so settle the exact spelling first.
if ($Mode.ToLowerInvariant() -ceq 'live') { $Mode = 'Live' } else { $Mode = 'DryRun' }
if ($Root -match '\s') { Write-Host 'The root folder must not contain spaces.'; exit 2 }
if (-not [Environment]::Is64BitProcess) { Write-Host 'This must run in 64-bit Windows PowerShell.'; exit 2 }
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Lib.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Runtime.ps1')

# -BindingTest (used by Test-Orchestrator.ps1): prove that the script parameters survived dot-sourcing, then stop. Touches no file, process or network.
if ($BindingTest) {
  Write-Host ('BINDING-TEST Mode=' + $Mode + ' Ngl=' + $Ngl + ' ContextSize=' + $ContextSize + ' ContextType=' + $ContextSize.GetType().Name + ' Root=' + $Root + ' CfgRoot=' + $script:Cfg.Root + ' ScriptCtxNull=' + ($script:Ctx -eq $null))
  exit 0
}

Initialize-PilotContext -Mode $Mode -LeaseEndEpoch ((Get-NowEpoch) + 3600)
$P = $script:Ctx.P
if (Test-Path -LiteralPath $P.Stop) { Write-Host ('A STOP file exists (' + $P.Stop + '). Nothing was started.'); exit 3 }
if (Test-Path -LiteralPath $P.Lease) {
  try {
    $old = Get-Content -LiteralPath $P.Lease -Raw | ConvertFrom-Json
    $oldProc = Get-Process -Id ([int]$old.pid) -ErrorAction SilentlyContinue
    if ($old.state -ceq 'running' -and $oldProc -and $oldProc.ProcessName -match 'powershell|pwsh' -and ((ConvertTo-UtcDate $old.lease_end_utc) -gt (Get-Date).ToUniversalTime())) { Write-Host 'A Pilot-Agent window is running. Close it first.'; exit 3 }
  } catch { }
}
if ($Mode -ceq 'Live') {
  $mk = Test-DryRunMarker $script:LiveRequired.run
  if (-not $mk.Ok) { Write-Host ('LIVE MODE REFUSED: ' + $mk.Why); exit 4 }
  Confirm-Approval 'APPROVE E-LIVE' ('LIVE RUN: will start llama-server on 127.0.0.1:8080 (ngl ' + $Ngl + ', ctx ' + $ContextSize + ', API key, no web UI), run the health check and stop it again, within the resource gates and the emergency brake.')
} else {
  Confirm-Approval 'APPROVE E-DRYRUN' 'DRY RUN: measures RAM/VRAM/disk, hashes files, plans the server steps. Starts nothing, sends no request.'
}
$script:St.Key = New-RandomHex 32
$runId = 'run-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
$plan = @(
  @{ type = 'preflight'; params = @{ ngl = $Ngl; ctx = $ContextSize } },
  @{ type = 'verify-integrity'; params = @{ scope = 'quick' } },
  @{ type = 'server-start'; params = @{ ngl = $Ngl; ctx = $ContextSize; idle_minutes = 30 } },
  @{ type = 'health'; params = @{ suite = 'synthetic3' } },
  @{ type = 'server-stop'; params = @{} }
)
Add-Audit 'run-start' @{ run = $runId; ngl = $Ngl; ctx = $ContextSize }
$results = New-Object System.Collections.ArrayList
$i = 0
$failed = $false
$runError = $null
try {
  foreach ($step in $plan) {
    $i = $i + 1
    if ($failed -and $step.type -cne 'server-stop') { continue }
    $job = @{ id = ($runId + '-' + $i + '-' + $step.type); type = $step.type; params = $step.params }
    $res = Invoke-PilotJob $job
    [void]$results.Add($res)
    Update-DryRunMarker $res
    Write-Host ('  ' + $step.type.PadRight(17) + ' -> ' + $res.status + $(if ($res.error) { '   ' + $res.error } else { '' }))
    foreach ($c in $res.checks) { if (-not $c.pass) { Write-Host ('      check failed: ' + $c.name + '  [' + $c.detail + ']') } }
    # in a dry run every step is only planned, so all of them are shown; a live run stops at the first step that is not ok (the server is still stopped)
    if ($Mode -ceq 'Live' -and @('ok') -cnotcontains $res.status) { $failed = $true }
  }
} catch {
  $failed = $true
  $runError = $_.Exception.Message
} finally {
  if ($script:St.Server) { [void](Stop-PilotServer 'run-exit') }
  $outcome = Get-RunOutcome $results
  $rd = Join-Path $P.Runs $runId
  try {
    [void](Assert-UnderRoot $rd)
    if (-not (Test-Path -LiteralPath $rd)) { [void](New-Item -ItemType Directory -Path $rd) }
    $summary = @{ schema = 'shords-pilot-run/1'; run = $runId; mode = $Mode; agent_version = $script:P6C.Version; ngl = $Ngl; ctx = $ContextSize; finished_utc = (Get-UtcNowText)
      outcome = $(if ($runError) { 'failed' } else { $outcome.Outcome }); refused = $outcome.Refused; error = $runError; steps = $results }
    Write-AtomicJson (Join-Path $rd 'report.json') $summary
    Write-Host ''
    Write-Host ('Report: ' + (Join-Path $rd 'report.json'))
  } catch {
    Write-Host ''
    Write-Host ('WARNING: the report could not be written: ' + $_.Exception.Message)
  }
  Add-Audit 'run-end' @{ run = $runId; failed = $failed; outcome = $outcome.Outcome; error = $runError }
  Write-Host ('Port 8080 free: ' + (Test-PortFree))
}
Write-Host ''
if ($runError) {
  Write-Host ('RESULT: the run stopped with an error: ' + $runError)
  exit 1
}
if ($outcome.Outcome -ceq 'gate-refused') {
  Write-Host 'RESULT: REFUSED BY A RESOURCE GATE. Nothing was started; the tool itself worked as designed. Refused checks:'
  foreach ($line in $outcome.Refused) { Write-Host ('   - ' + $line) }
  Write-Host 'Free the resource named above (for example close programs to raise available RAM) and run again.'
  exit 5
}
if ($outcome.Outcome -ceq 'failed') { Write-Host 'RESULT: failed (see the step lines above and the report).'; exit 1 }
Write-Host 'RESULT: ok.'
exit 0
