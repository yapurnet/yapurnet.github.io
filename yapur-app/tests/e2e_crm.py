# CRM en prueba: oculto para todos; el administrador lo prende en Ajustes (solo en su aparato) y ve la lista, los segmentos y la ficha con el historial. Chromium real contra workerd.
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
    hoy = datetime.date.today(); cur = hoy.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Cordoba Alicia', 'estado': 'activo', 'dir': 'Calle a', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': '2026-01-10', 'desde': '2026-01'}}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('b'), {'data': {'items': {'b': {'nombre': 'Diaz Bruno', 'estado': 'pendiente', 'dir': 'Calle b', 'loc': 'Añatuya', 'tel': '03854654321'}}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': hoy.isoformat(), 'creado': hoy.isoformat(), 'estado': 'pendiente', 'tecnico': '', 'clientId': 'a', 'notas': 'cambio de router'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 420, 'height': 900}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        check('apagado por defecto: no hay solapa CRM', await pg.query_selector('#tabs [data-tab=crm]') is None)
        await pg.click('#tabs [data-tab=ajustes]'); await pg.wait_for_selector('#aj-crm')
        check('en Ajustes está «Funciones en prueba» con el interruptor', 'Funciones en prueba' in await pg.inner_text('#view'))
        await pg.check('#aj-crm')
        await pg.wait_for_selector('#tabs [data-tab=crm]')
        check('al prenderlo aparece la solapa CRM', True)
        await pg.click('#tabs [data-tab=crm]'); await pg.wait_for_selector('[data-crm]')
        tx = await pg.inner_text('#view')
        check('avisa que es una prueba y que no cambia nada', 'CRM en prueba' in tx)
        check('lista a los clientes', 'Cordoba Alicia' in tx and 'Diaz Bruno' in tx, tx[:300])
        await pg.click('#crm-seg [data-s=pend]'); await pg.wait_for_function("document.querySelectorAll('[data-crm]').length===1")
        check('el segmento «Por instalar» deja solo al pendiente', 'Diaz Bruno' in await pg.inner_text('#view') and 'Cordoba Alicia' not in await pg.inner_text('#view'))
        await pg.click('#crm-seg [data-s=orden]'); await pg.wait_for_function("document.querySelectorAll('[data-crm]').length===1")
        check('el segmento «Con orden abierta» deja a quien tiene la visita', 'Cordoba Alicia' in await pg.inner_text('#view'))
        await pg.click('[data-crm]'); await pg.wait_for_selector('[role=dialog]')
        fi = await pg.inner_text('[role=dialog]')
        check('la ficha muestra el historial con el alta y la orden abierta', 'Alta del cliente' in fi and 'Visita técnica' in fi and 'cambio de router' in fi, fi)
        await pg.keyboard.press('Escape')
        # otro aparato (sin la marca): nada
        ctx2 = await br.new_context(viewport={'width': 420, 'height': 900}, bypass_csp=True)
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        p2 = await login(ctx2, 'mauro', 'claveSegura1')
        check('en otro aparato sigue apagado', await p2.query_selector('#tabs [data-tab=crm]') is None)
        # la oficina nunca lo ve, ni con la marca puesta a mano
        ctx3 = await br.new_context(viewport={'width': 420, 'height': 900}, bypass_csp=True)
        await ctx3.add_init_script("localStorage.setItem('yapur-crm','1')")
        await ctx3.route('**/fonts.g*/**', lambda r: r.abort())
        p3 = await login(ctx3, 'laura', 'laura123')
        check('la oficina no ve el CRM aunque tenga la marca', await p3.query_selector('#tabs [data-tab=crm]') is None)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
