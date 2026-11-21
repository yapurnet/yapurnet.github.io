@echo off
cd /d "%~dp0"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\YAPUR Ping respaldo.vbs" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*yapur_ping.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
schtasks /delete /tn "YAPUR Ping respaldo" /f >nul 2>&1
echo Respaldo de Probar conexion quitado.
pause
