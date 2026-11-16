<#
.SYNOPSIS
  Read-only regression test for the r4 failure ("The variable cannot be validated because the value 0 is not a valid value for the Ctx variable").
  Runs Invoke-PilotRun.ps1 and Pilot-Agent.ps1 in child Windows PowerShell processes with the -BindingTest switch, which dot-sources
  Phase6B.Common.ps1, Phase6C.Lib.ps1 and Phase6C.Runtime.ps1, prints the bound parameter values and exits BEFORE any folder, file, process or
  network action. Then checks that valid values bind, the alias -Ctx works, and invalid values are rejected. Windows PowerShell 5.1.
  Exit code 0 = all checks passed. It never writes a file, never reads or writes D:\llm, never starts llama-server and sends no request.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:failed = New-Object System.Collections.ArrayList
$script:psExe = Join-Path $PSHOME 'powershell.exe'

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass = $script:pass + 1 } else { $script:fail = $script:fail + 1; [void]$script:failed.Add($Name + '  ' + $Detail) }
}

function Invoke-Child {
  param([string]$ScriptName, [string]$ScriptArgs)
  $path = Join-Path $PSScriptRoot $ScriptName
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:psExe
  $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $path + '" ' + $ScriptArgs
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $out = $proc.StandardOutput.ReadToEnd()
  $err = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return @{ Code = $proc.ExitCode; Out = $out; Err = $err }
}

function Get-BindingLine {
  param([string]$Text)
  foreach ($l in ($Text -split "`r?`n")) { if ($l.StartsWith('BINDING-TEST ')) { return $l.Trim() } }
  return ''
}

Write-Host ('PowerShell ' + $PSVersionTable.PSVersion.ToString() + ', 64-bit process: ' + [Environment]::Is64BitProcess)
Check 'is-64-bit' ([Environment]::Is64BitProcess) 'run the 64-bit Windows PowerShell'
Check 'powershell-exe-found' (Test-Path -LiteralPath $script:psExe) $script:psExe

# Invoke-PilotRun.ps1 : valid values must bind and survive dot-sourcing
$run = @(
  @{ Name = 'default'; Args = ''; Ngl = '8'; Ctx = '4096' },
  @{ Name = 'ctx-4096'; Args = '-Ngl 8 -ContextSize 4096'; Ngl = '8'; Ctx = '4096' },
  @{ Name = 'ctx-8192'; Args = '-Ngl 8 -ContextSize 8192'; Ngl = '8'; Ctx = '8192' },
  @{ Name = 'ctx-12288'; Args = '-Ngl 8 -ContextSize 12288'; Ngl = '8'; Ctx = '12288' },
  @{ Name = 'alias-Ctx-4096'; Args = '-Ngl 8 -Ctx 4096'; Ngl = '8'; Ctx = '4096' },
  @{ Name = 'alias-Ctx-8192'; Args = '-Ctx 8192'; Ngl = '8'; Ctx = '8192' },
  @{ Name = 'ngl-0'; Args = '-Ngl 0'; Ngl = '0'; Ctx = '4096' },
  @{ Name = 'ngl-20'; Args = '-Ngl 20 -ContextSize 12288'; Ngl = '20'; Ctx = '12288' },
  @{ Name = 'mode-lowercase-dryrun-normalised'; Args = '-Mode dryrun'; Ngl = '8'; Ctx = '4096' }
)
foreach ($c in $run) {
  $r = Invoke-Child 'Invoke-PilotRun.ps1' ($c.Args + ' -BindingTest')
  $line = Get-BindingLine $r.Out
  $want = 'BINDING-TEST Mode=DryRun Ngl=' + $c.Ngl + ' ContextSize=' + $c.Ctx + ' ContextType=Int32 Root=D:\llm CfgRoot=D:\llm ScriptCtxNull=True'
  Check ('run:' + $c.Name + ':exit-0') ($r.Code -eq 0) ('exit ' + $r.Code + ' stderr: ' + $r.Err.Trim())
  Check ('run:' + $c.Name + ':values') ($line -ceq $want) ('got [' + $line + '] want [' + $want + ']')
}
# invalid values must be rejected by parameter validation, and nothing may run
$bad = @('-ContextSize 5000', '-ContextSize 0', '-ContextSize 2048', '-Ctx 16384', '-Ctx abc', '-Ngl 21', '-Ngl -1', '-Mode Live2', '-Mode dev')
foreach ($a in $bad) {
  $r = Invoke-Child 'Invoke-PilotRun.ps1' ($a + ' -BindingTest')
  Check ('run-invalid:' + $a) (($r.Code -ne 0) -and ((Get-BindingLine $r.Out) -ceq '')) ('exit ' + $r.Code + ' out [' + $r.Out.Trim() + ']')
}

