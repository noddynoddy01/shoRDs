# Phase6C.Runtime.ps1 - side-effecting part of the Phase 6C pilot agent: folders, audit log, integrity checks, the llama-server process,
# resource monitor with emergency shutdown, the loopback HTTP client, and the job handlers. Windows PowerShell 5.1, ASCII only.
# Dot-sourced (after Phase6B.Common.ps1 and Phase6C.Lib.ps1) by Pilot-Agent.ps1 and Invoke-PilotRun.ps1. Defining the functions does nothing.
# NOT EXECUTED by its author on any PowerShell (the sandbox refused to run one): the first execution is the owner's supervised dry-run.
# What this file can touch: files under the root folder (every path goes through Assert-UnderRoot); the one program llama-server.exe from
# install-record.json (hash-checked); nvidia-smi.exe read-only; read-only system counters; HTTP to 127.0.0.1:8080 only. Nothing else.

$script:Ctx = $null
$script:St = $null

# --------------------------------------------------------------------------------------------------------------- folders and state
function Get-PilotPaths {
  param([string]$Root)
  $j = Join-Path $Root 'jobs'
  return @{
    Root = $Root; Jobs = $j; Inbox = (Join-Path $j 'inbox'); Work = (Join-Path $j 'work'); Outbox = (Join-Path $j 'outbox')
    Rejected = (Join-Path $j 'rejected'); Archive = (Join-Path $j 'archive'); Stop = (Join-Path $j 'STOP'); Lease = (Join-Path $j 'agent.lease.json')
    Audit = (Join-Path $j 'audit.jsonl'); SeenIds = (Join-Path $j 'seen-ids.txt'); SessionKey = (Join-Path $j '.session-key')
    Marker = (Join-Path $j 'dryrun-complete.json'); Runs = (Join-Path $Root 'runs'); Secrets = (Join-Path $Root 'secrets')
    ServerKey = (Join-Path $Root 'secrets\server.key'); DryKey = (Join-Path $Root 'secrets\dryrun.key'); Suites = (Join-Path $Root 'suites')
    Logs = (Join-Path $Root 'logs'); Health = (Join-Path $Root 'health')
  }
}

function Initialize-PilotContext {
  param([string]$Mode, [long]$LeaseEndEpoch)
  $p = Get-PilotPaths $script:Cfg.Root
  $script:Ctx = @{ P = $p; Mode = $Mode }
  foreach ($d in @($p.Jobs, $p.Inbox, $p.Work, $p.Outbox, $p.Rejected, $p.Archive, $p.Runs, $p.Secrets, $p.Suites, $p.Logs, $p.Health)) {
    [void](Assert-UnderRoot $d)
    if (-not (Test-Path -LiteralPath $d)) { [void](New-Item -ItemType Directory -Path $d) }
  }
  foreach ($f in @($p.Stop, $p.Lease, $p.Audit, $p.SeenIds, $p.SessionKey, $p.Marker, $p.ServerKey, $p.DryKey)) { [void](Assert-UnderRoot $f) }
  $script:St = @{
    Mode = $Mode; LeaseEnd = $LeaseEndEpoch; Key = $null; Seen = @{}; ModelHash = $null; IntegrityUtc = $null; Server = $null
    AuditErrors = 0; JobsDone = 0; JobsRejected = 0; CurrentJob = $null; JobGuard = $null; HttpReady = $false
  }
}

function New-RandomHex {
  param([int]$Bytes)
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $b = New-Object byte[] $Bytes
  $rng.GetBytes($b)
  $rng.Dispose()
  $sb = New-Object System.Text.StringBuilder
  foreach ($x in $b) { [void]$sb.Append($x.ToString('x2')) }
  return $sb.ToString()
}

function Write-AtomicText {
  param([string]$Path, [string]$Text)
  [void](Assert-UnderRoot $Path)
  $tmp = $Path + '.tmp-' + (New-RandomHex 4)
  [System.IO.File]::WriteAllText($tmp, $Text, (New-Object System.Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $Path) { [System.IO.File]::Replace($tmp, $Path, $null) } else { [System.IO.File]::Move($tmp, $Path) }
}

function Write-AtomicJson {
  param([string]$Path, $Object)
  Write-AtomicText $Path (ConvertTo-Json -InputObject $Object -Depth 8)
}

function Add-Audit {
  param([string]$Event, $Data)
  try {
    $o = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); event = $Event; mode = $script:Ctx.Mode }
    if ($Data -is [hashtable]) { foreach ($k in $Data.Keys) { $o[[string]$k] = $Data[$k] } }
    $line = ConvertTo-Json -InputObject $o -Compress -Depth 6
    $sw = New-Object System.IO.StreamWriter($script:Ctx.P.Audit, $true, (New-Object System.Text.UTF8Encoding($false)))
    try { $sw.WriteLine($line) } finally { $sw.Dispose() }
  } catch { $script:St.AuditErrors = $script:St.AuditErrors + 1 }
}

function Get-UtcNowText { return (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) }

# --------------------------------------------------------------------------------------------------------------- measurements
function Test-PortFree {
  return (-not (Get-NetTCPConnection -LocalPort $script:P6C.Port -State Listen -ErrorAction SilentlyContinue))
}

function Get-ForeignServerPids {
  $own = Get-ServerState
  $r = @()
  foreach ($p in @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)) {
    if (-not $own -or $own.Process.Id -ne $p.Id) { $r += $p.Id }
  }
  return $r
}

function Get-InstallInfo {
  $rec = Read-Json $script:Cfg.InstallRecord
  if (-not $rec) { throw 'No install-record.json. The runtime is not installed.' }
  if ($rec.status -cne 'extracted' -or $rec.versionExitCode -ne 0) { throw 'install-record.json says the install did not finish cleanly.' }
  [void](Assert-UnderRoot $rec.exe)
  return $rec
}

function Get-ModelInfo {
  $marker = Read-Json $script:Cfg.Marker
  $mrec = $null
  if ($marker -and $marker.files) { $mrec = $marker.files.PSObject.Properties['qwen3-8b'] }
  if (-not $mrec) { throw 'qwen3-8b is not in verified-artifacts.json (Step C).' }
  $path = Join-Path $script:Cfg.Models 'Qwen3-8B-Q4_K_M.gguf'
  [void](Assert-UnderRoot $path)
  return @{ Path = $path; Length = [int64]$mrec.Value.length; LastWriteTicks = (ConvertTo-UtcDate $mrec.Value.lastWriteUtc).Ticks; Sha256 = [string]$mrec.Value.sha256 }
}

# Cheap checks only (exe hash, model size/time). The 5 GB model hash is separate (Confirm-ModelHash).
function Get-StartMeasurements {
  $m = @{ avail_ram_gib = $null; vram_free_mib = $null; disk_free_gib = $null; port_free = $false; foreign_server = $true; own_server = $false; exe_ok = $false; model_ok = $false }
  $m.avail_ram_gib = Get-AvailRamGiB
  $v = Get-VramMiB
  if ($v) { $m.vram_free_mib = $v.FreeMiB }
  $m.disk_free_gib = Get-GiBFree $script:Cfg.Root
  $m.port_free = Test-PortFree
  $m.foreign_server = (@(Get-ForeignServerPids).Count -gt 0)
  $m.own_server = [bool](Get-ServerState)
  try {
    $rec = Get-InstallInfo
    $m.exe_ok = ((Test-Path -LiteralPath $rec.exe) -and ((Get-FileSha256 $rec.exe) -eq ([string]$rec.exeSha256).ToLower()))
  } catch { $m.exe_ok = $false }
  try {
    $mi = Get-ModelInfo
    $fi = Get-Item -LiteralPath $mi.Path -ErrorAction Stop
    $m.model_ok = ($fi.Length -eq $mi.Length -and $fi.LastWriteTimeUtc.Ticks -eq $mi.LastWriteTicks)
  } catch { $m.model_ok = $false }
  return $m
}

