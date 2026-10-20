# GPS: el técnico, parado frente a la casa, toca «Usar mi ubicación actual» y las coordenadas se cargan solas.
# Se prueba con Chromium real y una ubicación simulada (Playwright), igual que lo haría el WebView del celular.
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

FAKE = "window.YapurApp = { saveFile: () => 'ok:x', openUrl: () => true };"
# permiso denegado, tal cual lo informa el navegador (en Chromium sin pantalla la consulta quedaría esperando respuesta)
DENIED = "navigator.geolocation.watchPosition = (ok, err) => { setTimeout(() => err({ code: 1, message: 'User denied Geolocation' }), 30); return 1; }; navigator.geolocation.clearWatch = () => {};"
LAT, LNG = -28.465, -62.835
def shard(cid):   # igual que clientShard() de la app: cada cliente vive en el lote que le toca por su id
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)

async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and 'Geolocation' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg

ERR = []
async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {}}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    for cid, c in {
        'a': {'nombre': 'Ana Sin Mapa', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1'},
        'b': {'nombre': 'Beto Sin Mapa', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 2'},
        'c': {'nombre': 'Carla Sin Mapa', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 3'},
        'd': {'nombre': 'Darío Instalar', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle 4'}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    cur = time.strftime('%Y-%m')
    for cid in 'abcd':
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o' + cid: {'tipo': 'instalacion' if cid == 'd' else 'visita', 'clientId': cid, 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': time.strftime('%Y-%m-%d'), 'creado': time.strftime('%Y-%m-%d'), 'tecnico': pedro['id']}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, permissions=['geolocation'], geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 6})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'pedro', 'pedro123')
        await pg.wait_for_function('S.clientes.size === 4 && S.ordenes.size === 4', timeout=10000)

        # 1) lectura precisa: se carga sola y se guarda
        await pg.evaluate("openClient('a')")
        await pg.wait_for_selector('.sheet [data-act=ubicacion]')
        await pg.click('.sheet [data-act=ubicacion]')
        await pg.wait_for_selector('#cf-gps')
        check('el botón del GPS está en «Cargar ubicación»', True)
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=8000)
        v = await pg.input_value('#cf-geo'); stx = await pg.inner_text('#cf-gps-st'); cls = await pg.get_attribute('#cf-gps-st', 'class')
        check('toma las coordenadas del GPS con 6 decimales', v == '-28.465000, -62.835000', v)
        check('avisa la precisión y que es buena', '±6 m' in stx and 'ok' in cls, [stx, cls])
        hint = await pg.inner_text('#cf-geo-hint')
        check('la validación de siempre sigue andando (se guarda tal número)', 'Se guarda -28.465, -62.835' in hint, hint)
        await pg.click('#geo-save')
        await pg.wait_for_function("S.clientes.get('a').lat === -28.465 && S.clientes.get('a').lng === -62.835", timeout=6000)
        st, j = api('GET', '/api/doc/clientes/' + shard('a'), None, TA)
        check('queda guardada en el servidor', st == 200 and j['data']['items']['a']['lat'] == LAT, [st, str(j)[:200]])
        await pg.wait_for_selector('.sheet', state='detached', timeout=3000)

        # 2) lectura que mejora sola: empieza floja y el GPS afina
        await ctx.set_geolocation({'latitude': LAT, 'longitude': LNG, 'accuracy': 45})
        await pg.evaluate("openGeoQuick('b')")
        await pg.wait_for_selector('#cf-gps')
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-gps-st').textContent.includes('±45')", timeout=8000)
        btxt = await pg.inner_text('#cf-gps')
        check('mientras busca muestra la precisión y deja usar lo mejor hasta ahora', 'Buscando' in btxt)
        await ctx.set_geolocation({'latitude': -28.4651, 'longitude': -62.8351, 'accuracy': 7})
        await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=8000)
        v = await pg.input_value('#cf-geo'); stx = await pg.inner_text('#cf-gps-st')
        check('cuando el GPS afina (±7 m) termina solo con la mejor lectura', v == '-28.465100, -62.835100' and '±7 m' in stx, [v, stx])
        check('el botón vuelve a su texto', (await pg.inner_text('#cf-gps')) == 'Usar mi ubicación actual (GPS)')
        await pg.click('.sheet [data-close]')

        # 3) señal pobre: se puede cortar y avisa que es poco precisa
        await ctx.set_geolocation({'latitude': LAT, 'longitude': LNG, 'accuracy': 70})
        await pg.evaluate("openGeoQuick('c')")
        await pg.wait_for_selector('#cf-gps')
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-gps-st').textContent.includes('±70')", timeout=8000)
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=5000)
        stx = await pg.inner_text('#cf-gps-st'); cls = await pg.get_attribute('#cf-gps-st', 'class')
        check('con precisión mala (±70 m) lo avisa y pide repetir', 'poco precisa' in stx and 'bad' in cls, [stx, cls])
        await pg.click('.sheet [data-close]')

        # 4) terminar una orden de instalación: el botón está y carga la ubicación del cliente
        await ctx.set_geolocation({'latitude': LAT, 'longitude': LNG, 'accuracy': 5})
        await pg.evaluate("openFinishOrder(S.ordenes.get('od'))")
        await pg.wait_for_selector('#cf-gps')
        await pg.click('#cf-gps')
        await pg.wait_for_function("document.querySelector('#cf-geo').value !== ''", timeout=8000)
        check('en el cierre de la instalación el técnico no ve «activar al cliente»', await pg.query_selector('#ff-est') is None)
        await pg.fill('#ff-res', 'Se instaló ONU, señal -19 dBm.')
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("S.ordenes.get('od').estado === 'hecha' && S.clientes.get('d').lat === -28.465", timeout=8000)
        check('al cerrar la instalación queda la orden hecha y la casa ubicada', True)
        check('el técnico no ve la opción de activar al cliente (eso lo hace la oficina)', await pg.evaluate("S.clientes.get('d').estado") == 'pendiente')
        await ctx.close()

        # 5) sin permiso en el navegador: mensaje claro
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.add_init_script(DENIED)
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'pedro', 'pedro123')
        await pg2.wait_for_function('S.clientes.size === 4', timeout=10000)
        await pg2.evaluate("openGeoQuick('b')")
        await pg2.wait_for_selector('#cf-gps')
        await pg2.click('#cf-gps')
        await pg2.wait_for_function("document.querySelector('#cf-gps-st').className.includes('bad')", timeout=8000)
        stx = await pg2.inner_text('#cf-gps-st')
        check('sin permiso en el navegador explica cómo darlo', 'permiso de ubicación' in stx and 'candado' in stx, stx)
        check('sin permiso no se completa nada', (await pg2.input_value('#cf-geo')) == '')
        await ctx2.close()

        # 6) sin permiso dentro del APK: explica dónde activarlo
        ctx3 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx3.add_init_script(FAKE)
        await ctx3.add_init_script(DENIED)
        await ctx3.route('**/fonts.g*/**', lambda r: r.abort())
        pg3 = await login(ctx3, 'pedro', 'pedro123')
        await pg3.wait_for_function('S.clientes.size === 4', timeout=10000)
        await pg3.evaluate("openGeoQuick('b')")
        await pg3.wait_for_selector('#cf-gps')
        await pg3.click('#cf-gps')
        await pg3.wait_for_function("document.querySelector('#cf-gps-st').className.includes('bad')", timeout=8000)
        stx = await pg3.inner_text('#cf-gps-st')
        check('sin permiso dentro del APK indica Ajustes → Aplicaciones → Permisos', 'Gestión YAPUR' in stx and 'Ubicación' in stx and 'APK' in stx, stx)
        await ctx3.close()
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
