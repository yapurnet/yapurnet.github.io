# Conexión en vivo: si el WebSocket falla 3 veces la pantalla pasa al SSE (que mantiene despierto al servidor las 24 h y gasta el cupo del plan gratis),
# pero a los 10 minutos tiene que volver a probar con el WebSocket y dejar el SSE. Se usa el reloj de Playwright para saltar los 10 minutos.
# Chromium real contra el servidor de verdad (workerd). Lo que se mira es lo que ve el servidor: cuántas pantallas hay por WebSocket y cuántas por SSE.
import asyncio, json, os, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def japi(method, path, body=None, token=None):
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or 'null')
        except Exception: return e.code, None

# un WebSocket que no llega a abrir (la red lo corta) mientras window.__wsFalla sea verdadero; después, el de verdad
WS_FALSO = """
(() => {
  const Real = window.WebSocket; window.__wsFalla = true;
  function Falso(u, p) {
    if (!window.__wsFalla) return new Real(u, p);
    const o = { readyState: 3, send() {}, close() {}, onclose: null, onopen: null, onmessage: null, onerror: null };
    setTimeout(() => { if (o.onclose) o.onclose({ code: 1006 }); }, 20);
    return o;
  }
  Falso.prototype = Real.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { Falso[k] = Real[k]; });
  window.WebSocket = Falso;
})();
"""

async def uso(tk):
    st, j = await asyncio.to_thread(japi, 'GET', '/api/uso', None, tk)
    return j if st == 200 else {}

async def esperar(tk, cond, seg):
    t0 = time.time(); j = {}
    while time.time() - t0 < seg:
        j = await uso(tk)
        if j and cond(j): return j
        await asyncio.sleep(0.7)
    return j

async def main():
    st, j = japi('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 420, 'height': 900})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        await ctx.add_init_script(WS_FALSO)
        pg = await ctx.new_page()
        await pg.clock.install()
        await pg.goto(BASE, wait_until='domcontentloaded')
        await pg.wait_for_selector('#lg-form', timeout=8000)
        await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1')
        await pg.click('#lg-form button[type=submit]')
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
        # 1) el WebSocket falla 3 veces seguidas: la pantalla queda en SSE
        u = await esperar(TA, lambda j: j.get('sse', 0) >= 1, 40)
        check('con el WebSocket cortado, la pantalla pasa al SSE de respaldo', u.get('sse') == 1 and u.get('ws') == 0, u)
        # 2) la red se arregla y pasan 11 minutos: tiene que volver al WebSocket y soltar el SSE
        await pg.evaluate('window.__wsFalla = false')
        await pg.clock.fast_forward('11:00')
        u = await esperar(TA, lambda j: j.get('ws', 0) >= 1 and j.get('sse', 0) == 0, 70)
        check('a los 10 minutos vuelve a probar con el WebSocket y deja el SSE', u.get('ws') == 1 and u.get('sse') == 0, u)
        await br.close()
    n = sum(1 for x in res if x)
    print(f'\n{n} ok, {len(res) - n} con fallas')
    raise SystemExit(0 if all(res) else 1)
asyncio.run(main())
