<#
.SYNOPSIS
  STEP D of the Phase 6B approval package: INSTALL (extract), LAUNCH and HEALTH-CHECK a local llama.cpp server. Windows PowerShell 5.1.
  D extracts the verified llama.cpp zips, EXECUTES llama-server.exe, loads the model into memory, opens a local port, sends three
  synthetic test prompts (no paper, no real text) and writes a health report. It needs step C to have been completed first.

.DESCRIPTION
  -Action Prereq    read-only. Checks the Microsoft Visual C++ runtime files, 64-bit PowerShell, NVIDIA driver tool, free RAM/VRAM/disk, the port
                    and the files Step C verified. Changes nothing, starts nothing. Run it before Install.
  -Action Install   needs APPROVE D. Re-checks the two zips' SHA-256, checks every zip entry stays inside the target folder, extracts into
                    <root>\llama.cpp\b11669 (never overwrites an existing file), then runs llama-server.exe --version and --help once (30 s limit each)
                    and records the file hash, Authenticode status and which command-line options this build understands.
  -Action Start     needs APPROVE D. Checks gates (free RAM, free VRAM, port, model file unchanged), then launches the server HIDDEN, bound to
                    127.0.0.1 only, with a context of 4096, one parallel request and a PROVISIONAL number of GPU layers (-Ngl, default 8, allowed
                    0 to 16). Output goes to <root>\logs. Waits up to 5 minutes for it to answer /health.
  -Action Health    talks only to 127.0.0.1. Records RAM, VRAM and server memory before/during/after, the load-log lines about layers/buffers/context,
                    the server's own properties, latency of three small prompts (wall time and the server's own timings), network connections of
                    the server process, and any firewall rule that mentions llama. Writes <root>\health\health-<time>.json and .txt.
  -Action Stop      never needs approval. Stops only the server this script started.
  -Action Status    read-only.

  Not changed: PATH, registry, services, execution policy, Windows settings, D:\shords, Git, production, credentials. If Windows Firewall asks
  whether to allow llama-server.exe, press Cancel (it listens on this computer only).
  Rollback: Stop, then Rollback.ps1. NOT EXECUTED by its author on any PowerShell: run the parser check first.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Prereq', 'Install', 'Start', 'Health', 'Stop', 'Status')][string]$Action,
  [ValidateRange(0, 16)][int]$Ngl = 8,
  [ValidateSet('8b', '4b')][string]$Model = '8b',
  [switch]$RehashModel,
  [string]$Root = 'D:\llm'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')
if ($Root -match '\s') { Write-Host 'The root folder must not contain spaces.'; exit 2 }
$cfg = $script:Cfg
$alias = 'qwen3-' + $Model
$base = 'http://127.0.0.1:' + $cfg.Port

function Invoke-Capture {
  param([string]$Exe, [string[]]$ArgList, [string]$OutFile, [int]$TimeoutSec = 30)
  $err = $OutFile + '.err'
  $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -WorkingDirectory (Split-Path -Path $Exe -Parent) -RedirectStandardOutput $OutFile -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $null = $p.Handle    # keeps the process handle so ExitCode is readable afterwards (known Windows PowerShell 5.1 quirk with -PassThru)
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    try { $p.Kill() } catch { }
    return @{ ExitCode = $null; TimedOut = $true; Text = '' }
  }
  $t = ''
  if (Test-Path -LiteralPath $OutFile) { $t += (Get-Content -LiteralPath $OutFile -Raw) }
  if (Test-Path -LiteralPath $err) { $t += (Get-Content -LiteralPath $err -Raw) }
  return @{ ExitCode = $p.ExitCode; TimedOut = $false; Text = $t }
}

function Get-ModelArtifact { return ($script:Artifacts | Where-Object { $_.Id -eq $alias } | Select-Object -First 1) }

