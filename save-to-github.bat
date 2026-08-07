@echo off
title RedField - Save to GitHub

echo Staging local changes...
git add .

echo Committing local changes...
git commit -m "Auto-save updates"

echo Pulling latest changes from GitHub...
git pull --rebase

echo Pushing to GitHub...
git push

echo.
echo All set!
pause