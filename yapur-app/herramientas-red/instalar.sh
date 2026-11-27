#!/bin/bash
# Instala en el contenedor yapur-tools los tres programas de red de YAPUR.NET. Se puede volver a correr para actualizarlos:
# no toca los archivos con secretos (app_token.txt, olt_comunidad.txt, mikrotik_comunidad.txt) ni nodos.txt si ya existe.
set -e
D=/opt/yapur; R=https://raw.githubusercontent.com/yapurnet/yapurnet.github.io/main/yapur-app/herramientas-red
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl iputils-ping ca-certificates >/dev/null
mkdir -p $D && cd $D
for f in olt_agente.py olt_pedidos.py olt_walk.py monitor_nodos.py consumo_mikrotik.py yapur_ping.py; do curl -fsSL "$R/$f" -o $f; done
[ -f nodos.txt ] || curl -fsSL "$R/nodos.txt" -o nodos.txt
sed -i "s#^HOST = '10.0.0.50'#HOST = '10.0.0.50'#" consumo_mikrotik.py
mk() { # nombre, descripcion, comando
  cat > /etc/systemd/system/$1.service <<EOT
[Unit]
Description=$2
After=network-online.target
[Service]
WorkingDirectory=$D
ExecStart=$3
Restart=on-failure
RestartSec=30
EOT
}
# lector de la OLT (2 veces por dia, cada 12 horas): se ejecuta una vez y un temporizador lo repite. «Leer ahora» no depende de este: lo atiende yapur-pedidos
mk yapur-olt "Lector de la OLT (potencia y caidas de ONU)" "/usr/bin/python3 $D/olt_agente.py --una-vez"; sed -i '/^Restart/d' /etc/systemd/system/yapur-olt.service
# «Leer ahora» (lecturas pedidas por un técnico): queda corriendo y consulta cada 5 segundos
mk yapur-pedidos "Leer ahora: lecturas de ONU pedidas por los tecnicos" "/usr/bin/python3 $D/olt_pedidos.py"
sed -i '/^Restart/d' /etc/systemd/system/yapur-pedidos.service
printf 'Restart=always\nRestartSec=10\n[Install]\nWantedBy=multi-user.target\n' >> /etc/systemd/system/yapur-pedidos.service
# «Probar conexión» de la ficha del cliente: queda corriendo y consulta (una vez por minuto, o cada 10 s mientras alguien prueba)
mk yapur-ping "Probar conexion de clientes (ping)" "/usr/bin/python3 $D/yapur_ping.py"
sed -i '/^Restart/d' /etc/systemd/system/yapur-ping.service
printf 'Restart=always\nRestartSec=10\n[Install]\nWantedBy=multi-user.target\n' >> /etc/systemd/system/yapur-ping.service
# monitor de nodos (cada minuto) y consumo (cada 5 minutos): se ejecutan una vez y un temporizador los repite
mk yapur-nodos "Monitor de nodos (ping)" "/usr/bin/python3 $D/monitor_nodos.py"; sed -i '/^Restart/d' /etc/systemd/system/yapur-nodos.service
mk yapur-consumo "Consumo de clientes (SNMP a ADMIN02)" "/usr/bin/python3 $D/consumo_mikrotik.py --una-vez"; sed -i '/^Restart/d' /etc/systemd/system/yapur-consumo.service
for t in "yapur-olt 12h" "yapur-nodos 1min" "yapur-consumo 5min"; do set -- $t
  printf '[Unit]\nDescription=Repite %s\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=%s\nAccuracySec=5s\n[Install]\nWantedBy=timers.target\n' "$1" "$2" > /etc/systemd/system/$1.timer
done
curl -fsSL "$R/configurar.sh" -o configurar.sh; chmod +x configurar.sh
systemctl daemon-reload
echo "Programas instalados en $D. Faltan los archivos con secretos (los escribe Mauro): app_token.txt, olt_comunidad.txt, mikrotik_comunidad.txt"
