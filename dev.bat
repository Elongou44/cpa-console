@echo off
title CPA Console 开发模式

REM 进入 bat 所在目录
cd /d "%~dp0"

echo [1/3] 停止已有实例（正式 exe / 旧的开发实例）...
taskkill /F /IM cpa-console.exe >nul 2>&1
taskkill /F /IM cpa-console-dev.exe >nul 2>&1
taskkill /F /IM air.exe >nul 2>&1

echo [2/3] 启动前端热更新（新窗口）...
start "cpa-console-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo [3/3] 启动后端热重载（air）...
set "AIR="
where air >nul 2>&1 && set "AIR=air"
if not defined AIR if exist "%USERPROFILE%\go\bin\air.exe" set "AIR=%USERPROFILE%\go\bin\air.exe"
if not defined AIR (
    echo [错误] 未找到 air，请先执行: go install github.com/air-verse/air@latest
    pause
    exit /b 1
)

echo.
echo ====================================================
echo   前端: http://localhost:5173   (vite 热更新)
echo   后端: http://localhost:8790   (air 热重载)
echo   改 .go 文件后端自动重启；改前端代码即时生效
echo   停止: 关闭本窗口和前端窗口，或各自按 Ctrl+C
echo ====================================================
echo.

%AIR%
