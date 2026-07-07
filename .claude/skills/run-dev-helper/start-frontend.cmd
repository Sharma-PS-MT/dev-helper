@echo off
REM Repo's committed Node (v12, under "C:\Program Files\nodejs" via nvm-windows'
REM active symlink) is too old for Angular 21 (needs Node >=20.19). Switching
REM the nvm symlink requires admin elevation, so instead we prepend the
REM already-installed Node 20 toolchain to PATH for this process tree only.
set "PATH=C:\Users\SarveswaraSarma\AppData\Roaming\nvm\v20.19.4;%PATH%"
cd /d "%~dp0..\..\.."
call npm start
