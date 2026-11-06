# Abonado nuevo: el técnico completa los datos reales (nombre, teléfono, domicilio, DNI, caja y puerto), termina la orden y ve el cobro según su permiso.
# Chromium real con ubicación simulada (Playwright), igual que lo haría el WebView del celular.
import asyncio, json, os, sys, time, urllib.request, urllib.error, re
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo contesta «Ahora no» como lo haría una persona
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass

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
ESTADO_PAGO = re.compile(r'\b(activo|suspendido)\b', re.I)   # lo que el técnico no debe ver de un cliente
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and 'Geolocation' not in m.text and 'status of 4' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    await sin_aviso(pg)
    return pg

async def toasts(pg): return await pg.inner_text('#toastRoot')
async def tabs(pg): return await pg.evaluate("[...document.querySelectorAll('#tabs .tab')].map(b=>b.textContent.replace(/\\d+$/,'').trim())")
async def gps_fill(pg, ctx, lat, lng, acc=5):
    await ctx.set_geolocation({'latitude': lat, 'longitude': lng, 'accuracy': acc})
    await pg.click('#cf-gps')
    await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=8000)
async def red_id(pg, nombre): return await pg.evaluate("n => { const p=[...S.red.values()].find(x=>x.nombre===n); return p?p.id:null; }", nombre)


