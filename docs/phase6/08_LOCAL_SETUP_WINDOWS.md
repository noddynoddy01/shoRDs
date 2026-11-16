# Phase 6A / 08 (revised) – Instructions for approvals A and B only

**Replaces the earlier version of this file.** The earlier version also contained steps for installing Node.js and llama.cpp, downloading the model and starting a server. Those steps are withdrawn: do not use them. They will be re-issued, with corrected numbers, only after I have seen your `hardware-probe.json`.

**Status of what you are about to run:** `Probe-Hardware.ps1` and `Verify-Kit.ps1` were written for Windows PowerShell 5.1 but have **NOT BEEN EXECUTED** on any PowerShell by me (neither sandbox has PowerShell). I read them line by line for 5.1 problems and fixed two (a failure on a single-processor machine; a failure if `nvidia-smi` prints `[N/A]`), and checked for PowerShell-7-only syntax. That is review, not a test. Step 3 below lets you check the syntax on your own machine *without running the script*.

## What these steps change on your computer (it is a short list, and all of it is deletable)
| Step | File-system effect | Other effects |
|---|---|---|
| A: Step 1 | Creates two empty folders: `D:\llm` and `D:\llm\downloads` | none |
| B: Step 2 | Your browser saves `shords-pilot-kit.zip` (about 0.1 MB) into `D:\llm\downloads`; Windows may also attach a small "downloaded from the internet" marker to it and Defender may scan it | none |
| B: Step 2 | Extracting creates `D:\llm\shords-pilot-kit\` with 29 small files (about 0.3 MB in total) | none |
| B: Steps 4–5 | Run two PowerShell scripts. `Verify-Kit.ps1` only reads. `Probe-Hardware.ps1` only reads Windows information, but it **creates one file**, `D:\llm\shords-pilot-kit\hardware-probe.json` (a few KB) | The scripts run with `-ExecutionPolicy Bypass` for that one process only (no saved setting changes). PowerShell may keep the commands you type in its normal history file |
No network connection is made by either script. Nothing is installed. No registry, PATH, service, firewall or policy setting is changed. `D:\shords` is not touched. Undo: delete `D:\llm`.

The probe reads: memory, CPU, GPU (via `nvidia-smi`), free space on the model drive, Windows version, battery/AC state, which tools exist, and the **names** of the ten programs using most memory. It does not read documents, browser tabs, your user name or computer name. `-NoProcessList` leaves the program names out.

Use **Windows PowerShell** (blue window), not "PowerShell 7": check with `$PSVersionTable.PSVersion` (should print 5.1.x).

## Approval A – create the folders
```powershell
New-Item -ItemType Directory -Force -Path D:\llm\downloads | Out-Null
```
(If D: is not your intended model drive, or has less than about 25 GB free, tell me before going on; use another letter everywhere.)

## Approval B – get, check and run the kit
**Step 2. Get and unpack the kit.** Download `shords-pilot-kit.zip` from our chat into `D:\llm\downloads`. Its SHA-256 must be:
`ace5569915ebfffb05b61af7b108c4666fa8dc9167398be5f1c24ebfc2698f5c`
```powershell
(Get-FileHash D:\llm\downloads\shords-pilot-kit.zip -Algorithm SHA256).Hash.ToLower()
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot-kit.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot-kit
```
If the printed hash differs, stop and tell me. (If `Expand-Archive` complains, right-click the zip → Extract All → `D:\llm`.)

**Step 3. Check the scripts without running them (read-only).** Open `Probe-Hardware.ps1` in Notepad and read it if you wish (about 300 lines). To ask PowerShell 5.1's own parser whether it is syntactically valid, without executing anything:
```powershell
foreach ($f in 'Probe-Hardware.ps1','Verify-Kit.ps1') {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location).Path $f), [ref]$tokens, [ref]$errors)
  $f + ': ' + @($errors).Count + ' syntax errors'
}
```
Both lines must say `0 syntax errors`. If not, paste the messages to me and do not run the scripts.

**Step 4. Verify the kit's files.**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1
```
It must end with `Kit verified: 28 files match the manifest.`

**Step 5. Run the hardware probe.** Close your browsers and other heavy programs first if you want the best-case reading (and run it a second time later with them open if you like: both readings are useful).
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Probe-Hardware.ps1 -ModelDrive D
```
Read `hardware-probe.json` yourself, then send it to me. Add `-NoProcessList` to the command if you do not want program names in it.

## Then stop
Nothing else is requested. Do **not** download llama.cpp, Node.js or any model, do not start a server and do not put any paper into the kit. When I have your `hardware-probe.json` I will tell you whether the Qwen3-8B plan is comfortable on your machine and what to approve next (C–F), with the memory numbers and the starting GPU-offload setting checked against it. The starting offload will be provisional in any case: it will be set from llama.cpp's own loading log, not from my arithmetic.

Claude remains the production default. Nothing here touches production, Railway, secrets, Git, or `D:\shords`.
