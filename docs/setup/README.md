# CineForge AI — installation and setup guide

Everything CineForge AI needs is listed in one file, [config/dependencies.json](../../config/dependencies.json),
and installed from the dashboard: **Settings → System Setup**. You never need to run pip, download models by hand or
edit PATH.

## 1. First-time installation (new PC)

1. Get the code: `git clone <repo>` or download the ZIP and extract it to a folder you own (for example
   `C:\Users\<you>\CineForge`). Don't use `Program Files`: CineForge writes models and videos into its own folder.
2. Double-click **`CineForge-Setup.bat`**.
   - If Node.js 22+ is missing, it asks before downloading the portable Node.js zip (34 MB) from nodejs.org. It checks
     the SHA-256 against the value pinned in `config/dependencies.json` and unpacks it to `runtime\node`. There's no
     installer, no administrator prompt and no PATH change.
   - It then starts the dashboard on `http://127.0.0.1:3000/` and opens **System Setup**.
3. In the **first-run guide** (top of System Setup), click **Next** through the steps:
   scan → hardware → inventory → disk space → locations → hardware profile → install dependencies → download models →
   configuration → verification → complete.
   - **Install all required** sets up Python 3.12 (portable, from python.org's official NuGet package, only if no
     Python 3.12 is installed), the studio Python environment and packages, and FFmpeg.
   - **Install recommended** adds the script model (llama.cpp + Gemma 3 4B) and Hindi alignment (Whisper small).
   - **Install optional** adds AI images (ComfyUI, PyTorch, DreamShaper 8): about 7 GB in total.
4. Under **System Health**, click **Run health checks**. When the overview says **Ready to launch**, create a video.

You can close the browser or the window at any point. Downloads resume from their partial files and the guide
remembers its step. Start again with `CineForge-Setup.bat` (or `start-studio.bat`, which does the same).

**Why a bootstrap script?** The dashboard is a Node.js program, so it can't install the Node.js it runs on. The
bootstrap is the only step outside the UI.

## 2. Hardware requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 1803+ / 11, 64-bit | Windows 11 |
| CPU | 4 cores x64 | 8+ threads |
| RAM | 8 GB (script model needs ~4 GB) | 16 GB |
| GPU | none (CPU profile) | NVIDIA, ≥ 6 GB VRAM, driver ≥ 527.41 (CUDA 12.6) |
| Disk | 6 GB (required + recommended) | 15 GB with AI images |
| Browser | Microsoft Edge (built into Windows 11) or Google Chrome | Chrome |

Frame capture needs hardware WebGL in a Chromium browser. Integrated GPUs work, and `SOFTWARE_GL=1` forces slow
software rendering. AI image generation without an NVIDIA GPU runs on the CPU and takes minutes per image.

**Hardware profiles** (Hardware tab): *Automatic* (the default; it leaves the existing launch flags unchanged),
*NVIDIA GPU accelerated*, *CPU only* (`-ngl 0` for the script model, `--cpu` for ComfyUI, CPU PyTorch for new
installs) and *Low memory* (4096-token context, ComfyUI `--lowvram`). The profile only decides what is compatible.
CineForge doesn't predict speed from a GPU name.

## 3. What gets installed, and where

All paths are inside the workspace unless you move the model folders (Advanced Settings → Paths).

| Component | Location | Download | Source / integrity |
|---|---|---|---|
| Node.js 22.23.2 (if missing) | `runtime/node` | 34 MB | nodejs.org, SHA-256 |
| Python 3.12.10 (if no 3.12) | `runtime/python312` | 14 MB | nuget.org (python.org package), SHA-512 |
| Studio Python env + 15 pinned packages | `runtime/python-venv` | ~450 MB | PyPI via pip (hash-checked by pip) |
| FFmpeg 9.0.2 essentials | `runtime/ffmpeg/bin` | 109 MB | gyan.dev, SHA-256 |
| Kokoro v1.0 + voices | `models/kokoro` | 338 MB | GitHub release; size + recorded SHA-256 (no official hash published) |
| faster-whisper small.en | `models/whisper` | 464 MB | Hugging Face, SHA-256 |
| faster-whisper small | `models/whisper-multilingual` | 464 MB | Hugging Face, SHA-256 |
| llama.cpp b12244 (Vulkan or CPU build) | `runtime/llama.cpp` | 36 MB | GitHub release, SHA-256 |
| Gemma 3 4B Q4_K_M | `models/llm` | 2.3 GB | Hugging Face, SHA-256 |
| ComfyUI @ bbd810e6 + venv | `runtime/comfyui` | ~60 MB | GitHub, git commit id |
| PyTorch 2.14.1 (+cu126 or CPU) | ComfyUI venv | 2.6 GB (CUDA) | download.pytorch.org, SHA-256 |
| DreamShaper 8 | `models/image-generation/checkpoints` | 2.0 GB | Hugging Face, SHA-256 |

System programs (Chrome, Git, NVIDIA driver) are detected and explained, but **never installed or changed** by
CineForge. Git is optional: without it, ComfyUI is fetched as the commit's source archive.

