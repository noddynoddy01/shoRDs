shoRDs Phase 6C file-mailbox bridge (local inference pilot), revision r6 - READ BEFORE ANYTHING ELSE

Status: written, statically checked and tested against a Python reference implementation (243 cross-language conformance cases, fuzzing, source-mirror
checks). The PowerShell has NEVER BEEN EXECUTED by its author on any PowerShell (none was available). The first execution is yours, in the
supervised dry run below. (r4 and r5 were run by the owner on Windows PowerShell 5.1 and each exposed a defect that no available tool could show; r6 fixes both and adds
Test-FileOps.ps1 for the second. r6 itself has still only been checked statically and by Python mirrors until you run it.) Nothing here runs by itself, installs anything, opens a port, starts the model server (dry run) or changes Windows settings.
r6 REPLACES r5 and r4 (r4: script parameter $Ctx collided with $script:Ctx; r5: gate lists came back as System.Collections.ArrayList and File.Replace threw
"The path is not of a legal form"; see CHANGELOG_r6.txt and CHANGELOG_r5.txt). r6 extracts to its own folder (shords-pilot6c-r6);
the r4 and r5 folders must not be used again and are left untouched. The r3 kit (shords-pilot6b-r3) is left untouched and still provides Step-D-Run.ps1 -Action Stop|Status.

PART 1 - verify the package (read-only; no agent, no server)
  1. Put the zip in D:\llm\downloads and compare its SHA-256 with the value in the approval package:
       Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r6.zip
  2. Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r6.zip -DestinationPath D:\llm
  3. cd D:\llm\shords-pilot6c-r6
  4. powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1       (every file against MANIFEST.sha256.txt)
  5. powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1      (syntax only; runs nothing)
  6. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1  (pure-logic self-test against the vectors; no disk writes, no network, no process)
  7. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 (the r4 regression: binds parameters of Invoke-PilotRun.ps1 / Pilot-Agent.ps1 in child
     Windows PowerShell processes with -BindingTest, which stops before any folder, file, process or network action; checks defaults, 4096/8192/12288, the -Ctx alias,
     invalid values, and -Mode spelling)
  8. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1    (r6: the file-handling regression. Works ONLY inside one new folder under %TEMP%
     (shords-6c-selftest-xxxxxxxx) that it deletes at the end: atomic file replace three times in a row (the r5 crash), lease, audit, dry-run marker, and a
     dry-run pass over the inbox with signed, badly signed and replayed jobs. It starts no program, opens no port, sends no request, never touches D:\llm.)
  Optional: Test-AgentLogic.ps1 -WithJobGuard   (also compiles the kill-on-close job object; writes one temp file in %TEMP%; starts no process)
  Stop and report if any of them prints a problem. Paste the output into the chat.

PART 2 - supervised dry run (needs the separate approval for the dry run; phrase typed by you at the prompt: APPROVE E-DRYRUN)
  Dry run = real measurements (RAM, VRAM, disk, port 8080, SHA-256 of the files from Step C/D), job validation and planning.
  It does NOT start llama-server, does NOT send any HTTP request, does NOT use the model.
  2a. One-command run (simplest):
       powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096
      (-Ctx still works as an alias of -ContextSize.)
      Result: D:\llm\runs\<run id>\report.json  (steps preflight, verify-integrity quick, server-start, health, server-stop; the server steps say "planned").
      Exit codes of Invoke-PilotRun.ps1: 0 = ok; 1 = a step failed or the run stopped with an error; 2/3/4 = refused before starting (setup problem, STOP file, Live not allowed);
      exit code 5 = REFUSED BY A RESOURCE GATE (for example not enough free RAM): nothing was started, the report is still written, the screen shows
      "RESULT: REFUSED BY A RESOURCE GATE" and lists the refused checks. That is the tool working as designed, not a crash. Close programs and run it again.
  2b. Agent run (exercises all eight job types; Claude sends the test jobs):
       powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 1
      Leave the window open and tell Claude in the chat. Stop it at any time: Ctrl+C, close the window, or create an empty file D:\llm\jobs\STOP .
      Claude then sends the battery (9 valid jobs and 9 deliberately bad ones) and reports. No job can carry a command; unknown or bad jobs are rejected with a reason.
  Acceptance (all must hold):
    - Get-Process llama-server -ErrorAction SilentlyContinue   prints nothing
    - netstat -ano | findstr ":8080"                            prints nothing
    - D:\llm\jobs\dryrun-complete.json exists (2b: types_ok lists all eight types)
    - D:\llm\jobs\audit.jsonl has agent-start and agent-end lines and no "emergency" line (and, in 2b, no "cycle-error" line)
    - 2b battery: every positive job has the expected status and every negative job is rejected with the expected reason
  Files the dry run creates (all under D:\llm, all removable with Rollback-6C.ps1): folders jobs\{inbox,work,outbox,rejected,archive}, runs, secrets, suites, logs,
  health; jobs\audit.jsonl, jobs\seen-ids.txt, jobs\.session-key, jobs\agent.lease.json, jobs\dryrun-complete.json, outbox\*.json, runs\<id>\report.json,
  secrets\dryrun.key (throw-away), suites\synthetic-v1.json (2b), health\health-agent-*.json (none in a dry run).

PART 3 - rollback / undo
  List first:       powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback-6C.ps1 -Scope All -List
  Remove (typed DELETE):  ... .\Rollback-6C.ps1 -Scope All      (Scopes: Jobs, Runs, Secrets, Suites, Logs, All; never recursive; never touches llama.cpp, the model, downloads, install-record.json)
  Remove the extracted kit: delete the folder D:\llm\shords-pilot6c-r6 yourself (File Explorer).
  If a server is ever running by mistake:  powershell -NoProfile -ExecutionPolicy Bypass -File D:\llm\shords-pilot6b-r3\Step-D-Run.ps1 -Action Stop

NOT AUTHORISED BY THIS PACKAGE: -Mode Live (starts the local server through the agent). It refuses to run without a completed dry run of this exact version and the
phrase APPROVE E-LIVE, and it needs its own approval in the chat. Do not run it before that.
