@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ================================================
echo   RedField - Save to GitHub
echo ================================================
echo.

REM ---- 1. Make sure git is installed ----
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git isn't installed, or isn't on your PATH.
    echo Install it from https://git-scm.com/downloads then try again.
    pause
    exit /b 1
)

REM ---- 2. Make sure this folder is actually a git repo ----
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This folder isn't a git repository yet.
    echo.
    echo One-time setup - run these commands here first:
    echo   git init
    echo   git remote add origin https://github.com/max1-sketch/RedField-domain.git
    echo   git add .
    echo   git commit -m "Initial commit"
    echo   git branch -M main
    echo   git push -u origin main
    pause
    exit /b 1
)

REM ---- 3. Pull first so you don't push on top of changes made elsewhere ----
echo Pulling latest changes from GitHub...
git pull --rebase
if errorlevel 1 (
    echo.
    echo [ERROR] Pull failed - probably a conflict. Open this folder in a
    echo real git tool ^(or ask for help^) and resolve it before saving again.
    pause
    exit /b 1
)
echo.

REM ---- 4. Stage everything ----
git add -A

REM ---- 5. SAFETY CHECK: refuse to push if .env or data/ somehow got staged ----
REM This is a public repo. .env holds your bot token; data/ holds ticket
REM transcripts, your site password, and blacklist reasons. The .gitignore
REM should already keep these out, but this check catches it even if that
REM file is ever missing, edited, or bypassed with "git add -f".
set SECRET_FOUND=0
for /f "delims=" %%F in ('git diff --cached --name-only') do (
    echo %%F | findstr /b /l /i ".env" >nul && set SECRET_FOUND=1
    echo %%F | findstr /b /l /i "data/" >nul && set SECRET_FOUND=1
    echo %%F | findstr /b /l /i "data\" >nul && set SECRET_FOUND=1
)
if "!SECRET_FOUND!"=="1" (
    echo [BLOCKED] .env or data/ is staged to be committed.
    echo This repo is PUBLIC - pushing either of those leaks your bot token
    echo or private ticket data. Nothing was committed or pushed.
    echo.
    echo Run this to unstage them, then try again:
    echo   git restore --staged .env data
    git reset >nul 2>&1
    pause
    exit /b 1
)

REM ---- 6. Skip the commit entirely if nothing actually changed ----
git diff --cached --quiet
if not errorlevel 1 (
    echo Nothing changed - nothing to save.
    pause
    exit /b 0
)

REM ---- 7. Commit with a timestamp ----
echo Committing changes...
git commit -m "Auto-save %date% %time%"
echo.

REM ---- 8. Push ----
echo Pushing to GitHub...
git push
if errorlevel 1 (
    echo.
    echo [ERROR] Push failed. Check the error above - if it's a rejected
    echo push, someone else's changes landed after your pull; run this
    echo script again to pull them in first.
    pause
    exit /b 1
)

echo.
echo Done - saved to https://github.com/max1-sketch/RedField-domain
pause