## 4. Downloads

- Only hosts on the registry's `trustedHosts` list are contacted, and every redirect is checked against it.
- Files go to `<name>.part` (or `<name>.seg0…N` for parallel ranges), are checked for size and checksum, and only
  then replace the target. A working model is kept until its replacement passes verification.
- Large files use up to 4 parallel byte ranges when the server supports them (Advanced → *Connections per large
  file*), which helps on links throttled per connection. A server that ignores Range requests restarts from zero, and
  the UI says so.
- Pause, resume, cancel, retry, verify, open folder and remove incomplete are all in the Downloads tab. Free space is
  checked before every attempt.
- If the dashboard stops mid-download, the item comes back as *paused* with its partial size, and **Resume** continues
  from there.

## 5. Offline setup

Video generation never uses the network. Setup does, unless you supply the files yourself:

- **Archives:** put the exact files (for example `ffmpeg-9.0.2-essentials_build.zip`) into `runtime\.downloads`
  and click Install. A file whose checksum matches is used without downloading.
- **Models:** AI Models → *Import local file…* copies a file you already have, but only if its SHA-256 matches the
  registry.
- Advanced → *Allow downloads* off = offline mode: installs that would need a download stop with a clear message.
- *Check network* (Overview) is the only reachability test, and it runs only when you click it.

Python packages come from PyPI. For a fully offline machine, copy a whole working `runtime\python-venv` from a PC
with the same Python 3.12 install path, or install while online.

## 6. Configuration

| File | Holds | Edited by |
|---|---|---|
| `config/studio-config.json` | all paths, ports, generation limits | Advanced → Paths (backed up to `backups/config/` first, applied after restart) |
| `config/setup-settings.json` | hardware profile, download settings, guide progress | System Setup (per machine, not committed) |
| `config/dependencies.json` | the dependency registry | developers only (validated on load: unknown ops, untrusted URLs, path traversal, missing checksums and cycles are rejected) |

Environment variables: `PORT`, `CHROME` (browser path), `SOFTWARE_GL=1`. A global `PYTHONHOME`/`PYTHONPATH` is
flagged on the Hardware tab because it breaks isolated environments.

## 7. Updates and recovery

- Components are pinned. **Update** appears only when the installed version is older than the pin, and it always
  asks first. Nothing upgrades automatically.
- **Repair** re-downloads or re-creates a component even if it looks installed (corrupted model, broken venv).
- **Verify** re-hashes model files without using the cache. *Verify all* is on the Overview.
- Every operation is recorded in `logs/setup/ops/<id>.json` with a timestamped log. An operation interrupted by a
  restart shows as *interrupted*, with a Retry button.
- To roll back configuration, copy a file from `backups/config/` back into `config/`.
- Storage cleanup (Advanced) removes only disposable data: incomplete downloads, the download folder, the AI image
  cache and setup logs. **Projects, exports and installed models are never touched.**

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "Another studio server is already running" | Open the URL it prints, or close that window first. |
| Port 3000 busy | `CineForge-Setup.bat -Port 3200` |
| Download keeps failing | Overview → *Check network*; Installation Logs shows the exact error and a recovery hint. |
| "SHA-256 mismatch" | The file was corrupted or changed at the source and has been discarded. Retry. Don't use mirrors. |
| Python environment "does not start" | The base Python moved or was uninstalled. Repair *Studio Python environment*. |
| ComfyUI / script model health check fails | Run the load test, read the message, Repair the named component. Stop other GPU-heavy programs. |
| WebGL shows SwiftShader | Update the GPU driver. Software rendering works but is slow. |
| Install refused "while a job is running" | Wait for the render to finish: files in use are never replaced. |

**Copy diagnostic report** (Installation Logs) produces JSON without secrets (tokens and signed-URL parameters are
redacted, the home folder is masked) for bug reports.

## 9. Security model of the setup API

The installer endpoints (`/api/setup/*`) accept only loopback connections, require `Host: 127.0.0.1|localhost:<port>`
(this blocks DNS rebinding), refuse cross-site `Origin` / `Sec-Fetch-Site`, and require a random per-process token
on every state-changing request. Requests name components by registry id only. URLs, commands and install paths come
from the registry, and commands are spawned with argument arrays and no shell.

## 10. Licenses

| Component | License |
|---|---|
| Node.js | MIT |
| Python | PSF-2.0 |
| Kokoro-82M v1.0 ONNX | Apache-2.0 |
| faster-whisper, Whisper small / small.en | MIT |
| llama.cpp | MIT |
| Gemma 3 4B Instruct (GGUF) | Gemma Terms of Use + Prohibited Use Policy |
| ComfyUI | GPL-3.0 |
| PyTorch | BSD-3-Clause |
| DreamShaper 8 | CreativeML OpenRAIL-M |
| FFmpeg (gyan.dev build) | GPL-3.0 |
| three.js r170 (vendored) | MIT |
| Inter, Caladea, Noto Sans Devanagari / FreeMono | SIL OFL 1.1 / GPL |

Model weights and generated media are never committed (`.gitignore`).
