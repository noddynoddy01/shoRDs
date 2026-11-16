<#
.SYNOPSIS
  Checks that the extracted pilot kit is complete and unmodified (SHA-256 of every file against MANIFEST.sha256.txt).
  Windows PowerShell 5.1 compatible. Read-only: it changes nothing and uses no network.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1
#>
[CmdletBinding()]
param([string]$KitDir = '.')

$root = (Resolve-Path -LiteralPath $KitDir).Path
$manifest = Join-Path $root 'MANIFEST.sha256.txt'
if (-not (Test-Path -LiteralPath $manifest)) { Write-Host 'MANIFEST.sha256.txt not found - run this inside the extracted kit folder.'; exit 2 }

$bad = 0; $ok = 0
foreach ($line in (Get-Content -LiteralPath $manifest)) {
  if (-not $line.Trim()) { continue }
  $parts = $line -split '\s+', 2
  $expected = $parts[0].ToLower()
  $rel = $parts[1].Trim()
  $path = Join-Path $root ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $path)) { Write-Host ('MISSING   ' + $rel); $bad++; continue }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { Write-Host ('CHANGED   ' + $rel); $bad++ } else { $ok++ }
}
Write-Host ''
if ($bad -eq 0) { Write-Host ('Kit verified: ' + $ok + ' files match the manifest.') ; exit 0 }
Write-Host ('PROBLEM: ' + $bad + ' file(s) missing or changed. Do not run the pilot; extract the kit again from the original zip.')
exit 1
