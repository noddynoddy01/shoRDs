# Phase 6 / 05 – Legacy Python engines: quarantine report

Status: **IMPLEMENTED, TESTED**. Nothing deleted; originals preserved byte-for-byte (sha256 in `backend/legacy_quarantine/MANIFEST.json`, checked by `legacyQuarantine.test.js`).

Checks before moving: no reference from the Node backend, the Dockerfile, `package.json`, Railway/Vercel config or the frontend; none is on the deployed path (the backend image is `node:20-alpine` with no Python). Quarantine folder added to `.dockerignore`, so it cannot enter an image.

Moved (10), to `backend/legacy_quarantine/python_engines/`: `multi_agent_engine.py`, `multi_pass_engine.py`, `section_intelligence.py`, `rig_engine.py`, `literature_review_writer.py`, `living_reviews.py`, `concept_recommender.py`, `finetune_model.py`, `research_engine.py` and `research_review_mode.py`. Each entry records why: they return fixed text, invented statistics and invented references whatever the input, i.e. they are not research-intelligence engines and must never be presented as one.

**Not moved – decision needed:** `ai_pipeline.py`, `figure_engine.py`, `audio_engine.py`, `video_engine.py` have the same problem but are imported by `celery_worker.py`, which `shords_server.py` (a FastAPI server, also not deployed) imports. Moving part of that cluster would break imports silently. Options: quarantine the whole cluster as one unit (recommended), or leave it. Until decided, do not run it.

`backend/llm/runCopilot.js` was removed in Phase 3 (dead module that could reach the provider without the spend gate); it is not part of this quarantine.
