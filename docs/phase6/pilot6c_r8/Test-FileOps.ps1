<#
.SYNOPSIS
  Windows PowerShell 5.1 regression test for the r5 Dry Run A failure ("Exception calling Replace with 3 argument(s): The path is not of a legal form")
  and for the agent's whole file-handling loop. Everything happens in ONE new temporary folder under %TEMP% (shords-6c-selftest-xxxxxxxx), which the
  script removes at the end. It never touches D:\llm, starts no program, sends no request, opens no port and needs no approval phrase.
.DESCRIPTION
  Uses the real Phase6C functions with that temporary folder as the root:
    1. Write-AtomicText / Write-AtomicJson: create, then replace an EXISTING file three times (the r5 failure), no temp files left behind.
    2. Initialize-PilotContext (DryRun), Update-Lease three times, Add-Audit, Update-DryRunMarker three times (a gate-failed result must not count).
    3. Invoke-InboxCycle with two signed jobs (server-stop, health: both only planned in a dry run), a bad-signature job, seven malformed files and one
       replayed job (nine rejections in all, the last three batches with no accepted job after them): results written to outbox, jobs archived/rejected,
       seen-ids written, and (r7) the completion marker agrees with the run's counters after every batch.
    4. r7 completion marker: run id, rejected_seen 8 then 9, the replay rejection counted, the end of the run (lease expiry and Ctrl+C routine), a second run
       that must not look like the first, and a marker write that fails (marker file locked) being counted and audited instead of ignored.
  Exit code 0 = all checks passed.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:failed = New-Object System.Collections.ArrayList
function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass = $script:pass + 1 } else { $script:fail = $script:fail + 1; [void]$script:failed.Add($Name + '  ' + $Detail) }
}

$tempBase = [System.IO.Path]::GetTempPath()
$Root = Join-Path $tempBase ('shords-6c-selftest-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Write-Host ('PowerShell ' + $PSVersionTable.PSVersion.ToString() + ', 64-bit process: ' + [Environment]::Is64BitProcess)
Write-Host ('Temporary test root: ' + $Root)
if ($Root -notmatch '\A[A-Za-z]:\\[\x20-\x7E]+\z' -or $Root -match '[*?"<>|]') {
  Write-Host 'The temporary folder path contains a non-ASCII character or is not a drive path, which the pilot path guard refuses. Nothing was created. Run this test from a user account whose temp folder path is plain ASCII, or tell the builder.'
  exit 2
}
# Baseline (read-only): this test starts nothing, so these must be the same at the end.
$procBefore = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue).Count
$portBefore = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue).Count
[void][System.IO.Directory]::CreateDirectory($Root)
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Lib.ps1')
. (Join-Path $PSScriptRoot 'Phase6C.Runtime.ps1')

function Read-Text { param([string]$Path) return [System.IO.File]::ReadAllText($Path) }
function Read-Marker { return (Read-Text $script:Ctx.P.Marker | ConvertFrom-Json) }
# r8: audit lines are PARSED (not matched with -like), so a line whose event name is wrong shows up as exactly that. Callers wrap the call in @( ).
function Get-AuditObjects {
  foreach ($l in @(Get-Content -LiteralPath $script:Ctx.P.Audit)) {
    if ($l.Trim().Length -gt 0) { $l | ConvertFrom-Json }
  }
}
function Get-AuditTail {
  param([int]$Last = 4)
  return ((@(Get-Content -LiteralPath $script:Ctx.P.Audit) | Select-Object -Last $Last) -join ' || ')
}

function New-SignedJobText {
  param([string]$Id, [string]$Type, [string]$Params, [string]$KeyText)
  $now = Get-NowEpoch
  $zero = '0' * 64
  $text = '{"schema":"' + $script:P6C.SchemaJob + '","id":"' + $Id + '","type":"' + $Type + '","created_utc":"' + (Format-PilotTimestamp ($now - 5)) + '","expires_utc":"' + (Format-PilotTimestamp ($now + 600)) + '","params":' + $Params + ',"hmac":"' + $zero + '"}'
  $parsed = (ConvertFrom-StrictJson -Text $text).Value
  $sig = Get-HmacSha256Hex $KeyText (Get-CanonicalJobString $parsed)
  return $text.Replace($zero, $sig)
}