async def sheet(pg): return (await pg.inner_text('.sheet')).replace('\xa0', ' ')
async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'milton', 'nombre': 'Milton', 'role': 'tecnico', 'clave': 'milton123', 'permisos': {}}, TA)
    api('POST', '/api/users', {'usuario': 'nando', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'nando123', 'permisos': {'cobrarCampo': True}}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    milton = next(u for u in ul['users'] if u['usuario'] == 'milton'); nando = next(u for u in ul['users'] if u['usuario'] == 'nando')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    api('PATCH', '/api/doc/red/puntos', {'data': {'items': {'n1': {'tipo': 'nap', 'nombre': 'Caja pon 41', 'puertos': 8, 'creado': 1, 'mod': 1}}}}, TA)
    for cid, c in {
        'p1': {'nombre': 'Tevez', 'estado': 'pendiente', 'ref': 'Frente al hospital', 'planId': 'p1'},
        'p2': {'nombre': 'Nuevo Dos', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle 2'},
        'a': {'nombre': 'Ana Activa', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1', 'tel': '3844000001', 'desde': cur},
        'z': {'nombre': 'Zoe Sola', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 9', 'tel': '3844000009', 'desde': cur}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    for oid, tipo, cid, tec, est in (('o1', 'instalacion', 'p1', milton['id'], 'en_curso'), ('o2', 'falla', 'a', milton['id'], 'en_curso'), ('o3', 'instalacion', 'p2', nando['id'], 'en_curso'), ('o4', 'instalacion', 'p2', milton['id'], 'pendiente')):
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {oid: {'tipo': tipo, 'clientId': cid, 'estado': est, 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': tec}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        ctx = await nuevo()

        # 1) Milton (técnico sin permiso de cobrar en la calle) en una orden de instalación de un abonado nuevo
        pg = await login(ctx, 'milton', 'milton123')
        await pg.wait_for_function('S.clientes.size >= 4 && S.ordenes.size >= 3', timeout=10000)
        await pg.click('#tabs [data-tab=ordenes]')
        await pg.wait_for_selector('[data-oid="o1"]')
        check('la orden de un abonado nuevo ofrece «Cargar datos del abonado»', 'Cargar datos del abonado' in await pg.inner_text('[data-oid="o1"] [data-oact=cliente]'))
        check('y una orden de reclamo de un cliente ya instalado, solo «Datos del abonado»', (await pg.inner_text('[data-oid="o2"] [data-oact=cliente]')).strip() == 'Datos del abonado')
        check('el botón que edita la orden se llama «Editar orden» (no se confunde con editar al abonado)', 'Editar orden' in await pg.inner_text('[data-oid="o1"] [data-oact=edit]'))
        await pg.click('[data-oid="o1"] [data-oact=cliente]'); await pg.wait_for_selector('#cform')
        check('el formulario deja cargar nombre, teléfonos, DNI, calle y localidad', all([await pg.query_selector(s) is not None for s in ('#cf-nombre', '#cf-tel', '#cf-tel2', '#cf-dni', '#cf-dir', '#cf-loc')]))
        check('y la caja NAP con su puerto, IP, usuario y equipo', all([await pg.query_selector(s) is not None for s in ('#cf-nap', '#cf-nap-puerto', '#cf-ip', '#cf-usuario', '#cf-equipo')]))
        check('pero no el precio, el estado ni nada de facturación (el plan sí: lo elige el técnico, sin precios)', all([await pg.query_selector(s) is None for s in ('#cf-precio', '#cf-estado', '#cf-desde', '#cf-ciclo', '#cf-da')]) and await pg.query_selector('#cf-plan') is not None and '$' not in await pg.inner_text('#cf-plan'))
        await pg.fill('#cf-nombre', 'Tevez Carlos'); await pg.fill('#cf-tel', '3844111222'); await pg.fill('#cf-dni', '30111222')
        await pg.fill('#cf-dir', 'Belgrano 123'); await pg.fill('#cf-loc', 'Añatuya'); await pg.fill('#cf-ip', '10.20.41.5'); await pg.fill('#cf-usuario', 'tevez'); await pg.fill('#cf-equipo', 'ZTEG1234')
        await pg.select_option('#cf-nap', 'n1'); await pg.fill('#cf-nap-puerto', '3')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('Cliente guardado')", timeout=6000)
        st, j = api('GET', '/api/doc/clientes/' + shard('p1'), None, TA); c1 = j['data']['items']['p1']
        check('en el servidor quedaron los datos reales del abonado', c1['nombre'] == 'Tevez Carlos' and c1['tel'] == '3844111222' and c1['dir'] == 'Belgrano 123' and c1['loc'] == 'Añatuya' and c1['dni'] == '30111222', c1)
        check('con su caja, puerto, IP, usuario y equipo', c1['nap'] == 'n1' and c1['napPuerto'] == 3 and c1['ip'] == '10.20.41.5' and c1['usuario'] == 'tevez' and c1['equipo'] == 'ZTEG1234', c1)
        check('y no se tocó la facturación: sigue pendiente y con su plan', c1['estado'] == 'pendiente' and c1['planId'] == 'p1', c1)
        await pg.evaluate("openClientForm('p1')"); await pg.wait_for_selector('#cform')
        check('al volver a abrirlo el técnico no ve el DNI guardado (campo vacío) pero sí el resto', await pg.input_value('#cf-dni') == '' and await pg.input_value('#cf-nombre') == 'Tevez Carlos' and await pg.input_value('#cf-dir') == 'Belgrano 123')
        await pg.fill('#cf-loc', 'Añatuya Centro'); await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('Cliente guardado')", timeout=6000)
        await pg.wait_for_function("S.clientes.get('p1').loc === 'Añatuya Centro'", timeout=6000)
        st, j = api('GET', '/api/doc/clientes/' + shard('p1'), None, TA)
        check('si lo guarda con el DNI vacío no se borra el DNI que ya estaba', j['data']['items']['p1']['dni'] == '30111222' and j['data']['items']['p1']['loc'] == 'Añatuya Centro', j['data']['items']['p1'])
        # clientes ya instalados: el técnico solo toca los datos técnicos
        await pg.evaluate("openClientForm('z')"); await pg.wait_for_selector('#cform')
        check('un cliente ya instalado y sin instalación abierta: solo datos técnicos (sin nombre ni domicilio)', await pg.query_selector('#cf-nombre') is None and await pg.query_selector('#cf-dir') is None and await pg.query_selector('#cf-nap') is not None)
        await pg.click('#cform [data-close]')
        await pg.evaluate("openClientForm('a')"); await pg.wait_for_selector('#cform')
        check('y uno con un reclamo abierto (no instalación) tampoco puede cambiar nombre ni domicilio', await pg.query_selector('#cf-nombre') is None)
        await pg.click('#cform [data-close]')
        await pg.evaluate("openClient('a')"); await pg.wait_for_selector('.sheet [data-act=editar]')
        check('en la ficha del cliente con un reclamo el botón sigue siendo «Editar datos técnicos»', 'Editar datos técnicos' in await pg.inner_text('.sheet [data-act=editar]'))
        await pg.click('.sheet [data-close]')
        await pg.evaluate("openClient('p1')"); await pg.wait_for_selector('.sheet [data-act=editar]')
        check('y en el del abonado nuevo dice «Cargar datos del abonado»', 'Cargar datos del abonado' in await pg.inner_text('.sheet [data-act=editar]'))
        await pg.click('.sheet [data-close]')

        # 2) terminar la orden: sin permiso de cobrar avisa que lo cobrado se le informa a la oficina; el cierre y la caja funcionan
        await pg.click('[data-oid="o1"] [data-oact=next]'); await pg.wait_for_selector('#fform')
        sh = await sheet(pg)
        check('al terminar, sin permiso de cobro, dice que avise a la oficina cuánto cobró', 'no registra cobros' in sh and await pg.query_selector('#ff-cobro') is None, sh[:400])
        check('la caja NAP y el puerto ya cargados vienen puestos', await pg.input_value('#cf-nap') == 'n1' and await pg.input_value('#cf-nap-puerto') == '3')
        await pg.fill('#ff-res', 'Se instaló ONU, señal -19 dBm.'); await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("S.ordenes.get('o1') && S.ordenes.get('o1').estado === 'hecha'", timeout=6000)
        check('la orden queda hecha', True)
        # desde «Editar orden» también se llega a terminar
        await pg.click('#tabs [data-tab=ordenes]')
        await pg.click('[data-oid="o4"] [data-oact=edit]'); await pg.wait_for_selector('#oform')
        check('«Editar orden» tiene un acceso a «Ir a terminar la orden»', await pg.query_selector('#of-fin') is not None)
        await pg.click('#of-fin'); await pg.wait_for_selector('#fform')
        check('que abre el cierre de la orden', 'Marcar como hecha' in await pg.inner_text('#fform'))
        await pg.click('#fform [data-close]')
        await ctx.close()

        # 3) un técnico con permiso de cobrar en la calle ve el cobro de la instalación con el precio fijo
        ctx2 = await nuevo(); pn = await login(ctx2, 'nando', 'nando123')
        await pn.wait_for_function('S.ordenes.size >= 3', timeout=10000)
        await pn.click('#tabs [data-tab=ordenes]'); await pn.wait_for_selector('[data-oid="o3"] [data-oact=next]')
        await pn.click('[data-oid="o3"] [data-oact=next]'); await pn.wait_for_selector('#fform')
        check('con permiso de cobro aparece «Cobré este trabajo»', await pn.query_selector('#ff-cobro') is not None and 'no registra cobros' not in await sheet(pn))
        await pn.check('#ff-cobro')
        check('y la instalación viene con el precio fijo de $ 65.000, que no se puede cambiar', await pn.input_value('#ff-monto') == '65000' and await pn.evaluate("document.querySelector('#ff-monto').readOnly") is True)
        await ctx2.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
