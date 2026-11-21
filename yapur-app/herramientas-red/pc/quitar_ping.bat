@echo off
cd /d "%~dp0"
schtasks /end /tn "YAPUR Ping respaldo" >nul 2>&1
schtasks /delete /tn "YAPUR Ping respaldo" /f >nul 2>&1
echo Respaldo de Probar conexion quitado. Si queda un proceso pythonw abierto, se cierra al reiniciar la PC.
pause
