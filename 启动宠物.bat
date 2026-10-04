@echo off
REM 桌面宠物启动脚本
REM 1. 清除 ELECTRON_RUN_AS_NODE，避免 electron 被当作 node 运行
REM 2. 禁用 GPU 避免虚拟机环境下 GPU 进程崩溃
set ELECTRON_RUN_AS_NODE=
".\node_modules\electron\dist\electron.exe" --disable-gpu . %*
