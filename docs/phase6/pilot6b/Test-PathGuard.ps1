<#
.SYNOPSIS
  Self-test of the path-safety check in Phase6B.Common.ps1. Windows PowerShell 5.1. Read-only: it only compares text and uses fake
  "exists" and "is a junction" answers, so it does not touch the disk, the network or anything under D:\llm. It runs no step script.
  Exit code 0 = every case behaved as expected.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-PathGuard.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = 'D:\llm'
. (Join-Path $PSScriptRoot 'Phase6B.Common.ps1')

$script:fail = 0
$script:total = 0
$noneExists = { param($p) $false }
$allExist = { param($p) $true }
$noReparse = { param($p) $false }

function Test-Case {
  param([string]$Name, [string]$Path, [string]$RootPath, [bool]$ExpectOk, [scriptblock]$Exists = $allExist, [scriptblock]$IsReparse = $noReparse, [string]$ExpectCanon = '')
  $script:total++
  $ok = $false; $canon = ''; $err = ''
  try { $canon = Resolve-UnderRoot -Path $Path -Root $RootPath -Exists $Exists -IsReparse $IsReparse; $ok = $true } catch { $err = $_.Exception.Message }
  $pass = ($ok -eq $ExpectOk)
  if ($pass -and $ExpectOk -and $ExpectCanon -ne '' -and $canon -cne $ExpectCanon) { $pass = $false; $err = 'accepted but canonical form was ' + $canon + ' (expected ' + $ExpectCanon + ')' }
  if ($pass) { Write-Host ('PASS  ' + $Name) }
  else { $script:fail++; Write-Host ('FAIL  ' + $Name + '  [' + $(if ($ok) { 'accepted ' + $canon } else { 'refused: ' + $err }) + ']') }
}

# --- must be ACCEPTED -------------------------------------------------------------------------------------------------------------
Test-Case 'root itself'                         'D:\llm'                          'D:\llm' $true $allExist $noReparse 'D:\llm'
Test-Case 'root with trailing backslash'        'D:\llm\'                         'D:\llm' $true $allExist $noReparse 'D:\llm'
Test-Case 'root given with trailing backslash'  'D:\llm'                          'D:\llm\' $true
Test-Case 'downloads folder'                    'D:\llm\downloads'                'D:\llm' $true $allExist $noReparse 'D:\llm\downloads'
Test-Case 'models folder'                       'D:\llm\models'                   'D:\llm' $true $allExist $noReparse 'D:\llm\models'
Test-Case 'model file'                          'D:\llm\models\Qwen3-8B-Q4_K_M.gguf' 'D:\llm' $true
Test-Case 'part file'                           'D:\llm\downloads\x.zip.part'     'D:\llm' $true
Test-Case 'lower-case drive and root'           'd:\llm\models'                   'D:\LLM' $true $allExist $noReparse 'D:\llm\models'
Test-Case 'upper-case path under lower root'    'D:\LLM\MODELS\X.GGUF'            'd:\llm' $true
Test-Case 'forward slashes'                     'D:/llm/models'                   'D:\llm' $true $allExist $noReparse 'D:\llm\models'
Test-Case 'doubled separators'                  'D:\llm\\downloads'               'D:\llm' $true $allExist $noReparse 'D:\llm\downloads'
Test-Case 'dot segment'                         'D:\llm\.\downloads'              'D:\llm' $true $allExist $noReparse 'D:\llm\downloads'
Test-Case 'parent segment that stays inside'    'D:\llm\a\..\models'              'D:\llm' $true $allExist $noReparse 'D:\llm\models'
Test-Case 'not yet existing child'              'D:\llm\logs\new.txt'             'D:\llm' $true $noneExists
Test-Case 'root given with forward slash/case'  'D:\llm\models'                   'd:/LLM/' $true

