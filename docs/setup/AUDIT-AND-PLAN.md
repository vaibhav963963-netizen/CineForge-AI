# System Setup — Phase 1 audit and Phase 2 architecture

Audit date: 2026-11-11. Machine audited: Windows 11 x64, RTX 3050 6 GB Laptop (driver 566.36), Node 22.23.2,
Git 2.55, 29 GB free on C:.

## 1. What already existed before this work

| Piece | What it does | Problems found |
|---|---|---|
| `setup-workspace.bat` | One-shot CLI installer: venv, pip, Kokoro/Whisper via `Invoke-WebRequest`, other models via `tools/fetch-model.mjs`, ComfyUI via `git clone`, torch wheel | Needs Node **and** Python 3.12 already installed; FFmpeg is never downloaded (only a message); Kokoro and Whisper small.en have no size/hash check; ComfyUI clone is unpinned (whatever `master` is that day); no progress UI; dependency list duplicated in `start-studio.bat`, `catalog.js` and this file |
| `start-studio.bat` | Refuses to start when FFmpeg / venv / Kokoro / Whisper are missing | A new PC can't reach a UI to fix anything |
| `tools/fetch-model.mjs` | Segmented, resumable, sha256-checked downloader with a per-file lock | CLI only, no pause/cancel, no host allowlist |
| `dashboard/lib/catalog.js` | Detects which engines are usable from files on disk (voices from the npz, Whisper vocab size, GGUF, checkpoints) | Presence checks only (no size/hash/version) — correct for option gating, not enough for setup |
| Settings → "Engines & Paths" | Read-only engine list | No actions |

## 2. Discovered dependency inventory (actual usage, not assumptions)

**Node.js dependencies: none.** `dashboard/package.json` has zero packages; the server, tests and tools use only Node
22 built-ins (`fetch`, `WebSocket`, `node:test`). There is no React, no build step, no `package-lock.json`, so there is
nothing for `npm install` to do. three.js r170 is **vendored** in `engine/styles/*/example/vendor/` and copied into
each project.

| Category | Component | Used by (file) | Install source | Integrity reference |
|---|---|---|---|---|
| Core | Windows 10 1803+ x64 (for built-in `tar.exe`, `curl.exe`) | bootstrap, zip extraction | — | — |
| Core | PowerShell 5.1 | bootstrap only | Windows | — |
| Runtime | Node.js ≥ 22 | everything in `dashboard/`, `capture.mjs`, tests | nodejs.org portable zip → `runtime/node` | `SHASUMS256.txt` (official) |
| Runtime | Python 3.12 (base interpreter) | creates both venvs | `py -3.12` if present, else python.org NuGet package → `runtime/python312` (no registry/PATH change) | NuGet SHA-512 (official) |
| Python env | `runtime/python-venv` + `config/requirements.txt` (numpy, scipy, kokoro-onnx, onnxruntime, faster-whisper, ctranslate2, phonemizer, espeakng-loader, soundfile, tokenizers, huggingface_hub, PyYAML, tqdm, anyio, colorama) | `voice.py` (numpy, scipy.io, kokoro_onnx), `words.py` (faster_whisper), `mix.py` (numpy, scipy.signal) | PyPI via pip, exact pins | pip verifies index hashes |
| Video | FFmpeg + FFprobe (libx264, aac, lavfi, freezedetect, blackdetect, signalstats) | `capture.mjs`, `mix.py`, `pipeline.js` QA, `words.py` | gyan.dev 9.0.2 essentials zip → `runtime/ffmpeg/bin` | gyan.dev `.sha256` (official) |
| Rendering | Chrome or Edge (headless, CDP, WebGL via ANGLE) | `capture.mjs` | system browser (Edge ships with Windows 11) | — |
| Rendering | three.js r170 (vendored), six styles, Inter/Caladea/FreeMono fonts | `scene.js` | in Git | file presence |
| Captions | Noto Sans Devanagari | Hindi/Hinglish captions (`scene.js`) | in Git (also google/fonts) | sha256 recorded |
| TTS | Kokoro v1.0 ONNX + voices-v1.0.bin | `voice.py`, `catalog.js` | GitHub release `thewh1teagle/kokoro-onnx` | size official; **sha256 trust-on-first-use** (GitHub publishes no digest for this release) |
| Alignment | faster-whisper small.en (4 files) | `words.py` (English) | HF `Systran/faster-whisper-small.en` | model.bin sha256 from HF LFS (official) |
| Alignment | faster-whisper small (4 files) | `words.py` (Hindi/Hinglish) | HF `Systran/faster-whisper-small` | model.bin sha256 from HF LFS (official) |
| LLM | llama.cpp b12244 Vulkan build (`llama-server.exe`) | `llm.js` | GitHub release (CPU build also published) | GitHub release asset digest (official) |
| LLM | Gemma 3 4B IT Q4_K_M GGUF | `llm.js`, `scriptgen.js` | HF `bartowski/google_gemma-3-4b-it-GGUF` | HF LFS sha256 (official) |
| Images | ComfyUI @ `bbd810e6` + own venv | `imagegen.js` | GitHub (git clone, or commit archive zip) | git commit id |
| Images | PyTorch 2.14.1 + torchvision 0.29.1 (cu126 or CPU) | ComfyUI | download.pytorch.org | wheel sha256 (official) |
| Images | ComfyUI `requirements.txt` (aiohttp, transformers, safetensors, av, …) | ComfyUI | PyPI | pip index hashes |
| Images | DreamShaper 8 pruned (SD1.5) | `imagegen.js` | HF `Lykon/DreamShaper` | HF LFS sha256 (official) |
| Images | `engine/comfy-workflows/sd15-txt2img.json` | `imagegen.js` | in Git | presence |
| Support | Git | ComfyUI install only (zip fallback exists) | git-scm.com (system install, guidance only) | — |
| Support | NVIDIA driver ≥ 527.41 | CUDA 12.6 torch | nvidia.com (guidance only) | — |