# -Mode is a ValidateSet (case-insensitive); the script must normalise the spelling so its case-sensitive comparisons see exactly DryRun or Live
foreach ($lm in @('live', 'LIVE', 'Live')) {
  $r = Invoke-Child 'Invoke-PilotRun.ps1' ('-Mode ' + $lm + ' -BindingTest')
  $line = Get-BindingLine $r.Out
  Check ('run:mode-' + $lm + '-normalised-to-Live') (($r.Code -eq 0) -and $line.StartsWith('BINDING-TEST Mode=Live ')) ('exit ' + $r.Code + ' got [' + $line + ']')
}

# Pilot-Agent.ps1
$agent = @(
  @{ Name = 'default'; Args = ''; Mode = 'DryRun'; Hours = '2'; Poll = '3' },
  @{ Name = 'hours-1'; Args = '-Hours 1'; Mode = 'DryRun'; Hours = '1'; Poll = '3' },
  @{ Name = 'hours-8'; Args = '-Hours 8 -PollSeconds 30'; Mode = 'DryRun'; Hours = '8'; Poll = '30' },
  @{ Name = 'hours-quarter'; Args = '-Hours 0.25 -PollSeconds 2'; Mode = 'DryRun'; Hours = '0.25'; Poll = '2' },
  @{ Name = 'mode-live-binds-only'; Args = '-Mode Live'; Mode = 'Live'; Hours = '2'; Poll = '3' },
  @{ Name = 'mode-lowercase-live-normalised'; Args = '-Mode live'; Mode = 'Live'; Hours = '2'; Poll = '3' },
  @{ Name = 'mode-lowercase-dryrun-normalised'; Args = '-Mode dryrun'; Mode = 'DryRun'; Hours = '2'; Poll = '3' }
)
foreach ($c in $agent) {
  $r = Invoke-Child 'Pilot-Agent.ps1' ($c.Args + ' -BindingTest')
  $line = Get-BindingLine $r.Out
  $want = 'BINDING-TEST Mode=' + $c.Mode + ' Hours=' + $c.Hours + ' PollSeconds=' + $c.Poll + ' Root=D:\llm CfgRoot=D:\llm ScriptCtxNull=True'
  Check ('agent:' + $c.Name + ':exit-0') ($r.Code -eq 0) ('exit ' + $r.Code + ' stderr: ' + $r.Err.Trim())
  Check ('agent:' + $c.Name + ':values') ($line -ceq $want) ('got [' + $line + '] want [' + $want + ']')
}
foreach ($a in @('-Hours 0', '-Hours 9', '-PollSeconds 1', '-PollSeconds 31', '-Mode Test')) {
  $r = Invoke-Child 'Pilot-Agent.ps1' ($a + ' -BindingTest')
  Check ('agent-invalid:' + $a) (($r.Code -ne 0) -and ((Get-BindingLine $r.Out) -ceq '')) ('exit ' + $r.Code + ' out [' + $r.Out.Trim() + ']')
}
# a root with a space is refused before anything else
$r = Invoke-Child 'Invoke-PilotRun.ps1' '-Root "D:\llm x" -BindingTest'
Check 'run:root-with-space-refused' (($r.Code -eq 2) -and ((Get-BindingLine $r.Out) -ceq '')) ('exit ' + $r.Code)

Write-Host ''
Write-Host ('Checks passed: ' + $script:pass + '   failed: ' + $script:fail)
foreach ($f in $script:failed) { Write-Host ('  FAIL  ' + $f) }
if ($script:fail -gt 0) { Write-Host 'PROBLEM: do not run the dry run. Send me this output.'; exit 1 }
Write-Host 'Both scripts bind their parameters correctly after dot-sourcing; invalid values are rejected. Nothing was written or started.'
exit 0
