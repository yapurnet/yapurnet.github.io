# -*- coding: utf-8 -*-
"""Lector de potencia de las ONU: cada 10 minutos le pregunta a la OLT (SNMP, solo lectura)
la potencia de cada ONU y la manda a la app de YAPUR.NET.
Archivos al lado de este programa: olt_comunidad.txt (comunidad de solo lectura), app_token.txt (token del lector),
(ya no hace falta mapa_onus.txt: la serie y el nombre de cada ONU se leen de la OLT)."""
import os, sys, time, socket, json, urllib.request, urllib.error
from olt_walk import pdu, parse_resp
AQUI = os.path.dirname(os.path.abspath(__file__))
HOST = '192.168.40.2'; URLS = ['https://yapur.mauroyapur.workers.dev/api/olt/ingest']; CADA = 600
B = '1.3.6.1.4.1.17409.2.8.4.'
def leer(n): return open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
def recorrer_raw(com, raiz):
    """Recorre una columna de la OLT (GETNEXT, de a una fila) y devuelve {indice de ONU: valor tal cual}."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(4)
    cur = raiz; rid = 1; res = {}
    while True:
        rid += 1; data = None
        time.sleep(0.03)
        for _ in range(10):
            try: s.sendto(pdu(0xA1, rid, cur, 1, com), (HOST, 161)); data, _ = s.recvfrom(65535); break
            except socket.timeout: pass
        if data is None: raise RuntimeError('La OLT no respondió (%s, después de %s)' % (raiz[len(B) - 3:], cur[len(raiz):]))
        es, vbs = parse_resp(data)
        if es or not vbs: break
        oid, t, v = vbs[0]
        if t in (0x80, 0x81, 0x82) or not (oid + '.').startswith(raiz + '.'): break
        cur = oid
        try: res[int(oid[len(raiz) + 1:].split('.')[0])] = v
        except ValueError: continue
    return res
def a_bytes(v):
    if isinstance(v, str):
        if v.startswith('0x'):
            try: return bytes.fromhex(v[2:])
            except ValueError: pass
        return v.encode('utf-8')
    return b''
def serie_de(v):
    """La OLT guarda la serie como 8 bytes: 4 letras (TPLG, ALCL, HWTC...) y 4 bytes que se leen en hexadecimal."""
    b = a_bytes(v)
    if len(b) != 8: return ''
    try: return (b[:4].decode('ascii') + b[4:].hex()).upper()
    except UnicodeDecodeError: return ''
def nombre_de(v):
    b = a_bytes(v).rstrip(b'\x00')
    for cod in ('utf-8', 'latin-1'):
        try: return b.decode(cod).strip()
        except UnicodeDecodeError: pass
    return ''
def ciclo():
    com = leer('olt_comunidad.txt'); tok = leer('app_token.txt')
    # la OLT dice sola qué ONU hay (serie y nombre): las altas y bajas de los técnicos se reflejan sin pasar ningún archivo
    series = {i: serie_de(v) for i, v in recorrer_raw(com, B + '6.1.1.2').items()}
    nombres = {i: nombre_de(v) for i, v in recorrer_raw(com, B + '1.1.2').items()}
    series = {i: sn for i, sn in series.items() if len(sn) >= 8}
    rx = {i: v / 100.0 for i, v in recorrer_raw(com, B + '4.1.4').items() if isinstance(v, int)}
    tx = {i: v / 100.0 for i, v in recorrer_raw(com, B + '4.1.5').items() if isinstance(v, int)}
    with open(os.path.join(AQUI, 'olt_lecturas.txt'), 'w') as f:
        for idx, v in sorted(rx.items()): f.write('%x|%s\n' % (idx, v))
    lect, todo = [], []
    for idx, sn in series.items():
        pon, oid = ((idx >> 8) & 255) - 6, idx & 255   # la OLT numera los puertos PON desde 7: el puerto 1 de la configuración es el 7
        port = '%d/%d' % (pon, oid)
        todo.append({'sn': sn, 'port': port})
        v = rx.get(idx)
        if v is None or not (-60 < v < 30): continue
        lect.append({'sn': sn, 'rx': v, 'tx': tx.get(idx), 'est': 'online', 'port': port, 'name': nombres.get(idx, '')})
    off = [sn for idx, sn in series.items() if idx not in rx]   # registradas en la OLT pero que no devolvieron potencia (apagadas, sin luz o cortadas)
    if len(todo) < 50: raise RuntimeError('La OLT devolvió muy pocas ONU (%d); no mando nada para no borrar lo que ya está.' % len(todo))
    for i in range(0, max(len(lect), 1), 500):
        env = {'lect': lect[i:i + 500]}
        if i == 0: env['mapa'] = todo; env['off'] = off
        cuerpo = json.dumps(env).encode(); ult = None
        for url in URLS:
            rq = urllib.request.Request(url, data=cuerpo, method='POST', headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YapurLector/1.0', 'Accept': 'application/json'})
            try: urllib.request.urlopen(rq, timeout=30).read(); ult = None; break
            except urllib.error.HTTPError as e: ult = '%s -> HTTP %d: %s' % (url.split('/')[2], e.code, e.read()[:200].decode('utf-8', 'replace'))
            except Exception as e: ult = '%s -> %s' % (url.split('/')[2], e)
        if ult: raise RuntimeError(ult)
    return len(rx), len(lect)
def log(txt):
    """Anota en lector.log (se usa cuando corre sin ventana); lo achica si crece de más."""
    try:
        ruta = os.path.join(AQUI, 'lector.log')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 200000: os.remove(ruta)
        with open(ruta, 'a', encoding='utf-8') as f: f.write(txt + '\n')
    except Exception: pass
    try: print(txt, flush=True)
    except Exception: pass
if __name__ == '__main__':
    uno = '--una-vez' in sys.argv
    while True:
        try: log(time.strftime('%d/%m %H:%M:%S') + ' ONU leídas: %d, enviadas: %d' % ciclo())
        except Exception as e: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
        if uno: break
        time.sleep(CADA)
