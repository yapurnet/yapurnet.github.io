# -*- coding: utf-8 -*-
"""Mide cuánto consume cada cliente: lee por SNMP (solo lectura) los contadores de las colas simples de ADMIN02 cada vez que corre
(la tarea programada lo ejecuta cada 5 minutos con --una-vez), suma lo que pasó desde la lectura anterior y cada 2 horas y media manda a la app
los totales del día por cliente. Archivos al lado de este programa: mikrotik_comunidad.txt, app_token.txt (el mismo del lector de la OLT).
Guarda su memoria en consumo_estado.json; si falla un envío, sigue sumando y lo manda en la próxima."""
import os, sys, time, socket, json, urllib.request, urllib.error
from olt_walk import pdu, parse_resp
AQUI = os.path.dirname(os.path.abspath(__file__))
HOST = '10.0.0.50'; URLS = ['https://yapur.mauroyapur.workers.dev/api/consumo/ingest']; ENVIAR_CADA = 150 * 60
B = '1.3.6.1.4.1.14988.1.1.2.1.1.'
def leer(n): return open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
def log(txt):
    try:
        ruta = os.path.join(AQUI, 'consumo.log')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 200000: os.remove(ruta)
        with open(ruta, 'a', encoding='utf-8') as f: f.write(txt + '\n')
    except Exception: pass
    try: print(txt, flush=True)
    except Exception: pass
def columna(com, col):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(4)
    raiz = B + str(col); cur = raiz; rid = 1; res = {}
    while True:
        rid += 1; data = None
        for _ in range(5):
            try: s.sendto(pdu(0xA1, rid, cur, 1, com), (HOST, 161)); data, _ = s.recvfrom(65535); break
            except socket.timeout: pass
        if data is None: raise RuntimeError('ADMIN02 no respondió (columna %d)' % col)
        es, vbs = parse_resp(data)
        if es or not vbs: break
        oid, t, v = vbs[0]
        if t in (0x80, 0x81, 0x82) or not (oid + '.').startswith(raiz + '.'): break
        cur = oid; res[oid[len(raiz) + 1:]] = v
    return res
def dia(ts): return time.strftime('%Y-%m-%d', time.gmtime(ts - 3 * 3600))   # hora de Argentina
def ciclo():
    com = leer('mikrotik_comunidad.txt'); tok = leer('app_token.txt')
    ruta = os.path.join(AQUI, 'consumo_estado.json')
    try: est = json.load(open(ruta, encoding='utf-8'))
    except Exception: est = {}
    prev = est.get('prev', {}); pend = est.get('pend', {}); ult_envio = est.get('envio', 0)
    nombres, ips, ent, sal = columna(com, 2), columna(com, 3), columna(com, 8), columna(com, 9)
    ahora = time.time(); d = dia(ahora); nuevo = {}
    for idx, nom in nombres.items():
        ip = ips.get(idx) or ''
        if not ip or ip.startswith('0.') or not isinstance(ent.get(idx), int) or not isinstance(sal.get(idx), int): continue
        a = nuevo.setdefault(ip, {'n': str(nom), 'i': 0, 'o': 0}); a['i'] += ent[idx]; a['o'] += sal[idx]
    sumados = 0
    for ip, a in nuevo.items():
        p = prev.get(ip)
        if p and a['i'] >= p['i'] and a['o'] >= p['o'] and ahora > p['t']:
            dt = ahora - p['t']; di, do = a['i'] - p['i'], a['o'] - p['o']
            if dt <= 3600 and (di or do):
                x = pend.setdefault(ip + '|' + d, {'ip': ip, 'n': a['n'], 'd': d, 'bi': 0, 'bo': 0, 'pk': 0})
                x['bi'] += di; x['bo'] += do; x['n'] = a['n']
                x['pk'] = max(x['pk'], round(di * 8 / dt / 1e6, 2)); sumados += 1
        a['t'] = ahora
    est['prev'] = nuevo
    msg = 'colas leídas: %d, con consumo nuevo: %d' % (len(nuevo), sumados)
    if len(nuevo) < 50: raise RuntimeError('Se leyeron muy pocas colas (%d); no se guarda nada.' % len(nuevo))
    if pend and ahora - ult_envio >= ENVIAR_CADA:
        lista = list(pend.values()); err = None
        for i in range(0, len(lista), 600):
            cuerpo = json.dumps({'q': lista[i:i + 600]}).encode()
            for url in URLS:
                rq = urllib.request.Request(url, data=cuerpo, method='POST', headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                try: urllib.request.urlopen(rq, timeout=30).read(); err = None; break
                except urllib.error.HTTPError as e: err = 'HTTP %d: %s' % (e.code, e.read()[:200].decode('utf-8', 'replace'))
                except Exception as e: err = str(e)
            if err: break
            for x in lista[i:i + 600]: pend.pop(x['ip'] + '|' + x['d'], None)
        if err: msg += ' | envío falló (se reintenta): ' + err
        else: est['envio'] = ahora; msg += ' | enviado a la app: %d clientes' % len(lista)
    est['pend'] = pend
    tmp = ruta + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(est, f)
    os.replace(tmp, ruta)
    return msg
if __name__ == '__main__':
    uno = '--una-vez' in sys.argv
    while True:
        try: log(time.strftime('%d/%m %H:%M:%S') + ' ' + ciclo())
        except Exception as e: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
        if uno: break
        time.sleep(300)
