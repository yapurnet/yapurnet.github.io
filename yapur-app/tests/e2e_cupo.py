# La tarjeta «Consumo del servidor» (Ajustes): muestra los pedidos, las filas leídas y escritas de la base y qué pidió más cada tipo de pedido.
import asyncio, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
ERR = []
async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto(BASE, wait_until='domcontentloaded')
        await pg.wait_for_selector('#lg-form', timeout=8000)
        await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1')
        await pg.click('#lg-form button[type=submit]')
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
        await pg.evaluate("openUso()")
        await pg.wait_for_function("document.querySelector('.sheet') && document.querySelector('.sheet').innerText.includes('Filas leídas')", timeout=8000)
        tx = await pg.inner_text('.sheet')
        check('la tarjeta muestra el tiempo encendido, los pedidos y las filas leídas y escritas con su tope diario', all(s in tx for s in ['Tiempo encendido', 'Pedidos', 'Filas leídas de la base', '5.000.000', 'Filas escritas en la base', '100.000']), tx[:400])
        check('la lista de pedidos trae las columnas Veces, Filas leídas y Filas escritas', all(s in tx.lower() for s in ['veces', 'filas leídas', 'filas escritas', 'post /api/login']), tx)
        await ctx.close(); await br.close()
    check('sin errores de consola', not ERR, ERR[:3])
    print(f'\n{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
