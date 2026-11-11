# Historial del cliente: los cortes, reconexiones y cambios de plan quedan anotados y la ficha junta todo en una línea de tiempo.
# - «Clientes: altas y bajas»: una barra verde (altas, por c.alta) y una roja (bajas, por c.bajaFecha) por cada uno de los
#   últimos 6 meses, con el neto en el pie.
# - «Órdenes cerradas por técnico»: una barra horizontal por técnico con lo que cerró ESTE mes (incluye a los que cerraron 0,
#   para que se note quién no hizo nada); no cuenta lo abierto ni lo cerrado en otro mes.
# Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.request, urllib.error
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
def addmonths(ym, n):
    y, m = map(int, ym.split('-')); m += n; y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return '%04d-%02d' % (y, m)
ERR = []
async def sin_aviso(pg):
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass
async def login(ctx, user, clave):
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

async def main():
    hoy = datetime.date.today(); cur = hoy.strftime('%Y-%m'); hs = hoy.isoformat()
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/pl1', {'data': {'nombre': 'Fibra 50', 'bajada': 50, 'subida': 25, 'precio': 20000, 'activo': True}}, TA)
    api('PUT', '/api/doc/planes/pl2', {'data': {'nombre': 'Fibra 100', 'bajada': 100, 'subida': 50, 'precio': 30000, 'activo': True}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Ana Alonso', 'estado': 'activo', 'dir': 'Calle A', 'loc': 'Añatuya', 'alta': cur + '-01', 'planId': 'pl1', 'desde': cur, 'ciclo': 1}}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'falla', 'estado': 'hecha', 'tecnico': pedro['id'], 'tecNombre': 'Pedro', 'clientId': 'a', 'creado': hs, 'cierre': hs + ' 09:00'}}}}, TA)
    api('PATCH', '/api/doc/pagos/%s-s%02d' % (hs[:4], fnv('a') % 32), {'data': {'items': {'pg1': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 20000, 'fecha': hs, 'hora': '10:00', 'recibo': 'R1', 'metodo': 'efectivo'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.loaded.ordenes && S.loaded.clientes && S.loaded.pagos && S.clientes.size >= 1 && S.planes.size >= 2", timeout=10000)
        await pg.evaluate("setSuspension([S.clientes.get('a')], true)")
        await pg.wait_for_function("(S.clientes.get('a').hist||[]).length === 1", timeout=8000)
        await pg.evaluate("setSuspension([S.clientes.get('a')], false)")
        await pg.wait_for_function("(S.clientes.get('a').hist||[]).length === 2", timeout=8000)
        await pg.evaluate("saveClient(S.clientes.get('a'), {planId:'pl2'})")
        await pg.wait_for_function("(S.clientes.get('a').hist||[]).length === 3", timeout=8000)
        h = await pg.evaluate("S.clientes.get('a').hist.map(x=>x.t+(x.d?':'+x.d:''))")
        check('quedan anotados el corte, la reconexión y el cambio de plan', h == ['corte', 'reconexion', 'plan:Fibra 50 → Fibra 100'], h)
        await pg.evaluate("saveClient(S.clientes.get('a'), {notas:'x'})")
        await pg.wait_for_timeout(600)
        check('editar otra cosa no suma renglones ni borra los anteriores', await pg.evaluate("S.clientes.get('a').hist.length") == 3)
        await pg.evaluate("openClient('a')")
        await pg.wait_for_selector('details.linea')
        await pg.click('details.linea summary')
        filas = await pg.evaluate("[...document.querySelectorAll('.linea .tl li')].map(l=>l.innerText.replace(/\\s+/g,' '))")
        txt = ' | '.join(filas)
        for k in ['Alta del cliente', 'Corte por falta de pago', 'Reconexión', 'Cambio de plan: Fibra 50 → Fibra 100', 'Mensualidad', '20.000', 'Orden de falla', 'realizada por Pedro']:
            check('la línea de tiempo muestra: ' + k, any(k.lower() in f.lower() for f in filas), filas)
        check('lo más nuevo va arriba (el alta, de principio de mes, queda al final)', filas[-1].endswith('Alta del cliente') or 'Alta del cliente' in filas[-1], filas)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
