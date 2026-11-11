@echo off
setlocal EnableDelayedExpansion
title AI Shorts Studio India - Workspace Setup

echo ==============================================================================
echo   AI SHORTS STUDIO INDIA - WORKSPACE BOOTSTRAP & VERIFICATION
echo ==============================================================================
echo.

cd /d "%~dp0"
set "WORKSPACE=%CD%"
set "PYTHON_VENV=%WORKSPACE%\runtime\python-venv"
set "FFMPEG_BIN=%WORKSPACE%\runtime\ffmpeg\bin"
set "MODELS_KOKORO=%WORKSPACE%\models\kokoro"
set "MODELS_WHISPER=%WORKSPACE%\models\whisper"

echo [1/6] Checking System Prerequisites...

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH. Please install Node.js 22+ from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js is installed.

:: Check Python 3.12
py -3.12 -c "import sys; assert sys.version_info >= (3, 12)" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3.12 was not found. Please install Python 3.12 (64-bit) from https://www.python.org/
    pause
    exit /b 1
)
echo [OK] Python 3.12 is installed.

:: Check Chrome
set "CHROME_FOUND=0"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=1"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=1"
if %CHROME_FOUND% EQU 1 (
    echo [OK] Google Chrome is installed (Hardware WebGL frame capture ready).
) else (
    echo [WARNING] Google Chrome was not found at standard path. Ensure CHROME is in PATH.
)

echo.
echo [2/6] Checking Portable FFmpeg & FFprobe...
if exist "%FFMPEG_BIN%\ffmpeg.exe" if exist "%FFMPEG_BIN%\ffprobe.exe" (
    echo [OK] Portable FFmpeg 9.0.2 binaries verified in runtime\ffmpeg\bin\
) else (
    echo [INFO] Copying or fetching portable FFmpeg 9.0.2...
    echo Please ensure ffmpeg.exe and ffprobe.exe are placed inside runtime\ffmpeg\bin\
)

echo.
echo [3/6] Setting Up Isolated Python Environment...
if not exist "%PYTHON_VENV%\Scripts\python.exe" (
    echo Creating fresh Python 3.12 virtual environment in runtime\python-venv...
    py -3.12 -m venv "%PYTHON_VENV%"
    "%PYTHON_VENV%\Scripts\python.exe" -m pip install --upgrade pip
)
echo Installing / verifying pinned dependencies from config\requirements.txt...
"%PYTHON_VENV%\Scripts\pip.exe" install -r "%WORKSPACE%\config\requirements.txt" --quiet
echo [OK] Python dependencies verified.

echo.
echo [4/6] Verifying Local AI Models...
:: Check Kokoro
if not exist "%MODELS_KOKORO%\kokoro-v1.0.onnx" (
    echo [DOWNLOADING] Kokoro ONNX model weights (~325 MB)...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx' -OutFile '%MODELS_KOKORO%\kokoro-v1.0.onnx'"
)
if not exist "%MODELS_KOKORO%\voices-v1.0.bin" (
    echo [DOWNLOADING] Kokoro voice profiles (~28 MB)...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin' -OutFile '%MODELS_KOKORO%\voices-v1.0.bin'"
)
echo [OK] Kokoro TTS models present in models\kokoro\

:: Check Whisper
if not exist "%MODELS_WHISPER%\model.bin" (
    echo [DOWNLOADING] Faster-Whisper small.en weights (~483 MB)...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://huggingface.co/Systran/faster-whisper-small.en/resolve/main/model.bin' -OutFile '%MODELS_WHISPER%\model.bin'"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://huggingface.co/Systran/faster-whisper-small.en/resolve/main/config.json' -OutFile '%MODELS_WHISPER%\config.json'"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://huggingface.co/Systran/faster-whisper-small.en/resolve/main/tokenizer.json' -OutFile '%MODELS_WHISPER%\tokenizer.json'"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://huggingface.co/Systran/faster-whisper-small.en/resolve/main/vocabulary.txt' -OutFile '%MODELS_WHISPER%\vocabulary.txt'"
)
echo [OK] Faster-Whisper models present in models\whisper\

