# Phase6C.Lib.ps1 - PURE logic for the Phase 6C pilot agent: strict JSON, job validation, HMAC, resource gates, emergency-brake decision,
# server command line. NO file, process, network or registry access happens in this file; it only defines settings and functions.
# Windows PowerShell 5.1, ASCII only. Every function here has a Python twin in linux\pilot_core.py and is checked against the shared
# conformance vectors (vectors\*.json) by Test-AgentLogic.ps1. All string comparisons are case-sensitive (-ceq, -cmatch, -ccontains,
# switch -CaseSensitive) on purpose: PowerShell's default is case-insensitive, which would let "Preflight" or "ABC" pass a lower-case check.

$script:P6C = @{
  Version          = 'r7.0'
  MarkerSchema     = 'shords-pilot-dryrun/1'
  MarkerRev        = 2
  SchemaJob        = 'shords-pilot-job/1'
  SchemaResult     = 'shords-pilot-result/1'
  SchemaSuite      = 'shords-pilot-suite/1'
  Types            = @('preflight', 'verify-integrity', 'server-start', 'server-stop', 'health', 'sweep', 'run-suite', 'collect')
  CtxAllowed       = @(4096, 8192, 12288)
  NglMax           = 20
  MaxLifetimeS     = 1800
  ClockSkewS       = 120
  MaxJobBytes      = 16384
  VramHardLimitMiB = 3700
  VramMarginMiB    = 250
  RamFloorGiB      = 1.0
  RamBaseGiB       = 6.5
  RamPer4096GiB    = 1.2
  DiskMinGiB       = 20
  Port             = 8080
}
$script:TopKeys = @('created_utc', 'expires_utc', 'hmac', 'id', 'params', 'schema', 'type')
$script:ParamKeys = @{
  'preflight'        = @('ctx', 'ngl')
  'verify-integrity' = @('scope')
  'server-start'     = @('ctx', 'idle_minutes', 'ngl')
  'server-stop'      = @()
  'health'           = @('suite')
  'sweep'            = @('ctx_list', 'gen_tokens', 'ngl_list')
  'run-suite'        = @('max_minutes', 'suite', 'suite_sha256')
  'collect'          = @('what')
}
$script:FatalLogPatterns = @('cuda error', 'out of memory', 'failed to allocate', 'ggml_assert', 'cudamalloc failed', 'ggml_cuda_init: failed', 'unable to allocate')

# ----------------------------------------------------------------------------------------------------------------- strict JSON
$script:RxStrictRun = New-Object System.Text.RegularExpressions.Regex('\G[\x20\x21\x23-\x5B\x5D-\x7E]*')
$script:RxRichRun = New-Object System.Text.RegularExpressions.Regex('\G[^\x00-\x1F"\\]*')
$script:RxJsonInt = New-Object System.Text.RegularExpressions.Regex('\G-?(0|[1-9][0-9]{0,14})')

function New-JResult {
  param([bool]$Ok, [string]$Error, $Value)
  return [pscustomobject]@{ Ok = $Ok; Error = $Error; Value = $Value }
}

function Skip-JWs {
  $j = $script:J
  while ($j.I -lt $j.N) {
    $c = [int]$j.S[$j.I]
    if ($c -eq 32 -or $c -eq 9 -or $c -eq 13 -or $c -eq 10) { $j.I = $j.I + 1 } else { break }
  }
}