try {
  # 1 atomic writes: the exact r5 failure was the second write of an existing file
  $f1 = Join-Path $Root 'a.txt'
  Write-AtomicText $f1 'one'
  Check 'atomic:create' ((Read-Text $f1) -ceq 'one') (Read-Text $f1)
  Write-AtomicText $f1 'two'
  Check 'atomic:replace-existing' ((Read-Text $f1) -ceq 'two') (Read-Text $f1)
  Write-AtomicText $f1 'three'
  Check 'atomic:replace-again' ((Read-Text $f1) -ceq 'three') (Read-Text $f1)
  $f2 = Join-Path $Root 'b.json'
  Write-AtomicJson $f2 @{ n = 1; list = @('x', 'y') }
  Write-AtomicJson $f2 @{ n = 2; list = @('x', 'y', 'z') }
  $j2 = Read-Text $f2 | ConvertFrom-Json
  Check 'atomic-json:replace-existing' (($j2.n -eq 2) -and (@($j2.list).Count -eq 3)) (Read-Text $f2)
  Check 'atomic:no-temp-files-left' (@(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $_.Name -like '*.tmp-*' }).Count -eq 0) 'a .tmp-* file was left behind'

  # 2 context, lease, audit, dry-run marker
  Initialize-PilotContext -Mode 'DryRun' -LeaseEndEpoch ((Get-NowEpoch) + 3600)
  $ctxP = $script:Ctx.P
  $script:St.Key = New-RandomHex 32
  Check 'context:folders' ((Test-Path -LiteralPath $ctxP.Inbox) -and (Test-Path -LiteralPath $ctxP.Outbox) -and (Test-Path -LiteralPath $ctxP.Archive) -and (Test-Path -LiteralPath $ctxP.Rejected)) ''
  Check 'context:mode-is-exact' ($script:Ctx.Mode -ceq 'DryRun') $script:Ctx.Mode
  Update-Lease 'running'
  Update-Lease 'running'
  Update-Lease 'ended'
  $lease = Read-Text $ctxP.Lease | ConvertFrom-Json
  Check 'lease:rewritten-three-times' (($lease.state -ceq 'ended') -and ($lease.agent_version -ceq $script:P6C.Version)) (Read-Text $ctxP.Lease)
  Add-Audit 'selftest' @{ a = 1 }
  Add-Audit 'selftest' @{ a = 2 }
  $auditLines = @(Get-Content -LiteralPath $ctxP.Audit)
  Check 'audit:two-json-lines' (($auditLines.Count -eq 2) -and ((($auditLines[1] | ConvertFrom-Json).a) -eq 2) -and ($script:St.AuditErrors -eq 0)) ('lines ' + $auditLines.Count + ' errors ' + $script:St.AuditErrors)
  # r8: ts, event and mode are the record's own fields. A data key with such a name (any case) must not replace them: r7 audited 'marker-error' with a data
  # key 'event' and the line said "event":"start" (checks marker:failed-write-is-audited and marker:read-back-flags-the-stale-marker failed on Windows).
  Add-Audit 'selftest-reserved' @{ event = 'x'; TS = 'y'; mode = 'z'; a = 3 }
  $resv = @(Get-AuditObjects | Where-Object { $_.event -ceq 'selftest-reserved' })
  $okResv = ($resv.Count -eq 1)
  if ($okResv) { $okResv = (($resv[0].data_event -ceq 'x') -and ($resv[0].data_TS -ceq 'y') -and ($resv[0].data_mode -ceq 'z') -and ($resv[0].a -eq 3) -and ($resv[0].mode -ceq 'DryRun')) }
  Check 'audit:reserved-data-keys-do-not-rename-the-event' $okResv (Get-AuditTail 1)
  # r7: the marker names THIS run from its first event
  $runA = [string]$script:St.RunId
  Check 'run-id:format' ($runA -cmatch '\Asess-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\z') $runA
  Update-DryRunMarker -Event 'start'
  $mk = Read-Marker
  Check 'marker:start-names-this-run' (($mk.run_id -ceq $runA) -and ($mk.state -ceq 'running') -and ($mk.event_seq -eq 1) -and ($mk.rejected_seen -eq 0) -and ($mk.jobs_done -eq 0) -and ($mk.marker_rev -eq 2)) (Read-Text $ctxP.Marker)
  $firstUtcA = [string]$mk.first_utc
  Update-DryRunMarker @{ status = 'planned'; type = 'server-stop' }
  Update-DryRunMarker @{ status = 'planned'; type = 'health' }
  Update-DryRunMarker @{ status = 'gate-failed'; type = 'preflight' }
  $mk = Read-Marker
  Check 'marker:rewritten-and-gate-failed-does-not-count' ((@($mk.types_ok) -join ',') -ceq 'health,server-stop') (@($mk.types_ok) -join ',')
  Check 'marker:version' ($mk.agent_version -ceq $script:P6C.Version) ([string]$mk.agent_version)
  Check 'marker:event-seq-counts-the-writes' (($mk.event_seq -eq 4) -and ($script:St.MarkerWrites -eq 4) -and ($script:St.MarkerErrors -eq 0)) ('seq ' + $mk.event_seq + ' writes ' + $script:St.MarkerWrites)
  $t1 = Test-DryRunMarker @('health', 'server-stop')
  $t2 = Test-DryRunMarker @('preflight')
  Check 'marker:test-ok-and-missing' ($t1.Ok -and (-not $t2.Ok) -and (@($t2.Missing) -join ',') -ceq 'preflight') ($t2.Why)

  # 3 inbox cycle with signed jobs
  $keyText = $script:St.Key
  $inbox = $ctxP.Inbox
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $inbox 'selftest-stop-0001.json'), (New-SignedJobText 'selftest-stop-0001' 'server-stop' '{}' $keyText), $utf8)
  [System.IO.File]::WriteAllText((Join-Path $inbox 'selftest-health-0002.json'), (New-SignedJobText 'selftest-health-0002' 'health' '{"suite":"synthetic3"}' $keyText), $utf8)
  $badKey = New-RandomHex 32
  [System.IO.File]::WriteAllText((Join-Path $inbox 'selftest-badsig-0003.json'), (New-SignedJobText 'selftest-badsig-0003' 'server-stop' '{}' $badKey), $utf8)
  $n = Invoke-InboxCycle
  Check 'inbox:three-files-handled' ($n -eq 3) ('handled ' + $n)
  $r1 = Read-Text (Join-Path $ctxP.Outbox 'selftest-stop-0001.json') | ConvertFrom-Json
  $r2 = Read-Text (Join-Path $ctxP.Outbox 'selftest-health-0002.json') | ConvertFrom-Json
  Check 'inbox:server-stop-planned' (($r1.status -ceq 'planned') -and ($r1.mode -ceq 'DryRun')) ([string]$r1.status)
  Check 'inbox:health-planned-no-request' (($r2.status -ceq 'planned') -and ([string]$r2.data.note -like 'DRY RUN: no request was sent*')) ([string]$r2.status)
  $rj = Read-Text (Join-Path $ctxP.Outbox 'rejected-selftest-badsig-0003.json') | ConvertFrom-Json
  Check 'inbox:bad-signature-rejected' (($rj.status -ceq 'rejected') -and ($rj.error -ceq 'hmac')) ([string]$rj.error)
  Check 'inbox:files-moved' ((Test-Path -LiteralPath (Join-Path $ctxP.Archive 'selftest-stop-0001.json')) -and (Test-Path -LiteralPath (Join-Path $ctxP.Archive 'selftest-health-0002.json')) -and (Test-Path -LiteralPath (Join-Path $ctxP.Rejected 'selftest-badsig-0003.json')) -and (@(Get-ChildItem -LiteralPath $inbox -Force).Count -eq 0)) ''
  Check 'inbox:seen-ids-written' ((@(Get-Content -LiteralPath $ctxP.SeenIds) -join ',') -ceq 'selftest-stop-0001,selftest-health-0002') (@(Get-Content -LiteralPath $ctxP.SeenIds) -join ',')
  # r7: whatever order the three files were handled in, the marker agrees with the run's own counters afterwards
  $mk = Read-Marker
  Check 'marker:after-first-cycle-matches-the-counters' (($mk.rejected_seen -eq 1) -and ($mk.jobs_done -eq 2) -and ($mk.rejected_seen -eq $script:St.JobsRejected) -and ((Get-MarkerProblem $mk $runA 'running' 2 1) -ceq '')) (Read-Text $ctxP.Marker)

  # r7: the r6 defect. Seven more rejected files (eight in all), with NO accepted job after them: r6 left rejected_seen at 1 here.
  for ($i = 4; $i -le 10; $i++) { [System.IO.File]::WriteAllText((Join-Path $inbox ('selftest-junk-' + ('{0:D4}' -f $i) + '.json')), '{}', $utf8) }
  $n = Invoke-InboxCycle
  $mk = Read-Marker
  Check 'inbox:seven-junk-files-rejected' (($n -eq 7) -and ($script:St.JobsRejected -eq 8)) ('handled ' + $n + ' rejected ' + $script:St.JobsRejected)
  Check 'marker:eight-negative-jobs-give-rejected-seen-8' (($mk.rejected_seen -eq 8) -and ($mk.jobs_done -eq 2) -and ((Get-MarkerProblem $mk $runA 'running' 2 8) -ceq '')) (Read-Text $ctxP.Marker)
  $seqBefore = [int]$mk.event_seq
  $lastBefore = [string]$mk.last_utc

  # the replay of an id that was already used: the ninth rejection, again after the last accepted job
  [System.IO.File]::WriteAllText((Join-Path $inbox 'selftest-stop-0001.json'), (New-SignedJobText 'selftest-stop-0001' 'server-stop' '{}' $keyText), $utf8)
  $n = Invoke-InboxCycle
  $rr = Read-Text (Join-Path $ctxP.Outbox 'rejected-selftest-stop-0001.json') | ConvertFrom-Json
  Check 'inbox:replay-rejected' (($n -eq 1) -and ($rr.error -ceq 'replay')) ([string]$rr.error)
  Check 'inbox:rejected-files-kept' (@(Get-ChildItem -LiteralPath $ctxP.Rejected -Force).Count -eq 9) ('rejected files ' + @(Get-ChildItem -LiteralPath $ctxP.Rejected -Force).Count)
  $mk = Read-Marker
  Check 'marker:nine-negative-jobs-give-rejected-seen-9' (($mk.rejected_seen -eq 9) -and ($script:St.JobsRejected -eq 9) -and ((Get-MarkerProblem $mk $runA 'running' 2 9) -ceq '')) (Read-Text $ctxP.Marker)
  Check 'marker:replay-rejection-is-in-the-final-count-and-advances-the-marker' (([int]$mk.event_seq -eq ($seqBefore + 1)) -and ([string]::CompareOrdinal([string]$mk.last_utc, $lastBefore) -ge 0)) ('seq ' + $mk.event_seq + ' last ' + $mk.last_utc + ' before ' + $lastBefore)
  Check 'marker:types-kept' ((@($mk.types_ok) -join ',') -ceq 'health,server-stop') (@($mk.types_ok) -join ',')
  Check 'marker:no-errors-so-far' (($script:St.MarkerErrors -eq 0) -and ($script:St.AuditErrors -eq 0)) ('marker errors ' + $script:St.MarkerErrors)

  # r7: natural end of the run (lease expiry / STOP file use the same routine): final marker says ended, how, and the final counters
  Complete-AgentSession 'lease-ended'
  $mk = Read-Marker
  Check 'marker:end-lease-ended' (($mk.state -ceq 'ended') -and ($mk.end_reason -ceq 'lease-ended') -and ($mk.ended_utc -ceq $mk.last_utc) -and ($mk.rejected_seen -eq 9) -and ($mk.jobs_done -eq 2) -and ($mk.run_id -ceq $runA)) (Read-Text $ctxP.Marker)
  Check 'marker:end-read-back-ok' (($script:St.MarkerErrors -eq 0) -and ((Get-MarkerProblem $mk $runA 'ended' 2 9) -ceq '')) ('marker errors ' + $script:St.MarkerErrors)
  $lease = Read-Text $ctxP.Lease | ConvertFrom-Json
  Check 'lease:ended-with-run-id-and-counters' (($lease.state -ceq 'ended') -and ($lease.run_id -ceq $runA) -and ($lease.jobs_rejected -eq 9) -and ($lease.marker_errors -eq 0)) (Read-Text $ctxP.Lease)
  $endLine = @(Get-Content -LiteralPath $ctxP.Audit | Where-Object { $_ -like '*"event":"agent-end"*' })
  Check 'audit:agent-end-has-reason-counters-and-run-id' (($endLine.Count -eq 1) -and ((($endLine[0] | ConvertFrom-Json).jobs_rejected) -eq 9) -and ((($endLine[0] | ConvertFrom-Json).run_id) -ceq $runA)) ($endLine -join ' | ')
  $nRejectedAudit = @(Get-Content -LiteralPath $ctxP.Audit | Where-Object { $_ -like '*"event":"job-rejected"*' }).Count
  Check 'audit:nine-job-rejected-events-match-the-marker' ($nRejectedAudit -eq 9) ('job-rejected events ' + $nRejectedAudit)

  # r7: a SECOND run on the same folder (what Dry Run B was after Dry Run A): the earlier marker can not be mistaken for it
  Initialize-PilotContext -Mode 'DryRun' -LeaseEndEpoch ((Get-NowEpoch) + 3600)
  $runB = [string]$script:St.RunId
  Check 'run-id:new-run-new-id' (($runB -cne $runA) -and ($runB -cmatch '\Asess-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\z')) ($runA + ' / ' + $runB)
  Update-DryRunMarker -Event 'start'
  $mk = Read-Marker
  Check 'marker:second-run-starts-clean-but-keeps-the-types' (($mk.run_id -ceq $runB) -and ($mk.state -ceq 'running') -and ($mk.rejected_seen -eq 0) -and ($mk.jobs_done -eq 0) -and ($mk.event_seq -eq 1) -and ($null -eq $mk.ended_utc) -and ((@($mk.types_ok) -join ',') -ceq 'health,server-stop') -and ($mk.first_utc -ceq $firstUtcA)) (Read-Text $ctxP.Marker)
  Check 'marker:previous-run-is-detected-as-not-this-run' ((Get-MarkerProblem $mk $runA 'ended' 2 9) -ceq 'run-id') ''
  # clean Ctrl+C: the finally block of Pilot-Agent.ps1 calls the same routine with the reason 'aborted'
  $script:St.JobsRejected = 1
  Update-DryRunMarker -Event 'reject'
  Complete-AgentSession 'aborted'
  $mk = Read-Marker
  Check 'marker:end-aborted-as-on-ctrl-c' (($mk.run_id -ceq $runB) -and ($mk.state -ceq 'ended') -and ($mk.end_reason -ceq 'aborted') -and ($mk.rejected_seen -eq 1) -and ($mk.event_seq -eq 3) -and ($script:St.MarkerErrors -eq 0)) (Read-Text $ctxP.Marker)

  # r7: a marker write that fails is surfaced (counted, audited), not ignored. A third run; the marker file is locked while the run starts.
  Initialize-PilotContext -Mode 'DryRun' -LeaseEndEpoch ((Get-NowEpoch) + 3600)
  $runC = [string]$script:St.RunId
  $lock = [System.IO.File]::Open($ctxP.Marker, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  try { Update-DryRunMarker -Event 'start' } finally { $lock.Dispose() }
  Check 'marker:failed-write-is-counted' ($script:St.MarkerErrors -eq 1) ('marker errors ' + $script:St.MarkerErrors)
  $mErr = @(Get-AuditObjects | Where-Object { $_.event -ceq 'marker-error' })
  $okAud = ($mErr.Count -eq 1)
  if ($okAud) { $okAud = (($mErr[0].marker_event -ceq 'start') -and (([string]$mErr[0].error).Length -gt 0)) }
  Check 'marker:failed-write-is-audited' $okAud ('marker-error lines ' + $mErr.Count + '; tail: ' + (Get-AuditTail 3))
  $mk = Read-Marker
  Check 'marker:failed-write-leaves-the-old-marker-and-no-temp-file' (($mk.run_id -ceq $runB) -and (@(Get-ChildItem -LiteralPath $ctxP.Jobs -Force | Where-Object { $_.Name -like '*.tmp-*' }).Count -eq 0)) ([string]$mk.run_id)
  Confirm-DryRunMarker 'running'
  $vErr = @(Get-AuditObjects | Where-Object { ($_.event -ceq 'marker-error') -and ($_.marker_event -ceq 'verify') })
  $okVer = (($script:St.MarkerErrors -eq 2) -and ($vErr.Count -eq 1))
  if ($okVer) { $okVer = ($vErr[0].error -ceq 'run-id') }
  Check 'marker:read-back-flags-the-stale-marker' $okVer ('marker errors ' + $script:St.MarkerErrors + '; verify lines ' + $vErr.Count + '; tail: ' + (Get-AuditTail 3))
  Update-Lease 'running'
  $lease = Read-Text $ctxP.Lease | ConvertFrom-Json
  Check 'lease:shows-the-marker-errors' (($lease.run_id -ceq $runC) -and ($lease.marker_errors -eq 2)) (Read-Text $ctxP.Lease)

  $procAfter = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue).Count
  $portAfter = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue).Count
  Check 'inbox:test-started-no-process-and-opened-no-port' (($procAfter -eq $procBefore) -and ($portAfter -eq $portBefore)) ('llama-server processes ' + $procBefore + '->' + $procAfter + ', listeners on 8080 ' + $portBefore + '->' + $portAfter)
  Check 'inbox:audit-has-no-error-lines' (@(Get-Content -LiteralPath $ctxP.Audit | Where-Object { $_ -match 'EMERGENCY|result-write-failed' }).Count -eq 0) ''
} catch {
  Check 'unexpected-exception' $false ($_.Exception.Message + '  at ' + $_.InvocationInfo.ScriptLineNumber)
} finally {
  if ($Root.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and $Root.Contains('shords-6c-selftest-') -and (Test-Path -LiteralPath $Root)) {
    try { [System.IO.Directory]::Delete($Root, $true) } catch { Write-Host ('NOTE: could not remove the temporary folder ' + $Root + ': ' + $_.Exception.Message) }
  }
}

Write-Host ''
Write-Host ('Checks passed: ' + $script:pass + '   failed: ' + $script:fail)
foreach ($f in $script:failed) { Write-Host ('  FAIL  ' + $f) }
if ($script:fail -gt 0) { Write-Host 'PROBLEM: do not run the dry run. Send me this output.'; exit 1 }
Write-Host 'File handling, lease, audit, dry-run marker and the inbox loop work on this machine. Nothing outside the temporary folder was touched; the folder was removed.'
exit 0
