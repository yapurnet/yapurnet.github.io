# Novedades para avisar al técnico aunque tenga la app cerrada: el servidor cuenta cuántas de SUS órdenes cambiaron (una
# nueva, una reasignada, un comentario…) desde la última vez que entró a la pestaña de Órdenes, y se lo manda al celular junto
# con el horario (misma llamada cada 10 minutos) para que el servicio dispare una notificación local. Se marca «visto» solo al
# entrar a Órdenes y también cuando el propio técnico guarda algo (para no avisarle de su propio cambio). Sin un dispositivo
# Android real acá, se prueba la cuenta del servidor (/api/ubicacion/estado) y que la web la resetee sola. Chromium real contra
# workerd.
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
def novedades(tok): return api('GET', '/api/ubicacion/estado', token=tok)[1].get('novedades')
async def espera(tok, val, ms=5000):
    t0 = time.time()
    while time.time() - t0 < ms / 1000:
        if novedades(tok) == val: return True
        await asyncio.sleep(0.2)
    return False
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
    hoy = datetime.date.today(); manana = hoy + datetime.timedelta(days=1); cur = hoy.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    st, lg = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'}); TP = lg['token']
    st, lg2 = api('POST', '/api/login', {'usuario': 'laura', 'clave': 'laura123'}); TL = lg2['token']
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Cordoba Alicia', 'estado': 'activo', 'dir': 'Calle a', 'loc': 'Añatuya', 'tel': '03854123456'}}}}, TA)
    check('el admin no tiene novedades (no es técnico)', novedades(TA) == 0)
    check('la oficina tampoco tiene novedades (no es técnico)', novedades(TL) == 0)
    check('sin órdenes todavía, el técnico no tiene novedades', novedades(TP) == 0)
    # «mod» lo pone siempre la app (saveOrder) al guardar; acá se arma la orden a mano por API, así que se lo agrega a propósito
    # (si no, para el servidor sería una orden sin fecha de modificación y nunca contaría como novedad)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': manana.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': pedro['id'], 'clientId': 'a', 'notas': 'cambio de router', 'mod': int(time.time() * 1000)}}}}, TA)
    check('una orden recién asignada cuenta como novedad', novedades(TP) == 1)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # al entrar a la pestaña de Órdenes, el técnico marca como vistas sus novedades
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.click('#tabs [data-tab=ordenes]'); await pt.wait_for_selector('[data-oid="o1"]')
        check('al entrar a Órdenes se marca como vista', await espera(TP, 0))
        # un comentario de la oficina genera una novedad nueva para el técnico
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.click('#tabs [data-tab=ordenes]'); await po.wait_for_selector('[data-oid="o1"]')
        await po.click('[data-oid="o1"] [data-oact=comentarios]'); await po.wait_for_selector('.sheet')
        await po.fill('.sheet textarea', '¿Qué materiales usaste?')
        await po.click('.sheet button[type=submit]'); await po.wait_for_selector('.sheet', state='detached')
        check('un comentario de la oficina genera una novedad para el técnico', await espera(TP, 1))
        # el técnico, al guardar algo en su orden («Salgo para allá»), de paso se marca visto: no se avisa de su propio cambio
        await pt.click('[data-oid="o1"] [data-oact=next]')
        await pt.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'en_camino'", timeout=8000)
        check('al guardar algo el técnico se marca visto solo (no se avisa de su propio cambio)', await espera(TP, 0))
        # una orden sin asignar (de nadie en particular) no le genera novedad a un técnico: solo cuentan las suyas
        api('PATCH', '/api/doc/clientes/' + shard('b'), {'data': {'items': {'b': {'nombre': 'Diaz Bruno', 'estado': 'activo', 'dir': 'Calle b', 'loc': 'Añatuya', 'tel': '03854654321'}}}}, TA)
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
            'o2': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': manana.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': '', 'clientId': 'b', 'notas': 'sin asignar', 'mod': int(time.time() * 1000)}}}}, TA)
        check('una orden sin asignar todavía no le genera novedad a un técnico', novedades(TP) == 0)
        # al tomarla («Salgo para allá» en «Sin asignar») pasa a ser suya, pero de paso también se marca vista sola
        await pt.click('[data-f="libres"]'); await pt.wait_for_selector('[data-oid="o2"]')
        await pt.click('[data-oid="o2"] [data-oact=next]')
        await pt.wait_for_function("(S.ordenes.get('o2')||{}).estado === 'en_camino'", timeout=8000)
        check('al tomarla y salir para allá, no queda como novedad propia (la vio él mismo)', await espera(TP, 0))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
