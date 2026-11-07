# Órdenes canceladas: queda anotado quién y cuándo la canceló, se ve en la orden y en la ficha del cliente, y la oficina la puede reabrir.
# El técnico no puede cancelar ni reabrir. Chromium real contra el servidor de verdad (workerd).
import asyncio, datetime, json, os, sys, time, urllib.request, urllib.error
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
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo acepta como lo haría una persona (si no lo
    # acepta, y es horario laboral, la app no lo deja usarla hasta que lo haga: ver gateCheck en p07c_ubic.js)
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=si]', timeout=4000)
        await pg.click('[role=dialog] [data-act=si]')
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
def orden(tok, oid, cur):
    st, j = api('GET', '/api/doc/ordenes/' + cur, None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(oid)

async def main():
    hoy = datetime.date.today(); manana = hoy + datetime.timedelta(days=1); cur = hoy.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    for cid, nombre in (('a', 'Cordoba Alicia'), ('b', 'Beto Bravo')):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nombre, 'estado': 'pendiente', 'dir': 'Calle ' + cid, 'loc': 'Añatuya'}}}}, TA)
    base = {'tipo': 'instalacion', 'prioridad': 'normal', 'fecha': manana.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': pedro['id']}
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': dict(base, clientId='a', notas='hay que instalar el servicio'),
        # una cancelada de antes de esta versión: sin el nombre de quien la canceló
        'o2': dict(base, clientId='b', estado='cancelada', cierre=hoy.isoformat() + ' 08:15', notas='orden vieja')}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el administrador cancela
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=ordenes]'); await pg.wait_for_selector('[data-oid="o1"]')
        check('el botón rojo dice «Cancelar orden» (no solo «Cancelar»)', (await pg.inner_text('[data-oid="o1"] [data-oact=cancel]')).strip() == 'Cancelar orden')
        await pg.click('[data-oid="o1"] [data-oact=cancel]'); await pg.wait_for_selector('.sheet [data-act=yes]')
        check('la confirmación avisa que queda anotado quién y cuándo, y que se puede reabrir', 'Queda anotado quién la canceló' in await pg.inner_text('.sheet') and 'reabrir' in await pg.inner_text('.sheet'), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'cancelada'", timeout=8000)
        o1 = orden(TA, 'o1', cur)
        check('en el servidor queda cancelada, con quién y cuándo', o1['estado'] == 'cancelada' and o1['cancelPor'] == 'Mauro' and o1['cierre'][:10] == hoy.isoformat() and len(o1['cierre']) == 16, o1)
        await pg.click('[data-f=hechas]'); await pg.wait_for_selector('[data-oid="o1"]')
        card = await pg.inner_text('[data-oid="o1"]')
        check('la orden dice «Cancelada el … por Mauro»', 'Cancelada el %s' % hoy.strftime('%d/%m/%Y') in card and 'por Mauro' in card, card)
        check('y ofrece «Reabrir la orden»', 'Reabrir la orden' in card)
        card2 = await pg.inner_text('[data-oid="o2"]')
        check('una cancelada de antes dice cuándo, sin inventar quién', 'Cancelada el %s 08:15' % hoy.strftime('%d/%m/%Y') in card2 and ' por ' not in card2.split('Cancelada el')[1].split('\n')[0], card2)
        # la ficha del cliente
        await pg.evaluate("openClient('a')"); await pg.wait_for_selector('.sheet')
        ficha = await pg.inner_text('.sheet')
        check('la ficha del cliente muestra cuándo y quién la canceló (y la fecha programada)', 'Cancelada el %s' % hoy.strftime('%d/%m/%Y') in ficha and 'por Mauro' in ficha and manana.strftime('%d/%m/%Y') in ficha, ficha[-400:])
        await pg.click('.sheet [data-close]'); await pg.wait_for_selector('.sheet', state='detached')
        # 2) la oficina la reabre y la vuelve a cancelar: queda a su nombre
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.click('#tabs [data-tab=ordenes]'); await po.click('[data-f=hechas]'); await po.wait_for_selector('[data-oid="o1"] [data-oact=reabrir]')
        await po.click('[data-oid="o1"] [data-oact=reabrir]')
        await po.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'pendiente'", timeout=8000)
        o1 = orden(TA, 'o1', cur)
        check('«Reabrir» la deja pendiente, sin fecha de cierre ni nombre de quien la canceló', o1['estado'] == 'pendiente' and not o1.get('cierre') and not o1.get('cancelPor') and o1.get('tecnico') == pedro['id'], o1)
        check('avisa que se reabrió', 'Orden reabierta' in await po.inner_text('#toastRoot'))
        await po.click('[data-f=abiertas]'); await po.wait_for_selector('[data-oid="o1"] [data-oact=cancel]')
        check('vuelve a figurar entre las abiertas', await po.query_selector('[data-oid="o1"] [data-oact=next]') is not None)
        await po.click('[data-oid="o1"] [data-oact=cancel]'); await po.wait_for_selector('.sheet [data-act=yes]'); await po.click('.sheet [data-act=yes]')
        await po.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'cancelada'", timeout=8000)
        check('si la cancela la oficina, queda a nombre de Laura', orden(TA, 'o1', cur)['cancelPor'] == 'Laura', orden(TA, 'o1', cur))
        # 3) el técnico no cancela ni reabre
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.click('#tabs [data-tab=ordenes]'); await pt.click('[data-f=hechas]'); await pt.wait_for_selector('[data-oid="o1"]')
        tc = await pt.inner_text('[data-oid="o1"]')
        check('el técnico ve que se canceló y quién, pero no puede reabrirla', 'Cancelada el' in tc and 'por Laura' in tc and await pt.query_selector('[data-oid="o1"] [data-oact=reabrir]') is None, tc)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
