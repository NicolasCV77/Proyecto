@echo off
chcp 65001 >nul
echo Verificando dependencias...
pip show paho-mqtt >nul 2>&1
if errorlevel 1 (
    echo Instalando paho-mqtt...
    pip install paho-mqtt
)
echo Iniciando simulador...
python simulador.py
pause
