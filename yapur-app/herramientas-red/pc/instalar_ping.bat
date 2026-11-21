@echo off
rem Respaldo de "Probar conexion": deja corriendo en esta PC el mismo programa que el servidor del contenedor.
rem Solo trabaja si el servidor no esta consultando. Va en la misma carpeta que app_token.txt (Desktop\conf).
cd /d "%~dp0"
echo.
echo === Respaldo de Probar conexion (YAPUR.NET) ===
if not exist app_token.txt (
  echo.
  echo Falta el archivo app_token.txt en esta carpeta: %CD%
  echo Es el mismo que usan los otros programas de red. Copialo aca y volve a abrir este archivo.
  pause & exit /b 1
)
set PYW=
for /f "delims=" %%i in ('where pythonw 2^>nul') do if not defined PYW set PYW=%%i
if not defined PYW for /f "delims=" %%i in ('where pyw 2^>nul') do if not defined PYW set PYW=%%i
if not defined PYW (
  echo.
  echo No encontre Python en esta PC. Es el mismo Python con el que andaban los otros programas.
  pause & exit /b 1
)
echo Descargando el programa...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/yapurnet/yapurnet.github.io/main/yapur-app/herramientas-red/yapur_ping.py' -OutFile 'yapur_ping.py'"
if errorlevel 1 ( echo No se pudo descargar. & pause & exit /b 1 )
schtasks /end /tn "YAPUR Ping respaldo" >nul 2>&1
schtasks /create /tn "YAPUR Ping respaldo" /tr "\"%PYW%\" \"%CD%\yapur_ping.py\" --pc" /sc onlogon /f >nul
if errorlevel 1 ( echo No se pudo crear la tarea programada. Abrilo con clic derecho: Ejecutar como administrador. & pause & exit /b 1 )
schtasks /run /tn "YAPUR Ping respaldo" >nul
echo.
echo Listo. El respaldo queda andando y se vuelve a prender solo cada vez que se inicia sesion en esta PC.
echo Para ver lo que hizo: abrir ping.log en esta carpeta. Para sacarlo: quitar_ping.bat
pause
