# Pasar a un cliente de un ciclo de cobro al otro: la app avisa que no hay prorrateo, lo que debe y desde cuándo paga en el ciclo nuevo, en la ficha de edición. Chromium real contra workerd.
# según la hora, su nombre, que ya sale). Es un enlace editable de WhatsApp (nunca se manda solo), no una acción de la orden.
# Se ofrece igual de grande que «Salgo para allá» tanto en la orden propia como en una sin asignar todavía (ahí firma el que
# está por tomarla, y al tocarlo de paso la toma y la pasa a «en camino», como si hubiera tocado «Salgo para allá»). También
# se lo ofrece a un técnico con permiso de ver todas las órdenes (antes quedaba excluido, y se quedaba sin ninguna forma de
# avisarle al cliente). No lo tiene la oficina (ya tiene su propio «Enviar por WhatsApp» con los datos de la orden) ni un
# técnico ajeno a una orden ya asignada a otro. Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.parse, urllib.request, urllib.error
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

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    hoy = datetime.date.today(); cur = hoy.strftime('%Y-%m')
    for cid, cy in (('r', 2), ('u', 1)):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': 'Cliente ' + cid, 'estado': 'activo', 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': cur + '-01', 'desde': cur, 'ciclo': cy, 'precio': 23000}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 420, 'height': 900}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        r = await pg.evaluate("cicloCambio(S.clientes.get('r'), 1)")
        check('del ciclo 2 al 1 no hay descuento: avisa lo que debe y desde cuándo paga del 1 al 10', r and r['nuevo'] == 1 and r['act'] == 2 and r['debe'] == 23000 and r['desde'] == 1 and r['hasta'] == 10 and r['precio'] == 23000 and 'dias' not in r, r)
        r2 = await pg.evaluate("cicloCambio(S.clientes.get('u'), 2)")
        check('del ciclo 1 al 2 paga del 13 al 20', r2 and r2['desde'] == 13 and r2['hasta'] == 20, r2)
        check('con el mismo ciclo no hay nada que calcular', await pg.evaluate("cicloCambio(S.clientes.get('r'), 2)") is None)
        await pg.evaluate("openClientForm('r')"); await pg.wait_for_selector('#cf-ciclo')
        check('al abrir la ficha el aviso está oculto', await pg.is_hidden('#cf-ciclo-calc'))
        await pg.select_option('#cf-ciclo', '1')
        tx = await pg.inner_text('#cf-ciclo-calc')
        check('al elegir el otro ciclo el aviso dice que no hay ajuste, cuánto debe y desde cuándo paga', 'no hay descuento ni recargo' in tx and 'cobrale eso antes de cambiar' in tx and 'del 1 al 10' in tx, tx)
        await pg.select_option('#cf-ciclo', '2')
        check('al volver al ciclo actual el aviso se oculta', await pg.is_hidden('#cf-ciclo-calc'))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
