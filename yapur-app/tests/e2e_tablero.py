# Panel «Hoy» en el Resumen: cobrado hoy, órdenes abiertas por técnico, instalaciones por activar y clientes para cortar.
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
    api('POST', '/api/users', {'usuario': 'juan', 'nombre': 'Juan', 'role': 'tecnico', 'clave': 'juan1234'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro'); juan = next(u for u in ul['users'] if u['usuario'] == 'juan')
    viejo = int((datetime.datetime.now() - datetime.timedelta(days=3)).timestamp() * 1000)
    clientes = {
        'a': {'nombre': 'Ana Alonso', 'estado': 'activo', 'dir': 'Calle A', 'loc': 'Añatuya', 'alta': cur + '-01'},
        'p1': {'nombre': 'Pablo Nuevo', 'estado': 'pendiente', 'dir': 'Calle P', 'loc': 'Añatuya', 'creado': viejo},
        'p2': {'nombre': 'Paula Nueva', 'estado': 'pendiente', 'dir': 'Calle Q', 'loc': 'Añatuya', 'creado': int(datetime.datetime.now().timestamp() * 1000)},
    }
    for cid, data in clientes.items(): api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: data}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': {'tipo': 'visita', 'estado': 'pendiente', 'tecnico': pedro['id'], 'clientId': 'a', 'creado': hs, 'prioridad': 'urgente'},
        'o2': {'tipo': 'falla', 'estado': 'pendiente', 'tecnico': pedro['id'], 'clientId': 'a', 'creado': hs},
        'o3': {'tipo': 'visita', 'estado': 'pendiente', 'tecnico': juan['id'], 'clientId': 'a', 'creado': hs},
        'o4': {'tipo': 'visita', 'estado': 'pendiente', 'tecnico': None, 'clientId': 'a', 'creado': hs},
        'o5': {'tipo': 'visita', 'estado': 'cancelada', 'tecnico': juan['id'], 'clientId': 'a', 'creado': hs},
        'o6': {'tipo': 'visita', 'estado': 'hecha', 'tecnico': juan['id'], 'clientId': 'a', 'creado': hs, 'cierre': hs + ' 09:00'},
    }}}, TA)
    api('PATCH', '/api/doc/pagos/%s-s%02d' % (hs[:4], fnv('a') % 32), {'data': {'items': {
        'pg1': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 20000, 'fecha': hs, 'hora': '10:00', 'recibo': 'R1', 'metodo': 'efectivo'},
        'pg2': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 5000, 'fecha': hs, 'hora': '11:00', 'recibo': 'R2', 'metodo': 'efectivo'},
        'pg3': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 99000, 'fecha': hs, 'hora': '12:00', 'recibo': 'R3', 'metodo': 'efectivo', 'anulado': True},
    }}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.loaded.ordenes && S.loaded.clientes && S.loaded.pagos && S.clientes.size >= 3", timeout=10000)
        await pg.click('#tabs [data-tab=resumen]'); await pg.wait_for_selector('#rs-hoy')
        txt = await pg.evaluate("document.querySelector('#rs-hoy').innerText")
        check('cobrado hoy suma 25.000 sin contar el pago anulado', '25.000' in txt.replace(' ', '') and '99.000' not in txt, txt[:200])
        check('2 cobros', '2 cobros' in txt, txt[:200])
        filas = await pg.evaluate("[...document.querySelectorAll('#rs-hoy .hoy-sec .per')].map(r=>r.innerText.replace(/\\s+/g,' '))")
        check('Pedro tiene 2 abiertas (1 urgente) y va primero', filas and filas[0].startswith('Pedro') and '2 · 1 urgente' in filas[0], filas)
        check('Juan tiene 1 (la cancelada y la hecha no cuentan)', any(f.startswith('Juan') and f.endswith('1') for f in filas), filas)
        check('1 orden sin técnico', any('Sin técnico' in f and f.endswith('1') for f in filas), filas)
        check('el recuadro de órdenes abiertas dice 4', await pg.evaluate("document.querySelector('#rs-hoy .kpi[data-go=ordenes] .n').textContent") == '4')
        check('las instalaciones por activar muestran a Pablo (hace 3 días) antes que a Paula (de hoy)', 'Pablo Nuevo' in txt and 'hace 3 días' in txt and txt.index('Pablo Nuevo') < txt.index('Paula Nueva') and 'de hoy' in txt, txt)
        await pg.click('#rs-hoy [data-open-client=p1]')
        await pg.wait_for_selector('[role=dialog]', timeout=5000)
        check('tocar una instalación abre la ficha del cliente', 'Pablo Nuevo' in await pg.evaluate("document.querySelector('[role=dialog]').innerText"))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
