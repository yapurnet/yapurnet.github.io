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
    api('POST', '/api/users', {'usuario': 'brenda', 'nombre': 'Brenda', 'role': 'oficina', 'clave': 'brenda123'}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Pallares Anabela', 'estado': 'activo', 'dir': 'Calle A', 'loc': 'Añatuya', 'alta': cur + '-01'}}}}, TA)
    api('PATCH', '/api/doc/pagos/%s-s%02d' % (hs[:4], fnv('a') % 32), {'data': {'items': {
        'pg1': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 100000, 'fecha': hs, 'hora': '10:00', 'recibo': 'R1', 'metodo': 'efectivo'},
        'pg2': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 5000, 'fecha': hs, 'hora': '11:00', 'recibo': 'R2', 'metodo': 'transferencia'},
    }}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'brenda', 'brenda123')
        await pg.click('#tabs [data-tab=cobranzas]')
        await pg.wait_for_selector('#cb-sub [data-s=egresos]', timeout=8000)
        await pg.click('#cb-sub [data-s=egresos]'); await pg.wait_for_selector('#eg-nuevo', timeout=8000)
        await pg.click('#eg-nuevo'); await pg.wait_for_selector('#eg-go', timeout=8000)
        check('el cliente solo se pide cuando el motivo lo necesita', await pg.locator('#eg-cli-box').is_hidden())
        await pg.select_option('#eg-cat', 'equipo')
        check('con equipo aparece el buscador de cliente', await pg.locator('#eg-cli-box').is_visible())
        await pg.fill('#eg-q', 'Pallares'); await pg.wait_for_selector('#eg-cli option', timeout=4000)
        await pg.fill('#eg-m', '39000'); await pg.fill('#eg-det', 'Router entregado a Pallares')
        await pg.click('#eg-go')
        await pg.wait_for_selector('[data-eg-an], .item .t', timeout=8000)
        txt = await pg.evaluate("document.querySelector('#eg-cuerpo').innerText")
        check('el egreso aparece con importe, motivo y cliente', '39.000' in txt and 'Pallares Anabela' in txt and 'Router entregado' in txt, txt[:300])
        check('el resumen resta el egreso al efectivo cobrado (100.000 - 39.000 = 61.000)', '100.000' in txt and '61.000' in txt, txt[:400])
        check('la oficina sin permiso de anular no ve el botón Anular', await pg.locator('[data-eg-an]').count() == 0)
        await pg.screenshot(path='/tmp/egresos.png')
        await pg.click('#cb-sub [data-s=caja]'); await pg.wait_for_selector('#cb-caja', timeout=8000)
        cj = await pg.evaluate("document.querySelector('#cb-caja').innerText")
        check('la caja del día muestra los egresos y el efectivo que debería quedar', 'Egresos de efectivo del día' in cj and 'Efectivo que debería quedar' in cj and '61.000' in cj, cj[:400])
        pa = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pa.click('#tabs [data-tab=cobranzas]'); await pa.wait_for_selector('#cb-sub [data-s=egresos]', timeout=8000)
        await pa.click('#cb-sub [data-s=egresos]'); await pa.wait_for_selector('[data-eg-an]', timeout=8000)
        await pa.click('[data-eg-an]'); await pa.fill('#eg-an', 'Se cargó dos veces'); await pa.click('#eg-an-go')
        await pa.wait_for_function("document.querySelector('#eg-cuerpo').innerText.includes('Anulado')", timeout=8000)
        t2 = await pa.evaluate("document.querySelector('#eg-cuerpo').innerText")
        check('el administrador anula con motivo y el efectivo vuelve a 100.000', 'Se cargó dos veces' in t2 and '100.000' in t2 and '61.000' not in t2, t2[:400])
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    print(f"{sum(res)} ok, {len(res) - sum(res)} fallas"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
