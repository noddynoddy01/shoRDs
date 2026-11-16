shoRDs Phase 6B scripts (local inference pilot), revision r3 - READ BEFORE ANYTHING ELSE

Status: written and statically checked, NOT EXECUTED by their author on any PowerShell. Nothing here runs by itself.
r3 extracts to its own folder (shords-pilot6b-r3); the earlier shords-pilot6b and shords-pilot6b-r2 folders are left untouched and must not be used.

1. Put the zip in D:\llm\downloads, check its SHA-256 against the value in the approval package, extract it into D:\llm.
2. cd D:\llm\shords-pilot6b-r3
3. powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1        (checks every file against MANIFEST.sha256.txt)
4. powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1       (syntax check only; runs nothing)
5. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-PathGuard.ps1    (path-safety self-test; touches no disk, runs no step)
Stop if any of them prints a problem.

Steps (each needs its own approval phrase typed by you at the prompt):
  Step-C-Acquire.ps1 -Action Preflight|Verify   read-only          (Step C is already done and verified)
  Step-D-Run.ps1 -Action Prereq                 read-only          (Visual C++ runtime, RAM, VRAM, port, Step C files)
  Step-D-Run.ps1 -Action Install                needs  APPROVE D   (extracts the zips, runs llama-server.exe --version/--help once)
  Step-D-Run.ps1 -Action Start                  needs  APPROVE D   (launches the local server on 127.0.0.1:8080 only)
  Step-D-Run.ps1 -Action Health                 talks only to 127.0.0.1
  Step-D-Run.ps1 -Action Stop|Status
  Rollback.ps1 -Scope Server|Install|Logs|StepD|Models|Downloads|All [-List]      needs  DELETE  (except -List and Server)
     StepD = the full undo of Step D; it never touches the downloaded zips or the model.

Do not run Step D until the owner has approved it in the chat.
