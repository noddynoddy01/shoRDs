# shoRDs on Ubuntu - how to continue Phase 6 (2026-11-05)

**Status of this guide.** I wrote it from our pinned Phase 6 documents and from the project files. **I ran none of the Ubuntu commands** (my environment has no GPU and is not your machine). What I did verify: the code transfer (section 2) by applying it to a copy of `origin/p0-fixes` and comparing every file, and the existence, sizes and SHA-256 values of the llama.cpp b11669 Linux assets on the GitHub release page. Items I could not check are marked **UNVERIFIED**.

## 0. What changes when you leave Windows

| | On Ubuntu |
|---|---|
| Windows PowerShell kit (Phase 6C r4-r8: `Pilot-Agent.ps1`, `Test-FileOps.ps1`, the `D:\llm\jobs` mailbox) | **Not used.** It depends on Windows APIs and paths. It stays in the repo as an archive. The pending r8 Test-FileOps result no longer blocks anything. |
| Node pipeline (`backend/native`), `scripts/native_pilot.js` (probe, server, run, report), the tests | **Unchanged and cross-platform.** The probe already handles Linux (`nvidia-smi`, `/proc`-style info via Node `os`). |
| Python reference (`pilot_core.py`, `pilot_submit.py`) | Stays as the specification of the job protocol. Only needed if the mailbox bridge is ever ported. |
| llama.cpp + Qwen3-8B Q4_K_M pins | Same model and revision; llama.cpp **b11669** has Linux builds (CUDA 12.8 and 13.4). |
| How I drive the local model | **Recommended: run Claude Code on the Ubuntu machine** (section 7). It can run `node`, `llama-server` and the pilot directly, asking you before each command, so the file mailbox is not needed. The alternative (me in the cloud, a Linux bridge) is a new build task; say so if you want it. |

Hardware as recorded earlier: Core i5-12450H, 16 GB RAM, RTX 3050 Laptop 4 GB. Everything below assumes the same laptop and Ubuntu 22.04 or 24.04. **Tell me the output of `lsb_release -a` if it differs.**

## 1. Check the machine (read-only)

```bash
lsb_release -a; uname -r
nvidia-smi                      # driver version, VRAM used at idle
lspci | grep -Ei "vga|3d"      # should list the Intel iGPU and the NVIDIA GPU
free -h; df -h ~               # want >= 25 GB free for the model, builds and downloads
```
* **No `nvidia-smi` / driver missing:** `ubuntu-drivers devices`, then `sudo ubuntu-drivers install`, reboot. If Secure Boot is on, the installer asks you to enrol a key (MOK) at the next boot - follow it.
* The CUDA 12.8 build needs an NVIDIA driver **570 or newer** (UNVERIFIED for your exact driver; `nvidia-smi` shows it). Ubuntu normally installs a newer one.
* Keep the desktop on the Intel GPU so the 4 GB stays free for the model: `prime-select query` should say `on-demand` (`sudo prime-select on-demand` if not). Compare `nvidia-smi` idle memory with what you saw on Windows.
* Fallbacks if CUDA misbehaves: the same release has `llama-b11669-bin-ubuntu-vulkan-x64.tar.gz` (29 MB) and a CPU build `...-ubuntu-x64.tar.gz` (17 MB).

## 2. Get the code (nothing is pushed or committed)

All Phase 2-6 work (native pipeline, pilot driver, tests, docs) exists **only in my working copy**; GitHub has `main` and an older `p0-fixes`. Two ways:

