@echo off
title Resume Manager
python "%~dp0resume_manager.py" --open
if errorlevel 1 pause
