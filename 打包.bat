@echo off
REM 桌面宠物打包脚本
REM 打包成 Windows 安装包(NSIS) + 免安装绿色版(portable)
REM 产物输出到 dist\ 目录
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo ============================================
echo  桌面宠物打包中...
echo ============================================
call npm run dist
echo.
echo 打包完成！产物在 dist\ 目录：
echo   - 安装包：桌面宠物 Setup *.exe
echo   - 绿色版：桌面宠物 *.exe (portable)
pause
