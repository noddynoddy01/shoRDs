<#
.SYNOPSIS
  Windows PowerShell 5.1 regression test for the r5 Dry Run A failure ("Exception calling Replace with 3 argument(s): The path is not of a legal form")
  and for the agent's whole file-handling loop. Everything happens in ONE new temporary folder under %TEMP% (shords-6c-selftest-xxxxxxxx), which the
  script removes at the end. It never touches D:\llm, starts no program, sends no request, opens no port and needs no approval phrase.
.DESCRIPTION
  Uses the real Phase6C functions with that temporary folder as the root:
    1. Write-AtomicText / Write-AtomicJson: create, then replace an EXISTING file three times (the r5 failure), no temp files left behind.
    2. Initialize-PilotContext (DryRun), Update-Lease three times, Add-Audit, Update-DryRunMarker three times (a gate-failed result must not count).
    3. Invoke-InboxCycle with two signed jobs (server-stop, health: both only planned in a dry run), one bad-signature job and one replayed job:
       results written to outbox, jobs archived/rejected, seen-ids written, marker updated again.
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
  Update-DryRunMarker @{ status = 'planned'; type = 'server-stop' }
  Update-DryRunMarker @{ status = 'planned'; type = 'health' }
  Update-DryRunMarker @{ status = 'gate-failed'; type = 'preflight' }
  $mk = Read-Text $ctxP.Marker | ConvertFrom-Json
  Check 'marker:rewritten-and-gate-failed-does-not-count' ((@($mk.types_ok) -join ',') -ceq 'health,server-stop') (@($mk.types_ok) -join ',')
  Check 'marker:version' ($mk.agent_version -ceq $script:P6C.Version) ([string]$mk.agent_version)
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
  [System.IO.File]::WriteAllText((Join-Path $inbox 'selftest-stop-0001.json'), (New-SignedJobText 'selftest-stop-0001' 'server-stop' '{}' $keyText), $utf8)
  $n = Invoke-InboxCycle
  $rr = Read-Text (Join-Path $ctxP.Outbox 'rejected-selftest-stop-0001.json') | ConvertFrom-Json
  Check 'inbox:replay-rejected' (($n -eq 1) -and ($rr.error -ceq 'replay')) ([string]$rr.error)
  Check 'inbox:rejected-files-kept' (@(Get-ChildItem -LiteralPath $ctxP.Rejected -Force).Count -eq 2) ('rejected files ' + @(Get-ChildItem -LiteralPath $ctxP.Rejected -Force).Count)
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