function Read-JString {
  $j = $script:J
  $s = $j.S
  if ($j.I -ge $j.N -or [int]$s[$j.I] -ne 34) { $j.Err = 'string'; return $false }
  $i = $j.I + 1
  $sb = New-Object System.Text.StringBuilder
  $rx = $script:RxStrictRun
  if ($j.Rich) { $rx = $script:RxRichRun }
  while ($true) {
    $m = $rx.Match($s, $i)
    if ($m.Length -gt 0) { [void]$sb.Append($s, $i, $m.Length); $i = $i + $m.Length }
    if ($i -ge $j.N) { $j.Err = 'string-eof'; return $false }
    $code = [int]$s[$i]
    if ($code -eq 34) { $j.I = $i + 1; $j.V = $sb.ToString(); return $true }
    if ($code -ne 92) { $j.Err = 'char'; return $false }
    if ($i + 1 -ge $j.N) { $j.Err = 'escape'; return $false }
    $e = [int]$s[$i + 1]
    if ($e -eq 34 -or $e -eq 92 -or $e -eq 47) { [void]$sb.Append([char]$e); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 98) { [void]$sb.Append([char]8); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 102) { [void]$sb.Append([char]12); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 110) { [void]$sb.Append([char]10); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 114) { [void]$sb.Append([char]13); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 116) { [void]$sb.Append([char]9); $i = $i + 2; continue }
    if ($j.Rich -and $e -eq 117) {
      if ($i + 6 -gt $j.N) { $j.Err = 'escape'; return $false }
      $hex = $s.Substring($i + 2, 4)
      if ($hex -cnotmatch '\A[0-9a-fA-F]{4}\z') { $j.Err = 'escape'; return $false }
      [void]$sb.Append([char][Convert]::ToInt32($hex, 16))
      $i = $i + 6
      continue
    }
    $j.Err = 'escape'
    return $false
  }
}

function Read-JValue {
  param([int]$Depth)
  $j = $script:J
  if ($Depth -gt $j.MaxDepth) { $j.Err = 'depth'; return $false }
  Skip-JWs
  if ($j.I -ge $j.N) { $j.Err = 'eof'; return $false }
  $s = $j.S
  $c = [int]$s[$j.I]
  if ($c -eq 123) {
    $j.I = $j.I + 1
    $d = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    Skip-JWs
    if ($j.I -lt $j.N -and [int]$s[$j.I] -eq 125) { $j.I = $j.I + 1; $j.V = $d; return $true }
    while ($true) {
      Skip-JWs
      if (-not (Read-JString)) { return $false }
      $k = [string]$j.V
      Skip-JWs
      if ($j.I -ge $j.N -or [int]$s[$j.I] -ne 58) { $j.Err = 'colon'; return $false }
      $j.I = $j.I + 1
      if ($d.ContainsKey($k)) { $j.Err = 'duplicate-key'; return $false }
      if (-not (Read-JValue ($Depth + 1))) { return $false }
      $d[$k] = $j.V
      Skip-JWs
      if ($j.I -ge $j.N) { $j.Err = 'eof'; return $false }
      $n = [int]$s[$j.I]
      if ($n -eq 44) { $j.I = $j.I + 1; continue }
      if ($n -eq 125) { $j.I = $j.I + 1; $j.V = $d; return $true }
      $j.Err = 'object'
      return $false
    }
  }
  if ($c -eq 91) {
    $j.I = $j.I + 1
    $a = New-Object System.Collections.ArrayList
    Skip-JWs
    if ($j.I -lt $j.N -and [int]$s[$j.I] -eq 93) { $j.I = $j.I + 1; $j.V = $a; return $true }
    while ($true) {
      if (-not (Read-JValue ($Depth + 1))) { return $false }
      [void]$a.Add($j.V)
      Skip-JWs
      if ($j.I -ge $j.N) { $j.Err = 'eof'; return $false }
      $n = [int]$s[$j.I]
      if ($n -eq 44) { $j.I = $j.I + 1; continue }
      if ($n -eq 93) { $j.I = $j.I + 1; $j.V = $a; return $true }
      $j.Err = 'array'
      return $false
    }
  }
  if ($c -eq 34) { return (Read-JString) }
  $rest = $j.N - $j.I
  if ($rest -ge 4 -and $s.Substring($j.I, 4) -ceq 'true') { $j.I = $j.I + 4; $j.V = $true; return $true }
  if ($rest -ge 5 -and $s.Substring($j.I, 5) -ceq 'false') { $j.I = $j.I + 5; $j.V = $false; return $true }
  if ($rest -ge 4 -and $s.Substring($j.I, 4) -ceq 'null') { $j.I = $j.I + 4; $j.V = $null; return $true }
  $m = $script:RxJsonInt.Match($s, $j.I)
  if (-not $m.Success) { $j.Err = 'token'; return $false }
  $end = $j.I + $m.Length
  if ($end -lt $j.N) {
    $nx = [int]$s[$end]
    if ($nx -eq 46 -or $nx -eq 101 -or $nx -eq 69 -or ($nx -ge 48 -and $nx -le 57)) { $j.Err = 'number'; return $false }
  }
  $j.I = $end
  $j.V = [long]::Parse($m.Value, [System.Globalization.CultureInfo]::InvariantCulture)
  return $true
}