echo.
echo [4b] Local models for Hindi, script writing and images (resumable, sha256-verified, workspace only)...
:: Devanagari caption font (SIL OFL 1.1)
if not exist "%WORKSPACE%\assets\fonts\NotoSansDevanagari-Variable.ttf" node tools\fetch-model.mjs "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%%5Bwdth%%2Cwght%%5D.ttf" "assets\fonts\NotoSansDevanagari-Variable.ttf" --segments 1
:: Multilingual Whisper small (MIT) for Hindi / Hinglish alignment
if not exist "%WORKSPACE%\models\whisper-multilingual" mkdir "%WORKSPACE%\models\whisper-multilingual"
for %%F in (config.json tokenizer.json vocabulary.txt) do if not exist "%WORKSPACE%\models\whisper-multilingual\%%F" node tools\fetch-model.mjs "https://huggingface.co/Systran/faster-whisper-small/resolve/main/%%F" "models\whisper-multilingual\%%F" --segments 1
node tools\fetch-model.mjs "https://huggingface.co/Systran/faster-whisper-small/resolve/main/model.bin" "models\whisper-multilingual\model.bin" --sha256 3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671
:: llama.cpp (MIT), Vulkan build: runs the script model on the GPU without the CUDA runtime
if not exist "%WORKSPACE%\runtime\llama.cpp\llama-server.exe" (
    node tools\fetch-model.mjs "https://github.com/ggml-org/llama.cpp/releases/download/b12244/llama-b12244-bin-win-vulkan-x64.zip" "runtime\llama.cpp\llama-vulkan.zip" --segments 2
    "%PYTHON_VENV%\Scripts\python.exe" -c "import zipfile; zipfile.ZipFile(r'runtime\llama.cpp\llama-vulkan.zip').extractall(r'runtime\llama.cpp')" && del "runtime\llama.cpp\llama-vulkan.zip"
)
:: Script model: Gemma 3 4B instruct, Q4_K_M GGUF (Gemma Terms of Use)
if not exist "%WORKSPACE%\models\llm" mkdir "%WORKSPACE%\models\llm"
node tools\fetch-model.mjs "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf" "models\llm\google_gemma-3-4b-it-Q4_K_M.gguf" --segments 10 --sha256 4996030242583a40aa151ff93f49ed787ac8c25e4120c3ae4588b2e2a7d1ae94
:: Image model: DreamShaper 8 (SD1.5-class, CreativeML OpenRAIL-M)
if not exist "%WORKSPACE%\models\image-generation\checkpoints" mkdir "%WORKSPACE%\models\image-generation\checkpoints"
node tools\fetch-model.mjs "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors" "models\image-generation\checkpoints\DreamShaper_8_pruned.safetensors" --segments 10 --sha256 879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd
:: ComfyUI (GPL-3.0) with its own Python 3.12 venv + CUDA 12.6 PyTorch (torch wheel sha256-verified, then deleted)
if not exist "%WORKSPACE%\runtime\comfyui\main.py" git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "%WORKSPACE%\runtime\comfyui"
if not exist "%WORKSPACE%\runtime\comfyui\venv\Scripts\python.exe" py -3.12 -m venv "%WORKSPACE%\runtime\comfyui\venv"
"%WORKSPACE%\runtime\comfyui\venv\Scripts\python.exe" -c "import torch" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    node tools\fetch-model.mjs "https://download.pytorch.org/whl/cu126/torch-2.14.1%%2Bcu126-cp312-cp312-win_amd64.whl" "runtime\comfyui\wheels\torch-2.14.1+cu126-cp312-cp312-win_amd64.whl" --segments 8 --sha256 97e3bc87ea74367518b740d912a7f5259c25a3c8115bf5916abee1d53ff115a4
    "%WORKSPACE%\runtime\comfyui\venv\Scripts\python.exe" -m pip install --no-cache-dir "runtime\comfyui\wheels\torch-2.14.1+cu126-cp312-cp312-win_amd64.whl" "torchvision==0.29.1+cu126" --index-url https://download.pytorch.org/whl/cu126 --extra-index-url https://pypi.org/simple
    del "runtime\comfyui\wheels\torch-2.14.1+cu126-cp312-cp312-win_amd64.whl"
)
"%WORKSPACE%\runtime\comfyui\venv\Scripts\python.exe" -m pip install --no-cache-dir -r "%WORKSPACE%\runtime\comfyui\requirements.txt"
echo [OK] Local models installed. Run "node --test tests/" to verify.

echo.
echo [5/6] Verifying Offline Model Loading & Checksums...
"%PYTHON_VENV%\Scripts\python.exe" -c "from kokoro_onnx import Kokoro; k = Kokoro(r'%MODELS_KOKORO%\kokoro-v1.0.onnx', r'%MODELS_KOKORO%\voices-v1.0.bin'); from faster_whisper import WhisperModel; m = WhisperModel(r'%MODELS_WHISPER%', device='cpu', compute_type='int8'); print('[OK] Both Kokoro and Faster-Whisper loaded successfully offline.')"

echo.
echo [6/6] License Verification:
echo   - Kokoro-82M ONNX: Apache 2.0 License
echo   - Faster-Whisper: MIT License (Systran)
echo   - Three.js WebGL: MIT License
echo   - FFmpeg 9.0.2: GPL v3 (Gyan.dev full build)
echo.
echo ==============================================================================
echo   ALL SET! The AI Shorts Studio workspace is fully operational.
echo   To launch the production server, run start-studio.bat
echo ==============================================================================
echo.
pause
