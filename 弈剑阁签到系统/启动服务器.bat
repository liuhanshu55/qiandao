@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 正在启动「弈剑阁 · 每日签到」服务器...
echo 启动后请保持此窗口不要关闭。
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
) else (
  "C:\Users\34566\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server.js
)

if errorlevel 1 (
  echo.
  echo 服务器异常退出，请检查上方错误信息。
  pause
)
