# Al instalar, el técnico elige el plan que quiere el abonado nuevo (sin precios, y solo si está «por instalar») y el nodo o torre desde una lista.
# Chromium real contra el servidor de verdad (workerd). Un técnico con el permiso apagado no ve ni la lista de planes.
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
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
def shard(cid):   # igual que clientShard() de la app
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
def cliente(tok, cid):
    st, j = api('GET', '/api/doc/clientes/' + shard(cid), None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(cid)
async def opciones(pg, sel): return await pg.evaluate("s => [...document.querySelectorAll(s + ' option')].map(o => [o.value, o.textContent.trim()])", sel)

async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'sinplan', 'nombre': 'Sin Plan', 'role': 'tecnico', 'clave': 'sinplan123', 'permisos': {'elegirPlan': False}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro'); sp = next(u for u in ul['users'] if u['usuario'] == 'sinplan')
    for pid, d in (('p1', {'nombre': 'Hogar 50', 'bajada': 50, 'subida': 20, 'precio': 20000}), ('p2', {'nombre': 'Hogar 100', 'bajada': 100, 'subida': 50, 'precio': 30000}), ('p3', {'nombre': 'Plan Viejo', 'bajada': 10, 'subida': 5, 'precio': 9000, 'activo': False})):
        api('PUT', '/api/doc/planes/' + pid, {'data': dict(d, tecnologia='fibra', **({} if 'activo' in d else {'activo': True}))}, TA)
    cl = {
        'n': {'nombre': 'Nuevo Abonado', 'estado': 'pendiente', 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '3844000001'},
        'm': {'nombre': 'Otro Nuevo', 'estado': 'pendiente', 'dir': 'Calle 2', 'loc': 'Añatuya', 'tel': '3844000002'},
        'i': {'nombre': 'Ya Instalado', 'estado': 'activo', 'planId': 'p2', 'dir': 'Calle 3', 'tel': '3844000003', 'nodo': 'Torre Leo'},
        'x1': {'nombre': 'Cliente Admin Uno', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 4', 'tel': '3844000004', 'nodo': 'ADMIN02'},
        'x2': {'nombre': 'Cliente Admin Dos', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 5', 'tel': '3844000005', 'nodo': 'admin02'},
        'x3': {'nombre': 'Cliente Cejas', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 6', 'tel': '3844000006', 'nodo': 'FM04'}}
    for cid, c in cl.items(): api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    for oid, cid, tec in (('o1', 'n', pedro['id']), ('o2', 'm', sp['id'])):
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {oid: {'tipo': 'instalacion', 'clientId': cid, 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': tec}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el técnico completa al abonado nuevo: plan y nodo desde listas
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.wait_for_function("S.planes.size === 3 && S.loaded.ordenes", timeout=10000)
        check('el técnico recibe los planes (sin precios) y el de los clientes ya instalados sigue oculto', await pt.evaluate("[...S.planes.values()].every(p => p.precio === undefined && p.hist === undefined) && S.clientes.get('i').planId === undefined && S.clientes.get('x1').planId === undefined"))
        await pt.click('#tabs [data-tab=ordenes]'); await pt.wait_for_selector('[data-oid="o1"] [data-oact=cliente]')
        await pt.click('[data-oid="o1"] [data-oact=cliente]'); await pt.wait_for_selector('#cform')
        pl = await opciones(pt, '#cf-plan')
        check('el formulario tiene «Plan que quiere el cliente» con los planes que se ofrecen (sin el que ya no se vende)', pl == [['', 'Todavía no eligió'], ['p1', 'Hogar 50 · 50/20 Mbps'], ['p2', 'Hogar 100 · 100/50 Mbps']], pl)
        check('sin precios en ninguna parte del formulario', not re.search(r'\$|20\.?000|30\.?000|9\.?000', await pt.inner_text('#cform')), await pt.inner_text('#cform'))
        nd = await opciones(pt, '#cf-nodo-sel')
        check('el nodo es una lista con los que ya existen (ADMIN02 una sola vez aunque esté escrito distinto), «Sin definir» y «Otro»', [v for v, _ in nd] == ['', 'ADMIN02' if any(v == 'ADMIN02' for v, _ in nd) else 'admin02', 'FM04', 'Torre Leo', '__otro'] and len(nd) == 5, nd)
        check('el campo para escribir un nodo nuevo está oculto', not await pt.is_visible('#cf-nodo'))
        await pt.select_option('#cf-plan', 'p2'); await pt.select_option('#cf-nodo-sel', 'Torre Leo')
        await pt.click('#cform button[type=submit]')
        await pt.wait_for_function("S.clientes.get('n').planId === 'p2'", timeout=8000)
        n = cliente(TA, 'n')
        check('queda guardado el plan y el nodo, y el abonado sigue «por instalar»', n.get('planId') == 'p2' and n.get('nodo') == 'Torre Leo' and n.get('estado') == 'pendiente', n)
        await pt.evaluate("openClient('n')"); await pt.wait_for_selector('.sheet')
        fich = await pt.inner_text('.sheet')
        check('la ficha le muestra el plan elegido (sin precio) y no ofrece copiar la cola de MikroTik', 'Hogar 100 · 100/50 Mbps' in fich and '30' not in fich.split('Hogar 100')[1][:20] and 'Copiar cola' not in fich, fich[:600])
        await pt.click('.sheet [data-close]'); await pt.wait_for_selector('.sheet', state='detached')
        check('de un cliente ya instalado no ve el plan ni en pantalla', await pt.evaluate("planVis(S.clientes.get('i')) === null && planVis(S.clientes.get('x1')) === null && verPlanDe(S.clientes.get('i')) === false"))
        # reabrir: vienen elegidos; «Otro» para un nodo nuevo
        await pt.evaluate("openClientForm('n')"); await pt.wait_for_selector('#cform')
        check('al volver a abrirlo el plan y el nodo vienen elegidos', await pt.input_value('#cf-plan') == 'p2' and await pt.input_value('#cf-nodo-sel') == 'Torre Leo')
        await pt.select_option('#cf-nodo-sel', '__otro')
        check('«Otro» muestra el campo para escribir', await pt.is_visible('#cf-nodo') and await pt.input_value('#cf-nodo') == '')
        await pt.fill('#cf-nodo', 'Nodo Nuevo 9'); await pt.click('#cform button[type=submit]')
        await pt.wait_for_function("S.clientes.get('n').nodo === 'Nodo Nuevo 9'", timeout=8000)
        check('el nodo nuevo queda guardado y el plan no se toca', cliente(TA, 'n').get('nodo') == 'Nodo Nuevo 9' and cliente(TA, 'n').get('planId') == 'p2')
        await pt.evaluate("openClientForm('n')"); await pt.wait_for_selector('#cform')
        check('y a partir de ahí figura en la lista de nodos', await pt.input_value('#cf-nodo-sel') == 'Nodo Nuevo 9' and not await pt.is_visible('#cf-nodo'))
        await pt.select_option('#cf-nodo-sel', ''); await pt.click('#cform button[type=submit]')
        await pt.wait_for_function("!S.clientes.get('n').nodo", timeout=8000)
        check('«Sin definir» deja el nodo vacío', not cliente(TA, 'n').get('nodo'))
        # 2) al terminar la orden de instalación también se carga el plan y el nodo
        await pt.evaluate("openFinishOrder(S.ordenes.get('o1'))"); await pt.wait_for_selector('#fform')
        check('«Terminar orden» pide el plan que eligió el cliente y el nodo', await pt.query_selector('#ff-plan') is not None and await pt.query_selector('#ff-nodo-sel') is not None and await pt.input_value('#ff-plan') == 'p2', await pt.inner_text('#fform'))
        await pt.select_option('#ff-plan', 'p1'); await pt.select_option('#ff-nodo-sel', 'FM04'); await pt.fill('#ff-res', 'Se instaló la ONU')
        await pt.click('#fform button[type=submit]')
        await pt.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'hecha' && S.clientes.get('n').planId === 'p1'", timeout=8000)
        n = cliente(TA, 'n')
        check('la orden queda hecha y el abonado con el plan y el nodo elegidos (sigue «por instalar» hasta que la oficina lo active)', n.get('planId') == 'p1' and n.get('nodo') == 'FM04' and n.get('estado') == 'pendiente', n)
        await pt.close()

        # 3) un técnico sin el permiso: el nodo sí, el plan no
        ps = await login(await nuevo(), 'sinplan', 'sinplan123')
        await ps.wait_for_function("S.loaded.ordenes && S.loaded.clientes", timeout=10000)
        check('sin el permiso el técnico no recibe ningún plan', await ps.evaluate("S.planes.size === 0 && [...S.clientes.values()].every(c => c.planId === undefined)"))
        await ps.click('#tabs [data-tab=ordenes]'); await ps.wait_for_selector('[data-oid="o2"] [data-oact=cliente]')
        await ps.click('[data-oid="o2"] [data-oact=cliente]'); await ps.wait_for_selector('#cform')
        check('el formulario no trae el plan, pero sí la lista de nodos', await ps.query_selector('#cf-plan') is None and await ps.query_selector('#cf-nodo-sel') is not None)
        await ps.select_option('#cf-nodo-sel', 'FM04'); await ps.click('#cform button[type=submit]')
        await ps.wait_for_function("S.clientes.get('m').nodo === 'FM04'", timeout=8000)
        check('guarda el nodo y no toca el plan', cliente(TA, 'm').get('nodo') == 'FM04' and not cliente(TA, 'm').get('planId'))
        await ps.close()

        # 4) la oficina sigue viendo el plan con sus precios y el nodo en lista
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.wait_for_function("S.planes.size === 3 && S.loaded.clientes", timeout=10000)
        await po.evaluate("openClientForm('n')"); await po.wait_for_selector('#cform')
        pl = await opciones(po, '#cf-plan')
        check('la oficina ve el plan con sus precios y el elegido por el técnico', any('$' in t for _, t in pl) and await po.input_value('#cf-plan') == 'p1' and await po.input_value('#cf-nodo-sel') == 'FM04', pl)
        await po.close()
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