# Strict JSON for control files. Job files: -Rich not set (printable ASCII only, escapes only \" \\ \/ , depth 4).
# Suite files: -Rich (any character from U+0020, plus \b \f \n \r \t \uXXXX, depth 6). Integers only (up to 15 digits). Duplicate keys refused.
# Returns [pscustomobject]@{ Ok; Error; Value }. Objects are case-sensitive Dictionary[string,object]; arrays are ArrayList; integers are [long].
function ConvertFrom-StrictJson {
  param([string]$Text, [switch]$Rich)
  if ($Text -eq $null) { return (New-JResult $false 'json' $null) }
  $max = 4
  if ($Rich) { $max = 6 }
  $script:J = @{ S = $Text; I = 0; N = $Text.Length; Rich = [bool]$Rich; V = $null; Err = 'json'; MaxDepth = $max }
  if ($script:J.N -gt 0 -and [int]$Text[0] -eq 65279) { $script:J.I = 1 }
  Skip-JWs
  if ($script:J.I -ge $script:J.N -or [int]$Text[$script:J.I] -ne 123) { return (New-JResult $false 'top-level' $null) }
  if (-not (Read-JValue 0)) { return (New-JResult $false $script:J.Err $null) }
  Skip-JWs
  if ($script:J.I -ne $script:J.N) { return (New-JResult $false 'trailing' $null) }
  return (New-JResult $true '' $script:J.V)
}

# ----------------------------------------------------------------------------------------------------------------- time
$script:EpochUtc = New-Object System.DateTime(1970, 1, 1, 0, 0, 0, [System.DateTimeKind]::Utc)

# 'yyyy-MM-ddTHH:mm:ssZ' (exactly) with year 2024..2099 -> seconds since 1970 as [long]; otherwise $null.
function ConvertFrom-PilotTimestamp {
  param($Text)
  if ($Text -isnot [string]) { return $null }
  $m = [regex]::Match($Text, '\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z\z')
  if (-not $m.Success) { return $null }
  $y = [int]$m.Groups[1].Value
  if ($y -lt 2024 -or $y -gt 2099) { return $null }
  try {
    $dt = New-Object System.DateTime($y, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value, [int]$m.Groups[4].Value, [int]$m.Groups[5].Value, [int]$m.Groups[6].Value, [System.DateTimeKind]::Utc)
  } catch { return $null }
  return [long][math]::Floor(($dt - $script:EpochUtc).TotalSeconds)
}

function Format-PilotTimestamp {
  param([long]$Epoch)
  return $script:EpochUtc.AddSeconds($Epoch).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-NowEpoch {
  return [long][math]::Floor(((Get-Date).ToUniversalTime() - $script:EpochUtc).TotalSeconds)
}

# ----------------------------------------------------------------------------------------------------------------- canonical form and HMAC
function ConvertTo-CanonValue {
  param($V)
  if ($V -is [bool]) { if ($V) { return 'true' } else { return 'false' } }
  if ($V -is [long] -or $V -is [int]) { return ([long]$V).ToString([System.Globalization.CultureInfo]::InvariantCulture) }
  if ($V -is [string]) { return $V }
  if ($V -is [System.Collections.ArrayList]) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($x in $V) { [void]$parts.Add((ConvertTo-CanonValue $x)) }
    return ($parts.ToArray() -join ',')
  }
  throw 'unsupported value in a job'
}

function Get-SortedKeys {
  param($Dict)
  $keys = New-Object 'System.Collections.Generic.List[string]'
  foreach ($k in $Dict.Keys) { $keys.Add([string]$k) }
  $keys.Sort([System.StringComparer]::Ordinal)
  return $keys.ToArray()
}

function Get-CanonicalJobString {
  param($Job)
  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add([string]$Job['schema'])
  [void]$lines.Add('id=' + [string]$Job['id'])
  [void]$lines.Add('type=' + [string]$Job['type'])
  [void]$lines.Add('created=' + [string]$Job['created_utc'])
  [void]$lines.Add('expires=' + [string]$Job['expires_utc'])
  $p = $Job['params']
  foreach ($k in (Get-SortedKeys $p)) { [void]$lines.Add('p.' + $k + '=' + (ConvertTo-CanonValue $p[$k])) }
  return ($lines.ToArray() -join "`n")
}