# ----------------------------------------------------------------------------------------------------------------------------- Prereq
function Invoke-Prereq {
  Write-Host 'STEP D - PREREQUISITES (read-only; nothing is written, extracted or started)'
  $bad = 0
  Write-Host ('PowerShell              : ' + $PSVersionTable.PSVersion.ToString() + $(if ([Environment]::Is64BitProcess) { ' (64-bit)' } else { ' (32-bit - NOT OK: open the normal 64-bit Windows PowerShell)' }))
  if (-not [Environment]::Is64BitProcess) { $bad++ }
  $vc = Get-VcRuntimeStatus
  foreach ($f in $vc.Files) { Write-Host ('  ' + $f.Name.PadRight(18) + $(if ($f.Present) { 'present ' + $f.Version } else { 'MISSING' })) }
  Write-Host ('Visual C++ 2015-2022 x64: ' + $(if ($vc.Ok) { 'OK' } else { 'NOT OK - missing ' + ($vc.Missing -join ', ') }) + $(if ($vc.Registry) { '   (registry: ' + $vc.Registry + ')' } else { '' }))
  if (-not $vc.Ok) { $bad++; Write-Host '  llama.cpp Windows builds need the Microsoft Visual C++ Redistributable (x64). It is not inside the llama.cpp zips. Installing it is a separate download and install that needs your own approval; tell me and I will prepare it. Step D Install will refuse to run until these files exist.' }
  $smi = Get-SmiPath
  Write-Host ('nvidia-smi              : ' + $(if ($smi) { $smi } else { 'NOT FOUND (needed for the VRAM safeguard; without it only -Ngl 0 is allowed)' }))
  $ram = Get-AvailRamGiB; $tot = Get-TotalRamGiB
  Write-Host ('RAM                     : ' + $ram + ' GiB available of ' + $tot + ' GiB (Start needs at least ' + $cfg.MinAvailRamGiB + ' for the 8B model)')
  $v = Get-VramMiB
  if ($v) { Write-Host ('VRAM                    : ' + $v.FreeMiB + ' MiB free of ' + $v.TotalMiB + ' (Start needs at least ' + $cfg.MinFreeVramMiB + ' MiB free at -Ngl 8)') }
  Write-Host ('Free disk               : ' + (Get-GiBFree $cfg.Root) + ' GiB')
  $listen = Get-NetTCPConnection -LocalPort $cfg.Port -State Listen -ErrorAction SilentlyContinue
  Write-Host ('Port ' + $cfg.Port + '               : ' + $(if ($listen) { 'IN USE - NOT OK' } else { 'free' }))
  if ($listen) { $bad++ }
  $other = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
  Write-Host ('Other llama-server      : ' + $(if ($other.Count -gt 0) { $other.Count.ToString() + ' running - NOT OK' } else { 'none' }))
  if ($other.Count -gt 0) { $bad++ }
  foreach ($z in @($script:Artifacts | Where-Object { $_.Group -eq 'runtime' })) {
    $pth = Get-ArtifactPath $z
    $ok = $false
    if (Test-Path -LiteralPath $pth) { $ok = ((Get-FileSha256 $pth) -eq $z.Sha256) }
    Write-Host ('Step C file             : ' + $z.File + $(if ($ok) { '  hash OK' } else { '  MISSING OR DIFFERENT - NOT OK' }))
    if (-not $ok) { $bad++ }
  }
  $art = Get-ModelArtifact
  $mp = Get-ArtifactPath $art
  $mk = Read-Json $cfg.Marker
  $inMarker = [bool]($mk -and $mk.files -and $mk.files.PSObject.Properties[$art.Id])
  Write-Host ('Model                   : ' + $art.File + $(if ((Test-Path -LiteralPath $mp) -and $inMarker) { '  present, listed in verified-artifacts.json' } else { '  MISSING OR NOT VERIFIED - NOT OK' }))
  if (-not ((Test-Path -LiteralPath $mp) -and $inMarker)) { $bad++ }
  $fwOk = $true; $fw = @()
  try { $fw = @(Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.DisplayName -match 'llama' }) } catch { $fwOk = $false }
  Write-Host ('Firewall rules "llama"  : ' + $(if (-not $fwOk) { 'could not be read (may need administrator rights; this script never changes firewall rules)' } elseif ($fw.Count -eq 0) { 'none (expected)' } else { $fw.Count.ToString() + ' found: ' + (($fw | ForEach-Object { $_.DisplayName + ' [' + $_.Enabled + ' ' + $_.Direction + ' ' + $_.Action + ']' }) -join '; ') }))
  Write-Host ''
  if ($bad -eq 0) { Write-Host 'PREREQUISITES: all OK.'; exit 0 }
  Write-Host ('PREREQUISITES: ' + $bad + ' problem(s). Do not run Install or Start.')
  exit 1
}

# ------------------------------------------------------------------------------------------------------------------------------ Install

