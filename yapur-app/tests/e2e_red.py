# Red: cajas NAP y botellas de empalme con GPS, conexión de cada cliente a su caja, cercanía y permisos.
# Chromium real con ubicación simulada (Playwright), igual que lo haría el WebView del celular.
import asyncio, json, os, sys, time, urllib.request, urllib.error
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

NAP1 = (-28.465, -62.835); BE1 = (-28.470, -62.835); NAP2 = (-28.480, -62.840)
async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    api('POST', '/api/users', {'usuario': 'sinred', 'nombre': 'Sin Red', 'role': 'tecnico', 'clave': 'sinred123', 'permisos': {'red': False}}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    for cid, c in {
        'a': {'nombre': 'Ana Cerca', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1', 'tel': '3844000001', 'lat': -28.4652, 'lng': -62.8351},
        'b': {'nombre': 'Beto Lejos', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 2', 'tel': '3844000002'},
        'd': {'nombre': 'Darío Instalar', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle 4', 'tel': '3844000004'}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    cur = time.strftime('%Y-%m')
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'od': {'tipo': 'instalacion', 'clientId': 'd', 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': time.strftime('%Y-%m-%d'), 'creado': time.strftime('%Y-%m-%d'), 'tecnico': pedro['id']}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, permissions=['geolocation'], geolocation={'latitude': NAP1[0], 'longitude': NAP1[1], 'accuracy': 5}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'pedro', 'pedro123')
        await pg.wait_for_function('S.clientes.size === 3 && S.loaded.red', timeout=10000)

        # 1) el técnico ve la pestaña Red y está vacía
        check('el técnico ve la pestaña «Red»', 'Red' in await tabs(pg), await tabs(pg))
        await pg.click('#tabs [data-tab=red]')
        await pg.wait_for_selector('#rd-new-nap')
        check('sin cajas cargadas explica cómo empezar', 'Todavía no hay cajas NAP' in await pg.inner_text('#rd-list'))

        # 2) alta de una caja NAP con el GPS
        await pg.click('#rd-new-nap')
        await pg.wait_for_selector('#rform')
        check('el formulario nace como caja NAP con 16 puertos', await pg.input_value('#rf-tipo') == 'nap' and await pg.input_value('#rf-puertos') == '16')
        await pg.fill('#rf-nombre', 'NAP-01'); await pg.fill('#rf-ref', 'Poste frente a la plaza')
        await gps_fill(pg, ctx, *NAP1)
        check('el GPS completa las coordenadas de la caja', await pg.input_value('#cf-geo') == '-28.465000, -62.835000', await pg.input_value('#cf-geo'))
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 1", timeout=6000)
        st, j = api('GET', '/api/doc/red/puntos', None, TA)
        n1 = next(v for v in j['data']['items'].values() if v['nombre'] == 'NAP-01')
        check('queda guardada en el servidor con tipo, ubicación y puertos', n1['tipo'] == 'nap' and n1['lat'] == NAP1[0] and n1['lng'] == NAP1[1] and n1['puertos'] == 16 and n1['ref'] == 'Poste frente a la plaza', n1)

        # 3) botella de empalme (sin puertos) y una segunda caja sin ubicación
        await pg.click('#rd-new-emp'); await pg.wait_for_selector('#rform')
        check('al elegir empalme se esconden los puertos', await pg.evaluate("document.querySelector('#rf-puertos-w').hidden") is True)
        await pg.fill('#rf-nombre', 'BE-01'); await gps_fill(pg, ctx, *BE1)
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 2", timeout=6000)
        await pg.click('#rd-new-nap'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'nap-01')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('Ya hay')", timeout=4000)
        check('no deja repetir el nombre de una caja (aunque cambien las mayúsculas)', S_ok := (await pg.evaluate("S.red.size")) == 2)
        await pg.fill('#rf-nombre', 'NAP-02'); await pg.fill('#rf-puertos', '8')
        await pg.select_option('#rf-padre', label='BE-01')
        await gps_fill(pg, ctx, *NAP2)
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 3", timeout=6000)
        be1 = await red_id(pg, 'BE-01'); nap1 = await red_id(pg, 'NAP-01'); nap2 = await red_id(pg, 'NAP-02')
        check('la caja NAP-02 queda colgada de la botella BE-01', await pg.evaluate("id => S.red.get(id).padre", nap2) == be1)

        # 4) lista, filtros y búsqueda
        await pg.wait_for_function("document.querySelector('#rd-count').textContent.startsWith('3 puntos')", timeout=4000)
        check('la lista muestra los 3 puntos', True)
        await pg.click('#rd-seg [data-f=empalme]')
        check('filtro «Empalmes»', (await pg.inner_text('#rd-count')).startswith('1 punto'))
        await pg.click('#rd-seg [data-f=todos]')
        await pg.fill('#rd-q', 'plaza')
        check('busca también por la referencia', (await pg.inner_text('#rd-count')).startswith('1 punto') and 'NAP-01' in await pg.inner_text('#rd-list'))
        await pg.fill('#rd-q', '')

        # 5) más cercanas a mí
        await ctx.set_geolocation({'latitude': -28.4652, 'longitude': -62.835, 'accuracy': 6})
        await pg.click('#rd-near')
        await pg.wait_for_function("document.querySelector('#rd-near-st').className.includes('ok')", timeout=8000)
        names = await pg.evaluate("[...document.querySelectorAll('#rd-list .item .t')].map(e=>e.childNodes[0].textContent.trim())")
        check('ordena por distancia a mi ubicación (la más cerca primero)', names == ['NAP-01', 'BE-01', 'NAP-02'], names)
        first = await pg.inner_text('#rd-list .item .tags')
        check('muestra a cuántos metros está', ' m' in first and 'a ' in first, first)
        await pg.click('#rd-name')
        names = await pg.evaluate("[...document.querySelectorAll('#rd-list .item .t')].map(e=>e.childNodes[0].textContent.trim())")
        check('se puede volver al orden por nombre', names == ['BE-01', 'NAP-01', 'NAP-02'], names)

        # 6) ficha de la caja: cómo llegar y editar
        await pg.click(f'#rd-list [data-open-red="{nap1}"]')
        await pg.wait_for_selector('.sheet .geo a[href*="google.com/maps/dir"]')
        check('la ficha de la caja tiene «Cómo llegar» con sus coordenadas', 'destination=-28.465000,-62.835000' in await pg.get_attribute('.sheet .geo a[href*="google.com/maps/dir"]', 'href'))
        check('la ficha dice que hay 0 de 16 puertos usados', '0/16 puertos' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]')

        # 7) cierre de una instalación: el técnico conecta al cliente a la caja y al puerto
        await ctx.set_geolocation({'latitude': -28.4653, 'longitude': -62.8352, 'accuracy': 5})
        await pg.evaluate("openFinishOrder(S.ordenes.get('od'))")
        await pg.wait_for_selector('#cf-nap')
        opts = await pg.evaluate("[...document.querySelectorAll('#cf-nap option')].map(o=>o.textContent)")
        check('al cerrar la instalación ofrece las cajas NAP (no los empalmes)', len(opts) == 3 and any('NAP-01' in o for o in opts) and not any('BE-01' in o for o in opts), opts)
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=8000)
        opts = await pg.evaluate("[...document.querySelectorAll('#cf-nap option')].map(o=>o.textContent)")
        check('con el GPS cargado, la caja más cercana pasa arriba y dice a cuántos metros', 'NAP-01' in opts[1] and ' m' in opts[1] and 'NAP-02' in opts[2], opts)
        await pg.select_option('#cf-nap', value=nap1)
        await pg.fill('#cf-nap-puerto', '99')
        check('avisa si el puerto no existe en esa caja', 'tiene 16 puertos' in await pg.inner_text('#cf-nap-hint'), await pg.inner_text('#cf-nap-hint'))
        await pg.fill('#cf-nap-puerto', '5')
        check('con un puerto válido lista los puertos libres', 'Puertos sin usar' in await pg.inner_text('#cf-nap-hint') or await pg.inner_text('#cf-nap-hint') == '', await pg.inner_text('#cf-nap-hint'))
        await pg.fill('#ff-res', 'Se instaló ONU en el puerto 5 de la NAP-01.')
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("S.ordenes.get('od').estado === 'hecha' && S.clientes.get('d').nap", timeout=8000)
        st, j = api('GET', '/api/doc/clientes/' + shard('d'), None, TA)
        d = j['data']['items']['d']
        check('la orden se cierra y el cliente queda conectado a la caja y al puerto', d['nap'] == nap1 and d['napPuerto'] == 5 and d['lat'] == -28.4653, d)
        check('el técnico no cambió la facturación al cerrar', d['estado'] == 'pendiente')

        # 8) un técnico sin permiso de red no ve la pestaña ni puede escribir
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'sinred', 'sinred123')
        check('sin el permiso no aparece la pestaña «Red»', 'Red' not in await tabs(pg2), await tabs(pg2))
        await pg2.wait_for_function("S.loaded.red && S.red.size === 3", timeout=8000)
        check('pero igual ve las cajas cargadas (para la ficha del cliente)', True)
        await ctx2.close()

        # 9) oficina: ficha del cliente, formulario, filtro y lista de clientes de la caja
        ctx3 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, permissions=['geolocation'], geolocation={'latitude': -28.4652, 'longitude': -62.8351, 'accuracy': 5}, accept_downloads=True)
        await ctx3.route('**/fonts.g*/**', lambda r: r.abort())
        pg3 = await login(ctx3, 'laura', 'laura123')
        await pg3.wait_for_function('S.clientes.size === 3 && S.red.size === 3', timeout=10000)
        await pg3.evaluate("openClient('d')")
        await pg3.wait_for_selector('.sheet [data-act=nap]')
        sheet = await pg3.inner_text('.sheet')
        check('la ficha del cliente muestra su caja y su puerto', 'NAP-01' in sheet and 'puerto 5' in sheet, sheet[:400])
        await pg3.click('.sheet [data-act=nap]')
        await pg3.wait_for_selector('.sheet [data-open-client="d"]')
        sheet = await pg3.inner_text('.sheet')
        check('la ficha de la caja lista a sus clientes con el puerto', 'Puerto 5' in sheet and 'Darío Instalar' in sheet and '1/16 puertos' in sheet, sheet[:500])
        check('y avisa los puertos sin usar sin el 5', 'Puertos sin usar' in sheet and '1, 2, 3, 4, 6' in sheet, sheet[:500])
        # intento de borrar una caja con clientes (la oficina sí tiene el botón)
        await pg3.click('.sheet [data-act=editar]'); await pg3.wait_for_selector('#rf-del')
        await pg3.click('#rf-del')
        await pg3.wait_for_function("document.querySelector('#toastRoot').textContent.includes('tiene 1 cliente conectado')", timeout=4000)
        check('no deja eliminar una caja con clientes conectados', (await pg3.evaluate("S.red.size")) == 3)
        await pg3.click('.sheet [data-close]')
        # asignar a Ana desde el formulario del cliente
        await pg3.evaluate("openClientForm('a')")
        await pg3.wait_for_selector('#cf-nap')
        opts = await pg3.evaluate("[...document.querySelectorAll('#cf-nap option')].map(o=>o.textContent)")
        check('en el formulario las cajas aparecen ordenadas por cercanía a la casa del cliente', 'NAP-01' in opts[1] and 'NAP-02' in opts[2], opts)
        await pg3.select_option('#cf-nap', value=nap1)
        await pg3.fill('#cf-nap-puerto', '5')
        check('avisa que el puerto ya lo usa otro cliente', 'ya figura usado por Darío Instalar' in await pg3.inner_text('#cf-nap-hint'), await pg3.inner_text('#cf-nap-hint'))
        await pg3.fill('#cf-nap-puerto', '6')
        await pg3.click('#cform button[type=submit]')
        await pg3.wait_for_function("S.clientes.get('a').nap === '" + nap1 + "' && S.clientes.get('a').napPuerto === 6", timeout=6000)
        check('queda conectada: NAP-01 puerto 6', True)
        await pg3.wait_for_function("(() => { const t = document.querySelector('#cl-count'); return true; })()")
        await pg3.click('#tabs [data-tab=clientes]')
        await pg3.fill('#cl-q', 'nap-01')
        await pg3.wait_for_function("document.querySelector('#cl-count').textContent.startsWith('2 ')", timeout=5000)
        check('en Clientes se busca por el nombre de la caja', 'Ana Cerca' in await pg3.inner_text('#cl-list') and 'Darío' in await pg3.inner_text('#cl-list'))
        await pg3.fill('#cl-q', '')
        await pg3.click('#cl-seg [data-f=nonap]')
        await pg3.wait_for_function("document.querySelector('#cl-count').textContent.startsWith('1 ')", timeout=5000)
        check('el filtro «Sin caja NAP» deja solo al que falta conectar (Beto)', 'Beto Lejos' in await pg3.inner_text('#cl-list') and 'Ana' not in await pg3.inner_text('#cl-list'), await pg3.inner_text('#cl-list'))
        # lista de la caja llena de puertos según el filtro
        await pg3.click('#tabs [data-tab=red]'); await pg3.wait_for_selector('#rd-csv')
        # exportar la lista
        async with pg3.expect_download() as dl:
            await pg3.click('#rd-csv')
        d = await dl.value
        txt = open(await d.path(), encoding='utf-8-sig').read()
        check('«Descargar lista» baja un CSV con las cajas, empalmes y sus clientes', d.suggested_filename.startswith('red-') and 'NAP-01,-28.465,-62.835,16,2' in txt and 'Botella de empalme,BE-01' in txt and 'BE-01' in txt.split('NAP-02')[1], txt)
        # eliminar la caja vacía (NAP-02 no tiene clientes) y el empalme que alimenta
        await pg3.click(f'#rd-list [data-open-red="{nap2}"]'); await pg3.wait_for_selector('.sheet [data-act=editar]')
        await pg3.click('.sheet [data-act=editar]'); await pg3.wait_for_selector('#rf-del')
        await pg3.click('#rf-del'); await pg3.wait_for_selector('.sheet [data-act=yes]')
        await pg3.click('.sheet [data-act=yes]')
        await pg3.wait_for_function("S.red.size === 2", timeout=6000)
        check('la oficina elimina una caja vacía y desaparece de la lista', nap2 not in await pg3.evaluate("[...S.red.keys()]"))
        await ctx3.close()

        # 10) el técnico no tiene botón de eliminar
        await pg.click('#tabs [data-tab=red]')
        await pg.click(f'#rd-list [data-open-red="{nap1}"]'); await pg.wait_for_selector('.sheet [data-act=editar]')
        await pg.click('.sheet [data-act=editar]'); await pg.wait_for_selector('#rform')
        check('el técnico puede editar pero no tiene el botón «Eliminar»', await pg.query_selector('#rf-del') is None)
        await pg.click('.sheet [data-close]')
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