**A. Tarball (ready now).** Download the three files from our chat to `~/Downloads`:
`shords-worktree-2026-11-05.tar.gz` (about 9.4 MB; its SHA-256 is in my chat message, because this guide is inside the archive and cannot contain its own hash) and `apply-worktree.sh` (SHA-256 `563df7cd634456dda675c7f67b7e7245c4cd409c64e451703ce2056cbef18ee2`).
```bash
sudo apt update && sudo apt install -y git curl ca-certificates xz-utils python3 poppler-utils
cd ~/Downloads && sha256sum shords-worktree-2026-11-05.tar.gz apply-worktree.sh      # compare with the values in my message / above
mkdir -p ~/src && cd ~/src
git clone https://github.com/noddynoddy01/shoRDs.git && cd shoRDs
git checkout -b phase6-ubuntu origin/p0-fixes
bash ~/Downloads/apply-worktree.sh ~/Downloads/shords-worktree-2026-11-05.tar.gz       # expect: done: ~170 changed paths (nothing committed, nothing pushed)
```
The tarball holds every tracked and untracked, non-ignored file (no `.git`, no `node_modules`, no `.env`, no `dump.rdb`; I scanned it for key patterns and found only a documentation line) plus a list of the 13 files that were deleted. I applied it to a copy of `origin/p0-fixes` and the result matched my working tree file for file.

**B. GitHub.** If you prefer, approve in chat that I commit this work to a **new branch** (for example `phase6-native-pilot`) and push it; then Ubuntu only needs `git clone` + `git checkout phase6-native-pilot`. I will not do this without your explicit yes.

## 3. Node 22, dependencies, baseline test

```bash
cd ~/Downloads
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o SHASUMS256.txt
f=$(grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' SHASUMS256.txt | head -1); echo "$f"
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$f"
grep " $f\$" SHASUMS256.txt | sha256sum -c -                       # must print: ...: OK
mkdir -p ~/opt && tar -xJf "$f" -C ~/opt
echo "export PATH=\$HOME/opt/${f%.tar.xz}/bin:\$PATH" >> ~/.bashrc && source ~/.bashrc
node --version                                                       # v22.x
cd ~/src/shoRDs && npm ci                                            # large (Expo app); a few minutes
npm run test:node 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail|todo)"
```
Expected, as measured here on Node 22 and 24: **638 tests, 637 pass, 0 fail, 1 todo.** If this differs, stop and send me the output before touching the model.

## 4. llama.cpp b11669 (CUDA 12.8) and the model - 3 downloads, about 5.9 GB

These are the only downloads; each is checked against a published hash. Do them only when you are ready (they are the Phase 6 "approval C/D" equivalent).
```bash
mkdir -p ~/llm/downloads ~/llm/models ~/llm/llama.cpp/b11669 && cd ~/llm/downloads
B=https://github.com/ggml-org/llama.cpp/releases/download/b11669
curl -fLO $B/llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz                   # 165 MB
curl -fLO $B/cudart-llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz            # 567 MB (CUDA runtime libraries; no CUDA toolkit install needed)
sha256sum -c - <<'H'
4703ed1a3cd6e8504affb6cb9866f501e96d634d68a002dc9a8251c9e2819b49  llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz
ab3eda89a82096bcba00b6448218c3c11eec2016b0f38d64884dc29736549f26  cudart-llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz
H
tar -xzf llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz        -C ~/llm/llama.cpp/b11669
tar -xzf cudart-llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz -C ~/llm/llama.cpp/b11669
find ~/llm/llama.cpp/b11669 -name llama-server                  # note the folder it prints = $BIN
# UNVERIFIED: I have not opened these archives. If ldd reports "not found", add the folder that holds the .so files:
#   export LD_LIBRARY_PATH="$BIN:$LD_LIBRARY_PATH";   ldd "$BIN/llama-server" | grep "not found"

curl -fL -C - -o ~/llm/models/Qwen3-8B-Q4_K_M.gguf.part \
  "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf"      # 5,027,783,488 bytes
echo "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785  $HOME/llm/models/Qwen3-8B-Q4_K_M.gguf.part" | sha256sum -c -
mv ~/llm/models/Qwen3-8B-Q4_K_M.gguf.part ~/llm/models/Qwen3-8B-Q4_K_M.gguf
```
Model licence: Apache-2.0 (as recorded in the Phase 6 documents). Keep `~/llm` outside the repository; never commit models or binaries.