function Get-HmacSha256Hex {
  param([string]$KeyText, [string]$Message)
  $h = New-Object System.Security.Cryptography.HMACSHA256
  $h.Key = [System.Text.Encoding]::ASCII.GetBytes($KeyText)
  $bytes = $h.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($Message))
  $h.Dispose()
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($b.ToString('x2')) }
  return $sb.ToString()
}

function Test-ConstantTimeEqual {
  param([string]$A, [string]$B)
  if ($A.Length -ne $B.Length) { return $false }
  $diff = 0
  for ($i = 0; $i -lt $A.Length; $i++) { $diff = $diff -bor ([int]$A[$i] -bxor [int]$B[$i]) }
  return ($diff -eq 0)
}

# ----------------------------------------------------------------------------------------------------------------- parameter checks
function Test-IntRange {
  param($V, [long]$Lo, [long]$Hi)
  return (($V -is [long]) -and $V -ge $Lo -and $V -le $Hi)
}

function Test-IntList {
  param($V, [long]$Lo, [long]$Hi, [int]$NMin, [int]$NMax, $Allowed)
  if ($V -isnot [System.Collections.ArrayList]) { return $false }
  if ($V.Count -lt $NMin -or $V.Count -gt $NMax) { return $false }
  $seen = @{}
  foreach ($x in $V) {
    if ($x -isnot [long]) { return $false }
    if ($x -lt $Lo -or $x -gt $Hi) { return $false }
    if ($Allowed -ne $null -and (@($Allowed) -notcontains $x)) { return $false }  # lint-ok numeric list
    if ($seen.ContainsKey($x)) { return $false }
    $seen[$x] = $true
  }
  return $true
}

function Test-StringEnum {
  param($V, [string[]]$Allowed)
  return (($V -is [string]) -and ($Allowed -ccontains $V))
}

function Test-ParamValue {
  param([string]$Type, [string]$Key, $V)
  switch -CaseSensitive ($Type + '.' + $Key) {
    'preflight.ngl' { return (Test-IntRange $V 0 $script:P6C.NglMax) }
    'preflight.ctx' { return (($V -is [long]) -and (@($script:P6C.CtxAllowed) -contains $V)) }  # lint-ok numeric list
    'verify-integrity.scope' { return (Test-StringEnum $V @('quick', 'runtime', 'full')) }
    'server-start.ngl' { return (Test-IntRange $V 0 $script:P6C.NglMax) }
    'server-start.ctx' { return (($V -is [long]) -and (@($script:P6C.CtxAllowed) -contains $V)) }  # lint-ok numeric list
    'server-start.idle_minutes' { return (Test-IntRange $V 5 120) }
    'health.suite' { return (Test-StringEnum $V @('synthetic3')) }
    'sweep.ngl_list' { return (Test-IntList $V 0 $script:P6C.NglMax 1 6 $null) }
    'sweep.ctx_list' { return (Test-IntList $V 4096 12288 1 3 $script:P6C.CtxAllowed) }
    'sweep.gen_tokens' { return (Test-IntRange $V 16 256) }
    'run-suite.suite' { return (($V -is [string]) -and ($V -cmatch '\A[a-z0-9][a-z0-9_-]{1,40}\z')) }
    'run-suite.suite_sha256' { return (($V -is [string]) -and ($V -cmatch '\A[0-9a-f]{64}\z')) }
    'run-suite.max_minutes' { return (Test-IntRange $V 1 120) }
    'collect.what' { return (Test-StringEnum $V @('logs', 'reports', 'all')) }
    default { return $false }
  }
}

function Test-KeySet {
  param($Dict, [string[]]$Expected)
  if ($Dict.Count -ne $Expected.Count) { return $false }
  foreach ($k in $Expected) { if (-not $Dict.ContainsKey($k)) { return $false } }
  return $true
}

function New-JobVerdict {
  param([bool]$Ok, [string]$Reason, $Job)
  return [pscustomobject]@{ Ok = $Ok; Reason = $Reason; Job = $Job }
}