function Invoke-Install {
  $marker = Read-Json $cfg.Marker
  if (-not $marker) { throw 'No verified-artifacts.json. Step C (Download) must be completed first.' }
  $vc = Get-VcRuntimeStatus
  if (-not $vc.Ok) { throw ('The Microsoft Visual C++ x64 runtime is incomplete (missing ' + ($vc.Missing -join ', ') + '). Nothing was extracted or run. Tell me; installing it needs separate approval.') }
  if (-not [Environment]::Is64BitProcess) { throw 'This is 32-bit PowerShell. Open the normal 64-bit Windows PowerShell. Nothing was extracted.' }
  $zips = @($script:Artifacts | Where-Object { $_.Group -eq 'runtime' })
  $dest = $cfg.LlamaDir
  $destCanon = ConvertTo-CanonPath $dest
  [void](Assert-UnderRoot $dest)
  if (Test-Path -LiteralPath $cfg.InstallRecord) { throw ('An install record already exists (' + $cfg.InstallRecord + '). Use Rollback.ps1 -Scope Install first. Nothing was extracted.') }
  if (Test-Path -LiteralPath $dest) { throw ($dest + ' already exists. Use Rollback.ps1 -Scope Install (or remove it yourself) first. Nothing was extracted.') }

  Confirm-Approval 'APPROVE D' ('STEP D (install) will extract ' + (($zips | ForEach-Object { $_.File }) -join ' and ') + ' into ' + $dest + ' (new folder, nothing overwritten) and then RUN llama-server.exe --version and --help once.')

  foreach ($z in $zips) {
    $path = Get-ArtifactPath $z
    [void](Assert-UnderRoot $path)
    if (-not (Test-Path -LiteralPath $path)) { throw ($z.File + ' is missing. Run step C first.') }
    Write-Host ('Re-checking SHA-256 of ' + $z.File + ' ...')
    if ((Get-FileSha256 $path) -ne $z.Sha256) { throw ($z.File + ' no longer matches its expected hash. Nothing was extracted.') }
  }

  # ---- PASS 1: read both archives and validate EVERY entry. Nothing is written in this pass.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $plan = New-Object System.Collections.ArrayList
  $seen = @{}
  [int64]$totalBytes = 0
  $handles = @()
  try {
    foreach ($z in $zips) {
      $zip = [System.IO.Compression.ZipFile]::OpenRead((Get-ArtifactPath $z))
      $handles += $zip
      foreach ($e in $zip.Entries) {
        $name = $e.FullName
        $isDir = ($name.EndsWith('/') -or $name.EndsWith('\'))
        $targetCanon = Test-ZipEntryName -Name $name -DestCanon $destCanon   # refuses unsafe names, traversal, device names, ADS, non-ASCII, outside-folder
        [void](Assert-UnderRoot $targetCanon)                               # inside D:\llm and no junction/symlink on the way
        if ($isDir) { continue }
        $key = $targetCanon.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { throw ('Two archive entries map to the same file (' + $targetCanon + '). Nothing was extracted; send me this message.') }
        $seen[$key] = $true
        if (Test-Path -LiteralPath $targetCanon) { throw ('Target already exists: ' + $targetCanon + '. Nothing was extracted.') }
        $totalBytes += $e.Length
        [void]$plan.Add([pscustomobject]@{ Zip = $zip; Entry = $e; Target = $targetCanon; Rel = $targetCanon.Substring($destCanon.Length + 1); Length = $e.Length })
      }
    }
    if ($plan.Count -eq 0) { throw 'The archives contain no files.' }
    if ($plan.Count -gt 2000) { throw ('Unexpectedly many files (' + $plan.Count + '). Nothing was extracted.') }
    if ($totalBytes -gt 6GB) { throw ('Unexpectedly large content (' + [math]::Round($totalBytes / 1GB, 2) + ' GiB uncompressed). Nothing was extracted.') }
    $free = Get-GiBFree $cfg.Root
    if ($free -ne $null -and $free -lt (($totalBytes / 1GB) + 2)) { throw ('Not enough free disk space (' + $free + ' GiB free; need ' + [math]::Round($totalBytes / 1GB + 2, 1) + ' GiB). Nothing was extracted.') }
    if (-not (@($plan | Where-Object { $_.Rel -ieq 'llama-server.exe' -or $_.Rel -imatch '(^|\\)llama-server\.exe$' }).Count -eq 1)) { throw 'The archives do not contain exactly one llama-server.exe. Nothing was extracted.' }
    Write-Host ('Validated ' + $plan.Count + ' files, ' + [math]::Round($totalBytes / 1MB, 0) + ' MiB uncompressed; every entry is inside ' + $destCanon + ', none exists yet, no links on the path.')

    # ---- PASS 2: extract. The record of what is created is written FIRST so that Rollback can remove exactly these files after any failure.
    $createdDirs = New-Object System.Collections.ArrayList
    $parentOfDest = Split-Path -Path $destCanon -Parent
    $llamaParent = $parentOfDest
    $parentWasNew = -not (Test-Path -LiteralPath $llamaParent)
    $record = [ordered]@{ phase = '6B'; status = 'extracting'; startedUtc = (Get-Date).ToUniversalTime().ToString('o'); dest = $destCanon; parentCreatedByInstall = $parentWasNew; files = @($plan | ForEach-Object { $_.Rel }) }
    Write-JsonFile $record $cfg.InstallRecord
    if ($parentWasNew) { [void](New-Item -ItemType Directory -Path $llamaParent) }
    [void](New-Item -ItemType Directory -Path $destCanon)
    foreach ($item in $plan) {
      $dir = Split-Path -Path $item.Target -Parent
      if (-not (Test-Path -LiteralPath $dir)) {
        $stack = @(); $d = $dir
        while (-not (Test-Path -LiteralPath $d)) { $stack += $d; $d = Split-Path -Path $d -Parent }
        [array]::Reverse($stack)
        foreach ($x in $stack) { [void](New-Item -ItemType Directory -Path $x); [void]$createdDirs.Add($x.Substring($destCanon.Length + 1)) }
      }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($item.Entry, $item.Target, $false)    # $false = never overwrite
    }
  } finally { foreach ($h in $handles) { $h.Dispose() } }
  $record['status'] = 'extracted'
  $record['createdDirs'] = @($createdDirs)
  $record['finishedUtc'] = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonFile $record $cfg.InstallRecord

  $exeItem = Get-ChildItem -LiteralPath $destCanon -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
  $exe = $exeItem.FullName
  $serverDir = Split-Path -Path $exe -Parent
  $dlls = @(Get-ChildItem -LiteralPath $serverDir -Filter '*.dll' | ForEach-Object { $_.Name })
  Write-Host ('Extracted ' + $plan.Count + ' files, ' + [math]::Round($totalBytes / 1MB, 0) + ' MiB; llama-server.exe is in ' + $serverDir)

  # ---- dependency check by reading the program file only (nothing is executed yet)
  $need = @()
  $wantCuda = @('ggml-cuda.dll')
  foreach ($w in $wantCuda) { if ($dlls -notcontains $w) { $need += ($w + ' (next to llama-server.exe)') } }
  foreach ($pat in @('cudart64_*.dll', 'cublas64_*.dll', 'cublasLt64_*.dll')) { if (@($dlls | Where-Object { $_ -like $pat }).Count -eq 0) { $need += ($pat + ' (next to llama-server.exe)') } }
  $named = @()
  try { $named = Get-DllNamesFromBinary $exe } catch { Write-Host ('(could not read DLL names from the program file: ' + $_.Exception.Message + ')') }
  $unresolved = @()
  foreach ($n in $named) {
    if ($n -like 'api-ms-win-*' -or $n -like 'ext-ms-*') { continue }
    if ($dlls -contains $n) { continue }
    if (Test-Path -LiteralPath (Join-Path (Join-Path $env:SystemRoot 'System32') $n)) { continue }
    $unresolved += $n
  }
  if ($need.Count -gt 0) { Write-Host ('WARNING: expected CUDA files not found: ' + ($need -join ', ')) }
  if ($unresolved.Count -gt 0) { Write-Host ('INFO: DLL names mentioned inside llama-server.exe that are neither next to it nor in System32 (some are optional backends probed at run time): ' + ($unresolved -join ', ')) }

  $sig = Get-AuthenticodeSignature -FilePath $exe
  Write-Host ('Authenticode signature of llama-server.exe: ' + $sig.Status + $(if ($sig.SignerCertificate) { ' (' + $sig.SignerCertificate.Subject + ')' } else { '' }))
  if ([string]$sig.Status -eq 'HashMismatch') { throw 'llama-server.exe carries a signature that does not match its contents. It was NOT run. Run Rollback.ps1 -Scope Install and tell me.' }
  $exeHash = Get-FileSha256 $exe

  if (-not (Test-Path -LiteralPath $cfg.Logs)) { [void](New-Item -ItemType Directory -Path $cfg.Logs) }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Write-Host 'Running llama-server.exe --version (30 s limit) ...'
  $v = Invoke-Capture $exe @('--version') (Join-Path $cfg.Logs ('version-' + $stamp + '.txt'))
  Write-Host ('  exit code ' + $v.ExitCode + $(if ($v.TimedOut) { ' (TIMED OUT)' } else { '' }))
  if ($v.ExitCode -eq -1073741515) { Write-Host '  0xC0000135: a required DLL was not found (most likely the Visual C++ runtime or a CUDA DLL).' }
  if ($v.ExitCode -eq -1073741701) { Write-Host '  0xC000007B: a DLL has the wrong bit-ness (32-bit vs 64-bit).' }
  if ($v.ExitCode -eq -1073741502) { Write-Host '  0xC0000142: the program failed to initialise (a DLL could not start).' }
  Write-Host (($v.Text -split "`r?`n" | Select-Object -First 8) -join "`n")
  Write-Host 'Running llama-server.exe --help (30 s limit) ...'
  $h = Invoke-Capture $exe @('--help') (Join-Path $cfg.Logs ('help-' + $stamp + '.txt'))
  $opts = @('--model', '--host', '--port', '--alias', '--ctx-size', '--parallel', '--n-gpu-layers', '--jinja')
  $missing = @($opts | Where-Object { $h.Text -notmatch [regex]::Escape($_) })
  if ($missing.Count -gt 0) { Write-Host ('WARNING: this build does not list these options in --help: ' + ($missing -join ', ') + '. Do not run Start; send me logs\help-*.txt.') }
  else { Write-Host 'All command-line options used by step D are listed in --help.' }

  Write-JsonFile @{ phase = '6B'; status = 'extracted'; extractedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); dest = $destCanon; parentCreatedByInstall = $parentWasNew;
    files = @($plan | ForEach-Object { $_.Rel }); createdDirs = @($createdDirs); exe = $exe; serverDir = $serverDir; exeSha256 = $exeHash;
    authenticodeStatus = [string]$sig.Status; versionExitCode = $v.ExitCode; versionText = (($v.Text -split "`r?`n" | Select-Object -First 8) -join ' | ');
    mibExtracted = [math]::Round($totalBytes / 1MB, 0); dlls = $dlls; expectedCudaFilesMissing = $need; unresolvedDllNames = $unresolved; optionsMissingFromHelp = $missing } $cfg.InstallRecord
  Write-Host ''
  Write-Host ('Install record: ' + $cfg.InstallRecord)
  if ($v.ExitCode -ne 0 -or $v.TimedOut -or $missing.Count -gt 0) { Write-Host 'The program did not run cleanly or lacks an option. Do not continue; send me the record and logs.'; exit 1 }
}

# ------------------------------------------------------------------------------------------------------------------------------- Start
function Invoke-Start {
  $rec = Read-Json $cfg.InstallRecord
  if (-not $rec) { throw 'No install-record.json. Run -Action Install first.' }
  if ($rec.status -ne 'extracted' -or $rec.versionExitCode -ne 0) { throw 'The install did not finish cleanly (status or --version exit code). Not starting. Send me install-record.json.' }
  if ($rec.optionsMissingFromHelp -and @($rec.optionsMissingFromHelp).Count -gt 0) { throw 'The installed build lacks command-line options this script uses; not starting.' }
  [void](Assert-UnderRoot $rec.exe)
  if (-not (Test-Path -LiteralPath $rec.exe)) { throw 'llama-server.exe from the install record is missing. Nothing was started.' }
  if ((Get-FileSha256 $rec.exe) -ne $rec.exeSha256) { throw 'llama-server.exe changed after it was installed (hash differs from the install record). Nothing was started.' }
  $art = Get-ModelArtifact
  $marker = Read-Json $cfg.Marker
  $mrec = $null
  if ($marker -and $marker.files) { $mrec = $marker.files.PSObject.Properties[$art.Id] }
  if (-not $mrec) { throw ('The ' + $art.File + ' model is not in verified-artifacts.json. Run Step C for it first.') }
  $modelPath = Get-ArtifactPath $art
  [void](Assert-UnderRoot $modelPath)
  $fi = Get-Item -LiteralPath $modelPath
  if ($fi.Length -ne [int64]$mrec.Value.length -or $fi.LastWriteTimeUtc.Ticks -ne (ConvertTo-UtcDate $mrec.Value.lastWriteUtc).Ticks) { throw 'The model file changed after it was verified. Run Step C -Action Verify.' }
  if ($RehashModel) {
    Write-Host 'Re-computing the model SHA-256 (about 1 minute) ...'
    if ((Get-FileSha256 $modelPath) -ne $art.Sha256) { throw 'The model file no longer matches its expected SHA-256. Nothing was started.' }
    Write-Host 'Model hash OK.'
  }

  if (Get-ServerState) { throw 'A server started by this script is already running. Use -Action Status or Stop.' }
  if (Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue) { throw 'Another llama-server process is running that this script did not start. Not starting a second one.' }
  if (Get-NetTCPConnection -LocalPort $cfg.Port -State Listen -ErrorAction SilentlyContinue) { throw ('Port ' + $cfg.Port + ' is already in use.') }

  $ram = Get-AvailRamGiB
  $vram = Get-VramMiB
  $minRam = $cfg.MinAvailRamGiB
  if ($Model -eq '4b') { $minRam = 4.5 }
  Write-Host ('Gate: available RAM now ' + $ram + ' GiB (needs at least ' + $minRam + ')')
  if ($ram -ne $null -and $ram -lt $minRam) { throw 'Not enough free RAM. Close browsers and other programs, then try again. Nothing was started.' }
  if ($vram) {
    Write-Host ('Gate: free VRAM now ' + $vram.FreeMiB + ' MiB of ' + $vram.TotalMiB + ' (needs at least ' + $cfg.MinFreeVramMiB + ' at -Ngl 8; scale down if you lower -Ngl)')
    if ($Ngl -ge 8 -and $vram.FreeMiB -lt $cfg.MinFreeVramMiB) { throw 'Not enough free VRAM for this -Ngl. Close programs that use the GPU or lower -Ngl. Nothing was started.' }
  } elseif ($Ngl -gt 0) { throw 'nvidia-smi was not found, so VRAM cannot be checked. Only -Ngl 0 (no GPU) is allowed in that case. Nothing was started.' }
  else { Write-Host 'Gate: nvidia-smi not available; running without the GPU (-Ngl 0).' }

  $argList = @('--model', $modelPath, '--host', '127.0.0.1', '--port', [string]$cfg.Port, '--alias', $alias, '--ctx-size', [string]$cfg.Context, '--parallel', [string]$cfg.Parallel, '--n-gpu-layers', [string]$Ngl, '--jinja')
  Confirm-Approval 'APPROVE D' ('STEP D (start) will launch: llama-server.exe ' + ($argList -join ' ') + "`n  listening on 127.0.0.1:" + $cfg.Port + ' only; logs in ' + $cfg.Logs + '. It will load about 5 GB into memory.')

  if (-not (Test-Path -LiteralPath $cfg.Logs)) { [void](New-Item -ItemType Directory -Path $cfg.Logs) }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $cfg.Logs ('server-' + $stamp + '.out.log')
  $errLog = Join-Path $cfg.Logs ('server-' + $stamp + '.err.log')
  $p = Start-Process -FilePath $rec.exe -ArgumentList $argList -WorkingDirectory $rec.serverDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
  $null = $p.Handle
  Write-JsonFile @{ pid = $p.Id; startedUtc = (Get-Date).ToUniversalTime().ToString('o'); model = $alias; ngl = $Ngl; ctx = $cfg.Context; args = $argList; outLog = $outLog; errLog = $errLog; ramGiBBefore = $ram; vramBefore = $vram } $cfg.PidFile
  Write-Host ('Started llama-server (process ' + $p.Id + '). Waiting for it to load the model (up to 5 minutes) ...')

  $deadline = (Get-Date).AddSeconds(300)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($p.HasExited) { break }
    $brakeRam = Get-AvailRamGiB
    if ($brakeRam -ne $null -and $brakeRam -lt 0.7) {
      Write-Host ''
      Write-Host ('EMERGENCY BRAKE: available RAM fell to ' + $brakeRam + ' GiB while loading; stopping the server now.')
      try { Stop-Process -Id $p.Id -Force } catch { }
      Remove-Item -LiteralPath $cfg.PidFile -ErrorAction SilentlyContinue
      throw 'Stopped by the memory safeguard. Close other programs or use -Ngl 12 / -Model 4b, then try again.'
    }
    try { $r = Invoke-WebRequest -Uri ($base + '/health') -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Seconds 3
    Write-Host -NoNewline '.'
  }
  Write-Host ''
  if (-not $ready) {
    Write-Host $(if ($p.HasExited) { 'The server exited (exit code ' + $p.ExitCode + ').' } else { 'The server did not become ready in 5 minutes; stopping it.' })
    if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch { } }
    Write-Host 'Last lines of its error log:'
    if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Tail 40 | ForEach-Object { Write-Host ('  ' + $_) } }
    Remove-Item -LiteralPath $cfg.PidFile -ErrorAction SilentlyContinue
    exit 1
  }
  $p.Refresh()
  $ls = Get-ListenerInfo $p.Id
  if ($ls -eq $null) { Write-Host ('Listening sockets: could not be read. Check by hand:  netstat -ano | findstr :' + $cfg.Port) }
  else {
    Write-Host ('Listening sockets of this server: ' + (($ls | ForEach-Object { $_.Address + ':' + $_.Port }) -join ', '))
    if (-not (Test-LoopbackOnly $ls)) {
      Write-Host 'The server is listening on an address other than 127.0.0.1. Stopping it.'
      try { Stop-Process -Id $p.Id -Force } catch { }
      Remove-Item -LiteralPath $cfg.PidFile -ErrorAction SilentlyContinue
      throw 'Non-loopback listener detected; the server was stopped.'
    }
  }
  Write-Host ('Server ready on ' + $base + ' (process ' + $p.Id + ', working set ' + [math]::Round($p.WorkingSet64 / 1MB, 0) + ' MiB). Available RAM now ' + (Get-AvailRamGiB) + ' GiB.')
  $v2 = Get-VramMiB
  if ($v2) { Write-Host ('VRAM used ' + $v2.UsedMiB + ' MiB, free ' + $v2.FreeMiB + ' MiB. Also watch Task Manager > Performance > GPU: "Shared GPU memory" must stay near zero.') }
  Write-Host 'Next: -Action Health   (and -Action Stop when finished).'
}

