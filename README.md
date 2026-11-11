# AI Shorts Studio — single-workspace, fully local

Topic → script → narration → word timing → storyboard → local images + 3D/2D animation → 1080×1920 MP4, entirely on
this machine. No cloud APIs. Every option you pick is validated against the models actually installed, and nothing is
silently replaced with a default.

## Run

```
setup-workspace.bat     # once: Python env, FFmpeg check, models (resumable, sha256-verified), ComfyUI
start-studio.bat        # dashboard at http://127.0.0.1:3000/
node --test tests/      # unit tests (validation, progress math, storyboard)
node tests/e2e-run.mjs cases [A B C UNSUPPORTED] [--source llm|fixture]   # end-to-end acceptance (server running)
node tests/e2e-run.mjs progress                                           # progress acceptance
```

Only one studio server may run per workspace (`logs/jobs/.server.lock`).

## How a video is made (one job, real progress)

| Stage | What really happens | Progress source |
|---|---|---|
| Configuration validation | option ids re-checked against installed models | — |
| Script generation / approved script | Gemma 3 4B (llama.cpp) writes in the selected language + personality, or the approved version is loaded | tokens generated |
| Preparation | language check (Devanagari / Hinglish say-forms / English), narration files | — |
| Kokoro TTS | selected voice + phonemizer language, personality speed; re-synthesized within the personality's range if the length misses the target | sentence n of N |
| Whisper alignment | small.en (English) or small multilingual (Hindi) + language-ID of the narration | seconds transcribed, word n of N |
| Storyboard | lines → shots: environment, objects, action, camera, method, image prompt, overlays | — |
| Local images (hybrid mode) | ComfyUI + DreamShaper 8, one image at a time, cached | image n of N, sampler step |
| Scene construction | style runtime + character + assets, every 0.25 s drawn once to catch errors | check n of N |
| Frame capture | headless Chrome on the dedicated GPU, frame-exact, H.264 | frame n of N |
| Audio | sound cues from the shots + procedural music + narration mix | step n of 4 |
| Composition | FFmpeg mux | encoded seconds |
| QA & export | FFprobe, duration tolerance, freeze/black/darkness, loudness, export copy re-verified | step n of 6 |

Overall % = finished stage weights + current weight × measured fraction; skipped stages leave the plan; 100 % only after
the export is verified. Jobs persist in `logs/jobs/<jobId>.json` (with a timestamped event log), stream over SSE with a
polling fallback, survive a browser refresh, can be cancelled (whole process tree) and retried.

## Layout

```
dashboard/            server.js (API + job server) · lib/ (catalog, validate, jobs, pipeline, storyboard, scene, llm, imagegen) · public/ (UI)
engine/runtime/       shared render runtime copied into every project (director, 2D painter, 3D stage, captions, capture, mix)
engine/styles/<id>/   six styles: profile.json (palette, lighting, captions, camera, transitions, image prompt) + example/ assets
engine/scripts/       voice.py (Kokoro) · words.py (faster-whisper)
engine/comfy-workflows/  ComfyUI workflow templates
models/               kokoro/ · whisper/ (small.en) · whisper-multilingual/ · llm/ (GGUF) · image-generation/ (checkpoints, cache)
runtime/              python-venv/ · ffmpeg/ · llama.cpp/ · comfyui/ (own venv, CUDA PyTorch)
projects/<id>/        project.json · script/ · storyboard/ · generated-images/ · scenes/ · audio/ · renders/ · review/
exports/<id>.mp4      final videos (the Video Library plays from here)
logs/                 jobs/ · tests/ · benchmarks/ · setup/
```

Every path resolves from `config/studio-config.json` relative to this folder. Worker processes get a workspace-only
environment (`HF_HUB_OFFLINE=1`, no `FACELESS_HOME`, no `~/.cache`). The pre-migration folders `~/faceless-shorts`,
`~/.faceless-shorts` and `~/.cache/huggingface` are kept untouched as recovery backups and are never read.

