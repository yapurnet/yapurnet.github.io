# El técnico no ve cuántos clientes tiene la empresa (ni arriba de la lista ni en «Ver más (N)»); la oficina sí. Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, sys, time, urllib.request, urllib.error
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
def shard(cid):
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)
ERR = []
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo acepta como lo haría una persona (si no lo
    # acepta, y es horario laboral, la app no lo deja usarla hasta que lo haga: ver gateCheck en p07c_ubic.js)
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=si]', timeout=4000)
        await pg.click('[role=dialog] [data-act=si]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass
async def login(br, user, clave):
    ctx = await br.new_context(bypass_csp=True, viewport={'width': 400, 'height': 900}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
    await ctx.route('**/fonts.g*/**', lambda r: r.abort())
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    await sin_aviso(pg)
    return pg
async def pantalla(pg):
    await pg.click('#tabs [data-tab=clientes]')
    await pg.wait_for_function("S.clientes.size === 70", timeout=15000)
    await pg.wait_for_selector('[data-open-client]')
    return await pg.evaluate("({cuenta: document.querySelector('#cl-count').textContent.trim(), mas: (document.querySelector('[data-more]')||{}).textContent || null, tarjetas: document.querySelectorAll('[data-open-client]').length})")

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Brenda', 'role': 'oficina', 'clave': 'brenda123'}, TA)
    api('POST', '/api/users', {'usuario': 'tec', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'fernando1', 'permisos': {'clientesTodos': True}}, TA)
    por = {}
    for i in range(70):
        cid = 'c%03d' % i
        por.setdefault(shard(cid), {})[cid] = {'nombre': 'Cliente %03d' % i if i else 'Zulema Única', 'estado': 'activo', 'dir': 'Calle %d' % i, 'alta': '2026-01-10', 'desde': time.strftime('%Y-%m')}
    for sh, items in por.items(): api('PATCH', '/api/doc/clientes/' + sh, {'data': {'items': items}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        po = await login(br, 'ofi', 'brenda123')
        r = await pantalla(po)
        check('la oficina ve el total de clientes arriba de la lista', r['cuenta'] == '70 clientes', r)
        check('y «Ver más (20)» con la cantidad que falta', r['mas'] == 'Ver más (20)' and r['tarjetas'] == 50, r)

        pt = await login(br, 'tec', 'fernando1')
        r = await pantalla(pt)
        check('el técnico ve la lista (50 tarjetas) pero no el total de clientes', r['tarjetas'] == 50 and r['cuenta'] == '', r)
        check('«Ver más» sale sin número', r['mas'] == 'Ver más', r)
        await pt.click('[data-more]')
        await pt.wait_for_function("document.querySelectorAll('[data-open-client]').length === 70", timeout=5000)
        check('y igual puede seguir viendo el resto de la lista', await pt.query_selector('[data-more]') is None)
        await pt.fill('#cl-q', 'zulema')
        await pt.wait_for_function("document.querySelectorAll('[data-open-client]').length === 1", timeout=5000)
        check('una búsqueda corta sí muestra cuántos encontró', await pt.inner_text('#cl-count') == '1 cliente')
        await pt.fill('#cl-q', 'cliente')
        await pt.wait_for_function("document.querySelectorAll('[data-open-client]').length === 50", timeout=5000)
        check('pero una búsqueda amplia no deja adivinar el total', await pt.inner_text('#cl-count') == '', await pt.inner_text('#cl-count'))
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