# Same order and the same reason codes as validate_job() in pilot_core.py. $Seen is a hashtable of ids already used.
function Test-JobText {
  param([string]$Text, [string]$Stem, [string]$KeyText, [long]$NowEpoch, $Seen)
  if ([System.Text.Encoding]::UTF8.GetByteCount($Text) -gt $script:P6C.MaxJobBytes) { return (New-JobVerdict $false 'size' $null) }
  $pj = ConvertFrom-StrictJson -Text $Text
  if (-not $pj.Ok) { return (New-JobVerdict $false 'json' $null) }
  $job = $pj.Value
  if (-not (Test-KeySet $job $script:TopKeys)) { return (New-JobVerdict $false 'top-keys' $null) }
  if (-not (($job['schema'] -is [string]) -and $job['schema'] -ceq $script:P6C.SchemaJob)) { return (New-JobVerdict $false 'schema' $null) }
  $id = $job['id']
  if (-not (($id -is [string]) -and ($id -cmatch '\A[a-z0-9][a-z0-9-]{6,63}\z'))) { return (New-JobVerdict $false 'id' $null) }
  if ($id -cne $Stem) { return (New-JobVerdict $false 'id-name-mismatch' $null) }
  $type = $job['type']
  if (-not (($type -is [string]) -and (@($script:P6C.Types) -ccontains $type))) { return (New-JobVerdict $false 'type' $null) }
  $c = ConvertFrom-PilotTimestamp $job['created_utc']
  $e = ConvertFrom-PilotTimestamp $job['expires_utc']
  if ($c -eq $null -or $e -eq $null) { return (New-JobVerdict $false 'timestamps' $null) }
  if ($e -le $c -or ($e - $c) -gt $script:P6C.MaxLifetimeS) { return (New-JobVerdict $false 'lifetime' $null) }
  $params = $job['params']
  if ($params -isnot [System.Collections.Generic.Dictionary[string,object]]) { return (New-JobVerdict $false 'params-type' $null) }
  $expectKeys = [string[]]@($script:ParamKeys[$type])
  if (-not (Test-KeySet $params $expectKeys)) { return (New-JobVerdict $false 'params-keys' $null) }
  foreach ($k in $expectKeys) {
    if (-not (Test-ParamValue $type $k $params[$k])) { return (New-JobVerdict $false ('params-value:' + $k) $null) }
  }
  if ($type -ceq 'sweep' -and ($params['ngl_list'].Count * $params['ctx_list'].Count) -gt 8) { return (New-JobVerdict $false 'params-value:combos' $null) }
  if ($NowEpoch -gt $e) { return (New-JobVerdict $false 'expired' $null) }
  if ($NowEpoch -lt ($c - $script:P6C.ClockSkewS)) { return (New-JobVerdict $false 'not-yet-valid' $null) }
  $h = $job['hmac']
  if (-not (($h -is [string]) -and ($h -cmatch '\A[0-9a-f]{64}\z'))) { return (New-JobVerdict $false 'hmac-format' $null) }
  $want = Get-HmacSha256Hex $KeyText (Get-CanonicalJobString $job)
  if (-not (Test-ConstantTimeEqual $h $want)) { return (New-JobVerdict $false 'hmac' $null) }
  if ($Seen.ContainsKey($id)) { return (New-JobVerdict $false 'replay' $null) }
  return (New-JobVerdict $true 'ok' $job)
}

