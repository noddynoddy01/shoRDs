<#
.SYNOPSIS
  Read-only hardware and runtime probe for planning a LOCAL language-model pilot. Windows PowerShell 5.1 compatible.

.DESCRIPTION
  Standalone: needs nothing from the shoRDs repository. It only READS information from Windows.
  It does not install, download, change settings, change the execution policy, open a network connection, or send anything anywhere.
  It writes ONE local file (default .\hardware-probe.json) and prints a summary. The file contains: memory, CPU, GPU, disk, Windows
  version, runtime versions, and the names (not paths, titles or contents) of the ten processes using most memory. It does not contain your
  user name, computer name, file names, browser tabs or any document. Read the file before you share it; use -NoProcessList to leave
  the process names out.

.PARAMETER ModelDrive
  Drive letter where the model files would be stored (default D). Free space is reported for this drive.

.PARAMETER LlamaDir
  Optional folder to look in for llama-server.exe (in addition to PATH).

.PARAMETER OutFile
  Where to write the JSON (default .\hardware-probe.json).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Probe-Hardware.ps1 -ModelDrive D
  (-ExecutionPolicy Bypass applies to this one process only; it does not change any saved setting.)
#>
[CmdletBinding()]
param(
  [string]$ModelDrive = 'D',
  [string]$LlamaDir = '',
  [string]$OutFile = '.\hardware-probe.json',
  [switch]$NoProcessList
)

$ErrorActionPreference = 'Continue'