## 5. Start the server (loopback only) and tune GPU layers

```bash
"$BIN/llama-server" --model ~/llm/models/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 \
  --alias qwen3-8b --ctx-size 4096 --parallel 1 --n-gpu-layers 16 --jinja
```
Same flags as the Windows plan; only `--n-gpu-layers` changes. Windows used 8 because the desktop held part of the 4 GB. Start at **16**, watch `watch -n1 nvidia-smi` in a second terminal, and raise it (20, 24, ...) only while at least ~300 MiB of VRAM stays free during a generation; if the load fails with an out-of-memory message, lower it. The Windows gates (VRAM used <= 3,700 MiB, RAM available >= 6.5 GiB at 4,096 context) are a sensible ceiling here too. The model has 36 layers; I have **not measured** which value fits on your laptop under Ubuntu.
```bash
curl -s http://127.0.0.1:8080/health          # {"status":"ok"} when ready
ss -ltnp | grep :8080                           # must show 127.0.0.1:8080 only, never 0.0.0.0
```
Stop with Ctrl+C in the server terminal. Nothing else runs in the background.

## 6. First pilot steps (no papers needed for the first two)

```bash
cd ~/src/shoRDs && mkdir -p ~/llm/pilot
node scripts/native_pilot.js probe  --model-dir ~/llm/models --out ~/llm/pilot/hardware.json
node scripts/native_pilot.js server --base http://127.0.0.1:8080/v1 --model qwen3-8b --out ~/llm/pilot/server.json
```
Send me both JSON files (they contain hardware facts and one short generation, nothing personal). The three-paper run needs `papers.json` with three open-access papers (CC-BY or CC0) whose licence **you** confirmed (`licence.confirmedBy`, `confirmedOn`, `sourceUrl`, `spdx`, `fullTextAllowed: true`); I will not substitute fictional papers.
```bash
node scripts/native_pilot.js run --papers ~/llm/pilot/papers.json --base http://127.0.0.1:8080/v1 --model qwen3-8b \
  --revision 7c41481f57cb95916b40956ab2f0b139b296d974 --quant Q4_K_M --runtime "llama.cpp b11669" \
  --hardware ~/llm/pilot/hardware.json --no-thinking --out ~/llm/pilot/run1
```
Roadmap after that is unchanged (`docs/phase6/06_ROADMAP_TOWARDS_CLAUDE_INDEPENDENCE.md`): read the failures, fix extraction/sections, compare PDF extractors, blinded B-vs-C rating, then the >=50-paper benchmark. Claude stays the production default.

## 7. Run Claude Code on the Ubuntu machine (recommended)

```bash
curl -fsSL https://claude.ai/install.sh | bash        # native installer, no Node needed; open a new terminal afterwards
claude --version && cd ~/src/shoRDs && claude         # first start: log in with your Claude account in the browser
```
Then tell it: "Continue Phase 6 using docs/phase6/30_UBUNTU_CONTINUATION_GUIDE.md". It works in the repo, runs the steps above on your machine and asks you before commands; keep the same rules as with me: it asks before downloads, installs, pushing or anything touching Railway/production, and nothing secret is pasted into chat. (Claude Code needs a Pro, Max, Team, Enterprise or Console account; docs: https://code.claude.com/docs/en/setup.)

## 8. Open items carried over
* Decide how Phase 2-6 reaches GitHub (section 2B) - until then it exists only in the tarball and my working copy.
* Three licence-confirmed papers for the pilot (yours to confirm).
* Anthropic Console spend limit (yours); Phase 4 benchmark items; the legacy FastAPI cluster decision.
* r8 Windows verification: parked; resume only if you go back to Windows.

## 9. Please tell me
1. `lsb_release -a` (Ubuntu version) and whether this is the same laptop (dual-boot or replaced Windows).
2. `nvidia-smi` header line (driver and CUDA version) if a driver is already installed.
3. Tarball (A) or GitHub branch (B) for the code.
