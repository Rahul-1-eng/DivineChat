@echo off
title DivineChat AI Tunnel
cd /d "%~dp0"

echo Starting Ollama (this window can stay open)...
start "Ollama" /min "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
timeout /t 3 >nul

echo.
echo ============================================================
echo   COPY the https://....trycloudflare.com address below
echo   into your host's  OLLAMA_URL  environment variable,
echo   then REDEPLOY your app.
echo.
echo   Keep THIS window open the whole time you want the AI
echo   features (Assistant + Interview) to work. Closing it
echo   stops the tunnel.
echo ============================================================
echo.

cloudflared.exe tunnel --protocol http2 --url http://localhost:11434 --http-host-header localhost