# Full SHA-256 of the model, once per agent session (cached by size and write time).
function Confirm-ModelHash {
  $mi = Get-ModelInfo
  $fi = Get-Item -LiteralPath $mi.Path
  $c = $script:St.ModelHash
  if ($c -and $c.Length -eq $fi.Length -and $c.Ticks -eq $fi.LastWriteTimeUtc.Ticks) { return $true }
  $h = Get-FileSha256 $mi.Path
  if ($h -ne $mi.Sha256.ToLower()) { return $false }
  $script:St.ModelHash = @{ Length = $fi.Length; Ticks = $fi.LastWriteTimeUtc.Ticks; Sha256 = $h }
  return $true
}

# --------------------------------------------------------------------------------------------------------------- kill-on-close job object
# If the agent window is closed (or the agent crashes) Windows ends llama-server too, so a model can never be left running unsupervised.
function Initialize-JobGuard {
  if ($script:St.JobGuard -ne $null) { return $script:St.JobGuard }
  $ok = $false
  try {
    if (-not ('Shords.JobGuard' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Shords {
  public static class JobGuard {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    static IntPtr job = IntPtr.Zero;
    public static bool Create() {
      if (job != IntPtr.Zero) { return true; }
      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) { return false; }
      ExtLimit info = new ExtLimit();
      info.Basic.LimitFlags = 0x2000;
      int size = Marshal.SizeOf(typeof(ExtLimit));
      IntPtr p = Marshal.AllocHGlobal(size);
      try { Marshal.StructureToPtr(info, p, false); return SetInformationJobObject(job, 9, p, (uint)size); }
      finally { Marshal.FreeHGlobal(p); }
    }
    public static bool Assign(IntPtr process) { return job != IntPtr.Zero && AssignProcessToJobObject(job, process); }
  }
}
'@
    }
    $ok = [Shords.JobGuard]::Create()
  } catch { $ok = $false }
  $script:St.JobGuard = $ok
  return $ok
}

# --------------------------------------------------------------------------------------------------------------- monitor
function New-Monitor {
  param($Proc, [string]$ErrLog, [int]$Ngl, [double]$BudgetS, [string]$Phase)
  return @{ Proc = $Proc; ErrLog = $ErrLog; Ngl = $Ngl; Budget = $BudgetS; Phase = $Phase; Sw = [System.Diagnostics.Stopwatch]::StartNew(); LogPos = 0L; Unknown = 0; Tick = 0
    LastLoop = $null; LastExt = 0; PeakVram = 0; MinRam = 999.0; PeakWs = 0; Samples = (New-Object System.Collections.ArrayList); Fatal = ''; Csv = $null }
}

function Read-NewLogText {
  param($M)
  if (-not $M.ErrLog -or -not (Test-Path -LiteralPath $M.ErrLog)) { return '' }
  try {
    $fs = [System.IO.File]::Open($M.ErrLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      if ($fs.Length -le $M.LogPos) { return '' }
      [void]$fs.Seek($M.LogPos, [System.IO.SeekOrigin]::Begin)
      $n = [int][math]::Min(262144, $fs.Length - $M.LogPos)
      $buf = New-Object byte[] $n
      $got = $fs.Read($buf, 0, $n)
      $M.LogPos = $M.LogPos + $got
      return [System.Text.Encoding]::UTF8.GetString($buf, 0, $got)
    } finally { $fs.Dispose() }
  } catch { return '' }
}

# One monitor tick: reads RAM, VRAM, server memory, (every 3rd tick) listeners and external connections, new log text, stop file, lease.
# Returns the brake trigger name or $null. Never throws.
function Get-MonitorVerdict {
  param($M)
  try {
    $M.Tick = $M.Tick + 1
    $ram = Get-AvailRamGiB
    $vr = Get-VramMiB
    $vused = $null
    if ($vr) { $vused = $vr.UsedMiB }
    $unknown = ($ram -eq $null) -or ($M.Ngl -gt 0 -and $vused -eq $null)
    if ($unknown) { $M.Unknown = $M.Unknown + 1 } else { $M.Unknown = 0 }
    $alive = $false
    $ws = $null
    if ($M.Proc) { try { $M.Proc.Refresh(); $alive = -not $M.Proc.HasExited; if ($alive) { $ws = [math]::Round($M.Proc.WorkingSet64 / 1MB, 0) } } catch { $alive = $false } }
    if (($M.Tick % 3) -eq 1 -and $alive) {
      $ls = Get-ListenerInfo $M.Proc.Id
      if ($ls -eq $null) { $M.LastLoop = $null } else { $M.LastLoop = [bool](Test-LoopbackOnly $ls) }
      $ext = 0
      try { foreach ($c in @(Get-NetTCPConnection -OwningProcess $M.Proc.Id -State Established -ErrorAction Stop)) { if (Test-ExternalRemote ([string]$c.RemoteAddress)) { $ext = $ext + 1 } } } catch { }
      $M.LastExt = $ext
    }
    $newLog = Read-NewLogText $M
    if (Test-LogFatal $newLog) { $M.Fatal = $newLog.Substring(0, [math]::Min(300, $newLog.Length)) }
    if ($ram -ne $null -and $ram -lt $M.MinRam) { $M.MinRam = $ram }
    if ($vused -ne $null -and $vused -gt $M.PeakVram) { $M.PeakVram = $vused }
    if ($ws -ne $null -and $ws -gt $M.PeakWs) { $M.PeakWs = $ws }
    $state = @{
      stop_file = (Test-Path -LiteralPath $script:Ctx.P.Stop); lease_expired = ((Get-NowEpoch) -gt $script:St.LeaseEnd)
      listeners_loopback = $M.LastLoop; external_conns = $M.LastExt; avail_ram_gib = $ram; vram_used_mib = $vused
      log_fatal = ($M.Fatal.Length -gt 0); elapsed_s = $M.Sw.Elapsed.TotalSeconds; budget_s = $M.Budget; telemetry_unknown_streak = $M.Unknown; proc_alive = $alive
    }
    $verdict = Get-BrakeVerdict $state
    if ($M.Samples.Count -lt 5000) {
      [void]$M.Samples.Add(@{ t = [math]::Round($M.Sw.Elapsed.TotalSeconds, 1); ram = $ram; vram = $vused; ws = $ws; phase = $M.Phase })
    }
    if ($M.Csv) { try { $M.Csv.WriteLine(((Get-UtcNowText) + ',' + $M.Phase + ',' + $ram + ',' + $vused + ',' + $ws + ',' + $verdict)); $M.Csv.Flush() } catch { } }
    return $verdict
  } catch { return $null }
}

# --------------------------------------------------------------------------------------------------------------- server start / stop
function New-KeyFile {
  param([string]$Path)
  [void](Assert-UnderRoot $Path)
  $key = New-RandomHex 32
  [System.IO.File]::WriteAllText($Path, ($key + "`n"), (New-Object System.Text.ASCIIEncoding))
  return $key
}

function Wait-PortClosed {
  param([int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortFree) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (Test-PortFree)
}

# Stops the server this agent (or an earlier agent/Step D) started. Verifies the process is gone and the port is closed.
function Stop-PilotServer {
  param([string]$Reason)
  $r = @{ was_running = $false; stopped = $false; port_closed = $null; reason = $Reason; ram_after_gib = $null }
  $st = Get-ServerState
  $srv = $script:St.Server
  $procId = $null
  if ($st) { $procId = $st.Process.Id } elseif ($srv -and $srv.Proc -and -not $srv.Proc.HasExited) { $procId = $srv.Proc.Id }
  if ($procId -ne $null) {
    $r.was_running = $true
    try { Stop-Process -Id $procId -ErrorAction Stop } catch { }
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and -not $p.WaitForExit(20000)) { try { Stop-Process -Id $procId -Force } catch { }; [void]$p.WaitForExit(10000) }
    $r.stopped = -not [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue)
  } else { $r.stopped = $true }
  if ($srv -and $srv.Mon -and $srv.Mon.Csv) { try { $srv.Mon.Csv.Dispose() } catch { } }
  Remove-Item -LiteralPath $script:Cfg.PidFile -ErrorAction SilentlyContinue
  $script:St.Server = $null
  $r.port_closed = Wait-PortClosed 15
  $r.ram_after_gib = Get-AvailRamGiB
  Add-Audit 'server-stopped' @{ reason = $Reason; was_running = $r.was_running; stopped = $r.stopped; port_closed = $r.port_closed }
  return $r
}

