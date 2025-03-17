@echo off
echo Installing Node.js dependencies...
cd "%~dp0"
npm install
echo Done! Press any key to exit.
pause > nul