# Planes de noviembre: botón «Cargar planes de noviembre» y «Desactivar planes sin clientes».
import asyncio, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)

ERR = []
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    # instalación nueva: sin clientes → no se ofrece desactivar nada, aunque haya planes
    api('PUT', '/api/doc/planes/viejo5', {'data': {'nombre': 'Plan 5 Mbps', 'bajada': 5, 'subida': 5, 'precio': 17000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    api('PUT', '/api/doc/planes/viejo25', {'data': {'nombre': 'Plan 2.5', 'bajada': 2.5, 'subida': 2.5, 'precio': 17000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    # «plan 100» ya existe con otro precio y otra escritura: no se duplica ni se pisa
    api('PUT', '/api/doc/planes/p100', {'data': {'nombre': 'plan 100', 'bajada': 15, 'subida': 15, 'precio': 18500, 'tecnologia': 'fibra', 'activo': True}}, TA)
    base = {'estado': 'activo', 'dir': 'Calle 1', 'ciclo': 1, 'alta': '2026-01-01', 'desde': '2099-01'}
    # el usuario de oficina sin permiso de precios no ve el aviso
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.planes.size === 3', timeout=10000)
        await pg.click('#tabs [data-tab=planes]')
        await pg.wait_for_selector('#pl-nov')
        txt = await pg.inner_text('#pl-nov')
        check('sin clientes no se ofrece desactivar planes', 'sin clientes' not in txt and 'Desactivar' not in txt, txt)
        check('el aviso lista los 4 que faltan (Plan 100 ya existe, aunque esté en minúsculas)', 'Faltan 4' in txt and 'Plan 200' in txt and 'Plan 25 Mbps' in txt and 'Plan 100 (' not in txt, txt)
        await pg.click('[data-nov=cargar]')
        await pg.wait_for_selector('[data-act=yes]')
        conf = await pg.inner_text('.modal, [role=dialog], #modalRoot')
        check('pide confirmar y nombra los planes con su precio', 'Plan 200 ($' in conf.replace('\xa0', ' ') or 'Plan 200 (' in conf, conf[:300])
        await pg.click('[data-act=yes]')
        await pg.wait_for_function('S.planes.size === 7', timeout=8000)
        pl = await pg.evaluate("Object.fromEntries([...S.planes.values()].map(p=>[p.nombre,p]))")
        check('se crearon los 4 planes nuevos y no se duplicó Plan 100', sorted(pl) == sorted(['Plan 5 Mbps', 'Plan 2.5', 'plan 100', 'Plan 200', 'Plan 20 Mbps', 'Plan 25 Mbps', 'Plan 30 Mbps']), list(pl))
        check('el Plan 100 existente no se tocó (18.500)', pl['plan 100']['precio'] == 18500)
        check('precios: 200→19.000, 20→23.000, 25→24.000, 30→35.000', [pl[n]['precio'] for n in ('Plan 200', 'Plan 20 Mbps', 'Plan 25 Mbps', 'Plan 30 Mbps')] == [19000, 23000, 24000, 35000], pl)
        check('velocidad simétrica y tecnología fibra y wireless', pl['Plan 25 Mbps']['bajada'] == 25 and pl['Plan 25 Mbps']['subida'] == 25 and pl['Plan 25 Mbps']['tecnologia'] == 'ambas')
        q = await pg.evaluate("queueText([...S.planes.values()].find(p=>p.nombre==='Plan 25 Mbps'))")
        check('la cola sale como la de los routers (25M, ráfaga 35M, umbral 8M, 22s, garantizada 256k/1M)', q == 'max-limit=25M/25M burst-limit=35M/35M burst-threshold=8M/8M burst-time=22s/22s limit-at=256k/1M', q)
        await pg.wait_for_function("!document.querySelector('[data-nov=cargar]')", timeout=8000)
        check('el aviso desaparece al estar todos', await pg.evaluate("document.querySelector('[data-nov=cargar]')") is None)
        # ahora hay clientes: uno usa «Plan 5 Mbps», nadie usa «Plan 2.5»
        api('PATCH', '/api/doc/clientes/' + shard('ana'), {'data': {'items': {'ana': {**base, 'nombre': 'Ana Alda', 'planId': 'viejo5'}}}}, TA)
        api('PATCH', '/api/doc/clientes/' + shard('bea'), {'data': {'items': {'bea': {**base, 'nombre': 'Bea Bos', 'planId': 'p100'}}}}, TA)
        await pg.wait_for_function('S.clientes.size === 2', timeout=8000)
        await pg.wait_for_selector('[data-nov=viejos]', timeout=8000)
        txt = await pg.inner_text('#pl-nov')
        check('ofrece desactivar solo «Plan 2.5» (Plan 5 Mbps tiene un cliente)', '1 plan viejo sin clientes' in txt and 'Plan 2.5' in txt and 'Plan 5 Mbps' not in txt, txt)
        await pg.click('[data-nov=viejos]')
        await pg.wait_for_selector('[data-act=yes]')
        await pg.click('[data-act=yes]')
        await pg.wait_for_function("S.planes.get('viejo25').activo === false", timeout=8000)
        v25 = (await pg.evaluate("S.planes.get('viejo25')"))
        check('Plan 2.5 quedó inactivo y conserva sus datos', v25['activo'] is False and v25['bajada'] == 2.5 and v25['precio'] == 17000 and v25['nombre'] == 'Plan 2.5', v25)
        check('Plan 5 Mbps (con cliente) sigue activo', await pg.evaluate("S.planes.get('viejo5').activo") is True)
        await pg.wait_for_function("!document.querySelector('[data-nov=viejos]') && document.querySelector('#pl-list').innerText.includes('Inactivo')", timeout=8000)
        check('el aviso de viejos desaparece', await pg.evaluate("document.querySelector('[data-nov=viejos]')") is None)
        check('la tarjeta del plan muestra «Inactivo»', 'Inactivo' in await pg.inner_text('#pl-list'))
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