function Get-Safe {
  param([scriptblock]$Block)
  try { & $Block } catch { $null }
}
function To-GB {
  param($Bytes, [int]$Digits = 2)
  if ($Bytes -eq $null) { return $null }
  return [math]::Round(([double]$Bytes) / 1073741824, $Digits)
}
function To-Int {
  param($Value)
  try { return [int]$Value } catch { return $null }
}
function Find-Exe {
  param([string]$Name, [string[]]$ExtraDirs)
  $cmd = Get-Safe { Get-Command ($Name + '.exe') -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($cmd -ne $null) { return [string]$cmd.Path }
  foreach ($d in $ExtraDirs) {
    if ($d -and (Test-Path -LiteralPath $d)) {
      $p = Join-Path $d ($Name + '.exe')
      if (Test-Path -LiteralPath $p) { return $p }
    }
  }
  return $null
}

Write-Host ''
Write-Host 'shoRDs local-pilot hardware probe (read-only; nothing is installed, changed or sent anywhere)'
Write-Host '---------------------------------------------------------------------------------------------'

# ---------------------------------------------------------------- Windows and PowerShell
$osInfo = Get-Safe { Get-CimInstance -ClassName Win32_OperatingSystem }
$sysInfo = Get-Safe { Get-CimInstance -ClassName Win32_ComputerSystem }
$windows = $null
if ($osInfo -ne $null) {
  $windows = [ordered]@{
    caption = [string]$osInfo.Caption
    version = [string]$osInfo.Version
    build = [string]$osInfo.BuildNumber
    architecture = [string]$osInfo.OSArchitecture
  }
}
$psInfo = [ordered]@{
  version = $PSVersionTable.PSVersion.ToString()
  edition = [string]$PSVersionTable.PSEdition
  executionPolicyEffective = [string](Get-Safe { Get-ExecutionPolicy })
}

# ---------------------------------------------------------------- Memory
# FreePhysicalMemory is memory that is completely unused. AvailableBytes (performance counter) also counts cached memory that Windows can
# give back at once, and is the better measure of what a program could use.
$perfMem = Get-Safe { Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory }
$totalBytes = $null
if ($sysInfo -ne $null) { $totalBytes = [double]$sysInfo.TotalPhysicalMemory }
$freeBytes = $null
if ($osInfo -ne $null) { $freeBytes = [double]$osInfo.FreePhysicalMemory * 1024 }
$availBytes = $null
if ($perfMem -ne $null) { $availBytes = [double]$perfMem.AvailableBytes }
if ($availBytes -eq $null) { $availBytes = $freeBytes }
$usedPct = $null
if ($totalBytes -and $availBytes -ne $null) { $usedPct = [math]::Round(100 * ($totalBytes - $availBytes) / $totalBytes, 1) }
$memory = [ordered]@{
  totalGB = To-GB $totalBytes
  completelyFreeGB = To-GB $freeBytes
  availableGB = To-GB $availBytes
  usedPercentIncludingCache = $usedPct
  commitLimitGB = $null
  committedGB = $null
}
if ($perfMem -ne $null) {
  $memory.commitLimitGB = To-GB ([double]$perfMem.CommitLimit)
  $memory.committedGB = To-GB ([double]$perfMem.CommittedBytes)
}

# ---------------------------------------------------------------- CPU
$procs = @(Get-Safe { Get-CimInstance -ClassName Win32_Processor })
$cpu = $null
if ($procs -ne $null -and $procs.Count -gt 0) {
  $cores = 0; $logical = 0
  foreach ($p in $procs) { $cores += [int]$p.NumberOfCores; $logical += [int]$p.NumberOfLogicalProcessors }
  $cpu = [ordered]@{
    model = ([string]$procs[0].Name).Trim()
    physicalCores = $cores
    logicalProcessors = $logical
    maxClockMHz = [int]$procs[0].MaxClockSpeed
  }
}

# ---------------------------------------------------------------- GPU
$smi = Find-Exe 'nvidia-smi' @(
  (Join-Path $env:SystemRoot 'System32'),
  (Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI')
)
$nvidia = @()
$cudaVersion = $null
if ($smi) {
  $rows = Get-Safe { & $smi --query-gpu=name,memory.total,memory.used,memory.free,driver_version --format=csv,noheader,nounits 2>$null }
  foreach ($line in @($rows)) {
    if (-not $line) { continue }
    $f = @(([string]$line).Split(',') | ForEach-Object { $_.Trim() })
    if ($f.Count -ge 5) {
      $nvidia += [ordered]@{
        name = $f[0]
        vramTotalMiB = To-Int $f[1]
        vramUsedMiB = To-Int $f[2]
        vramFreeMiB = To-Int $f[3]
        driver = $f[4]
      }
    }
  }
  $head = Get-Safe { (& $smi 2>$null) -join "`n" }
  if ($head -and ($head -match 'CUDA Version:\s*([0-9]+\.[0-9]+)')) { $cudaVersion = $Matches[1] }
}
$adapters = Get-Safe { @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object { [string]$_.Name }) }
$gpu = [ordered]@{
  nvidiaSmiFound = [bool]$smi
  nvidia = $nvidia
  cudaVersionReportedByDriver = $cudaVersion
  displayAdapterNames = $adapters
  note = 'VRAM figures come from nvidia-smi at this moment. Windows and open programs already use part of it.'
}

# ---------------------------------------------------------------- Disk
$drive = $ModelDrive.TrimEnd(':').Substring(0, 1).ToUpper()
$vol = Get-Safe { Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $drive + ":'") }
$disk = [ordered]@{ drive = $drive + ':'; found = ($vol -ne $null) }
if ($vol -ne $null) {
  $disk.fileSystem = [string]$vol.FileSystem
  $disk.totalGB = To-GB ([double]$vol.Size) 1
  $disk.freeGB = To-GB ([double]$vol.FreeSpace) 1
  $pd = Get-Safe { Get-Partition -DriveLetter $drive -ErrorAction Stop | Get-Disk -ErrorAction Stop | Get-PhysicalDisk -ErrorAction Stop }
  if ($pd -ne $null) {
    $disk.mediaType = [string]$pd.MediaType
    $disk.busType = [string]$pd.BusType
  }
}
$fixedDrives = Get-Safe {
  @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{ drive = [string]$_.DeviceID; fileSystem = [string]$_.FileSystem; freeGB = (To-GB ([double]$_.FreeSpace) 1); totalGB = (To-GB ([double]$_.Size) 1) }
  })
}

# ---------------------------------------------------------------- Power
$battery = Get-Safe { Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 }
$power = [ordered]@{ hasBattery = ($battery -ne $null) }
if ($battery -ne $null) {
  # BatteryStatus 2 = on AC power, 1 = discharging
  $power.onAcPower = ([int]$battery.BatteryStatus -eq 2)
  $power.chargePercent = [int]$battery.EstimatedChargeRemaining
}
$plan = Get-Safe { (& powercfg /getactivescheme 2>$null) -join ' ' }
if ($plan) { $power.activePlanLine = ([string]$plan -replace '^.*:\s*', '') }