# ----------------------------------------------------------------------------------------------------------------- suites
function Test-SuiteText {
  param([string]$Text)
  $pj = ConvertFrom-StrictJson -Text $Text -Rich
  if (-not $pj.Ok) { return 'suite-json' }
  $o = $pj.Value
  if (-not ($o.ContainsKey('schema') -and $o['schema'] -is [string] -and $o['schema'] -ceq $script:P6C.SchemaSuite)) { return 'suite-schema' }
  if (-not ($o.ContainsKey('name') -and $o['name'] -is [string] -and $o['name'] -cmatch '\A[a-z0-9][a-z0-9_-]{1,40}\z')) { return 'suite-name' }
  $prov = $null
  if ($o.ContainsKey('provenance')) { $prov = $o['provenance'] }
  if (-not ($prov -is [string] -and ($prov -ceq 'synthetic' -or $prov -ceq 'licensed'))) { return 'suite-provenance' }
  if ($prov -ceq 'licensed') {
    $lr = $null
    if ($o.ContainsKey('licence_ref')) { $lr = $o['licence_ref'] }
    if (-not ($lr -is [string] -and $lr.Length -ge 3 -and $lr.Length -le 200)) { return 'suite-licence-ref' }
  }
  $items = $null
  if ($o.ContainsKey('items')) { $items = $o['items'] }
  if ($items -isnot [System.Collections.ArrayList] -or $items.Count -lt 1 -or $items.Count -gt 50) { return 'suite-items' }
  $seen = @{}
  $total = 0
  foreach ($it in $items) {
    if ($it -isnot [System.Collections.Generic.Dictionary[string,object]] -or -not (Test-KeySet $it @('id', 'max_tokens', 'system', 'user'))) { return 'suite-item-keys' }
    $iid = $it['id']
    if (-not ($iid -is [string] -and $iid -cmatch '\A[A-Za-z0-9_-]{1,40}\z') -or $seen.ContainsKey($iid)) { return 'suite-item-id' }
    $seen[$iid] = $true
    $sy = $it['system']; $us = $it['user']
    if ($sy -isnot [string] -or $us -isnot [string] -or $sy.Length -gt 20000 -or $us.Length -gt 40000) { return 'suite-item-text' }
    $total = $total + $sy.Length + $us.Length
    if (-not (Test-IntRange $it['max_tokens'] 1 1024)) { return 'suite-item-max-tokens' }
  }
  if ($total -gt 400000) { return 'suite-too-large' }
  return 'ok'
}

# ----------------------------------------------------------------------------------------------------------------- gates
function Get-EstVramMiB {
  param([int]$Ngl, [int]$Ctx)
  return (600 + 135 * $Ngl + [int][math]::Floor($Ctx / 256) * $Ngl)
}

function Get-RequiredFreeVramMiB {
  param([int]$Ngl, [int]$Ctx)
  return ((Get-EstVramMiB $Ngl $Ctx) + $script:P6C.VramMarginMiB)
}

function Get-MinAvailRamGiB {
  param([int]$Ctx)
  return [math]::Round($script:P6C.RamBaseGiB + $script:P6C.RamPer4096GiB * ($Ctx - 4096) / 4096.0, 2)
}

function New-Check {
  param([string]$Name, [bool]$Pass, [string]$Detail)
  return @{ name = $Name; pass = $Pass; detail = $Detail }
}

# $M is a hashtable with: avail_ram_gib, vram_free_mib ($null = nvidia-smi unavailable), disk_free_gib, port_free, foreign_server, own_server, exe_ok, model_ok.
# Emits the @{ name; pass; detail } items one by one, in a fixed order (same names/order as start_gate_checks() in pilot_core.py).
# Callers ALWAYS wrap the call:  $checks = @(Get-StartGateChecks ...)  (a function result is unrolled; never return ,$list: that nests inside @() and -join).
function Get-StartGateChecks {
  param($M, [int]$Ngl, [int]$Ctx)
  $out = New-Object System.Collections.ArrayList
  $inRange = ($Ngl -ge 0 -and $Ngl -le $script:P6C.NglMax -and (@($script:P6C.CtxAllowed) -contains $Ctx))  # lint-ok numeric list
  [void]$out.Add((New-Check 'params-in-range' $inRange ('ngl=' + $Ngl + ' ctx=' + $Ctx)))
  [void]$out.Add((New-Check 'exe-matches-record' ([bool]$M.exe_ok) ''))
  [void]$out.Add((New-Check 'model-matches-record' ([bool]$M.model_ok) ''))
  $needRam = Get-MinAvailRamGiB $Ctx
  $r = $M.avail_ram_gib
  [void]$out.Add((New-Check 'ram' (($r -ne $null) -and ([double]$r -ge $needRam)) ('available=' + $r + ' need>=' + $needRam)))
  if ($M.vram_free_mib -eq $null) {
    [void]$out.Add((New-Check 'vram' ($Ngl -eq 0) 'nvidia-smi unavailable; only ngl=0 allowed'))
  } else {
    $need = Get-RequiredFreeVramMiB $Ngl $Ctx
    [void]$out.Add((New-Check 'vram' ([double]$M.vram_free_mib -ge $need) ('free=' + $M.vram_free_mib + ' need>=' + $need + ' est=' + (Get-EstVramMiB $Ngl $Ctx))))
  }
  $d = $M.disk_free_gib
  [void]$out.Add((New-Check 'disk' (($d -ne $null) -and ([double]$d -ge $script:P6C.DiskMinGiB)) ('free=' + $d + ' need>=' + $script:P6C.DiskMinGiB)))
  [void]$out.Add((New-Check 'port-free' ([bool]$M.port_free) ('port ' + $script:P6C.Port)))
  [void]$out.Add((New-Check 'no-foreign-server' (-not [bool]$M.foreign_server) ''))
  [void]$out.Add((New-Check 'no-own-server' (-not [bool]$M.own_server) ''))
  return $out
}

