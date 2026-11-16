# Phase6B.Common.ps1 - shared settings and helper functions for the Phase 6B step scripts.
# Dot-sourced by Step-C-Acquire.ps1, Step-D-Run.ps1 and Rollback.ps1. ASCII only. Windows PowerShell 5.1.
# Nothing in this file does anything by itself: it only defines settings and functions.

if (-not $Root) { $Root = 'D:\llm' }

$script:Cfg = @{
  Root           = $Root
  Downloads      = (Join-Path $Root 'downloads')
  Models         = (Join-Path $Root 'models')
  LlamaDir       = (Join-Path $Root 'llama.cpp\b11669')
  Logs           = (Join-Path $Root 'logs')
  Health         = (Join-Path $Root 'health')
  Marker         = (Join-Path $Root 'verified-artifacts.json')
  InstallRecord  = (Join-Path $Root 'install-record.json')
  PidFile        = (Join-Path $Root 'server.pid.json')
  Port           = 8080          # always passed explicitly: llama.cpp v0.7.0 notes say the default port changed to 9931
  Context        = 4096
  Parallel       = 1
  DefaultNgl     = 8             # PROVISIONAL: to be adjusted from the llama-server load log
  MinAvailRamGiB = 6.5           # gate: about 4.84 GiB expected use at ctx 4096 / ngl 8, plus 1.5 GiB for Windows, plus a little
  MinFreeVramMiB = 2200          # gate: about 1,711 MiB expected use plus a margin
  MinFreeDiskGiB = 20
}