# --- must be REFUSED --------------------------------------------------------------------------------------------------------------
Test-Case 'sibling with same prefix: llm-evil'  'D:\llm-evil'                     'D:\llm' $false
Test-Case 'sibling prefix, child'               'D:\llm-evil\models'              'D:\llm' $false
Test-Case 'sibling prefix: llmx'                'D:\llmx'                         'D:\llm' $false
Test-Case 'other folder'                        'D:\other'                        'D:\llm' $false
Test-Case 'drive root'                          'D:\'                             'D:\llm' $false
Test-Case 'other drive'                         'E:\llm'                          'D:\llm' $false
Test-Case 'parent traversal to sibling'         'D:\llm\..\other'                 'D:\llm' $false
Test-Case 'parent traversal to prefix sibling'  'D:\llm\..\llm-evil'              'D:\llm' $false
Test-Case 'parent traversal to parent'          'D:\llm\..'                       'D:\llm' $false
Test-Case 'traversal above the drive'           'D:\llm\..\..\..\x'               'D:\llm' $false
Test-Case 'traversal case-mixed'                'D:\LLM\..\Windows'               'D:\llm' $false
Test-Case 'drive-relative'                      'D:llm\models'                    'D:\llm' $false
Test-Case 'relative path'                       'llm\models'                      'D:\llm' $false
Test-Case 'rooted without drive'                '\llm\models'                     'D:\llm' $false
Test-Case 'UNC path'                            '\\server\share\llm'              'D:\llm' $false
Test-Case 'device path \\?\'                    '\\?\D:\llm\models'               'D:\llm' $false
Test-Case 'device path \\.\'                    '\\.\D:\llm\models'               'D:\llm' $false
Test-Case 'alternate data stream'               'D:\llm\x.txt:evil'               'D:\llm' $false
Test-Case 'trailing dot segment'                'D:\llm\x.'                       'D:\llm' $false
Test-Case 'trailing space segment'              'D:\llm\x '                       'D:\llm' $false
Test-Case 'wildcard'                            'D:\llm\a*b'                      'D:\llm' $false
Test-Case 'non-ASCII'                           ('D:\llm\' + [string][char]0x00FC) 'D:\llm' $false
Test-Case 'empty path'                          ''                                'D:\llm' $false
Test-Case 'whole drive as root'                 'D:\llm'                          'D:\' $false
Test-Case 'relative root'                       'D:\llm'                          'llm' $false

# --- reserved Windows device names (added in r3) ----------------------------------------------------------------------------------
Test-Case 'device name CON'                     'D:\llm\CON'                      'D:\llm' $false
Test-Case 'device name nul with extension'      'D:\llm\nul.txt'                  'D:\llm' $false
Test-Case 'device name com1 lower-case'         'D:\llm\logs\com1'                'D:\llm' $false
Test-Case 'device name LPT9 with extension'     'D:\llm\Lpt9.gguf'                'D:\llm' $false
Test-Case 'device name CONIN$'                  'D:\llm\conin$'                   'D:\llm' $false
Test-Case 'name that only starts like a device' 'D:\llm\console.txt'              'D:\llm' $true
Test-Case 'com10 is not a device name'          'D:\llm\com10'                    'D:\llm' $true
Test-Case 'communal is not a device name'       'D:\llm\communal\x.dll'           'D:\llm' $true

# --- junctions / symbolic links (fake answers) ------------------------------------------------------------------------------------
$reparseDownloads = { param($p) $p -ieq 'D:\llm\downloads' }
$reparseRoot = { param($p) $p -ieq 'D:\llm' }
$reparseLeaf = { param($p) $p -ieq 'D:\llm\models\Qwen3-8B-Q4_K_M.gguf' }
Test-Case 'link: folder below root is a junction (the folder)'    'D:\llm\downloads'            'D:\llm' $false $allExist $reparseDownloads
Test-Case 'link: folder below root is a junction (file inside)'   'D:\llm\downloads\x.zip'      'D:\llm' $false $allExist $reparseDownloads
Test-Case 'link: junction, lower-case spelling of the path'       'd:\LLM\Downloads\x.zip'      'D:\llm' $false $allExist $reparseDownloads
Test-Case 'link: root itself is a junction'                       'D:\llm\models'               'D:\llm' $false $allExist $reparseRoot
Test-Case 'link: file is a symbolic link'                         'D:\llm\models\Qwen3-8B-Q4_K_M.gguf' 'D:\llm' $false $allExist $reparseLeaf
Test-Case 'link: unrelated folder is a junction, ours is fine'    'D:\llm\models'               'D:\llm' $true  $allExist $reparseDownloads
Test-Case 'link: junction on a part that does not exist yet'      'D:\llm\downloads\x.zip'      'D:\llm' $true  $noneExists $reparseDownloads

# --- archive entry names (Test-ZipEntryName, used by Step D Install before anything is extracted) --------------------------------------
function Test-ZipCase {
  param([string]$Name, [string]$Entry, [bool]$ExpectOk)
  $script:total++
  $ok = $false; $err = ''
  try { [void](Test-ZipEntryName -Name $Entry -DestCanon 'D:\llm\llama.cpp\b11669'); $ok = $true } catch { $err = $_.Exception.Message }
  if ($ok -eq $ExpectOk) { Write-Host ('PASS  zip: ' + $Name) }
  else { $script:fail++; Write-Host ('FAIL  zip: ' + $Name + '  [' + $(if ($ok) { 'accepted' } else { 'refused: ' + $err }) + ']') }
}
Test-ZipCase 'plain file'                       'llama-server.exe'                $true
Test-ZipCase 'file in sub-folder (slash)'       'bin/ggml-cuda.dll'               $true
Test-ZipCase 'file in sub-folder (backslash)'   'bin\ggml-cuda.dll'               $true
Test-ZipCase 'folder entry'                     'bin/'                            $true
Test-ZipCase 'doubled slash'                    'bin//x.dll'                      $true
Test-ZipCase 'com10 file name'                  'bin/com10.dll'                   $true
Test-ZipCase 'parent traversal'                 '../evil.dll'                     $false
Test-ZipCase 'traversal in the middle'          'a/../../evil.dll'                $false
Test-ZipCase 'traversal that stays inside'      'a/../b.dll'                      $false
Test-ZipCase 'backslash traversal'              '..\evil.dll'                     $false
Test-ZipCase 'absolute with slash'              '/evil.dll'                       $false
Test-ZipCase 'absolute with backslash'          '\evil.dll'                       $false
Test-ZipCase 'drive letter'                     'C:\Windows\evil.dll'             $false
Test-ZipCase 'alternate data stream'            'x.dll:stream'                    $false
Test-ZipCase 'device name CON'                  'CON'                             $false
Test-ZipCase 'device name aux with extension'   'bin/aux.dll'                     $false
Test-ZipCase 'device name LPT1'                 'LPT1.dll'                        $false
Test-ZipCase 'trailing dot'                     'bin/x.'                          $false
Test-ZipCase 'trailing space'                   'bin/x '                          $false
Test-ZipCase 'wildcard'                         'bin/*.dll'                       $false
Test-ZipCase 'non-ASCII name'                   ('bin/' + [string][char]0x00FC + '.dll') $false
Test-ZipCase 'empty name'                       ''                                $false

# --- the exact failure seen in the first Step C run: the configured folders from Phase6B.Common.ps1 --------------------------------
foreach ($d in @($script:Cfg.Root, $script:Cfg.Downloads, $script:Cfg.Models, $script:Cfg.LlamaDir, $script:Cfg.Logs, $script:Cfg.Health, $script:Cfg.Marker, $script:Cfg.InstallRecord, $script:Cfg.PidFile)) {
  Test-Case ('configured path ' + $d) $d $script:Cfg.Root $true
}
foreach ($a in $script:Artifacts) { Test-Case ('artifact ' + $a.File) (Get-ArtifactPath $a) $script:Cfg.Root $true }

Write-Host ''
if ($script:fail -eq 0) { Write-Host ('All ' + $script:total + ' path-guard cases behaved as expected. (Nothing on disk was read or changed.)'); exit 0 }
Write-Host ($script:fail.ToString() + ' of ' + $script:total + ' cases failed. Do not run step C; send me this output.')
exit 1
