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
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\YAPUR Ping respaldo.vbs"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*yapur_ping.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
echo Set s = CreateObject("WScript.Shell"^)> "%VBS%"
echo s.CurrentDirectory = "%CD%">> "%VBS%"
echo s.Run """%PYW%"" ""%CD%\yapur_ping.py"" --pc", 0, False>> "%VBS%"
if not exist "%VBS%" ( echo No se pudo crear el inicio automatico. & pause & exit /b 1 )
wscript "%VBS%"
echo.
echo Listo. El respaldo queda andando y se vuelve a prender solo cada vez que se inicia sesion en esta PC (carpeta Inicio).
echo Para ver lo que hizo: abrir ping.log en esta carpeta. Para sacarlo: quitar_ping.bat
pause