# ------------------------------------------------------------------------------------------------------------------------------ Health
function Invoke-Health {
  $st = Get-ServerState
  if (-not $st) { throw 'No running server found. Use -Action Start first.' }
  Add-Type -AssemblyName System.Net.Http
  if (-not (Test-Path -LiteralPath $cfg.Health)) { [void](New-Item -ItemType Directory -Path $cfg.Health) }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $started = Get-Date

  function Take-Sample {
    param([string]$Label)
    $pr = Get-Process -Id $st.Process.Id -ErrorAction SilentlyContinue
    $ws = $null; $pm = $null
    if ($pr) { $pr.Refresh(); $ws = [math]::Round($pr.WorkingSet64 / 1MB, 0); $pm = [math]::Round($pr.PrivateMemorySize64 / 1MB, 0) }
    $vr = Get-VramMiB
    return @{ label = $Label; secondsSinceStart = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); availRamGiB = (Get-AvailRamGiB);
      vramUsedMiB = $(if ($vr) { $vr.UsedMiB } else { $null }); vramFreeMiB = $(if ($vr) { $vr.FreeMiB } else { $null }); serverWorkingSetMiB = $ws; serverPrivateMiB = $pm }
  }

  $script:brakeFired = $false
  $samples = New-Object System.Collections.ArrayList
  [void]$samples.Add((Take-Sample 'before'))
  $listenBefore = Get-ListenerInfo $st.Process.Id

  function Get-Json { param([string]$Path) try { return (Invoke-RestMethod -Uri ($base + $Path) -TimeoutSec 15) } catch { return @{ error = $_.Exception.Message } } }
  $healthNow = Get-Json '/health'
  $props = Get-Json '/props'
  $models = Get-Json '/v1/models'

  function Invoke-Chat {
    param([string]$Label, [string]$System, [string]$User, [int]$MaxTokens)
    $body = @{ model = $alias; messages = @(@{ role = 'system'; content = $System }, @{ role = 'user'; content = $User }); max_tokens = $MaxTokens; temperature = 0; stream = $false; chat_template_kwargs = @{ enable_thinking = $false } }
    $json = ConvertTo-Json -InputObject $body -Depth 6
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(20)
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $task = $client.PostAsync(($base + '/v1/chat/completions'), $content)
    while (-not $task.IsCompleted) {
      $smp = Take-Sample ($Label + ' (running)')
      [void]$samples.Add($smp)
      if ($smp.availRamGiB -ne $null -and $smp.availRamGiB -lt 0.5 -and -not $script:brakeFired) {
        $script:brakeFired = $true
        Write-Host ('EMERGENCY BRAKE: available RAM fell to ' + $smp.availRamGiB + ' GiB; stopping the server now.')
        try { Stop-Process -Id $st.Process.Id -Force } catch { }
      }
      Start-Sleep -Milliseconds 1500
    }
    $sw.Stop()
    $out = @{ test = $Label; wallSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 2); httpStatus = $null; error = $null }
    try {
      $resp = $task.Result
      $out.httpStatus = [int]$resp.StatusCode
      $text = $resp.Content.ReadAsStringAsync().Result
      $r = $text | ConvertFrom-Json
      $msg = $r.choices[0].message.content
      $out.finishReason = $r.choices[0].finish_reason
      $out.promptTokens = $r.usage.prompt_tokens
      $out.completionTokens = $r.usage.completion_tokens
      $out.answerPreview = $(if ($msg) { ([string]$msg).Substring(0, [math]::Min(200, ([string]$msg).Length)) } else { '' })
      $out.answerHasThinkTags = [bool]($msg -match '<think>|</think>')
      $out.serverTimings = $r.timings
    } catch { $out.error = $_.Exception.Message }
    $client.Dispose()
    [void]$samples.Add((Take-Sample ($Label + ' (done)')))
    return $out
  }

  $lines = New-Object System.Text.StringBuilder
  for ($i = 1; $i -le 30; $i++) { [void]$lines.Append('Sample line ' + $i + ': the measured value was ' + (10 + $i) + ' units.' + "`n") }
  $tests = @()
  $tests += Invoke-Chat 'T1 tiny prompt' 'You are a terse assistant.' 'Reply with the single word: ready.' 8
  $tests += Invoke-Chat 'T2 short summary' 'You write short factual summaries.' 'Summarise in two sentences: A bakery recalibrates its oven every Monday. The target temperature is 220 degrees. After calibration the oven held 219 to 221 degrees across three test loaves, and the crust colour matched the reference chart. The calibration takes forty minutes.' 120
  $tests += Invoke-Chat 'T3 longer prompt' 'You answer with a number only.' ($lines.ToString() + 'How many lines are listed above?') 12
  [void]$samples.Add((Take-Sample 'after'))

  $srv = Read-Json $cfg.PidFile
  $patterns = 'offload|KV buffer|model buffer|compute buffer|n_ctx|n_slots|n_gpu_layers|ggml_cuda|CUDA|VRAM|device|error|fail|warn|memory'
  $extract = @()
  foreach ($f in @($srv.errLog, $srv.outLog)) { if ($f -and (Test-Path -LiteralPath $f)) { $extract += @(Select-String -LiteralPath $f -Pattern $patterns | Select-Object -First 120 | ForEach-Object { $_.Line.Trim() }) } }
  $extractPath = Join-Path $cfg.Health ('loadlog-extract-' + $stamp + '.txt')
  [System.IO.File]::WriteAllText($extractPath, ($extract -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))

  $conns = @()
  try { $conns = @(Get-NetTCPConnection -OwningProcess $st.Process.Id -ErrorAction Stop | ForEach-Object { @{ local = ($_.LocalAddress + ':' + $_.LocalPort); remote = ($_.RemoteAddress + ':' + $_.RemotePort); state = [string]$_.State } }) } catch { }
  $external = @($conns | Where-Object { $_.state -eq 'Established' -and $_.remote -notmatch '^(127\.0\.0\.1|::1|0\.0\.0\.0|::)' })
  $fw = @()
  try { $fw = @(Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.DisplayName -match 'llama' } | ForEach-Object { @{ name = $_.DisplayName; enabled = [string]$_.Enabled; direction = [string]$_.Direction; action = [string]$_.Action } }) } catch { $fw = @('could not be read (that can need administrator rights)') }

  $okSamples = @($samples | Where-Object { $_.availRamGiB -ne $null })
  $minRam = ($okSamples | ForEach-Object { $_.availRamGiB } | Measure-Object -Minimum).Minimum
  $vs = @($samples | Where-Object { $_.vramUsedMiB -ne $null })
  $maxVram = $null; if ($vs.Count -gt 0) { $maxVram = ($vs | ForEach-Object { $_.vramUsedMiB } | Measure-Object -Maximum).Maximum }
  $maxWs = ($samples | Where-Object { $_.serverWorkingSetMiB -ne $null } | ForEach-Object { $_.serverWorkingSetMiB } | Measure-Object -Maximum).Maximum

  $nctx = $null; $slots = $null
  try { $nctx = $props.default_generation_settings.n_ctx; $slots = $props.total_slots } catch { }
  $listenNow = Get-ListenerInfo $st.Process.Id
  $listenText = $(if ($listenNow -eq $null) { 'could not be read' } else { (($listenNow | ForEach-Object { $_.Address + ':' + $_.Port }) -join ', ') })
  $checks = @()
  $checks += @{ check = 'server listens on 127.0.0.1 only (listening sockets)'; pass = ($listenNow -ne $null -and $listenNow.Count -gt 0 -and (Test-LoopbackOnly $listenNow)); detail = $listenText }
  $checks += @{ check = 'memory emergency brake not triggered'; pass = (-not $script:brakeFired) }
  $checks += @{ check = '/health answers'; pass = ($healthNow -and -not $healthNow.error) }
  $checks += @{ check = 'context is 4096'; pass = ($nctx -eq 4096); detail = $nctx }
  $checks += @{ check = 'one slot'; pass = ($slots -eq 1); detail = $slots }
  $checks += @{ check = 'all three prompts answered (HTTP 200, no error)'; pass = (@($tests | Where-Object { $_.error -or $_.httpStatus -ne 200 }).Count -eq 0) }
  $checks += @{ check = 'no <think> tags in answers'; pass = (@($tests | Where-Object { $_.answerHasThinkTags }).Count -eq 0) }
  $checks += @{ check = 'available RAM never below 1.0 GiB'; pass = ($minRam -ne $null -and $minRam -ge 1.0); detail = $minRam }
  $checks += @{ check = 'VRAM used stayed below 3,600 MiB'; pass = ($maxVram -eq $null -or $maxVram -le 3600); detail = $maxVram }
  $checks += @{ check = 'no established connection to a non-local address'; pass = ($external.Count -eq 0); detail = $external.Count }

  $report = [ordered]@{ phase = '6B'; kind = 'health-check'; takenUtc = (Get-Date).ToUniversalTime().ToString('o'); server = $srv; health = $healthNow; props = $props; models = $models;
    tests = $tests; samples = $samples; listenersBefore = $listenBefore; listenersAfter = $listenNow; loadLogExtractFile = $extractPath; connections = $conns; externalConnections = $external; firewallRulesMentioningLlama = $fw;
    summary = @{ minAvailRamGiB = $minRam; maxVramUsedMiB = $maxVram; maxServerWorkingSetMiB = $maxWs }; checks = $checks }
  $jsonPath = Join-Path $cfg.Health ('health-' + $stamp + '.json')
  Write-JsonFile $report $jsonPath

  Write-Host ''
  Write-Host 'HEALTH CHECK RESULT'
  foreach ($c in $checks) { Write-Host (($(if ($c.pass) { '  PASS  ' } else { '  FAIL  ' })) + $c.check + $(if ($c.detail -ne $null) { '  [' + $c.detail + ']' } else { '' })) }
  Write-Host ''
  foreach ($t in $tests) {
    $tm = $t.serverTimings
    Write-Host ('  ' + $t.test + ': ' + $t.wallSeconds + ' s wall; prompt ' + $t.promptTokens + ' tokens, generated ' + $t.completionTokens + ' tokens' +
      $(if ($tm) { '; server: prompt ' + $tm.prompt_per_second + ' tok/s, generation ' + $tm.predicted_per_second + ' tok/s' } else { '; (no server timings in the reply)' }))
  }
  Write-Host ''
  Write-Host ('  Lowest available RAM ' + $minRam + ' GiB; highest VRAM used ' + $maxVram + ' MiB; server working set up to ' + $maxWs + ' MiB')
  Write-Host ('  Report: ' + $jsonPath)
  Write-Host ('  Load-log extract: ' + $extractPath)
  Write-Host 'Also look at Task Manager > Performance > GPU for "Shared GPU memory" (it should be near zero) and send me what you see.'
  if (@($checks | Where-Object { -not $_.pass }).Count -gt 0) { exit 1 }
}

