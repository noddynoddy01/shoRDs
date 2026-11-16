# Legacy quarantine: Python engines that return invented output

**Status (2026-11-04, Phase 6): QUARANTINED, not deleted. These files are byte-identical to the originals (see `MANIFEST.json`, sha256).**

## What these files are

Ten Python files that look like research-intelligence engines ("5-pass pipeline", "multi-agent engine", "research intelligence graph", "literature review writer", ...). They are **not functional**. Their methods return **hard-coded or invented output regardless of the paper text they are given**: fixed accuracy figures, fixed equations, fixed claims with invented confidence and replication counts, invented papers and DOIs, a fixed "evidence quality score". `finetune_model.py` trains on one invented sample if its dataset file is missing. The reason for each file is in `MANIFEST.json`.

## Rules

1. **They must not be exposed through any production endpoint**, scheduled job, worker or script. Nothing in the production path (`backend/start_local_server.js`, the Dockerfile, `railway.json`, `docker-compose.yml`, CI) references them; a test (`backend/tests/node/legacyQuarantine.test.js`) keeps it that way.
2. **They must not be used for training or evaluation.** Their output is invented; it is not a reference summary, a label, a benchmark or a baseline. Do not use their output as training data for any model, and do not score any system against it.
3. **They must not be presented to users or to investors as working features.** If a feature of this kind is wanted, build it on the evidence-anchored native pipeline (`backend/native/`) and the existing claim guard.
4. Do not "fix" them by adding real calls. They are kept only as a record of what existed. New work goes elsewhere.
5. The folder is excluded from the Docker image (`.dockerignore`).

## What was checked before moving anything (2026-11-04)

- No JavaScript, TypeScript, JSON, YAML, Dockerfile, `docker-compose.yml`, `railway.json`, CI workflow or `package.json` script mentions any of the ten files. The only mentions are in documentation and `CHANGELOG.md` (text).
- No other Python file imports any of the ten. (The Python tests under `backend/tests/` do not import them either.)
- The Node entry point is `backend/start_local_server.js`; no Python process is started by the deployment.

## Not moved, and why (decision needed)

`ai_pipeline.py`, `figure_engine.py`, `audio_engine.py`, `video_engine.py` have the same problem (templated "summary" text, invented asset URLs and an invented "18.5% boost" podcast line) but are imported by `celery_worker.py`, which `shords_server.py` (a FastAPI server) imports. That Python server is not part of the deployment either. Moving only part of that cluster would break its imports silently, so it is reported here for an explicit decision (quarantine the whole legacy FastAPI cluster as one unit, or leave it). Until then it is **not** to be run.
