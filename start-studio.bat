@echo off
:: Start CineForge AI. Same as CineForge-Setup.bat: finds (or, after asking, installs portable) Node.js, starts the
:: dashboard on 127.0.0.1 and opens it. Missing components no longer stop the start: Settings -> System Setup shows
:: exactly what is missing and installs it. Options: -Port 3200  -NoBrowser
call "%~dp0CineForge-Setup.bat" %*