# -------------------------------------------------------------------------------------------------------------------------- Stop, Status
function Invoke-Stop {
  $st = Get-ServerState
  if (-not $st) {
    Write-Host 'No server started by this script is running.'
    $others = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
    if ($others.Count -gt 0) { Write-Host ('NOTE: ' + $others.Count + ' other llama-server process(es) exist that this script did not start (ids: ' + (($others | ForEach-Object { $_.Id }) -join ', ') + '). They were not touched.') }
    Remove-Item -LiteralPath $cfg.PidFile -ErrorAction SilentlyContinue
    return
  }
  Stop-Process -Id $st.Process.Id
  if (-not $st.Process.WaitForExit(20000)) { Stop-Process -Id $st.Process.Id -Force; [void]$st.Process.WaitForExit(10000) }
  Remove-Item -LiteralPath $cfg.PidFile -ErrorAction SilentlyContinue
  Write-Host ('Stopped llama-server (process ' + $st.Process.Id + '). Available RAM now ' + (Get-AvailRamGiB) + ' GiB.')
  if (Get-NetTCPConnection -LocalPort $cfg.Port -State Listen -ErrorAction SilentlyContinue) { Write-Host ('WARNING: something is still listening on port ' + $cfg.Port) } else { Write-Host ('Port ' + $cfg.Port + ' is closed.') }
}

