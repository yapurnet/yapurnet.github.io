# «Avisar que salgo»: en una orden abierta, el técnico tiene un enlace de WhatsApp al cliente con un mensaje ya armado (saludo
# según la hora, su nombre, que ya sale). Es un enlace editable de WhatsApp (nunca se manda solo), no una acción de la orden.
# Se ofrece igual de grande que «Salgo para allá» tanto en la orden propia como en una sin asignar todavía (ahí firma el que
# está por tomarla, y al tocarlo de paso la toma y la pasa a «en camino», como si hubiera tocado «Salgo para allá»). No lo
# tiene la oficina (ya tiene su propio «Enviar por WhatsApp» con los datos de la orden) ni un técnico ajeno a una orden ya
# asignada a otro. Chromium real contra workerd.
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
    hoy = datetime.date.today(); manana = hoy + datetime.timedelta(days=1); cur = hoy.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Cordoba Alicia', 'estado': 'activo', 'dir': 'Calle a', 'loc': 'Añatuya', 'tel': '03854123456'}}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('b'), {'data': {'items': {'b': {'nombre': 'Diaz Bruno', 'estado': 'activo', 'dir': 'Calle b', 'loc': 'Añatuya', 'tel': '03854654321'}}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': manana.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': pedro['id'], 'clientId': 'a', 'notas': 'cambio de router'},
        'o2': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': manana.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': '', 'clientId': 'b', 'notas': 'sin asignar todavía'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el técnico dueño de la orden tiene el enlace, con el mensaje bien armado
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.click('#tabs [data-tab=ordenes]'); await pt.wait_for_selector('[data-oid="o1"]')
        link = pt.locator('[data-oid="o1"] a:has-text("Avisar que salgo")')
        check('el técnico tiene el enlace «Avisar que salgo»', await link.count() == 1)
        href = await link.get_attribute('href')
        check('abre WhatsApp al número del cliente', href.startswith('https://wa.me/5493854123456?text='), href)
        texto = urllib.parse.unquote(href.split('text=', 1)[1])
        check('saluda según el momento del día', texto.startswith('¡Buen día!') or texto.startswith('¡Buenas tardes!') or texto.startswith('¡Buenas noches!'), texto)
        check('se presenta con el nombre del técnico asignado', 'Soy el técnico Pedro, de YAPUR.NET.' in texto, texto)
        check('avisa que ya sale, dejando domicilio/comercio para que el técnico borre el que no va', 'saliendo hacia su domicilio/comercio' in texto, texto)
        check('se despide con cordialidad', texto.strip().endswith('¡Hasta ahora!'), texto)
        check('el enlace abre en una pestaña aparte, sin tapar la app', await link.get_attribute('target') == '_blank')
        # 2) un técnico ajeno a una orden YA asignada a otro no la ve (filtro de «mías»/«libres»), así que no puede avisar nada
        api('POST', '/api/users', {'usuario': 'otro', 'nombre': 'Otro', 'role': 'tecnico', 'clave': 'otro1234'}, TA)
        ul2 = api('GET', '/api/users', token=TA)[1]; otro = next(u for u in ul2['users'] if u['usuario'] == 'otro')
        ctx2 = await nuevo(); await ctx2.route('https://wa.me/**', lambda r: r.abort())
        pt2 = await login(ctx2, 'otro', 'otro1234')
        await pt2.click('#tabs [data-tab=ordenes]')
        check('un técnico ajeno a una orden ya asignada a otro ni la ve', await pt2.query_selector('[data-oid="o1"]') is None)
        # 2b) pero en una orden SIN ASIGNAR («Sin asignar»), cualquier técnico ve el mismo botón grande, firmado con su
        #     propio nombre (todavía no la tomó), y al tocarlo de paso la toma y la pasa a «en camino»
        await pt2.click('[data-f="libres"]'); await pt2.wait_for_selector('[data-oid="o2"]')
        link2 = pt2.locator('[data-oid="o2"] a:has-text("Avisar que salgo")')
        check('un técnico que todavía no la tomó también ve «Avisar que salgo» en una orden sin asignar', await link2.count() == 1)
        check('se ofrece igual de grande que «Salgo para allá» (btn primary, no small)', 'primary' in (await link2.get_attribute('class') or ''), await link2.get_attribute('class'))
        href2 = await link2.get_attribute('href')
        texto2 = urllib.parse.unquote(href2.split('text=', 1)[1])
        check('se presenta con SU propio nombre aunque todavía no la tomó', 'Soy el técnico Otro, de YAPUR.NET.' in texto2, texto2)
        async with ctx2.expect_page() as pop2:
            await link2.click()
        pop2p = await pop2.value; await pop2p.close()
        await pt2.wait_for_function("(S.ordenes.get('o2')||{}).estado === 'en_camino'", timeout=8000)
        st_o2, j_o2 = api('GET', '/api/doc/ordenes/' + cur, token=TA)
        check('al tocarlo de paso la toma (queda asignada a quien tocó)', j_o2['data']['items']['o2']['tecnico'] == otro['id'], j_o2['data']['items']['o2'])
        check('…y la pasa a «en camino», como «Salgo para allá»', j_o2['data']['items']['o2']['estado'] == 'en_camino')
        # 3) la oficina no tiene este enlace (tiene el suyo propio, «Enviar por WhatsApp», con los datos de la orden),
        #    ni en la orden asignada ni en una sin asignar
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.click('#tabs [data-tab=ordenes]'); await po.wait_for_selector('[data-oid="o1"]')
        check('la oficina no tiene «Avisar que salgo» en una orden asignada', await po.query_selector('[data-oid="o1"] a:has-text("Avisar que salgo")') is None)
        check('la oficina sigue con su «Enviar por WhatsApp» de siempre', await po.query_selector('[data-oid="o1"] a:has-text("Enviar por WhatsApp")') is not None)
        check('la oficina tampoco lo tiene en una orden sin asignar', await po.query_selector('[data-oid="o2"] a:has-text("Avisar que salgo")') is None)
        # 4) si la orden ya no está asignada a este técnico, o ya se cerró, deja de ofrecerse
        await pt.click('[data-oid="o1"] [data-oact=next]')
        await pt.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'en_camino'", timeout=8000)
        check('en camino, sigue ofreciéndolo (puede haberse demorado en avisar)', await pt.locator('[data-oid="o1"] a:has-text("Avisar que salgo")').count() == 1)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