# Emits the names of the failed checks (nothing when none failed). Callers ALWAYS wrap the call:  $failed = @(Get-FailedCheckNames $checks)
# r5 had  return ,$f  here: the whole ArrayList travelled as ONE object, so  @(Get-FailedCheckNames ...) -join ','  printed 'System.Collections.ArrayList'.
function Get-FailedCheckNames {
  param($Checks)
  $f = New-Object System.Collections.ArrayList
  foreach ($c in $Checks) { if (-not $c.pass) { [void]$f.Add([string]$c.name) } }
  return $f
}

# Summarises the step results of a run (Invoke-PilotRun.ps1): ok / gate-refused / failed, and which gate checks refused. Pure logic; twin: run_outcome() in pilot_core.py.
# A gate refusal is an expected, clean outcome (nothing was started); anything else that is not ok/planned is a failure.
function Get-RunOutcome {
  param($Results)
  $refused = New-Object System.Collections.ArrayList
  $failed = $false
  foreach ($r in @($Results)) {
    $st = [string]$r.status
    if ($st -ceq 'gate-failed') {
      foreach ($c in @($r.checks)) { if ((-not $c.pass) -and ([string]$c.severity -ceq 'fail')) { [void]$refused.Add(([string]$r.type + ': ' + [string]$c.name + ' [' + [string]$c.detail + ']')) } }
    } elseif ($st -cne 'ok' -and $st -cne 'planned') { $failed = $true }
  }
  $outcome = 'ok'
  if ($failed) { $outcome = 'failed' } elseif ($refused.Count -gt 0) { $outcome = 'gate-refused' }
  return @{ Outcome = $outcome; Refused = @($refused) }
}

# ----------------------------------------------------------------------------------------------------------------- dry-run marker (pure)
# jobs\dryrun-complete.json. ONE marker file; counters and state belong to the run named by run_id (one run = one agent window or one Invoke-PilotRun),
# while types_ok and first_utc accumulate over all runs of the SAME agent version (a marker of another version never counts).
# Events: start (run begins), job (an accepted job finished), reject (a job file was rejected), end (the run is shutting down; EndReason says how).
# last_utc = the UTC time of the most recent marker write = the last job result, the last rejection, or the end of the run (whichever came last).
# event_seq counts the marker writes of the run (1 at start): it advances on every event even when last_utc (1-second resolution) does not.
# Twin: next_marker() / marker_problem() in pilot_core.py, cross-checked by vectors\marker-vectors.json. Nothing here touches the disk.
function Format-MarkerTime {
  param($V)
  if ($V -is [datetime]) { return $V.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) }
  return [string]$V
}

function Get-NextMarker {
  param($Old, [string]$Version, [string]$RunId, [string]$NowText, [string]$Event, [string]$Status, [string]$Type, [int]$JobsDone, [int]$JobsRejected, [string]$EndReason)
  $types = @{}
  $first = $NowText
  $seq = 1
  $runStart = $NowText
  if (($Old -ne $null) -and ([string]$Old.agent_version -ceq $Version)) {
    foreach ($t in @($Old.types_ok)) { if (($t -is [string]) -and $t.Length -gt 0) { $types[$t] = $true } }
    if ($Old.first_utc) { $first = Format-MarkerTime $Old.first_utc }
    if (([string]$Old.run_id -ceq $RunId) -and $Old.run_started_utc) {
      $seq = [int]$Old.event_seq + 1
      $runStart = Format-MarkerTime $Old.run_started_utc
    }
  }
  if (($Event -ceq 'job') -and ($Status -ceq 'ok' -or $Status -ceq 'planned') -and $Type.Length -gt 0) { $types[$Type] = $true }
  $state = 'running'
  $endedUtc = $null
  $endedWhy = $null
  if ($Event -ceq 'end') { $state = 'ended'; $endedUtc = $NowText; $endedWhy = $EndReason }
  return [ordered]@{
    schema = $script:P6C.MarkerSchema; marker_rev = $script:P6C.MarkerRev; agent_version = $Version; run_id = $RunId; state = $state
    run_started_utc = $runStart; first_utc = $first; last_utc = $NowText; event_seq = $seq; ended_utc = $endedUtc; end_reason = $endedWhy
    types_ok = @(Get-SortedKeys $types); jobs_done = $JobsDone; rejected_seen = $JobsRejected
  }
}

