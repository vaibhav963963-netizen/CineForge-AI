@echo off
setlocal EnableDelayedExpansion
title AI Shorts Studio - Local Production Server

echo ==============================================================================
echo   AI SHORTS STUDIO - LOCAL DASHBOARD AND PRODUCTION ENGINE
echo ==============================================================================
echo.

cd /d "%~dp0"
set "WORKSPACE=%CD%"
:: The server builds the environment of every worker itself (workspace paths only, Hugging Face forced offline).

:: Required components
set MISSING=0
if not exist "%WORKSPACE%\runtime\ffmpeg\bin\ffmpeg.exe" ( echo [ERROR] runtime\ffmpeg\bin\ffmpeg.exe missing & set MISSING=1 )
if not exist "%WORKSPACE%\runtime\python-venv\Scripts\python.exe" ( echo [ERROR] runtime\python-venv missing & set MISSING=1 )
if not exist "%WORKSPACE%\models\kokoro\kokoro-v1.0.onnx" ( echo [ERROR] models\kokoro\kokoro-v1.0.onnx missing & set MISSING=1 )
if not exist "%WORKSPACE%\models\whisper\model.bin" ( echo [ERROR] models\whisper\model.bin missing & set MISSING=1 )
if "%MISSING%"=="1" (
    echo.
    echo Run setup-workspace.bat to install the missing components.
    pause
    exit /b 1
)

:: Optional components: the dashboard shows exactly which options they unlock
if exist "%WORKSPACE%\models\whisper-multilingual\model.bin" ( echo [OK] Hindi / Hinglish word alignment ^(multilingual Whisper^) ) else ( echo [--] Hindi / Hinglish unavailable: models\whisper-multilingual missing )
if exist "%WORKSPACE%\runtime\llama.cpp\llama-server.exe" ( echo [OK] llama.cpp runtime ) else ( echo [--] Script generation unavailable: runtime\llama.cpp missing )
dir /b "%WORKSPACE%\models\llm\*.gguf" >nul 2>&1 && ( echo [OK] Script model ^(models\llm^) ) || ( echo [--] Script generation unavailable: no GGUF in models\llm )
if exist "%WORKSPACE%\runtime\comfyui\venv\Scripts\python.exe" ( echo [OK] ComfyUI runtime ) else ( echo [--] Hybrid AI images unavailable: runtime\comfyui not installed )
dir /b "%WORKSPACE%\models\image-generation\checkpoints\*.safetensors" >nul 2>&1 && ( echo [OK] Image model ^(models\image-generation^) ) || ( echo [--] Hybrid AI images unavailable: no checkpoint )
echo.
echo Launching dashboard at http://127.0.0.1:3000/ ...
start http://127.0.0.1:3000/
node dashboard\server.js
pause
