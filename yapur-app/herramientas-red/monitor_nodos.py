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
ACUM = os.path.join(AQUI, 'nodos_acum.json')
def cargar_acum():
    try: return json.load(open(ACUM, encoding='utf-8'))
    except Exception: return {}
def mandar(res):
    cuerpo = json.dumps({'nodos': res}).encode(); tok = leer('app_token.txt'); ult = None
    for url in URLS:
        rq = urllib.request.Request(url, data=cuerpo, method='POST', headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YapurMonitor/1.0', 'Accept': 'application/json'})
        try: urllib.request.urlopen(rq, timeout=20).read(); return None
        except urllib.error.HTTPError as e: ult = '%s -> HTTP %d: %s' % (url.split('/')[2], e.code, e.read()[:200].decode('utf-8', 'replace'))
        except Exception as e: ult = '%s -> %s' % (url.split('/')[2], e)
    return ult
def main():
    """Hace ping cada minuto, pero junta las pruebas y manda UN resumen cada 10 minutos (la app guarda por tramos de 10 minutos y el plan gratis de Cloudflare limita las escrituras por día).
    Si algún nodo no contesta ningún ping se manda enseguida, así la caída se detecta igual de rápido."""
    lista = nodos()
    if not lista: log(time.strftime('%d/%m %H:%M:%S') + ' nodos.txt no tiene ningún nodo con IP: completalo (NOMBRE|IP).'); return
    with ThreadPoolExecutor(max_workers=8) as ex: res = list(ex.map(ping, lista))
    ac = cargar_acum(); ya = '--ahora' in sys.argv or '--detalle' in sys.argv
    fin_tramo = int(time.time() // 60) % 10 == 9                  # último minuto del tramo de 10 minutos de la app
    envio, tocados = [], []
    for r in res:
        a = ac.get(r['n']) or {'sent': 0, 'rec': 0, 'ms': 0.0, 'mc': 0, 'caido': False}
        if r['rec'] == 0 or a.get('caido') or ya:
            # sin respuesta, o recién vuelve, o pedido a mano: se manda esta prueba sola y enseguida (así la caída y la vuelta se detectan al minuto)
            e = {'n': r['n'], 'sent': r['sent'], 'rec': r['rec']}
            if 'ms' in r: e['ms'] = r['ms']
            envio.append(e); tocados.append((r['n'], r['rec'] == 0))
        else:
            a['sent'] += r['sent']; a['rec'] += r['rec']
            if 'ms' in r: a['ms'] += r['ms']; a['mc'] += 1
            if a['sent'] > 30:                                      # tope que acepta la app por tramo (si no se pudo mandar, se descartan las más viejas)
                f = 30 / a['sent']; a['sent'] = 30; a['rec'] = min(30, round(a['rec'] * f)); a['ms'] *= f; a['mc'] = round(a['mc'] * f)
            if fin_tramo and a['sent']:
                e = {'n': r['n'], 'sent': a['sent'], 'rec': a['rec']}
                if a['mc']: e['ms'] = round(a['ms'] / a['mc'], 1)
                envio.append(e); tocados.append((r['n'], False))
        ac[r['n']] = a
    if envio:
        ult = mandar(envio)
        if ult: log(time.strftime('%d/%m %H:%M:%S') + ' Error: ' + ult)
        else:
            for n, cae in tocados: ac[n] = {'sent': 0, 'rec': 0, 'ms': 0.0, 'mc': 0, 'caido': cae}
            if any(c for _, c in tocados): log(time.strftime('%d/%m %H:%M:%S') + ' ' + ', '.join('%s %d/%d' % (r['n'], r['rec'], r['sent']) for r in res))
    try: json.dump(ac, open(ACUM, 'w', encoding='utf-8'))
    except Exception: pass
    if '--detalle' in sys.argv: print('\n'.join('%s: %d de %d%s' % (r['n'], r['rec'], r['sent'], ' (%s ms)' % r['ms'] if 'ms' in r else '') for r in res))
if __name__ == '__main__':
    try: main()
    except Exception as e: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