function Invoke-Status {
  $st = Get-ServerState
  Write-Host ('Available RAM ' + (Get-AvailRamGiB) + ' GiB of ' + (Get-TotalRamGiB) + ' GiB')
  $v = Get-VramMiB
  if ($v) { Write-Host ('VRAM used ' + $v.UsedMiB + ' MiB, free ' + $v.FreeMiB + ' MiB of ' + $v.TotalMiB) }
  if ($st) {
    $st.Process.Refresh()
    Write-Host ('Server running: process ' + $st.Process.Id + ', working set ' + [math]::Round($st.Process.WorkingSet64 / 1MB, 0) + ' MiB, started ' + $st.Record.startedUtc + ', -Ngl ' + $st.Record.ngl + ', ctx ' + $st.Record.ctx)
    $ls = Get-ListenerInfo $st.Process.Id
    if ($ls -eq $null) { Write-Host ('Listening sockets: could not be read. Check by hand:  netstat -ano | findstr :' + $cfg.Port) }
    else { Write-Host ('Listening sockets: ' + (($ls | ForEach-Object { $_.Address + ':' + $_.Port }) -join ', ') + $(if (Test-LoopbackOnly $ls) { '   (loopback only - OK)' } else { '   (NOT loopback only - run -Action Stop)' })) }
    try { $r = Invoke-WebRequest -Uri ($base + '/health') -UseBasicParsing -TimeoutSec 5; Write-Host ('/health: HTTP ' + $r.StatusCode) } catch { Write-Host ('/health: ' + $_.Exception.Message) }
  } else { Write-Host 'No server started by this script is running.' }
}

try {
  switch ($Action) {
    'Prereq'  { Invoke-Prereq }
    'Install' { Invoke-Install }
    'Start'   { Invoke-Start }
    'Health'  { Invoke-Health }
    'Stop'    { Invoke-Stop }
    'Status'  { Invoke-Status }
  }
}
catch {
  Write-Host ''
  Write-Host ('STOPPED: ' + $_.Exception.Message)
  exit 1
}