# ---------------------------------------------------------------- Runtimes (versions only)
$extra = @()
if ($LlamaDir) { $extra += $LlamaDir }
$nodePath = Find-Exe 'node' @()
$gitPath = Find-Exe 'git' @()
$llamaServer = Find-Exe 'llama-server' $extra
$llamaCli = Find-Exe 'llama-cli' $extra
$ollamaPath = Find-Exe 'ollama' @()
$pdftotextPath = Find-Exe 'pdftotext' @()
$wingetPath = Find-Exe 'winget' @()
$curlPath = Find-Exe 'curl' @()
$nodeVersion = $null
if ($nodePath) { $nodeVersion = ([string](Get-Safe { & $nodePath --version 2>$null })).Trim() }
$runtimes = [ordered]@{
  node = [ordered]@{ found = [bool]$nodePath; version = $nodeVersion; neededForPilot = 'Node.js 20 or newer' }
  llamaServer = [ordered]@{ found = [bool]$llamaServer; neededForPilot = 'llama-server.exe from a llama.cpp Windows release' }
  llamaCli = [bool]$llamaCli
  ollama = [bool]$ollamaPath
  git = [bool]$gitPath
  pdftotext = [ordered]@{ found = [bool]$pdftotextPath; neededForPilot = 'only if a paper is supplied as PDF; JATS XML or text needs none' }
  winget = [bool]$wingetPath
  curlExe = [ordered]@{ found = [bool]$curlPath; neededForPilot = 'resumable model download (ships with Windows 10 1803 and later)' }
}

# ---------------------------------------------------------------- Biggest memory users (names only)
$topProcesses = $null
if (-not $NoProcessList) {
  $topProcesses = Get-Safe {
    @(Get-Process | Group-Object -Property Name | ForEach-Object {
      $sum = ($_.Group | Measure-Object -Property WorkingSet64 -Sum).Sum
      New-Object PSObject -Property @{ name = [string]$_.Name; instances = [int]$_.Count; workingSetMB = [int][math]::Round($sum / 1048576) }
    } | Sort-Object -Property workingSetMB -Descending | Select-Object -First 10)
  }
}

# ---------------------------------------------------------------- Rule-of-thumb fit (NOT a measurement)
# Needs are deliberately generous. They count the weights as if all were in RAM, the key-value cache for a 20k-token prompt, and the
# runtime's own buffers. Headroom keeps Windows responsive so it does not start swapping to disk.
$headroomGB = 1.5
$candidates = @(
  [ordered]@{ model = 'Qwen3-8B Q4_K_M (5.03 GB file)'; worstCaseNeedGB = 8.0 },
  [ordered]@{ model = 'gpt-oss-20b MXFP4 (12.11 GB file, MoE experts kept in RAM)'; worstCaseNeedGB = 11.0 }
)
$fit = @()
foreach ($c in $candidates) {
  $verdict = 'UNKNOWN'
  if ($memory.availableGB -ne $null -and $memory.totalGB -ne $null) {
    $need = [double]$c.worstCaseNeedGB + $headroomGB
    if ([double]$memory.availableGB -ge $need) { $verdict = 'FITS NOW' }
    elseif ([double]$memory.totalGB -ge ($need + 3.0)) { $verdict = 'ONLY AFTER CLOSING OTHER PROGRAMS (re-run the probe then)' }
    else { $verdict = 'DOES NOT FIT SAFELY on this machine as it is now' }
  }
  $fit += [ordered]@{ model = $c.model; worstCaseNeedGB = $c.worstCaseNeedGB; plusHeadroomGB = $headroomGB; availableNowGB = $memory.availableGB; verdict = $verdict }
}

$summaryParts = @()
if ($cpu -ne $null) { $summaryParts += ($cpu.model + ', ' + $cpu.logicalProcessors + ' logical processors') }
$summaryParts += ('RAM ' + [string]$memory.totalGB + ' GB total, ' + [string]$memory.availableGB + ' GB available at probe time')
if ($nvidia.Count -gt 0) { $summaryParts += ($nvidia[0].name + ', ' + $nvidia[0].vramTotalMiB + ' MiB VRAM (' + $nvidia[0].vramFreeMiB + ' MiB free), driver ' + $nvidia[0].driver + ', CUDA ' + $cudaVersion) } else { $summaryParts += 'no NVIDIA GPU reported by nvidia-smi' }
if ($vol -ne $null) { $summaryParts += ('disk ' + $disk.drive + ' ' + [string]$disk.freeGB + ' GB free') }
if ($windows -ne $null) { $summaryParts += $windows.caption }
$summaryText = $summaryParts -join '; '

