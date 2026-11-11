# Consumo del servidor: el administrador abre Ajustes → «Ver el consumo de hoy» y ve cuántos pedidos hubo y cuánto tiempo estuvo encendida la base de datos.
# Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, urllib.request, urllib.error
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

ERR = []
async def main():
    st, j = japi('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    japi('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura Oficina', 'role': 'oficina', 'clave': 'laura1'}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 420, 'height': 900})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        async def entrar(user, clave, ctx=ctx):
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
            await pg.goto(BASE, wait_until='domcontentloaded')
            await pg.wait_for_selector('#lg-form', timeout=8000)
            await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
            await pg.click('#lg-form button[type=submit]')
            await pg.wait_for_selector('#tabs .tab', timeout=10000)
            return pg
        pa = await entrar('mauro', 'claveSegura1')
        await pa.click('#tabs [data-tab=ajustes]')
        await pa.wait_for_selector('#aj-uso', timeout=8000)
        check('Ajustes tiene la tarjeta «Consumo del servidor»', 'Consumo del servidor' in await pa.inner_text('body'))
        await pa.click('#aj-uso')
        await pa.wait_for_function("document.querySelector('.sheet') && document.querySelector('.sheet').textContent.includes('Tiempo encendido')", timeout=8000)
        tx = await pa.inner_text('.sheet')
        check('muestra el tiempo encendido y el porcentaje del tope', 'Tiempo encendido' in tx and '13.000 GB-s' in tx and '%' in tx, tx[:400])
        check('muestra los pedidos del día, con el inicio de sesión del administrador', 'Pedidos' in tx and 'POST /api/login' in tx or 'POST /api/setup' in tx, tx[:600])
        check('muestra cuántas pantallas hay conectadas y cuántos routers hacen pruebas', 'Pantallas conectadas ahora' in tx and 'Routers con pruebas de conexión' in tx, tx[:600])
        await pa.click('.sheet [data-close]')
        ctxL = await br.new_context(bypass_csp=True, viewport={'width': 420, 'height': 900})
        await ctxL.route('**/fonts.g*/**', lambda r: r.abort())
        pl = await entrar('laura', 'laura1', ctxL)
        tab = await pl.query_selector('#tabs [data-tab=ajustes]')
        if tab: await tab.click(); await asyncio.sleep(0.8)
        check('la oficina no ve la tarjeta de consumo', await pl.query_selector('#aj-uso') is None)
        await br.close()
    check('sin errores de la página', not ERR, ERR[:3])
    n = sum(1 for x in res if x)
    print(f'\n{n} ok, {len(res) - n} con fallas')
    raise SystemExit(0 if all(res) else 1)
asyncio.run(main())