function Invoke-EmergencyShutdown {
  param([string]$Trigger, [string]$JobId)
  Add-Audit 'EMERGENCY-SHUTDOWN' @{ trigger = $Trigger; job = $JobId }
  Write-Host ''
  Write-Host ('EMERGENCY SHUTDOWN: ' + $Trigger + ' - stopping the server now.')
  $r = Stop-PilotServer ('emergency:' + $Trigger)
  $inc = @{ schema = 'shords-pilot-incident/1'; utc = (Get-UtcNowText); trigger = $Trigger; job = $JobId; stop = $r }
  try { Write-AtomicJson (Join-Path $script:Ctx.P.Outbox ('incident-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '.json')) $inc } catch { }
  return $r
}

# Starts llama-server (Live only). Returns @{ ok; status; error; checks; data }.
function Start-PilotServer {
  param([int]$Ngl, [int]$Ctx, [int]$IdleMinutes, [string]$JobId)
  $res = @{ ok = $false; status = 'failed'; error = $null; checks = $null; data = @{} }
  if ($script:St.Server) { $res.error = 'A server is already running under this agent. Send server-stop first.'; return $res }
  $m = Get-StartMeasurements
  $checks = Get-StartGateChecks $m $Ngl $Ctx
  $res.checks = $checks
  $res.data.measurements = $m
  $failed = Get-FailedCheckNames $checks
  if ($failed.Count -gt 0) { $res.status = 'gate-failed'; $res.error = 'Resource or integrity gate refused the start: ' + ($failed -join ', ') + '. Nothing was started.'; return $res }
  if (-not (Confirm-ModelHash)) { $res.error = 'The model file no longer matches its expected SHA-256. Nothing was started.'; return $res }
  $rec = Get-InstallInfo
  $mi = Get-ModelInfo
  $key = New-KeyFile $script:Ctx.P.ServerKey
  foreach ($e in @(Get-ChildItem Env: | Where-Object { $_.Name -match '^LLAMA_' })) { Remove-Item -LiteralPath ('Env:' + $e.Name) -ErrorAction SilentlyContinue }
  $argList = Get-ServerArgs $mi.Path $Ngl $Ctx $script:Ctx.P.ServerKey
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $outLog = Join-Path $script:Cfg.Logs ('agent-server-' + $stamp + '.out.log')
  $errLog = Join-Path $script:Cfg.Logs ('agent-server-' + $stamp + '.err.log')
  [void](Assert-UnderRoot $outLog); [void](Assert-UnderRoot $errLog)
  $guard = Initialize-JobGuard
  $p = Start-Process -FilePath $rec.exe -ArgumentList $argList -WorkingDirectory $rec.serverDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
  $null = $p.Handle
  $guarded = $false
  if ($guard) { try { $guarded = [Shords.JobGuard]::Assign($p.Handle) } catch { $guarded = $false } }
  $startedUtc = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonFile @{ pid = $p.Id; startedUtc = $startedUtc; model = 'qwen3-8b'; ngl = $Ngl; ctx = $Ctx; args = $argList; outLog = $outLog; errLog = $errLog; startedBy = 'agent'; job = $JobId; ramGiBBefore = $m.avail_ram_gib; vramBefore = $m.vram_free_mib } $script:Cfg.PidFile
  $mon = New-Monitor $p $errLog $Ngl 1.0e9 'loading'
  $csvPath = Join-Path $script:Cfg.Logs ('agent-monitor-' + $stamp + '.csv')
  [void](Assert-UnderRoot $csvPath)
  try { $mon.Csv = New-Object System.IO.StreamWriter($csvPath, $false, (New-Object System.Text.ASCIIEncoding)); $mon.Csv.WriteLine('utc,phase,avail_ram_gib,vram_used_mib,server_ws_mib,verdict') } catch { $mon.Csv = $null }
  $script:St.Server = @{ Proc = $p; Pid = $p.Id; Ngl = $Ngl; Ctx = $Ctx; IdleMinutes = $IdleMinutes; LastActivity = (Get-NowEpoch); OutLog = $outLog; ErrLog = $errLog; Mon = $mon; StartedUtc = $startedUtc; Guarded = $guarded; JobId = $JobId; CsvPath = $csvPath }
  Add-Audit 'server-started' @{ pid = $p.Id; ngl = $Ngl; ctx = $Ctx; guarded = $guarded; args = ($argList -join ' ') }
  $res.data.pid = $p.Id
  $res.data.kill_on_close_guard = $guarded
  $res.data.log_files = @($outLog, $errLog, $csvPath)
  $loadSw = [System.Diagnostics.Stopwatch]::StartNew()
  $ready = $false
  while ($loadSw.Elapsed.TotalSeconds -lt 300) {
    $v = Get-MonitorVerdict $mon
    if ($v -and $v -cne 'server-exited') {
      [void](Invoke-EmergencyShutdown $v $JobId)
      $res.status = 'aborted'; $res.error = 'Emergency brake during load: ' + $v
      return $res
    }
    if ($p.HasExited) { break }
    $h = Invoke-PilotHttp -Method 'GET' -Path '/health' -Bearer $key -TimeoutSec 5
    if ($h.Status -eq 200) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  $res.data.load_seconds = [math]::Round($loadSw.Elapsed.TotalSeconds, 1)
  if (-not $ready) {
    $tail = ''
    if (Test-Path -LiteralPath $errLog) { $tail = (@(Get-Content -LiteralPath $errLog -Tail 30) -join "`n") }
    [void](Stop-PilotServer 'not-ready')
    $res.error = 'The server did not become ready (exited or 5 minute limit). Last log lines: ' + $tail
    return $res
  }
  $mon.Phase = 'serving'
  $p.Refresh()
  $ls = Get-ListenerInfo $p.Id
  if ($ls) { $res.data.listeners = @($ls | ForEach-Object { $_.Address + ':' + $_.Port }) }
  if ($ls -eq $null -or -not (Test-LoopbackOnly $ls) -or @($ls).Count -eq 0) {
    [void](Invoke-EmergencyShutdown 'non-loopback-listener-or-unreadable' $JobId)
    $res.status = 'aborted'; $res.error = 'Could not confirm that the server listens on 127.0.0.1 only; it was stopped.'
    return $res
  }
  $v2 = Get-VramMiB
  $res.data.vram_before_free_mib = $m.vram_free_mib
  if ($v2) { $res.data.vram_after_load_used_mib = $v2.UsedMiB; $res.data.vram_after_load_free_mib = $v2.FreeMiB }
  if ($m.vram_free_mib -ne $null -and $v2) { $res.data.vram_delta_mib = ($m.vram_free_mib - $v2.FreeMiB) }
  $res.data.server_working_set_mib = [math]::Round($p.WorkingSet64 / 1MB, 0)
  $res.data.avail_ram_after_load_gib = Get-AvailRamGiB
  if (Test-Path -LiteralPath $errLog) { $res.data.err_log_head = @(Get-Content -LiteralPath $errLog -TotalCount 60) }
  $script:St.Server.Key = $key
  $res.ok = $true; $res.status = 'ok'
  return $res
}

# --------------------------------------------------------------------------------------------------------------- loopback HTTP client
# The only network code in the package. The host and port are constants: nothing but http://127.0.0.1:8080 can be reached.
function Invoke-PilotHttp {
  param([string]$Method, [string]$Path, [string]$Body, [string]$Bearer, [hashtable]$Headers, [int]$TimeoutSec = 30, $Monitor)
  $out = @{ Status = $null; Body = ''; Headers = @{}; Seconds = 0.0; Error = $null; Aborted = $null }
  if ($Path -cnotmatch '\A/[A-Za-z0-9/_.-]{0,60}\z') { $out.Error = 'refused path'; return $out }
  if ($Method -cne 'GET' -and $Method -cne 'POST') { $out.Error = 'refused method'; return $out }
  if (-not $script:St.HttpReady) { Add-Type -AssemblyName System.Net.Http; $script:St.HttpReady = $true }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.UseProxy = $false
  $handler.AllowAutoRedirect = $false
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
  try {
    $verb = [System.Net.Http.HttpMethod]::Get
    if ($Method -ceq 'POST') { $verb = [System.Net.Http.HttpMethod]::Post }
    $msg = New-Object System.Net.Http.HttpRequestMessage($verb, ('http://127.0.0.1:' + $script:P6C.Port + $Path))
    if ($Bearer) { [void]$msg.Headers.TryAddWithoutValidation('Authorization', ('Bearer ' + $Bearer)) }
    if ($Headers) { foreach ($k in $Headers.Keys) { [void]$msg.Headers.TryAddWithoutValidation([string]$k, [string]$Headers[$k]) } }
    if ($Body) { $msg.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, 'application/json') }
    $task = $client.SendAsync($msg)
    while (-not $task.IsCompleted) {
      Start-Sleep -Milliseconds 600
      if ($Monitor) {
        $v = Get-MonitorVerdict $Monitor
        if ($v) { $out.Aborted = $v; $client.CancelPendingRequests(); break }
      }
    }
    if (-not $out.Aborted) {
      $resp = $task.Result
      $out.Status = [int]$resp.StatusCode
      $out.Body = $resp.Content.ReadAsStringAsync().Result
      foreach ($h in $resp.Headers) { $out.Headers[$h.Key.ToLowerInvariant()] = ($h.Value -join ',') }
      foreach ($h in $resp.Content.Headers) { $out.Headers[$h.Key.ToLowerInvariant()] = ($h.Value -join ',') }
    }
  } catch { $out.Error = $_.Exception.Message }
  finally { $client.Dispose(); $handler.Dispose() }
  $out.Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  return $out
}

# One chat completion against the local model. Returns the metrics hashtable; Aborted is set when the emergency brake fired.
function Invoke-ChatCall {
  param([string]$Label, [string]$System, [string]$User, [int]$MaxTokens, $Monitor, [int]$TimeoutSec = 1200)
  $body = ConvertTo-Json -InputObject @{ model = 'qwen3-8b'; messages = @(@{ role = 'system'; content = $System }, @{ role = 'user'; content = $User }); max_tokens = $MaxTokens; temperature = 0; stream = $false; chat_template_kwargs = @{ enable_thinking = $false } } -Depth 6 -Compress
  $h = Invoke-PilotHttp -Method 'POST' -Path '/v1/chat/completions' -Body $body -Bearer $script:St.Server.Key -TimeoutSec $TimeoutSec -Monitor $Monitor
  $script:St.Server.LastActivity = Get-NowEpoch
  $o = @{ test = $Label; wallSeconds = $h.Seconds; httpStatus = $h.Status; error = $h.Error; aborted = $h.Aborted; text = ''; finishReason = $null; promptTokens = $null; completionTokens = $null; promptTps = $null; genTps = $null; hasThinkTags = $false }
  if ($h.Status -eq 200) {
    try {
      $r = $h.Body | ConvertFrom-Json
      $msg = [string]$r.choices[0].message.content
      $o.text = $msg
      $o.finishReason = $r.choices[0].finish_reason
      $o.promptTokens = $r.usage.prompt_tokens
      $o.completionTokens = $r.usage.completion_tokens
      if ($r.timings) { $o.promptTps = $r.timings.prompt_per_second; $o.genTps = $r.timings.predicted_per_second }
      $o.hasThinkTags = [bool]($msg -match '<think>|</think>')
    } catch { $o.error = 'could not parse the reply: ' + $_.Exception.Message }
  }
  return $o
}

# --------------------------------------------------------------------------------------------------------------- results
function ConvertTo-HexLower {
  param([byte[]]$Bytes)
  $sb = New-Object System.Text.StringBuilder
  foreach ($x in $Bytes) { [void]$sb.Append($x.ToString('x2')) }
  return $sb.ToString()
}

function New-JobResult {
  param($Job)
  return @{ schema = $script:P6C.SchemaResult; id = [string]$Job['id']; type = [string]$Job['type']; mode = $script:Ctx.Mode; agent_version = $script:P6C.Version
    started_utc = (Get-UtcNowText); finished_utc = $null; seconds = $null; status = 'failed'; error = $null; checks = (New-Object System.Collections.ArrayList); data = @{} }
}

function Add-ResultCheck {
  param($R, [string]$Name, [bool]$Pass, $Detail, [string]$Severity = 'fail')
  [void]$R.checks.Add(@{ name = $Name; pass = $Pass; detail = [string]$Detail; severity = $Severity })
}

function Test-ResultChecksPass {
  param($R)
  foreach ($c in $R.checks) { if (-not $c.pass -and $c.severity -ceq 'fail') { return $false } }
  return $true
}

function Set-MonitorBudget {
  param($Mon, [double]$Seconds)
  $Mon.Budget = $Mon.Sw.Elapsed.TotalSeconds + $Seconds
}

# Emergency handling after an HTTP call came back with Aborted: stops the server, fills the result. Returns $true when aborted.
function Test-CallAborted {
  param($Call, $R)
  if (-not $Call.aborted) { return $false }
  [void](Invoke-EmergencyShutdown ([string]$Call.aborted) $R.id)
  $R.error = 'Emergency brake: ' + $Call.aborted
  return $true
}

# --------------------------------------------------------------------------------------------------------------- handlers
function Invoke-JobPreflight {
  param($Job, $R)
  $ngl = [int]$Job['params']['ngl']; $ctx = [int]$Job['params']['ctx']
  $m = Get-StartMeasurements
  $checks = Get-StartGateChecks $m $ngl $ctx
  foreach ($c in $checks) { Add-ResultCheck $R $c.name $c.pass $c.detail }
  $R.data.measurements = $m
  $R.data.total_ram_gib = Get-TotalRamGiB
  $v = Get-VramMiB
  if ($v) { $R.data.vram_total_mib = $v.TotalMiB; $R.data.vram_used_mib = $v.UsedMiB }
  $R.data.estimate = @{ vram_mib = (Get-EstVramMiB $ngl $ctx); required_free_vram_mib = (Get-RequiredFreeVramMiB $ngl $ctx); min_avail_ram_gib = (Get-MinAvailRamGiB $ctx) }
  $R.data.agent_server_running = [bool]$script:St.Server
  if ((Get-FailedCheckNames $checks).Count -gt 0) { return 'gate-failed' }
  return 'ok'
}

function Invoke-JobVerifyIntegrity {
  param($Job, $R)
  $scope = [string]$Job['params']['scope']
  if ($script:St.Server -and $scope -cne 'quick') { $R.error = 'The long integrity scopes are not run while a server is running (nothing would watch the resources meanwhile). Send server-stop first.'; return 'failed' }
  $rec = Get-InstallInfo
  $exeOk = ((Test-Path -LiteralPath $rec.exe) -and ((Get-FileSha256 $rec.exe) -eq ([string]$rec.exeSha256).ToLower()))
  Add-ResultCheck $R 'exe-hash-matches-install-record' $exeOk $rec.exe
  $missing = @()
  foreach ($f in @($rec.files)) { if (-not (Test-Path -LiteralPath (Join-Path $rec.dest ([string]$f)))) { $missing += [string]$f } }
  Add-ResultCheck $R 'installed-files-present' ($missing.Count -eq 0) ('listed ' + @($rec.files).Count + ', missing ' + $missing.Count)
  $mi = Get-ModelInfo
  $fi = Get-Item -LiteralPath $mi.Path -ErrorAction SilentlyContinue
  $mq = ($fi -ne $null -and $fi.Length -eq $mi.Length -and $fi.LastWriteTimeUtc.Ticks -eq $mi.LastWriteTicks)
  Add-ResultCheck $R 'model-size-and-time-match-step-c' $mq ''
  if ($scope -ceq 'runtime' -or $scope -ceq 'full') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destCanon = ConvertTo-CanonPath $rec.dest
    $marker = Read-Json $script:Cfg.Marker
    foreach ($a in @($script:Artifacts | Where-Object { $_.Group -ceq 'runtime' })) {
      $zp = Get-ArtifactPath $a
      [void](Assert-UnderRoot $zp)
      $zok = $false
      if (Test-Path -LiteralPath $zp) { $zok = ((Get-FileSha256 $zp) -eq $a.Sha256) }
      Add-ResultCheck $R ('zip-sha256-' + $a.Id) $zok $a.File
      if (-not $zok) { continue }
      $bad = @(); $n = 0
      $zip = [System.IO.Compression.ZipFile]::OpenRead($zp)
      try {
        foreach ($e in $zip.Entries) {
          if ($e.FullName.EndsWith('/')) { continue }
          $target = Test-ZipEntryName $e.FullName $destCanon
          $n = $n + 1
          if (-not (Test-Path -LiteralPath $target)) { $bad += ($e.FullName + ' (missing)'); continue }
          $sha = [System.Security.Cryptography.SHA256]::Create()
          $s = $e.Open()
          try { $hb = $sha.ComputeHash($s) } finally { $s.Dispose(); $sha.Dispose() }
          if ((ConvertTo-HexLower $hb) -ne (Get-FileSha256 $target)) { $bad += ($e.FullName + ' (differs)') }
        }
      } finally { $zip.Dispose() }
      Add-ResultCheck $R ('extracted-files-equal-zip-' + $a.Id) ($bad.Count -eq 0) ('entries ' + $n + '; problems: ' + ($bad -join '; '))
    }
  }
  if ($scope -ceq 'full') { Add-ResultCheck $R 'model-sha256-matches-expected' (Confirm-ModelHash) 'full 5 GB hash' }
  $R.data.scope = $scope
  $R.data.exe_sha256 = [string]$rec.exeSha256
  $R.data.authenticode = [string]$rec.authenticodeStatus
  if (Test-ResultChecksPass $R) { $script:St.IntegrityUtc = Get-UtcNowText; return 'ok' }
  return 'failed'
}

function Invoke-JobServerStart {
  param($Job, $R)
  $ngl = [int]$Job['params']['ngl']; $ctx = [int]$Job['params']['ctx']; $idle = [int]$Job['params']['idle_minutes']
  if ($script:Ctx.Mode -ceq 'DryRun') {
    $m = Get-StartMeasurements
    $checks = Get-StartGateChecks $m $ngl $ctx
    foreach ($c in $checks) { Add-ResultCheck $R $c.name $c.pass $c.detail }
    $key = New-KeyFile $script:Ctx.P.DryKey
    $mi = Get-ModelInfo
    $rec = Get-InstallInfo
    $R.data.would_run = ($rec.exe + ' ' + ((Get-ServerArgs $mi.Path $ngl $ctx $script:Ctx.P.ServerKey) -join ' '))
    $R.data.key_generation_tested = (Test-Path -LiteralPath $script:Ctx.P.DryKey)
    $R.data.idle_minutes = $idle
    $R.data.measurements = $m
    $R.data.note = 'DRY RUN: nothing was started. The gates above were evaluated against live readings.'
    if ((Get-FailedCheckNames $checks).Count -gt 0) { return 'gate-failed' }
    return 'planned'
  }
  $s = @(Start-PilotServer $ngl $ctx $idle ([string]$Job['id']))[-1]
  if ($s.checks) { foreach ($c in $s.checks) { Add-ResultCheck $R $c.name $c.pass $c.detail } }
  foreach ($k in $s.data.Keys) { $R.data[$k] = $s.data[$k] }
  $R.error = $s.error
  return [string]$s.status
}

function Invoke-JobServerStop {
  param($Job, $R)
  if ($script:Ctx.Mode -ceq 'DryRun') {
    $R.data.server_running = [bool](Get-ServerState)
    $R.data.port_free = Test-PortFree
    $R.data.note = 'DRY RUN: nothing was stopped.'
    return 'planned'
  }
  $r = Stop-PilotServer 'job'
  foreach ($k in $r.Keys) { $R.data[$k] = $r[$k] }
  Add-ResultCheck $R 'process-gone' ([bool]$r.stopped) ''
  Add-ResultCheck $R 'port-8080-closed' ([bool]$r.port_closed) ''
  if ($r.stopped -and $r.port_closed) { return 'ok' }
  return 'failed'
}

function Invoke-JobHealth {
  param($Job, $R)
  if ($script:Ctx.Mode -ceq 'DryRun') {
    $R.data.note = 'DRY RUN: no request was sent. Live: /health, /props, three synthetic prompts, five security checks, resource samples, report in the health folder.'
    $R.data.server_running = [bool](Get-ServerState)
    return 'planned'
  }
  if (-not $script:St.Server) { $R.error = 'No server is running under this agent. Send server-start first.'; return 'failed' }
  $srv = $script:St.Server
  $mon = $srv.Mon
  Set-MonitorBudget $mon 900
  $key = $srv.Key
  $h = Invoke-PilotHttp -Method 'GET' -Path '/health' -Bearer $key -TimeoutSec 15
  $props = Invoke-PilotHttp -Method 'GET' -Path '/props' -Bearer $key -TimeoutSec 15
  $nctx = $null; $slots = $null
  try { $pj = $props.Body | ConvertFrom-Json; $nctx = $pj.default_generation_settings.n_ctx; $slots = $pj.total_slots } catch { }
  $lines = New-Object System.Text.StringBuilder
  for ($i = 1; $i -le 30; $i++) { [void]$lines.Append('Sample line ' + $i + ': the measured value was ' + (10 + $i) + ' units.' + "`n") }
  $tests = New-Object System.Collections.ArrayList
  [void]$tests.Add((Invoke-ChatCall 'T1 tiny prompt' 'You are a terse assistant.' 'Reply with the single word: ready.' 8 $mon))
  if (Test-CallAborted $tests[0] $R) { return 'aborted' }
  [void]$tests.Add((Invoke-ChatCall 'T2 short summary' 'You write short factual summaries.' 'Summarise in two sentences: A bakery recalibrates its oven every Monday. The target temperature is 220 degrees. After calibration the oven held 219 to 221 degrees across three test loaves, and the crust colour matched the reference chart. The calibration takes forty minutes.' 120 $mon))
  if (Test-CallAborted $tests[1] $R) { return 'aborted' }
  [void]$tests.Add((Invoke-ChatCall 'T3 longer prompt' 'You answer with a number only.' ($lines.ToString() + 'How many lines are listed above?') 12 $mon))
  if (Test-CallAborted $tests[2] $R) { return 'aborted' }
  # security checks on the hardened launch (finding V1): they use short requests and no monitor
  $noKey = Invoke-PilotHttp -Method 'POST' -Path '/v1/chat/completions' -Body '{"model":"qwen3-8b","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' -TimeoutSec 20
  $badKey = Invoke-PilotHttp -Method 'POST' -Path '/v1/chat/completions' -Body '{"model":"qwen3-8b","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' -Bearer 'not-the-key' -TimeoutSec 20
  $cors = Invoke-PilotHttp -Method 'GET' -Path '/v1/models' -Bearer $key -Headers @{ Origin = 'http://evil.example' } -TimeoutSec 15
  $ui = Invoke-PilotHttp -Method 'GET' -Path '/' -Bearer $key -TimeoutSec 15
  $sl = Invoke-PilotHttp -Method 'GET' -Path '/slots' -Bearer $key -TimeoutSec 15
  $acao = ''
  if ($cors.Headers.ContainsKey('access-control-allow-origin')) { $acao = [string]$cors.Headers['access-control-allow-origin'] }
  $ls = Get-ListenerInfo $srv.Proc.Id
  $lsText = ''
  if ($ls) { $lsText = (($ls | ForEach-Object { $_.Address + ':' + $_.Port }) -join ', ') }
  $ext = 0
  try { foreach ($c in @(Get-NetTCPConnection -OwningProcess $srv.Proc.Id -State Established -ErrorAction Stop)) { if (Test-ExternalRemote ([string]$c.RemoteAddress)) { $ext = $ext + 1 } } } catch { }
  $answered = $true
  foreach ($t in $tests) { if ($t.error -or $t.httpStatus -ne 200) { $answered = $false } }
  $thinks = $false
  foreach ($t in $tests) { if ($t.hasThinkTags) { $thinks = $true } }
  Add-ResultCheck $R 'listens-on-127.0.0.1-only' ($ls -ne $null -and @($ls).Count -gt 0 -and (Test-LoopbackOnly $ls)) $lsText
  Add-ResultCheck $R 'emergency-brake-not-triggered' $true ''
  Add-ResultCheck $R 'health-endpoint-answers' ($h.Status -eq 200) $h.Status
  Add-ResultCheck $R 'context-matches-start-parameter' ($nctx -eq $srv.Ctx) ('server ' + $nctx + ' / requested ' + $srv.Ctx)
  Add-ResultCheck $R 'one-slot' ($slots -eq 1) $slots
  Add-ResultCheck $R 'three-prompts-answered' $answered ''
  Add-ResultCheck $R 'no-think-tags' (-not $thinks) ''
  Add-ResultCheck $R 'available-ram-never-below-1.0-GiB' ($mon.MinRam -ge 1.0) $mon.MinRam
  Add-ResultCheck $R 'vram-used-below-3600-MiB' ($mon.PeakVram -le 3600) $mon.PeakVram
  Add-ResultCheck $R 'no-established-external-connection' ($ext -eq 0) $ext
  Add-ResultCheck $R 'api-key-enforced' ($noKey.Status -eq 401 -or $noKey.Status -eq 403) ('without key: HTTP ' + $noKey.Status)
  Add-ResultCheck $R 'wrong-key-rejected' ($badKey.Status -eq 401 -or $badKey.Status -eq 403) ('wrong key: HTTP ' + $badKey.Status)
  Add-ResultCheck $R 'cors-foreign-origin-not-allowed' (($acao -cne '*') -and ($acao -cne 'http://evil.example')) ('Access-Control-Allow-Origin: [' + $acao + ']')
  Add-ResultCheck $R 'web-ui-disabled' ($ui.Status -ne 200) ('GET / : HTTP ' + $ui.Status) 'warn'
  Add-ResultCheck $R 'slots-endpoint-disabled' ($sl.Status -ne 200) ('GET /slots : HTTP ' + $sl.Status) 'warn'
  $R.data.tests = $tests
  $R.data.summary = @{ min_avail_ram_gib = $mon.MinRam; max_vram_used_mib = $mon.PeakVram; max_server_working_set_mib = $mon.PeakWs; samples = $mon.Samples.Count }
  $R.data.props_n_ctx = $nctx
  $errLines = 0
  if (Test-Path -LiteralPath $srv.ErrLog) { $all = @(Get-Content -LiteralPath $srv.ErrLog); $errLines = $all.Count; $R.data.err_log_offload_lines = @($all | Where-Object { $_ -match 'offload|KV buffer|model buffer|compute buffer|n_gpu_layers|CUDA' } | Select-Object -First 60) }
  $R.data.err_log_line_count = $errLines
  $R.data.server = @{ pid = $srv.Pid; ngl = $srv.Ngl; ctx = $srv.Ctx; started_utc = $srv.StartedUtc; kill_on_close_guard = $srv.Guarded }
  $rep = Join-Path $script:Cfg.Health ('health-agent-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')
  [void](Assert-UnderRoot $rep)
  Write-AtomicJson $rep @{ kind = 'agent-health'; job = $R.id; takenUtc = (Get-UtcNowText); checks = $R.checks; data = $R.data }
  $R.data.report_file = $rep
  Set-MonitorBudget $mon 1.0e9
  if (Test-ResultChecksPass $R) { return 'ok' }
  return 'failed'
}

function Get-BenchPrompt {
  return 'Write a detailed, plain-language description of how a neighbourhood bakery plans its day: ordering flour, preparing dough, baking in batches, checking quality, and cleaning up. Use full sentences and at least twelve of them.'
}

function Invoke-JobSweep {
  param($Job, $R)
  $nglList = @($Job['params']['ngl_list'] | ForEach-Object { [int]$_ } | Sort-Object)
  $ctxList = @($Job['params']['ctx_list'] | ForEach-Object { [int]$_ } | Sort-Object)
  $gen = [int]$Job['params']['gen_tokens']
  if ($script:Ctx.Mode -ceq 'DryRun') {
    $plan = New-Object System.Collections.ArrayList
    foreach ($c in $ctxList) {
      $m = Get-StartMeasurements
      foreach ($n in $nglList) { [void]$plan.Add(@{ ctx = $c; ngl = $n; est_vram_mib = (Get-EstVramMiB $n $c); required_free_vram_mib = (Get-RequiredFreeVramMiB $n $c); min_avail_ram_gib = (Get-MinAvailRamGiB $c); free_vram_now_mib = $m.vram_free_mib; avail_ram_now_gib = $m.avail_ram_gib; gates_would_pass_now = ((Get-FailedCheckNames (Get-StartGateChecks $m $n $c)).Count -eq 0) }) }
    }
    $R.data.plan = $plan
    $R.data.note = 'DRY RUN: nothing was started. Live: for each combination the gates run, the server starts, one warm-up and one measured request run, the server stops and RAM must recover before the next combination.'
    return 'planned'
  }
  if ($script:St.Server) { $R.error = 'A server is already running. Send server-stop before a sweep.'; return 'failed' }
  $budget = 1800.0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $table = New-Object System.Collections.ArrayList
  $R.data.table = $table
  $aborted = $false
  foreach ($c in $ctxList) {
    $refused = $false
    foreach ($n in $nglList) {
      $row = @{ ctx = $c; ngl = $n; status = $null; est_vram_mib = (Get-EstVramMiB $n $c) }
      [void]$table.Add($row)
      if ($refused) { $row.status = 'skipped: a lower ngl was already refused by a gate at this context'; continue }
      if ($sw.Elapsed.TotalSeconds + 240 -gt $budget) { $row.status = 'skipped: job time budget'; continue }
      $s = @(Start-PilotServer $n $c 30 ([string]$Job['id']))[-1]
      $row.status = [string]$s.status
      if ($s.status -ceq 'gate-failed') { $refused = $true; $row.failed_gates = @(Get-FailedCheckNames $s.checks); $row.error = $s.error; continue }
      if (-not $s.ok) { $row.error = $s.error; if ($s.status -ceq 'aborted') { $aborted = $true; break }; continue }
      $row.load_seconds = $s.data.load_seconds
      $row.vram_delta_mib = $s.data.vram_delta_mib
      $row.vram_after_load_used_mib = $s.data.vram_after_load_used_mib
      $mon = $script:St.Server.Mon
      Set-MonitorBudget $mon 600
      $warm = Invoke-ChatCall 'warmup' 'You are terse.' 'Say ready.' 8 $mon
      if (Test-CallAborted $warm $R) { $row.status = 'aborted'; $aborted = $true; break }
      $b = Invoke-ChatCall 'bench' 'You write clear prose.' (Get-BenchPrompt) $gen $mon
      if (Test-CallAborted $b $R) { $row.status = 'aborted'; $aborted = $true; break }
      $row.http_status = $b.httpStatus
      $row.prompt_tokens = $b.promptTokens; $row.prompt_tps = $b.promptTps
      $row.gen_tokens = $b.completionTokens; $row.gen_tps = $b.genTps; $row.wall_seconds = $b.wallSeconds
      $row.vram_peak_mib = $mon.PeakVram; $row.ram_min_gib = $mon.MinRam; $row.server_ws_peak_mib = $mon.PeakWs
      $row.status = $(if ($b.httpStatus -eq 200) { 'measured' } else { 'request-failed' })
      $stop = Stop-PilotServer 'sweep-step'
      $row.stopped = $stop.stopped; $row.port_closed = $stop.port_closed; $row.ram_after_stop_gib = $stop.ram_after_gib
      if (-not ($stop.stopped -and $stop.port_closed)) { $row.status = 'STOP-FAILED'; $R.error = 'The server could not be stopped cleanly; sweep ended.'; break }
      $need = Get-MinAvailRamGiB $c
      $recoverBy = (Get-Date).AddSeconds(60)
      while ((Get-Date) -lt $recoverBy -and (Get-AvailRamGiB) -lt $need) { Start-Sleep -Seconds 3 }
    }
    if ($aborted -or $R.error) { break }
  }
  if ($script:St.Server) { [void](Stop-PilotServer 'sweep-end') }
  $R.data.total_seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $R.data.bench_prompt_tokens_note = 'Speeds come from the server own timings for one measured request after one warm-up; gen_tokens below the requested number means the model stopped early.'
  $rep = Join-Path $script:Cfg.Health ('sweep-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')
  [void](Assert-UnderRoot $rep)
  Write-AtomicJson $rep @{ kind = 'sweep'; job = $R.id; takenUtc = (Get-UtcNowText); table = $table }
  $R.data.report_file = $rep
  if ($aborted) { return 'aborted' }
  if ($R.error) { return 'failed' }
  return 'ok'
}

function Invoke-JobRunSuite {
  param($Job, $R)
  $name = [string]$Job['params']['suite']; $want = [string]$Job['params']['suite_sha256']; $maxMin = [int]$Job['params']['max_minutes']
  $path = Join-Path $script:Ctx.P.Suites ($name + '.json')
  [void](Assert-UnderRoot $path)
  if (-not (Test-Path -LiteralPath $path)) { $R.error = 'Suite file not found: suites\' + $name + '.json'; return 'failed' }
  $fi = Get-Item -LiteralPath $path
  if ($fi.Length -gt 600000) { $R.error = 'Suite file is larger than 600,000 bytes.'; return 'failed' }
  $got = Get-FileSha256 $path
  Add-ResultCheck $R 'suite-sha256-matches-job' ($got -ceq $want) ('file ' + $got)
  if ($got -cne $want) { return 'failed' }
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $reason = Test-SuiteText $text
  Add-ResultCheck $R 'suite-valid' ($reason -ceq 'ok') $reason
  if ($reason -cne 'ok') { return 'failed' }
  $suite = (ConvertFrom-StrictJson -Text $text -Rich).Value
  $R.data.suite = @{ name = $name; provenance = $suite['provenance']; licence_ref = $(if ($suite.ContainsKey('licence_ref')) { $suite['licence_ref'] } else { $null }); items = $suite['items'].Count; sha256 = $got }
  if ($script:Ctx.Mode -ceq 'DryRun') { $R.data.note = 'DRY RUN: the suite was found, hashed and validated; no request was sent.'; return 'planned' }
  if (-not $script:St.Server) { $R.error = 'No server is running under this agent. Send server-start first.'; return 'failed' }
  $mon = $script:St.Server.Mon
  Set-MonitorBudget $mon ($maxMin * 60)
  $results = New-Object System.Collections.ArrayList
  foreach ($it in $suite['items']) {
    $o = Invoke-ChatCall ([string]$it['id']) ([string]$it['system']) ([string]$it['user']) ([int]$it['max_tokens']) $mon
    if (Test-CallAborted $o $R) { $R.data.partial_results = $results; return 'aborted' }
    [void]$results.Add($o)
  }
  $rf = Join-Path (Join-Path $script:Ctx.P.Runs $R.id) 'suite-results.json'
  $rd = Split-Path -Path $rf -Parent
  [void](Assert-UnderRoot $rd)
  if (-not (Test-Path -LiteralPath $rd)) { [void](New-Item -ItemType Directory -Path $rd) }
  Write-AtomicJson $rf @{ schema = 'shords-pilot-suite-results/1'; job = $R.id; suite = $R.data.suite; takenUtc = (Get-UtcNowText); server = @{ ngl = $script:St.Server.Ngl; ctx = $script:St.Server.Ctx }; resource = @{ min_avail_ram_gib = $mon.MinRam; max_vram_used_mib = $mon.PeakVram }; results = $results }
  Set-MonitorBudget $mon 1.0e9
  $R.data.results_file = $rf
  $bad = 0
  foreach ($o in $results) { if ($o.error -or $o.httpStatus -ne 200) { $bad = $bad + 1 } }
  Add-ResultCheck $R 'all-items-answered' ($bad -eq 0) ('failed items: ' + $bad)
  if ($bad -eq 0) { return 'ok' }
  return 'failed'
}

function Invoke-JobCollect {
  param($Job, $R)
  $what = [string]$Job['params']['what']
  $dirs = @()
  if ($what -ceq 'logs' -or $what -ceq 'all') { $dirs += $script:Cfg.Logs }
  if ($what -ceq 'reports' -or $what -ceq 'all') { $dirs += $script:Cfg.Health; $dirs += $script:Ctx.P.Outbox }
  $files = New-Object System.Collections.ArrayList
  foreach ($d in $dirs) {
    [void](Assert-UnderRoot $d)
    foreach ($f in @(Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue)) {
      $e = @{ path = $f.FullName; bytes = $f.Length; modifiedUtc = $f.LastWriteTimeUtc.ToString('o'); sha256 = $null }
      if ($f.Length -le 52428800) { $e.sha256 = Get-FileSha256 $f.FullName }
      [void]$files.Add($e)
    }
  }
  $mf = Join-Path (Join-Path $script:Ctx.P.Runs $R.id) 'collect-manifest.json'
  $md = Split-Path -Path $mf -Parent
  [void](Assert-UnderRoot $md)
  if (-not (Test-Path -LiteralPath $md)) { [void](New-Item -ItemType Directory -Path $md) }
  Write-AtomicJson $mf @{ schema = 'shords-pilot-collect/1'; job = $R.id; takenUtc = (Get-UtcNowText); what = $what; files = $files }
  $R.data.manifest_file = $mf
  $R.data.file_count = $files.Count
  return 'ok'
}

# Runs one validated job (a Dictionary from Test-JobText, or a hashtable built by Invoke-PilotRun.ps1). Always writes outbox\<id>.json.
function Invoke-PilotJob {
  param($Job)
  $R = New-JobResult $Job
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $script:St.CurrentJob = $R.id
  Add-Audit 'job-start' @{ id = $R.id; type = $R.type }
  try {
    $out = @()
    switch -CaseSensitive ([string]$Job['type']) {
      'preflight' { $out = @(Invoke-JobPreflight $Job $R) }
      'verify-integrity' { $out = @(Invoke-JobVerifyIntegrity $Job $R) }
      'server-start' { $out = @(Invoke-JobServerStart $Job $R) }
      'server-stop' { $out = @(Invoke-JobServerStop $Job $R) }
      'health' { $out = @(Invoke-JobHealth $Job $R) }
      'sweep' { $out = @(Invoke-JobSweep $Job $R) }
      'run-suite' { $out = @(Invoke-JobRunSuite $Job $R) }
      'collect' { $out = @(Invoke-JobCollect $Job $R) }
      default { $R.error = 'unsupported job type' }
    }
    if ($out.Count -gt 0) { $R.status = [string]$out[$out.Count - 1] }
  } catch {
    $R.status = 'failed'
    $R.error = $_.Exception.Message
    if ($script:St.Server -and $script:Ctx.Mode -ceq 'Live' -and $R.type -cin @('health', 'sweep', 'run-suite', 'server-start')) { [void](Invoke-EmergencyShutdown 'handler-exception' $R.id) }
  }
  $sw.Stop()
  $R.finished_utc = Get-UtcNowText
  $R.seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $script:St.CurrentJob = $null
  $script:St.JobsDone = $script:St.JobsDone + 1
  try { Write-AtomicJson (Join-Path $script:Ctx.P.Outbox ($R.id + '.json')) $R } catch { Add-Audit 'result-write-failed' @{ id = $R.id; error = $_.Exception.Message } }
  Add-Audit 'job-end' @{ id = $R.id; type = $R.type; status = $R.status; seconds = $R.seconds }
  return $R
}

# --------------------------------------------------------------------------------------------------------------- dry-run marker, lease, inbox
$script:LiveRequired = @{ agent = @('preflight', 'verify-integrity', 'server-start', 'server-stop', 'health', 'sweep', 'run-suite', 'collect'); run = @('preflight', 'verify-integrity', 'server-start', 'health', 'server-stop') }

function Update-DryRunMarker {
  param($Result)
  if ($script:Ctx.Mode -cne 'DryRun') { return }
  $p = $script:Ctx.P.Marker
  $types = @{}
  $old = $null
  if (Test-Path -LiteralPath $p) { try { $old = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { $old = $null } }
  if ($old -and $old.agent_version -ceq $script:P6C.Version) { foreach ($t in @($old.types_ok)) { $types[[string]$t] = $true } }
  if (@('ok', 'planned') -ccontains $Result.status) { $types[[string]$Result.type] = $true }
  $first = Get-UtcNowText
  if ($old -and $old.first_utc -and $old.agent_version -ceq $script:P6C.Version) { $first = [string]$old.first_utc }
  Write-AtomicJson $p @{ schema = 'shords-pilot-dryrun/1'; agent_version = $script:P6C.Version; first_utc = $first; last_utc = (Get-UtcNowText); types_ok = @($types.Keys | Sort-Object); rejected_seen = $script:St.JobsRejected }
}

# Live is allowed only after a dry run of this exact version exercised every job type needed. Returns @{ Ok; Missing; Why }.
function Test-DryRunMarker {
  param([string[]]$Required)
  $p = $script:Ctx.P.Marker
  if (-not (Test-Path -LiteralPath $p)) { return @{ Ok = $false; Why = 'No dry run has been completed yet (jobs\dryrun-complete.json is missing).'; Missing = $Required } }
  try { $m = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { return @{ Ok = $false; Why = 'dryrun-complete.json cannot be read.'; Missing = $Required } }
  if ($m.agent_version -cne $script:P6C.Version) { return @{ Ok = $false; Why = 'The dry run was made with another version of the agent.'; Missing = $Required } }
  $have = @{}
  foreach ($t in @($m.types_ok)) { $have[[string]$t] = $true }
  $missing = @($Required | Where-Object { -not $have.ContainsKey($_) })
  if ($missing.Count -gt 0) { return @{ Ok = $false; Why = 'The dry run did not yet exercise: ' + ($missing -join ', '); Missing = $missing } }
  $age = ((Get-Date).ToUniversalTime() - (ConvertTo-UtcDate $m.last_utc)).TotalDays
  if ($age -gt 7) { return @{ Ok = $false; Why = 'The dry run is older than 7 days; repeat it.'; Missing = @() } }
  return @{ Ok = $true; Why = ''; Missing = @() }
}

function Update-Lease {
  param([string]$State)
  $s = $script:St
  Write-AtomicJson $script:Ctx.P.Lease @{ schema = 'shords-pilot-lease/1'; state = $State; pid = $PID; mode = $script:Ctx.Mode; agent_version = $script:P6C.Version; beat_utc = (Get-UtcNowText)
    lease_end_utc = (Format-PilotTimestamp $s.LeaseEnd); current_job = $s.CurrentJob; jobs_done = $s.JobsDone; jobs_rejected = $s.JobsRejected; audit_errors = $s.AuditErrors
    server = $(if ($s.Server) { @{ pid = $s.Server.Pid; ngl = $s.Server.Ngl; ctx = $s.Server.Ctx; idle_minutes = $s.Server.IdleMinutes } } else { $null }) }
}

function Move-ToFolder {
  param([string]$Source, [string]$DestDir, [string]$Name)
  $dest = Join-Path $DestDir $Name
  if (Test-Path -LiteralPath $dest) { $dest = Join-Path $DestDir ((Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + (New-RandomHex 2) + '-' + $Name) }
  [void](Assert-UnderRoot $dest)
  [System.IO.File]::Move($Source, $dest)
  return $dest
}

function Write-RejectResult {
  param([string]$Stem, [string]$Reason)
  $id = $Stem
  if ($id -cnotmatch '\A[a-z0-9][a-z0-9-]{6,63}\z') { $id = 'invalid-' + (New-RandomHex 4) }
  $r = @{ schema = $script:P6C.SchemaResult; id = $id; type = $null; mode = $script:Ctx.Mode; agent_version = $script:P6C.Version; started_utc = (Get-UtcNowText); finished_utc = (Get-UtcNowText); seconds = 0; status = 'rejected'; error = $Reason; checks = @(); data = @{} }
  try { Write-AtomicJson (Join-Path $script:Ctx.P.Outbox ('rejected-' + $id + '.json')) $r } catch { }
}

# Looks at the inbox once: at most 20 files, oldest first. Returns the number of files handled.
function Invoke-InboxCycle {
  $p = $script:Ctx.P
  $files = @(Get-ChildItem -LiteralPath $p.Inbox -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '\.json\z' -or $_.Name -cnotmatch '\.tmp(-[0-9a-f]+)?\z' } | Sort-Object LastWriteTimeUtc | Select-Object -First 20)
  $n = 0
  foreach ($f in $files) {
    if ($script:St.Server -eq $null -and (Test-Path -LiteralPath $p.Stop)) { break }
    $name = $f.Name
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($name)
    try { $work = Move-ToFolder $f.FullName $p.Work $name } catch { continue }
    $n = $n + 1
    $reason = $null
    $verdict = $null
    if ($name -cnotmatch '\A[a-z0-9][a-z0-9-]{6,63}\.json\z') { $reason = 'filename' }
    elseif ((Get-Item -LiteralPath $work).Length -gt 65536) { $reason = 'size' }
    else {
      $text = [System.IO.File]::ReadAllText($work, [System.Text.Encoding]::UTF8)
      $verdict = Test-JobText -Text $text -Stem $stem -KeyText $script:St.Key -NowEpoch (Get-NowEpoch) -Seen $script:St.Seen
      if (-not $verdict.Ok) { $reason = $verdict.Reason }
    }
    if ($reason) {
      $script:St.JobsRejected = $script:St.JobsRejected + 1
      Add-Audit 'job-rejected' @{ file = $name; reason = $reason }
      Write-RejectResult $stem $reason
      Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $name + '  REJECTED: ' + $reason)
      [void](Move-ToFolder $work $p.Rejected $name)
      continue
    }
    $job = $verdict.Job
    $script:St.Seen[[string]$job['id']] = $true
    try { [System.IO.File]::AppendAllText($p.SeenIds, ([string]$job['id'] + "`n"), (New-Object System.Text.ASCIIEncoding)) } catch { }
    $res = Invoke-PilotJob $job
    Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $res.id + '  ' + $res.type + '  ->  ' + $res.status + $(if ($res.error) { '  (' + $res.error + ')' } else { '' }))
    Update-DryRunMarker $res
    [void](Move-ToFolder $work $p.Archive $name)
  }
  return $n
}

# Stops the server when nothing has used it for its idle time.
function Test-ServerIdle {
  $s = $script:St.Server
  if (-not $s) { return }
  if (((Get-NowEpoch) - $s.LastActivity) -gt ($s.IdleMinutes * 60)) { [void](Stop-PilotServer 'idle-timeout') }
}