# Expected values. Sources and the way each was checked are in 10_PHASE6B_APPROVAL_PACKAGE.md.
# Sha256 of the two llama.cpp zips = the digests GitHub displays on the b11669 release page (read twice). Model hashes = Git LFS pointer files
# on Hugging Face at the pinned revisions (read through two different routes).
$script:Artifacts = @(
  [pscustomobject]@{ Id = 'llama-cuda'; Group = 'runtime'; Dir = 'Downloads'; File = 'llama-b11669-bin-win-cuda-12.4-x64.zip';
    Url = 'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cuda-12.4-x64.zip';
    Sha256 = 'c2da1f73ed176ae093ac5aceb978a7b167a16113f6d74c6789eeaee2135cb8dc'; Bytes = 0; ApproxMB = 254 },
  [pscustomobject]@{ Id = 'cudart'; Group = 'runtime'; Dir = 'Downloads'; File = 'cudart-llama-bin-win-cuda-12.4-x64.zip';
    Url = 'https://github.com/ggml-org/llama.cpp/releases/download/b11669/cudart-llama-bin-win-cuda-12.4-x64.zip';
    Sha256 = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'; Bytes = 0; ApproxMB = 373 },
  [pscustomobject]@{ Id = 'qwen3-8b'; Group = 'model8b'; Dir = 'Models'; File = 'Qwen3-8B-Q4_K_M.gguf';
    Url = 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf';
    Sha256 = 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785'; Bytes = 5027783488; ApproxMB = 4795 },
  [pscustomobject]@{ Id = 'qwen3-4b'; Group = 'model4b'; Dir = 'Models'; File = 'Qwen3-4B-Q4_K_M.gguf';
    Url = 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf';
    Sha256 = '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'; Bytes = 2497280256; ApproxMB = 2381 }
)

function Get-ArtifactPath {
  param($Artifact)
  return (Join-Path $script:Cfg[$Artifact.Dir] $Artifact.File)
}

function Confirm-Approval {
  param([string]$Phrase, [string]$What)
  Write-Host ''
  Write-Host $What
  $answer = Read-Host ('Type exactly  ' + $Phrase + '  to continue (anything else cancels and changes nothing)')
  if ($answer -cne $Phrase) { Write-Host 'Cancelled. Nothing was changed.'; exit 3 }
}

# ---- Path safety (rewritten after the first Step C run: the old check required "root + backslash" as a prefix, so the root folder itself was refused) ----
# ConvertTo-CanonPath is pure string logic (no file system access, no .NET GetFullPath), so it behaves the same everywhere and can be tested
# without touching the disk. It accepts only absolute drive paths such as D:\llm\models, turns / into \, removes empty and "." segments,
# resolves ".." (refusing to climb above the drive), upper-cases the drive letter, and removes trailing separators.
# It REFUSES: empty text, non-ASCII or control characters, * ? " < > |, UNC (\\server), device (\\?\ and \\.\), relative and drive-relative
# (D:llm) forms, a colon after the drive (NTFS alternate data streams), segments ending in "." or a space (Windows would silently drop them),
# and reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, CONIN$, CONOUT$, with or without an extension).
function ConvertTo-CanonPath {
  param([string]$Path)
  if ([string]::IsNullOrEmpty($Path)) { throw 'Refusing an empty path.' }
  foreach ($ch in $Path.ToCharArray()) {
    $code = [int]$ch
    if ($code -lt 32 -or $code -gt 126) { throw ('Refusing a path with a control or non-ASCII character: ' + $Path) }
  }
  if ($Path -match '[*?"<>|]') { throw ('Refusing a path with a wildcard or reserved character: ' + $Path) }
  $p = $Path.Replace('/', '\')
  if ($p -notmatch '^[A-Za-z]:\\') { throw ('Refusing a path that is not an absolute drive path such as D:\llm (UNC, device, relative and drive-relative forms are refused): ' + $Path) }
  if ($p.IndexOf(':', 2) -ge 0) { throw ('Refusing a path with a colon after the drive letter (alternate data stream): ' + $Path) }
  $parts = New-Object System.Collections.ArrayList
  foreach ($seg in $p.Substring(3).Split('\')) {
    if ($seg -eq '' -or $seg -eq '.') { continue }
    if ($seg -eq '..') {
      if ($parts.Count -eq 0) { throw ('Refusing a path that climbs above the drive root: ' + $Path) }
      $parts.RemoveAt($parts.Count - 1)
      continue
    }
    if ($seg.EndsWith('.') -or $seg.EndsWith(' ')) { throw ('Refusing a path segment that ends with a dot or a space: ' + $Path) }
    $stem = $seg.Split('.')[0].ToUpperInvariant()
    if ($stem -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$') { throw ('Refusing a path segment that is a reserved Windows device name: ' + $Path) }
    [void]$parts.Add($seg)
  }
  return ($p.Substring(0, 1).ToUpperInvariant() + ':\' + ($parts -join '\'))
}

# True when CanonPath is the root itself or lies below it. Both arguments must already be canonical. The boundary is a whole path segment:
# D:\llm\models and D:\llm are inside D:\llm; D:\llm-evil and D:\llmx are not. Windows file names are case-insensitive, so the compare is too.
function Test-PathWithinRoot {
  param([string]$CanonPath, [string]$CanonRoot)
  if ([string]::Equals($CanonPath, $CanonRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  $prefix = $CanonRoot
  if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
  return $CanonPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

# Full check. Throws unless Path is inside Root AND neither Root nor any existing folder/file on the way from Root down to Path is a
# junction or symbolic link (reparse point). Exists/IsReparse are script blocks so the test script can supply fakes without touching the disk.
# Returns the canonical path. A path whose later parts do not exist yet is fine (the scripts create them under a checked parent).
function Resolve-UnderRoot {
  param([string]$Path, [string]$Root, [scriptblock]$Exists, [scriptblock]$IsReparse)
  $cr = ConvertTo-CanonPath $Root
  if ($cr.Length -le 3) { throw ('The root folder must not be a whole drive: ' + $Root) }
  $cp = ConvertTo-CanonPath $Path
  if (-not (Test-PathWithinRoot $cp $cr)) { throw ('Refusing to touch a path outside ' + $cr + ' : ' + $cp) }
  $chain = New-Object System.Collections.ArrayList
  [void]$chain.Add($cr)
  if ($cp.Length -gt $cr.Length) {
    $acc = $cr
    foreach ($seg in $cp.Substring($cr.Length + 1).Split('\')) {
      $acc = $acc + '\' + $seg
      [void]$chain.Add($acc)
    }
  }
  foreach ($c in $chain) {
    if (& $Exists $c) {
      if (& $IsReparse $c) { throw ('Refusing ' + $c + ': it is a junction or symbolic link (reparse point).') }
    }
  }
  return $cp
}

function Assert-UnderRoot {
  param([string]$Path)
  $exists = { param($p) Test-Path -LiteralPath $p }
  $isReparse = { param($p) [bool]((Get-Item -LiteralPath $p -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) }
  return (Resolve-UnderRoot -Path $Path -Root $script:Cfg.Root -Exists $exists -IsReparse $isReparse)
}

# Validates ONE archive entry name against the install folder and returns the canonical target path, or throws. No disk access.
# Refuses: absolute names, any colon, any ".." segment (even one that would stay inside), and everything ConvertTo-CanonPath refuses
# (non-ASCII, wildcards, trailing dot/space, device names, alternate data streams). Backslash and slash are both treated as separators.
function Test-ZipEntryName {
  param([string]$Name, [string]$DestCanon)
  if ([string]::IsNullOrEmpty($Name)) { throw 'Unsafe archive entry: empty name.' }
  if ($Name -match '^[\\/]' -or $Name.Contains(':')) { throw ('Unsafe archive entry (absolute path or colon): ' + $Name) }
  $segs = $Name.Replace('\', '/').Split('/')
  if ($segs -contains '..') { throw ('Unsafe archive entry (parent traversal): ' + $Name) }
  $target = ConvertTo-CanonPath (Join-Path $DestCanon $Name)
  if (-not (Test-PathWithinRoot $target $DestCanon)) { throw ('Archive entry would land outside the install folder: ' + $Name) }
  return $target
}

function Get-AvailRamGiB {
  try {
    $p = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory
    return [math]::Round(([double]$p.AvailableBytes) / 1073741824, 2)
  } catch { return $null }
}

function Get-TotalRamGiB {
  try { return [math]::Round(([double](Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory) / 1073741824, 2) } catch { return $null }
}

function Get-SmiPath {
  $c = Get-Command 'nvidia-smi.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [string]$c.Path }
  foreach ($p in @((Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'), (Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'))) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

# returns @{ TotalMiB; UsedMiB; FreeMiB } or $null
function Get-VramMiB {
  $smi = Get-SmiPath
  if (-not $smi) { return $null }
  try {
    $line = @(& $smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits 2>$null) | Select-Object -First 1
    $f = @(([string]$line).Split(',') | ForEach-Object { $_.Trim() })
    if ($f.Count -lt 3) { return $null }
    return @{ TotalMiB = [int]$f[0]; UsedMiB = [int]$f[1]; FreeMiB = [int]$f[2] }
  } catch { return $null }
}

function Get-FileSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Get-CurlPath {
  $c = Get-Command 'curl.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [string]$c.Path }
  return $null
}

function Get-GiBFree {
  param([string]$Path)
  $drive = (Split-Path -Path $Path -Qualifier).TrimEnd(':')
  $v = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $drive + ":'")
  if (-not $v) { return $null }
  return [math]::Round(([double]$v.FreeSpace) / 1073741824, 1)
}

function Read-Json {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Write-JsonFile {
  param($Object, [string]$Path)
  $json = ConvertTo-Json -InputObject $Object -Depth 8
  [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Converts a stored timestamp (text such as 2026-11-04T10:30:00.1234567Z, or a DateTime when a newer PowerShell already converted it) to UTC.
function ConvertTo-UtcDate {
  param($Value)
  if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
  return [datetime]::Parse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

# The server this package started: the recorded process id must still be a llama-server process that STARTED when we recorded it
# (so a recycled process id can never make us stop an unrelated program).
function Get-ServerState {
  $rec = Read-Json $script:Cfg.PidFile
  if (-not $rec) { return $null }
  $proc = Get-Process -Id ([int]$rec.pid) -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.ProcessName -ne 'llama-server') { return $null }
  try {
    $diff = [math]::Abs((($proc.StartTime.ToUniversalTime()) - (ConvertTo-UtcDate $rec.startedUtc)).TotalSeconds)
    if ($diff -gt 300) { return $null }
  } catch { return $null }
  return @{ Record = $rec; Process = $proc }
}

# Listening sockets owned by a process: @{ Address; Port } items (read-only).
function Get-ListenerInfo {
  param([int]$ProcessId)
  $r = @()
  try {
    foreach ($c in @(Get-NetTCPConnection -State Listen -OwningProcess $ProcessId -ErrorAction Stop)) { $r += @{ Address = [string]$c.LocalAddress; Port = [int]$c.LocalPort } }
  } catch { return $null }
  return $r
}

function Test-LoopbackOnly {
  param($Listeners)
  if ($Listeners -eq $null) { return $false }
  foreach ($l in @($Listeners)) { if (@('127.0.0.1', '::1') -notcontains $l.Address) { return $false } }
  return $true
}

# Microsoft Visual C++ 2015-2022 x64 runtime files that MSVC-built programs (llama.cpp's Windows builds) load. They are NOT part of the llama.cpp zips.
# Read-only: looks for the files in the 64-bit System32 folder and for the registry flag the redistributable writes.
function Get-VcRuntimeStatus {
  $sys = Join-Path $env:SystemRoot 'System32'
  $items = @()
  foreach ($n in @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'vcomp140.dll')) {
    $f = Join-Path $sys $n
    $ver = $null
    if (Test-Path -LiteralPath $f) { try { $ver = (Get-Item -LiteralPath $f).VersionInfo.FileVersion } catch { } }
    $items += @{ Name = $n; Present = (Test-Path -LiteralPath $f); Version = $ver }
  }
  $reg = $null
  try { $k = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction Stop; $reg = ('Installed=' + $k.Installed + ' Version=' + $k.Version) } catch { }
  $missing = @($items | Where-Object { -not $_.Present } | ForEach-Object { $_.Name })
  return @{ Files = $items; Missing = $missing; Registry = $reg; Is64BitProcess = [Environment]::Is64BitProcess; Ok = ($missing.Count -eq 0) }
}

# Names of DLLs mentioned as text inside a program file (import table and delay-load names are plain ASCII). Nothing is executed; the file is only read.
function Get-DllNamesFromBinary {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
  $names = @{}
  foreach ($m in [regex]::Matches($text, '[A-Za-z0-9_\.\-]{3,60}\.dll', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) { $names[$m.Value.ToLowerInvariant()] = $true }
  return @($names.Keys | Sort-Object)
}
