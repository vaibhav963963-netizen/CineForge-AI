@echo off
:: CineForge AI - first run and everyday start.
:: Gets Node.js if needed (portable, hash-verified, no admin), then opens Settings -> System Setup in the browser.
:: "-ExecutionPolicy Bypass" applies to this one PowerShell process only; no system setting is changed.
title CineForge AI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1" %*
if errorlevel 1 pause