# '' when the marker agrees with the run's own counters, otherwise the first problem found: missing, run-id, state, rejected-count, jobs-done-count.
# This is the check that would have caught the r6 defect (marker rejected_seen 8 while the run had rejected 9) and a marker left over from an earlier run.
function Get-MarkerProblem {
  param($M, [string]$RunId, [string]$State, [int]$JobsDone, [int]$JobsRejected)
  if ($M -eq $null) { return 'missing' }
  if ([string]$M.run_id -cne $RunId) { return 'run-id' }
  if ([string]$M.state -cne $State) { return 'state' }
  if ([int]$M.rejected_seen -ne $JobsRejected) { return 'rejected-count' }
  if ([int]$M.jobs_done -ne $JobsDone) { return 'jobs-done-count' }
  return ''
}

# ----------------------------------------------------------------------------------------------------------------- emergency brake
function Test-LogFatal {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  $t = $Text.ToLowerInvariant()
  foreach ($p in $script:FatalLogPatterns) { if ($t.Contains($p)) { return $true } }
  return $false
}

function Test-ExternalRemote {
  param([string]$Address)
  return (@('127.0.0.1', '::1', '0.0.0.0', '::', '') -cnotcontains $Address)
}

# $S: hashtable with stop_file, lease_expired, listeners_loopback ($true/$false/$null), external_conns, avail_ram_gib ($null unknown),
# vram_used_mib ($null unknown), log_fatal, elapsed_s, budget_s, telemetry_unknown_streak, proc_alive.
# Returns the first trigger name, or $null when everything is within limits. Same order as brake_verdict() in pilot_core.py.
function Get-BrakeVerdict {
  param($S)
  if ($S.stop_file) { return 'stop-file' }
  if ($S.lease_expired) { return 'lease-expired' }
  if ($S.listeners_loopback -eq $false -and $S.listeners_loopback -ne $null) { return 'non-loopback-listener' }
  if ([int]$S.external_conns -gt 0) { return 'external-connection' }
  if ($S.avail_ram_gib -ne $null -and [double]$S.avail_ram_gib -lt $script:P6C.RamFloorGiB) { return 'ram-low' }
  if ($S.vram_used_mib -ne $null -and [double]$S.vram_used_mib -gt $script:P6C.VramHardLimitMiB) { return 'vram-high' }
  if ($S.log_fatal) { return 'server-log-fatal' }
  if ([double]$S.elapsed_s -gt [double]$S.budget_s) { return 'job-timeout' }
  if ([int]$S.telemetry_unknown_streak -ge 5) { return 'telemetry-lost' }
  if (-not $S.proc_alive) { return 'server-exited' }
  return $null
}

# ----------------------------------------------------------------------------------------------------------------- server command line
# Hardening (finding V1 of the Phase 6B run): API key from a key FILE (never on the command line), web UI off, slots endpoint off,
# CORS restricted to the server's own origin, no CORS credentials. Loopback only, one slot, explicit port.
function Get-ServerArgs {
  param([string]$ModelPath, [int]$Ngl, [int]$Ctx, [string]$KeyFile)
  return @('--model', $ModelPath, '--host', '127.0.0.1', '--port', [string]$script:P6C.Port, '--alias', 'qwen3-8b', '--ctx-size', [string]$Ctx,
    '--parallel', '1', '--n-gpu-layers', [string]$Ngl, '--jinja', '--api-key-file', $KeyFile, '--no-webui', '--no-slots',
    '--cors-origins', ('http://127.0.0.1:' + $script:P6C.Port), '--no-cors-credentials')
}
