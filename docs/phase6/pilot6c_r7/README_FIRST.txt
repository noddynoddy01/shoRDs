shoRDs Phase 6C file-mailbox bridge (local inference pilot), revision r7 - READ BEFORE ANYTHING ELSE

Status: written, statically checked and tested against a Python reference implementation (243 cross-language conformance cases, fuzzing, source-mirror
checks). The PowerShell has NEVER BEEN EXECUTED by its author on any PowerShell (none was available). The first execution is yours, in the
supervised dry run below. (r4, r5 and r6 were run by the owner on Windows PowerShell 5.1 and each exposed a defect that no available tool could show; r7 fixes the last
one, a completion-marker inconsistency, and extends Test-AgentLogic.ps1 and Test-FileOps.ps1 for it. r7 itself has only been checked statically and by Python mirrors until you run it.) Nothing here runs by itself, installs anything, opens a port, starts the model server (dry run) or changes Windows settings.
r7 REPLACES r6, r5 and r4 (r4: script parameter $Ctx collided with $script:Ctx; r5: gate lists came back as System.Collections.ArrayList and File.Replace threw
"The path is not of a legal form"; r6: jobs\dryrun-complete.json missed the last rejection and the end of the run; see CHANGELOG_r7.txt, _r6 and _r5). r7 extracts to its own
folder (shords-pilot6c-r7); the r4, r5 and r6 folders must not be used again and are left untouched. The r3 kit (shords-pilot6b-r3) is left untouched and still provides Step-D-Run.ps1 -Action Stop|Status.

PART 1 - verify the package (read-only; no agent, no server)
  1. Put the zip in D:\llm\downloads and compare its SHA-256 with the value in the approval package:
       Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r7.zip
  2. Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r7.zip -DestinationPath D:\llm
  3. cd D:\llm\shords-pilot6c-r7
  4. powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1       (every file against MANIFEST.sha256.txt)
  5. powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1      (syntax only; runs nothing)
  6. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1  (pure-logic self-test against the vectors; no disk writes, no network, no process)
  7. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 (the r4 regression: binds parameters of Invoke-PilotRun.ps1 / Pilot-Agent.ps1 in child
     Windows PowerShell processes with -BindingTest, which stops before any folder, file, process or network action; checks defaults, 4096/8192/12288, the -Ctx alias,
     invalid values, and -Mode spelling)
  8. powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1    (r6/r7: the file-handling and completion-marker regression. Works ONLY inside one new
     folder under %TEMP% (shords-6c-selftest-xxxxxxxx) that it deletes at the end: atomic file replace three times in a row (the r5 crash), lease, audit, and the dry-run
     marker through three runs: eight and then nine rejected jobs (rejected_seen 8, then 9 with the replay), the end of a run (lease expiry and the Ctrl+C routine), a
     second run that must not look like the first, and a marker write that fails (the file is locked) being reported. It starts no program, opens no port, sends no
     request, never touches D:\llm.)
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
      Exit code 6 (r7, also Pilot-Agent.ps1) = the dry-run marker jobs\dryrun-complete.json could not be written or did not match what the run did; the message says so.
  2b. Agent run (exercises all eight job types; Claude sends the test jobs):
       powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 1
      Leave the window open and tell Claude in the chat. Stop it at any time: Ctrl+C, close the window, or create an empty file D:\llm\jobs\STOP .
      Claude then sends the battery (9 valid jobs and 9 deliberately bad ones) and reports. No job can carry a command; unknown or bad jobs are rejected with a reason.
  Acceptance (all must hold):
    - Get-Process llama-server -ErrorAction SilentlyContinue   prints nothing
    - netstat -ano | findstr ":8080"                            prints nothing
    - D:\llm\jobs\dryrun-complete.json exists (2b: types_ok lists all eight types). r7: it names the run (run_id, the same value as in agent.lease.json and in the
      agent-start / agent-end audit lines), state is "ended" once the agent has exited, end_reason says how (lease-ended, stop-file, cycle-errors, aborted = Ctrl+C or an error),
      rejected_seen equals jobs_rejected in the lease and the number of job-rejected audit lines, jobs_done equals jobs_done in the lease, and last_utc is the time of
      the final event (the last job, the last rejection or the end of the run). If the window was closed instead of stopped, the state stays "running" and no end_reason is set.
    - D:\llm\jobs\audit.jsonl has agent-start and agent-end lines and no "emergency" line (and, in 2b, no "cycle-error" and no "marker-error" line)
    - 2b battery: every positive job has the expected status and every negative job is rejected with the expected reason
  Files the dry run creates (all under D:\llm, all removable with Rollback-6C.ps1): folders jobs\{inbox,work,outbox,rejected,archive}, runs, secrets, suites, logs,
  health; jobs\audit.jsonl, jobs\seen-ids.txt, jobs\.session-key, jobs\agent.lease.json, jobs\dryrun-complete.json, outbox\*.json, runs\<id>\report.json,
  secrets\dryrun.key (throw-away), suites\synthetic-v1.json (2b), health\health-agent-*.json (none in a dry run).

PART 3 - rollback / undo
  List first:       powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback-6C.ps1 -Scope All -List
  Remove (typed DELETE):  ... .\Rollback-6C.ps1 -Scope All      (Scopes: Jobs, Runs, Secrets, Suites, Logs, All; never recursive; never touches llama.cpp, the model, downloads, install-record.json)
  Remove the extracted kit: delete the folder D:\llm\shords-pilot6c-r7 yourself (File Explorer).
  If a server is ever running by mistake:  powershell -NoProfile -ExecutionPolicy Bypass -File D:\llm\shords-pilot6b-r3\Step-D-Run.ps1 -Action Stop

NOT AUTHORISED BY THIS PACKAGE: -Mode Live (starts the local server through the agent). It refuses to run without a completed dry run of this exact version and the
phrase APPROVE E-LIVE, and it needs its own approval in the chat. Do not run it before that.
