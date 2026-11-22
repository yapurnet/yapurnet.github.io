# -*- coding: utf-8 -*-
"""Monitor de nodos de YAPUR.NET: le hace ping a cada nodo (router, torre, enlace) y manda a la app cuántos paquetes volvieron.
Se ejecuta cada minuto (lo programa instalar_monitor.bat). No cambia nada en ningún equipo: solo hace ping.
Archivos al lado de este programa: nodos.txt (una línea por nodo: NOMBRE|IP) y app_token.txt (el mismo token del lector de la OLT)."""
import os, re, sys, subprocess, json, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
AQUI = os.path.dirname(os.path.abspath(__file__))
URLS = ['https://yapur.mauroyapur.workers.dev/api/nodos/ingest']
PINGS = 3
def leer(n): return open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
def log(txt):
    try:
        ruta = os.path.join(AQUI, 'monitor.log')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 100000: os.remove(ruta)
        with open(ruta, 'a', encoding='utf-8') as f: f.write(txt + '\n')
    except Exception: pass
def nodos():
    res = []
    for l in leer('nodos.txt').splitlines():
        l = l.strip()
        if not l or l.startswith('#') or '|' not in l: continue
        n, ip = [x.strip() for x in l.split('|', 1)]
        if n and re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}', ip): res.append((n, ip))
    return res
def ping(nodo):
    n, ip = nodo
    cf = 0x08000000 if os.name == 'nt' else 0                      # sin ventana negra
    cmd = ['ping', '-n', str(PINGS), '-w', '1500', ip] if os.name == 'nt' else ['ping', '-c', str(PINGS), '-W', '2', ip]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=30, creationflags=cf, errors='replace').stdout
    except Exception: return {'n': n, 'sent': PINGS, 'rec': 0}
    # cuenta las respuestas reales («TTL=» sale en cualquier idioma; «host inaccesible» también responde pero no tiene TTL)
    rec = len(re.findall(r'TTL=', out, re.I)); t = [float(x.replace(',', '.')) for x in re.findall(r'(?:tiempo|time)\s*[=<]\s*(\d+(?:[.,]\d+)?)\s*ms', out, re.I)]
    r = {'n': n, 'sent': PINGS, 'rec': min(rec, PINGS)}
    if t: r['ms'] = round(sum(t) / len(t), 1)
    return r
def main():
    lista = nodos(); tok = leer('app_token.txt')
    if not lista: log(time.strftime('%d/%m %H:%M:%S') + ' nodos.txt no tiene ningún nodo con IP: completalo (NOMBRE|IP).'); return
    with ThreadPoolExecutor(max_workers=8) as ex: res = list(ex.map(ping, lista))
    cuerpo = json.dumps({'nodos': res}).encode(); ult = None
    for url in URLS:
        rq = urllib.request.Request(url, data=cuerpo, method='POST', headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YapurMonitor/1.0', 'Accept': 'application/json'})
        try: urllib.request.urlopen(rq, timeout=20).read(); ult = None; break
        except urllib.error.HTTPError as e: ult = '%s -> HTTP %d: %s' % (url.split('/')[2], e.code, e.read()[:200].decode('utf-8', 'replace'))
        except Exception as e: ult = '%s -> %s' % (url.split('/')[2], e)
    if ult: log(time.strftime('%d/%m %H:%M:%S') + ' Error: ' + ult)
    elif '--detalle' in sys.argv or any(r['rec'] == 0 for r in res): log(time.strftime('%d/%m %H:%M:%S') + ' ' + ', '.join('%s %d/%d' % (r['n'], r['rec'], r['sent']) for r in res))
    if '--detalle' in sys.argv: print('\n'.join('%s: %d de %d%s' % (r['n'], r['rec'], r['sent'], ' (%s ms)' % r['ms'] if 'ms' in r else '') for r in res))
if __name__ == '__main__':
    try: main()
    except Exception as e: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
