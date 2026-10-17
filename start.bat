@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 星弈 xingyi

echo.
echo   星弈 · xingyi
echo   ----------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [x] 没找到 Node.js。请先安装 Node 20 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
for /f "tokens=*" %%v in ('npm -v') do set NPMVER=%%v
echo   Node %NODEVER%   npm %NPMVER%

if not exist "node_modules\" (
  echo.
  echo   首次运行，正在安装依赖（大约 1 分钟，只做一次）...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [x] 依赖安装失败。检查网络后重试，或手动执行：npm install
    pause
    exit /b 1
  )
)

if /i "%~1"=="prod" goto :prod

if not exist "packages\rules\dist\index.js" (
  echo   构建内部包...
  call npm run build:packages
  if errorlevel 1 (
    echo   [x] 构建失败
    pause
    exit /b 1
  )
)

echo.
echo   启动中：服务端 7388 · 前端 5173
echo   浏览器会自动打开 http://localhost:5173
echo   关掉这个窗口即停止。
echo.

start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:5173"
call npm run dev
goto :end

:prod
echo.
echo   构建生产版本（首次会慢一些）...
call npm run build
if errorlevel 1 (
  echo   [x] 构建失败
  pause
  exit /b 1
)
echo.
echo   启动 http://127.0.0.1:7388 ...
start "" /min cmd /c "timeout /t 4 >nul & start http://127.0.0.1:7388"
call npm start

:end
echo.
echo   已经停止。按任意键关闭窗口。
pause >nul
