# Phase 6A / 09 (revised) – Approval request: A and B only

**Replaces the earlier version of this file.** The earlier version listed approvals C–F (runtime, model, server) as well. Those are withdrawn from this request. I am not asking for them, and I will not recommend them until I have your `hardware-probe.json`. Please do not act on the earlier C–F lines.

Everything below changes files on your computer. None of it is destructive and all of it can be undone by deleting `D:\llm`, but each item is a file-system change, and B also *runs* a script. Reply with "approve A and B", or tell me which one you decline.

| ID | What you would do | File-system changes | Size | Network | Undo |
|---|---|---|---|---|---|
| **A** | Create two empty folders | creates `D:\llm` and `D:\llm\downloads` | 0 | none | delete `D:\llm` |
| **B** | Download the kit zip **from our chat** (a browser download; no download by me) → verify its hash → extract → check syntax and file integrity → run the hardware probe | writes `shords-pilot-kit.zip` into `D:\llm\downloads` (Windows may add a download marker; Defender may scan it); creates `D:\llm\shords-pilot-kit\` with 29 files; the probe **writes `hardware-probe.json`** (a few KB) into that folder | about 0.1 MB zip, 0.3 MB extracted, a few KB JSON | none (the scripts open no connection) | delete `D:\llm` |

Details of B you should know before approving:
- It **executes two PowerShell scripts** (`Verify-Kit.ps1`, `Probe-Hardware.ps1`) with `-ExecutionPolicy Bypass` for that single process. That overrides your script-signing policy for that process only; no setting is saved. You can read both scripts first (Notepad), and step 3 of the instructions checks their syntax without running them.
- **Both scripts are NOT EXECUTED by me on PowerShell 5.1 or any PowerShell.** I have reviewed them and fixed two problems found by reading, but a first real run could still fail. A failure would leave at most a missing or partial `hardware-probe.json`; it cannot change anything else on the computer.
- The probe reads memory, CPU, GPU, disk, Windows version, power state, tool availability and the *names* of the ten largest-memory programs. It sends nothing anywhere. Use `-NoProcessList` to omit program names.
- PowerShell may record the commands you type in its normal history file.

## Not requested now (information only, no instructions yet)
Installing or downloading Node.js, llama.cpp or any model weights; starting a model server; placing or processing papers; any use of a GPU by the pilot. These come later, one at a time, each with its own approval, after I have read your probe results.

## What I will do with the probe results (no action on your side)
I will check the available RAM and free VRAM against the Qwen3-8B plan (about 7.0 GiB of RAM and about 2.3 GiB of VRAM at the provisional offload; see `07`, section 5), confirm or change the model, and propose the next approval step. The starting GPU-offload setting will be provisional and will be tuned from llama.cpp's loading log.

## Controls that stay in force
- Claude remains the production default; nothing here touches production, Railway, a database or any secret.
- Nothing is committed, pushed, merged or deployed; `D:\shords` is not modified.
- No paid inference, no GPU rental, no purchases. Local-only: the pilot driver refuses any non-loopback model address.
- Papers: only ones you licence-confirm later; no fictional papers as evidence; no restricted material.
- Spend, licence and validation controls are unchanged.
