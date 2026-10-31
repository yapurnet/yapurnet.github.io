# Simula la envoltura de Android: la app se abre desde la dirección del servidor (como en el APK) y el puente nativo (window.YapurApp) es un doble.
import asyncio, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo contesta «Ahora no» como lo haría una persona
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass

def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

FAKE = """
window.__calls = []; window.__saveResult = null;
window.YapurApp = {
  saveFile: (n, m, t) => { window.__calls.push(['saveFile', n, m, t]); return window.__saveResult || ('ok:Descargas/' + n); },
  openUrl: (u) => { window.__calls.push(['openUrl', u]); return true; }
};
"""

async def main():
    errors = []
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {'clientesTodos': True}}, TA)
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    api('PATCH', '/api/doc/clientes/c00', {'data': {'items': {'a': {'nombre': 'Ana Pérez', 'estado': 'activo', 'planId': 'p1', 'tel': '3844 56-2605', 'dir': 'Calle 1', 'lat': -28.46, 'lng': -62.83}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await ctx.add_init_script(FAKE)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        await ctx.route('https://wa.me/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<h1 id="wa">WhatsApp</h1>'))
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errors.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto(BASE, wait_until='domcontentloaded')
        await pg.wait_for_selector('#lg-form', timeout=8000)
        body = await pg.inner_text('#view')
        check('primer uso en el celular: va directo al ingreso, sin pedir ninguna dirección', 'Servidor' not in body and await pg.query_selector('#sv-form') is None, body[:120])
        check('la app sabe que está dentro del APK', await pg.evaluate('NET.native') is True)
        await pg.fill('#lg-user', 'pedro'); await pg.fill('#lg-pass', 'pedro123')
        await pg.click('#lg-form button[type=submit]')
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
        await sin_aviso(pg)
        await pg.wait_for_function('S.clientes.size === 1 && NET.online', timeout=10000)
        check('entra y carga datos con tiempo real', True)
        api('PATCH', '/api/doc/clientes/c00', {'data': {'items': {'b': {'nombre': 'Beto', 'estado': 'activo', 'planId': 'p1'}}}}, TA)
        await pg.wait_for_function('S.clientes.size === 2', timeout=6000)
        check('los cambios llegan en vivo también en modo celular', True)
        # guardar archivo
        await pg.evaluate("saveFile('clientes.csv','a,b\\n1,2')")
        await pg.wait_for_selector('.toast:has-text("Guardado en Descargas")', timeout=3000)
        calls = await pg.evaluate('window.__calls')
        check('exportar entrega el archivo al puente nativo (nombre, tipo y contenido)', calls[0][:3] == ['saveFile', 'clientes.csv', 'text/csv'] and calls[0][3] == 'a,b\n1,2', calls)
        await pg.evaluate("window.__saveResult = 'No hay permiso para guardar'")
        await pg.evaluate("saveFile('x.json','{}')")
        await pg.wait_for_selector('.toast.bad:has-text("No se pudo guardar")', timeout=3000)
        check('si el celular no deja guardar, la app lo avisa', True)
        # botón atrás
        await pg.evaluate("openClient('a')")
        await pg.wait_for_selector('.sheet')
        r = await pg.evaluate("window.yapurBack()")
        await pg.wait_for_selector('.sheet', state='detached', timeout=3000)
        check('el botón atrás cierra la ficha abierta', r is True, r)
        await pg.click('#tabs [data-tab=clientes]')
        r = await pg.evaluate("window.yapurBack()")
        await pg.wait_for_timeout(300)
        tab = await pg.evaluate('S.tab')
        check('el botón atrás vuelve a la primera pestaña', r is True and tab == 'ordenes', [r, tab])
        r = await pg.evaluate("window.yapurBack()")
        check('y desde la primera pestaña deja que Android cierre la app', r is False, r)
        # enlaces externos
        await pg.click('#tabs [data-tab=clientes]')
        await pg.evaluate("openClient('a')")
        await pg.wait_for_selector('.sheet a[href^="https://wa.me"]')
        url0 = pg.url
        await pg.evaluate("window.__calls.length = 0")
        await pg.click('.sheet a[href^="https://wa.me"]')
        await pg.wait_for_timeout(400)
        calls = await pg.evaluate('window.__calls')
        check('los enlaces de WhatsApp se abren afuera (puente nativo) y la app no se mueve', len(calls) == 1 and calls[0][0] == 'openUrl' and calls[0][1].startswith('https://wa.me') and pg.url == url0, [calls, pg.url])
        await br.close()
    errors = [e for e in errors if 'No hay permiso para guardar' not in e]   # error esperado de la prueba que simula un celular sin permiso
    print('\nERRORES:', 'ninguno' if not errors else errors)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not errors else 1)
asyncio.run(main())