$result = [ordered]@{
  probe = 'shoRDs Probe-Hardware.ps1'
  probeVersion = '1'
  collectedAtUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  readOnly = $true
  summary = $summaryText
  windows = $windows
  powershell = $psInfo
  memory = $memory
  cpu = $cpu
  gpu = $gpu
  disk = $disk
  fixedDrives = $fixedDrives
  power = $power
  runtimes = $runtimes
  topMemoryProcesses = $topProcesses
  fitRuleOfThumb = $fit
  fitNote = 'Rule of thumb from the stated needs plus headroom. It is not a measurement; the real figures come from the llama-server load log and the pilot report.'
}

# ---------------------------------------------------------------- Console summary
function Show { param([string]$Label, $Value) Write-Host ('{0,-24} {1}' -f $Label, $Value) }
if ($windows -ne $null) { Show 'Windows' ($windows.caption + ' (version ' + $windows.version + ', build ' + $windows.build + ', ' + $windows.architecture + ')') }
Show 'PowerShell' ($psInfo.version + ' ' + $psInfo.edition + ', execution policy ' + $psInfo.executionPolicyEffective)
if ($cpu -ne $null) { Show 'CPU' ($cpu.model + ', ' + $cpu.physicalCores + ' cores / ' + $cpu.logicalProcessors + ' logical processors') }
Show 'RAM total' ([string]$memory.totalGB + ' GB')
Show 'RAM available now' ([string]$memory.availableGB + ' GB   (completely free: ' + [string]$memory.completelyFreeGB + ' GB; memory in use: ' + [string]$memory.usedPercentIncludingCache + ' %)')
if ($nvidia.Count -gt 0) {
  foreach ($g in $nvidia) { Show 'NVIDIA GPU' ($g.name + ', VRAM total ' + $g.vramTotalMiB + ' MiB, used ' + $g.vramUsedMiB + ' MiB, free ' + $g.vramFreeMiB + ' MiB, driver ' + $g.driver) }
  Show 'CUDA (from driver)' $cudaVersion
} else { Show 'NVIDIA GPU' 'nvidia-smi not found or reported nothing' }
Show 'Display adapters' (@($adapters) -join '; ')
if ($vol -ne $null) { Show ('Disk ' + $disk.drive) ([string]$disk.freeGB + ' GB free of ' + [string]$disk.totalGB + ' GB, ' + $disk.fileSystem + ', ' + $disk.mediaType + ' ' + $disk.busType) }
else { Show ('Disk ' + $disk.drive) 'drive not found (use -ModelDrive with the right letter)' }
if ($power.hasBattery) { Show 'Power' ('battery ' + $power.chargePercent + ' %, on AC: ' + $power.onAcPower + ', plan: ' + $power.activePlanLine) }
Show 'Node.js' ($(if ($nodePath) { $nodeVersion } else { 'not found' }))
Show 'llama-server.exe' ($(if ($llamaServer) { 'found' } else { 'not found' }))
Show 'curl.exe' ($(if ($curlPath) { 'found' } else { 'not found' }))
Show 'pdftotext' ($(if ($pdftotextPath) { 'found' } else { 'not found (only needed for PDF papers)' }))
Write-Host ''
Write-Host 'Fit (rule of thumb, with 1.5 GB headroom):'
foreach ($x in $fit) { Write-Host ('  ' + $x.model + ' -> ' + $x.verdict) }
if ($topProcesses -ne $null) {
  Write-Host ''
  Write-Host 'Largest memory users right now (name, MB):'
  foreach ($t in $topProcesses) { Write-Host ('  ' + $t.name + '  ' + $t.workingSetMB + ' MB  (x' + $t.instances + ')') }
}

# ---------------------------------------------------------------- Write the JSON (no BOM)
if ([System.IO.Path]::IsPathRooted($OutFile)) { $full = $OutFile } else { $full = Join-Path (Get-Location).Path $OutFile }
$json = $result | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host ('Saved: ' + $full)
Write-Host 'Nothing was installed, downloaded, changed or sent. Open the file and read it before sharing it.'
