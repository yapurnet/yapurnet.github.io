# -*- coding: utf-8 -*-
"""«Leer ahora»: cada pocos segundos le pregunta a la app si algún técnico pidió la potencia de una ONU; si es así, lee solo esa ONU en la OLT
(SNMP, solo lectura) y manda la lectura enseguida. No hace nada más. Usa los mismos archivos que olt_agente.py (olt_comunidad.txt, app_token.txt)."""
import os, sys, time, socket, json, urllib.request, urllib.error
from olt_walk import pdu, parse_resp
AQUI = os.path.dirname(os.path.abspath(__file__))
HOST = '192.168.40.2'; BASE = 'https://yapur.mauroyapur.workers.dev/api/olt/'; CADA = 5
B = '1.3.6.1.4.1.17409.2.8.4.'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YapurLector/1.0'
def leer(n): return open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
def log(txt):
    try:
        ruta = os.path.join(AQUI, 'pedidos.log')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 200000: os.remove(ruta)
        with open(ruta, 'a', encoding='utf-8') as f: f.write(txt + '\n')
    except Exception: pass
    try: print(txt, flush=True)
    except Exception: pass
def pedir(tok, ruta, cuerpo=None):
    rq = urllib.request.Request(BASE + ruta, data=None if cuerpo is None else json.dumps(cuerpo).encode(), method='GET' if cuerpo is None else 'POST',
                                headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': UA})
    return json.loads(urllib.request.urlopen(rq, timeout=15).read().decode('utf-8') or '{}')
def snmp_get(sock, com, oid, rid):
    for _ in range(3):
        try:
            sock.sendto(pdu(0xA0, rid, oid, 1, com), (HOST, 161)); data, _ = sock.recvfrom(65535)
            es, vbs = parse_resp(data)
            if es or not vbs: return None
            o, t, v = vbs[0]
            return v / 100.0 if (t not in (0x80, 0x81, 0x82) and isinstance(v, int)) else None
        except socket.timeout: pass
    return None
def leer_onu(com, port):
    pon, oid = [int(x) for x in port.split('/')]
    idx = 0x01000000 | ((pon + 6) << 8) | oid   # el puerto 1 de la configuración es el 7 de la OLT
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2)
    rx = snmp_get(s, com, '%s4.1.4.%d.0.0' % (B, idx), 1001); tx = snmp_get(s, com, '%s4.1.5.%d.0.0' % (B, idx), 1002)
    s.close()
    return rx, tx
def ciclo(com, tok):
    p = pedir(tok, 'pedidos').get('p') or []
    for x in p[:20]:
        sn, port = str(x.get('sn', '')), str(x.get('port', ''))
        if not sn or '/' not in port: continue
        rx, tx = leer_onu(com, port)
        if rx is not None and -60 < rx < 30:
            pedir(tok, 'ingest', {'lect': [{'sn': sn, 'rx': rx, 'tx': tx, 'est': 'online', 'port': port}]})
            log(time.strftime('%d/%m %H:%M:%S') + ' %s (%s): %s dBm' % (sn, port, rx))
        else: log(time.strftime('%d/%m %H:%M:%S') + ' %s (%s): la OLT no devolvió potencia (ONU apagada o sin señal)' % (sn, port))
if __name__ == '__main__':
    err_ant = ''
    while True:
        try:
            ciclo(leer('olt_comunidad.txt'), leer('app_token.txt')); err_ant = ''
        except Exception as e:
            if str(e) != err_ant: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
            err_ant = str(e)
        time.sleep(CADA)