## Languages, voices, personalities

| Language | Script / captions | Voices (installed) | Alignment |
|---|---|---|---|
| Hindi — Conversational | Devanagari | hf_alpha, hf_beta, hm_omega, hm_psi | Whisper small (multilingual) |
| Hindi — Shuddh / Formal | Devanagari | same | same |
| Hinglish | Roman captions, Devanagari "say" form for the voice | same | same |
| English | Latin | 28 American / British Kokoro voices | Whisper small.en |

A voice can only narrate its own language (Kokoro's Hindi phonemizer reads only Devanagari; Roman Hindi is read as
English), so mismatches are refused with the compatible alternatives. Kokoro has no emotion controls: a personality
shapes the script's wording plus speaking speed and pauses. Mumbai Conversational requires Hindi or Hinglish.

## Licenses

| Component | License |
|---|---|
| Kokoro-82M v1.0 ONNX | Apache-2.0 |
| faster-whisper / Whisper small, small.en | MIT |
| llama.cpp | MIT |
| Gemma 3 4B Instruct (GGUF) | Gemma Terms of Use + Prohibited Use Policy |
| ComfyUI | GPL-3.0 |
| PyTorch | BSD-3-Clause |
| DreamShaper 8 (SD1.5) | CreativeML OpenRAIL-M |
| three.js r170 | MIT |
| FFmpeg 9.0.2 | GPL-3.0 |
| Inter, Caladea, FreeMono, Noto Sans Devanagari | SIL OFL 1.1 / GPL (FreeMono) |

The local script model can state wrong facts: review every script before publishing.

## How to run — command cheat sheet

All commands run from the workspace folder (`Shorts Studio`). Windows; Node 22 required.

**1. First-time setup (once)**
```bat
setup-workspace.bat
```
Installs the Python environment, checks FFmpeg, downloads the models (resumable, sha256-verified) and sets up ComfyUI.

**2. Start the studio**
```bat
start-studio.bat
```
Opens the dashboard at http://127.0.0.1:3000/. Or start it by hand:
```bat
node dashboard\server.js
```
If port 3000 is busy (another app), use a different port:
```bat
set PORT=3200 && node dashboard\server.js
```
Git Bash: `PORT=3200 node dashboard/server.js`. Only one studio server can run per workspace (`logs/jobs/.server.lock`); close the window (or Ctrl+C) to stop it.

**3. Make a video (dashboard)**
1. **Create** → type a topic, pick language, personality, voice, style, character, duration, visual mode.
2. **Generate script preview** → it opens in **Script Studio**.
3. Review the **Fact check** panel: tick each flagged claim after checking it, or edit the line and save. Known errors can't be approved.
4. **Approve & render** → watch live progress; the MP4 lands in `exports\<project-id>.mp4`.

Optional: add verified facts for a topic in `facts\<topic>.json` (see `facts\roopkund.json`) or paste them under *Verified facts for this video* on the Create screen.

**4. Tests** (start the server first for e2e; set `STUDIO_URL` if not on port 3000)
```bash
node --test tests/unit.test.mjs                                   # unit tests (27)
STUDIO_URL=http://127.0.0.1:3200 node tests/e2e-run.mjs progress  # progress acceptance (24 checks)
STUDIO_URL=http://127.0.0.1:3200 node tests/e2e-run.mjs cases A B C UNSUPPORTED --source llm   # procedural
STUDIO_URL=http://127.0.0.1:3200 HYBRID=1 node tests/e2e-run.mjs cases A B C --source llm     # with AI images
```
(Git Bash syntax; in cmd use `set STUDIO_URL=...` then run the command.) Evidence is written to `logs\tests\`.

**5. Dev tools**
```bash
node tools/rescene.mjs <project-id>     # re-plan storyboard + contact sheet for an existing project
node tools/offline-audit.mjs all        # verify no external network connections
```

Full acceptance report: `logs/final-report.md`.