**Discovered beyond the prompt's checklist:** `tar.exe` is needed for zip extraction; espeak-ng comes from the
`espeakng-loader` wheel (no separate install); the ComfyUI custom-node folder is unused (`--disable-all-custom-nodes`);
no VAE/LoRA/embeddings are used (the `loras/` folder is empty); fact checking is pure JS + `facts/*.json` (no model);
`tools/qa.py` and `estimate.py` use only the standard library; there is **no** Node package, React or frontend build.

**Not used (prompt items that do not apply):** OpenCV, Pillow (outside ComfyUI), httpx/requests (outside ComfyUI),
React, npm packages, a CUDA toolkit (torch wheels bundle the runtime).

## 3. Risks found

1. Two different first-run paths would have diverged further; fixed by one registry (`config/dependencies.json`).
2. Kokoro has no official checksum → the registry says so (`checksumSource: "tofu"`) instead of pretending.
3. `setup-workspace.bat` downloaded with `Invoke-WebRequest` without hash checks; superseded by the download manager.
4. Installer endpoints on a local HTTP server are reachable by any web page via DNS rebinding / CSRF unless Host and a
   per-process token are checked → implemented.
5. One 6 GB GPU cannot host LLM + ComfyUI + capture together → health "load tests" refuse while a render job runs.

## 4. Architecture (implemented)

```
config/dependencies.json        single source of truth: components, features, profiles, trusted hosts
config/setup-settings.json      user choices (hardware profile, download concurrency) — created on first save
dashboard/lib/setup/
  registry.js    load + validate registry (unique ids, deps exist, no cycles, URLs on trusted hosts, paths stay
                 inside their base), topological install order, path resolution through studio-config.json
  hashcache.js   streamed sha256 with a cache keyed by path+size+mtime (never loads a model into memory)
  system.js      OS / CPU / RAM / GPU (nvidia-smi + CIM) / disks / runtime versions / network reachability
  detect.js      per-component status: files, sizes, hashes, executable versions, pip pins, python imports
  downloads.js   download manager: queue, concurrency limit, .part + Range resume, redirect-by-redirect host
                 allowlist, size + sha256 verify, backoff, pause/resume/cancel, persisted state
  installer.js   allowlisted operations only (download / download-extract / venv / pip / git / nuget-python),
                 spawn with argument arrays (no shell), cancellable, persisted history
  health.js      real checks: ffmpeg encode+probe, Python imports + Kokoro/Whisper load, WebGL through CDP,
                 llama-server / ComfyUI health, ports and ownership, folder write access
  settings.js    configuration manager: validate, back up, then write studio-config.json / setup-settings.json
  log.js         structured JSON-lines logs with secret redaction
  routes.js      /api/setup/* — Host check + per-process token on every request, ids validated
dashboard/public/setup.js|css   Settings → System Setup (8 tabs + first-run wizard)
bootstrap.ps1 + CineForge-Setup.bat   start the dashboard on a PC without Node (portable Node, hash-verified)
```

Install order is the registry's topological order: base Python → venv → pip → FFmpeg → models → llama.cpp →
ComfyUI → its venv → torch → its requirements → DreamShaper.

## 5. Verification actually executed (2026-11-11, this machine)

| What | Result |
|---|---|
| `node --test tests/setup.test.mjs` (24 tests: downloads incl. resume / no-Range / corrupt / size / disk-full / duplicate / 404 / idle timeout / pause-resume-cancel / untrusted URL + redirect + destination / restart recovery / parallel segments incl. a server ignoring range ends; registry validation; detection honesty; installer planning and busy-refusal; API token / Host / Origin / Sec-Fetch-Site / id injection; log redaction; folder validation) | 24/24 pass, 3 consecutive runs |
| `node --test tests/unit.test.mjs` (existing pipeline unit tests) | 28/28 pass |
| Full scan through the API on this PC | 25/25 components ready, `readyToLaunch: true` |
| Real repair of `python-base` (nuget.org, SHA-512, bsdtar extract, venv/ensurepip check) | completed, 1,322 files, verified |
| Real repair of `font-devanagari` (raw.githubusercontent.com) | downloaded, SHA-256 matches |
| Verify of all 6 model sets (≈5.5 GB hashed) | all match (official hashes; Kokoro against the recorded hash) |
| Health checks: FFmpeg encode+probe, Kokoro → Whisper (10 words aligned), WebGL2 via CDP on the RTX 3050, ports, folders, storage, model integrity | all healthy |
| Load tests with the modified launchers, profile `auto` (GPU) and `cpu` | LLM answered, ComfyUI started on cuda:0 / on cpu; services stopped, VRAM back to 0 |
| Bootstrap on a simulated clean PC (Node removed from PATH) | portable Node downloaded, SHA-256 verified, unpacked, version 22.23.2; detected the running server instead of starting a second |

**Not executed:** the full render pipeline e2e (`tests/e2e-run.mjs`). It needs the studio server restarted with the
new code, and the running server on :3200 belonged to another session. A wipe-and-reinstall of a real clean Windows
PC was not done: the clean-PC path was simulated as described above, and large downloads (Gemma, PyTorch,
DreamShaper) were not repeated.
