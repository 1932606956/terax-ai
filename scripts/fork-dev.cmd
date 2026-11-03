@echo off
rem Local dev launcher: rustup is not on the default PATH and pnpm is a shell
rem script on Windows (CreateProcess rejects it), so wrap both here.
set "PATH=C:\Users\enovate\.cargo\bin;%PATH%"
cd /d D:\DeskBox\enovate\project\terax-ai
pnpm.cmd tauri dev
