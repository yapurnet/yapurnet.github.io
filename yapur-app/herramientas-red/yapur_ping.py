# -*- coding: utf-8 -*-
"""«Probar conexión» de la ficha de un cliente, hecho desde este servidor (en vez de un router): le pregunta a la app si alguien pidió probar
a un cliente (una vez por minuto, y cada 10 s mientras alguien está probando), le hace 4 pings a esa IP y avisa cuántos volvieron.
Solo hace ping: no cambia nada en ningún equipo. Usa el mismo app_token.txt que los demás programas.
Con --pc corre en la PC de la oficina (Windows) como respaldo: la app solo le da pruebas cuando el servidor del contenedor no está consultando."""
import os, re, sys, time, subprocess, urllib.request, urllib.error, urllib.parse
AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://yapur.mauroyapur.workers.dev/api/olt/ping'; CADA = 10
PC = '--pc' in sys.argv; WIN = os.name == 'nt'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YapurPing/1.0'
def leer(n): return open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
def log(txt):
    try:
        ruta = os.path.join(AQUI, 'ping.log')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 200000: os.remove(ruta)
        with open(ruta, 'a', encoding='utf-8') as f: f.write(txt + '\n')
    except Exception: pass
    try: print(txt, flush=True)
    except Exception: pass
def http(tok, metodo='GET', query=''):
    if PC: query = (query + '&' if query else '?') + 'de=pc'
    rq = urllib.request.Request(BASE + query, data=b'x' if metodo == 'POST' else None, method=metodo, headers={'Authorization': 'Bearer ' + tok, 'User-Agent': UA})
    return urllib.request.urlopen(rq, timeout=15).read().decode('utf-8', 'replace').strip()
def ping(ip, n=4):
    """(enviados, recibidos, ms promedio o None). Solo IPv4 válidas: se valida antes de llamar al programa ping."""
    if not re.fullmatch(r'(\d{1,3}\.){3}\d{1,3}', ip) or any(int(x) > 255 for x in ip.split('.')): return None
    try:
        if WIN:   # Windows (la salida cambia con el idioma: se leen los números)
            out = subprocess.run(['ping', '-n', str(n), '-w', '2000', ip], capture_output=True, text=True, errors='replace', timeout=40, creationflags=0x08000000).stdout
            rec = re.search(r'(?:Received|recibidos)\s*=\s*(\d+)', out, re.I)
            if not rec: return None
            a = re.search(r'(?:Average|Media)\s*=\s*(\d+)\s*ms', out, re.I)
            return n, int(rec.group(1)), float(a.group(1)) if a else None
        out = subprocess.run(['ping', '-n', '-q', '-c', str(n), '-W', '2', '-i', '0.3', ip], capture_output=True, text=True, timeout=30).stdout
    except Exception: return None
    m = re.search(r'(\d+) packets transmitted, (\d+) (?:packets )?received', out)
    if not m: return None
    a = re.search(r'= [\d.]+/([\d.]+)/', out)
    return int(m.group(1)), int(m.group(2)), float(a.group(1)) if a else None
def ciclo(tok):
    """Devuelve cuántos segundos esperar hasta la próxima consulta."""
    txt = http(tok)
    espera = CADA
    for it in [x for x in txt.split(',') if x]:
        if re.fullmatch(r's\d{1,2}', it): espera = CADA * int(it[1:]); continue   # nadie está probando: consulta una vez por minuto
        m = re.fullmatch(r'(g[0-9a-f]{14}):(\d{1,3}(?:\.\d{1,3}){3})', it)
        if not m: continue
        r = ping(m.group(2))
        if r is None: log(time.strftime('%d/%m %H:%M:%S') + ' %s: no se pudo hacer el ping' % m.group(2)); continue
        sent, rec, avg = r
        q = '?' + urllib.parse.urlencode({'id': m.group(1), 'sent': sent, 'rec': rec, **({'avg': '%.1fms' % avg} if avg is not None and rec else {})})
        http(tok, 'POST', q)
        log(time.strftime('%d/%m %H:%M:%S') + ' %s: %d de %d%s' % (m.group(2), rec, sent, '' if avg is None else ' · %.1f ms' % avg))
    return espera
if __name__ == '__main__':
    err_ant = ''; espera = CADA
    while True:
        try: espera = ciclo(leer('app_token.txt')); err_ant = ''
        except Exception as e:
            if str(e) != err_ant: log(time.strftime('%d/%m %H:%M:%S') + ' Error: %s' % e)
            err_ant = str(e); espera = 30
        time.sleep(espera)
