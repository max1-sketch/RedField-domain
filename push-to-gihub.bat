@echo off
echo Committing submodule changes...
git submodule foreach "git add . && git commit -m \"Submodule update\" || true && git push || true"

echo Committing main repository...
git add .
git commit -m "Automated update"
git pull --rebase
git push
echo All set!
pause