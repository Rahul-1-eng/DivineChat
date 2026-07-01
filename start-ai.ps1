Write-Host "Monitoring AI Tunnel..." -ForegroundColor Green
while ($true) {
    Start-Process -FilePath "cloudflared.exe" -ArgumentList "tunnel --protocol http2 --url http://localhost:11434 --http-host-header localhost" -Wait
    Write-Host "Tunnel dropped! Restarting in 5 seconds..." -ForegroundColor Red
    Start-Sleep -Seconds 5
}