<#
.SYNOPSIS
  Read-only syntax check of every .ps1 file in this folder using the Windows PowerShell 5.1 parser. It does NOT run any of them.
  Also reports any non-ASCII byte. Exit code 0 = all files parse cleanly.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1
#>
[CmdletBinding()]
param([string]$Dir = '.')
$bad = 0
$files = Get-ChildItem -LiteralPath $Dir -Filter '*.ps1' | Sort-Object Name
Write-Host ('PowerShell version: ' + $PSVersionTable.PSVersion.ToString())
foreach ($f in $files) {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $nonAscii = 0
  foreach ($b in $bytes) { if ($b -gt 127) { $nonAscii++ } }
  if ($errors -and $errors.Count -gt 0) {
    $bad++
    Write-Host ('PARSE ERRORS  ' + $f.Name)
    foreach ($e in $errors) { Write-Host ('   line ' + $e.Extent.StartLineNumber + ': ' + $e.Message) }
  } elseif ($nonAscii -gt 0) {
    $bad++
    Write-Host ('NON-ASCII     ' + $f.Name + ' (' + $nonAscii + ' bytes)')
  } else {
    Write-Host ('OK            ' + $f.Name)
  }
}
Write-Host ''
if ($bad -eq 0) { Write-Host ('All ' + @($files).Count + ' scripts parse cleanly. (This proves syntax only, not behaviour.)'); exit 0 }
Write-Host ($bad.ToString() + ' file(s) have a problem. Do not run any step; send me this output.')
exit 1
