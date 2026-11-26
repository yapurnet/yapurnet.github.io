# Suspender y reconectar desde la ficha del cliente: antes solo se podía por Editar → Estado o con el botón de la lista de Cortes.
# El botón «Suspender» (cliente activo) pide confirmación, lo pasa a suspendido y el servidor le manda la orden de corte a los routers (agregar su IP a «Clientes Cortados» con su nombre);
# «Reconectar» (cliente suspendido) pide confirmación, lo pasa a activo y manda la orden de reconexión (borrar la entrada); si todavía debe, la confirmación lo advierte.
# Un técnico no ve ninguno de los dos.
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
async def abrir(pg, cid):
    await pg.evaluate(f"openClient('{cid}')"); await pg.wait_for_selector('.sheet [data-act=editar]')
async def confirmar(pg, si=True):
    await pg.wait_for_selector('[role=dialog] [data-act=yes]', timeout=4000)
    txt = await pg.inner_text('[role=dialog]')
    await pg.click('[role=dialog] [data-act=%s]' % ('yes' if si else 'no'))
    return txt

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'tec1', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro1', 'permisos': {'clientesTodos': True}}, TA)
    cur = datetime.date.today().strftime('%Y-%m'); nxt = (datetime.date.today().replace(day=1) + datetime.timedelta(days=32)).strftime('%Y-%m')
    base = {'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': cur + '-01', 'ciclo': 1, 'precio': 20000}
    api('PATCH', '/api/doc/clientes/' + shard('ca'), {'data': {'items': {'ca': dict(base, nombre='Cliente Activo', ip='10.20.41.60', estado='activo', desde=nxt)}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('cs'), {'data': {'items': {'cs': dict(base, nombre='Cliente Suspendido Al Dia', ip='10.20.41.61', estado='suspendido', corteMora=cur + '-01', desde=nxt)}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('cd'), {'data': {'items': {'cd': dict(base, nombre='Cliente Suspendido Debe', ip='10.20.41.62', estado='suspendido', corteMora=cur + '-01', desde=cur)}}}, TA)
    st, j = api('POST', '/api/routers', {'nombre': 'ADMIN02', 'kinds': ['q']}, TA); rid = j['router']['id']
    st, j = api('POST', f'/api/routers/{rid}/reco-token', {}, TA); TK = j['token']
    def cola(v2=False):
        rq = urllib.request.Request(BASE + '/api/router/reco' + ('?v=2' if v2 else ''), headers={'Authorization': 'Bearer ' + TK})
        return urllib.request.urlopen(rq).read().decode()
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1000, 'height': 900}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')

        await abrir(pg, 'ca')
        check('un cliente activo muestra «Suspender» y no «Reconectar»', await pg.locator('.sheet [data-act=suspender]').count() == 1 and await pg.locator('.sheet [data-act=reconectar]').count() == 0)
        await pg.click('.sheet [data-act=suspender]')
        t = await confirmar(pg, False)
        check('pide confirmación y avisa que se le corta el internet (los routers agregan la IP a «Clientes Cortados»)', 'cortes automáticos' in t and 'Clientes Cortados' in t, t)
        await pg.wait_for_timeout(500)
        check('si se cancela, el cliente sigue activo', await pg.evaluate("S.clientes.get('ca').estado") == 'activo')
        await abrir(pg, 'ca')
        await pg.click('.sheet [data-act=suspender]'); await confirmar(pg, True)
        await pg.wait_for_function("S.clientes.get('ca').estado==='suspendido'", timeout=6000)
        check('al confirmar queda suspendido con la fecha de corte', await pg.evaluate("S.clientes.get('ca').estado==='suspendido'&&!!S.clientes.get('ca').corteMora"))
        check('el servidor le manda a los routers la orden de CORTE con la IP y el nombre completo', cola(True).split(',')[0].split(':')[1:] == ['c', '10.20.41.60', '', 'Cliente Activo'], cola(True))
        check('los scripts viejos (que solo reactivan) no la reciben', cola() == '', cola())

        await abrir(pg, 'ca')
        check('ahora muestra «Reconectar» y no «Suspender»', await pg.locator('.sheet [data-act=reconectar]').count() == 1 and await pg.locator('.sheet [data-act=suspender]').count() == 0)
        await pg.click('.sheet [data-act=reconectar]'); await confirmar(pg, True)
        await pg.wait_for_function("S.clientes.get('ca').estado==='activo'", timeout=6000)
        check('reconectar lo pasa a activo y anota la fecha de reconexión', await pg.evaluate("!S.clientes.get('ca').corteMora&&!!S.clientes.get('ca').reconectado"))
        check('y la orden de corte se reemplaza por la de reconexión (borrar la entrada)', cola(True).count(',') == 0 and cola(True).split(':')[1:3] == ['r', '10.20.41.60'], cola(True))
        check('el script viejo también la recibe', cola().endswith(':10.20.41.60:') and cola().count(',') == 0, cola())

        await abrir(pg, 'cd')
        await pg.click('.sheet [data-act=reconectar]')
        t = await confirmar(pg, False)
        check('si el cliente todavía debe, la confirmación lo advierte', 'todavía debe' in t and 'promesa' in t, t)
        check('si se cancela, sigue suspendido', await pg.evaluate("S.clientes.get('cd').estado") == 'suspendido')

        await abrir(pg, 'cs')
        await pg.click('.sheet [data-act=reconectar]')
        t = await confirmar(pg, False)
        check('si está al día, no lo advierte', 'todavía debe' not in t, t)

        ctx2 = await br.new_context(viewport={'width': 1000, 'height': 900}, bypass_csp=True)
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        tp = await login(ctx2, 'tec1', 'pedro1')
        await tp.evaluate("openClient('ca')"); await tp.wait_for_selector('.sheet')
        check('un técnico (aunque vea todos los clientes) no ve ni «Suspender» ni «Reconectar»', await tp.locator('.sheet [data-act=suspender]').count() == 0 and await tp.locator('.sheet [data-act=reconectar]').count() == 0)
        await tp.keyboard.press('Escape'); await tp.wait_for_timeout(300)
        await tp.evaluate("openClient('cs')"); await tp.wait_for_selector('.sheet')
        check('tampoco en un cliente suspendido', await tp.locator('.sheet [data-act=reconectar]').count() == 0)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
