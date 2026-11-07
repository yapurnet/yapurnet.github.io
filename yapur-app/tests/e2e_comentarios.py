# Comentarios de una orden de trabajo: para preguntar o avisar algo puntual (qué materiales se usaron, cuánto cobrar…) sin salir
# de la app a un chat aparte. Puede comentar la oficina/admin en cualquier orden, y el técnico asignado en la suya, esté abierta
# o ya cerrada (el caso típico: una visita ya hecha a la que después hay que preguntarle algo para poder cobrarla). Chromium real
# contra workerd.
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
def orden(tok, oid, cur):
    st, j = api('GET', '/api/doc/ordenes/' + cur, None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(oid)

async def main():
    hoy = datetime.date.today(); cur = hoy.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Monasterio Madre de Dios', 'estado': 'activo', 'dir': 'Campo Rosso', 'loc': 'Añatuya'}}}}, TA)
    # o1 ya cerrada, sin materiales ni costo anotados: justo el caso que necesita un comentario después de cerrada
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': {'tipo': 'visita', 'prioridad': 'normal', 'fecha': hoy.isoformat(), 'creado': hoy.isoformat(), 'estado': 'hecha', 'cierre': hoy.isoformat() + ' 14:34', 'tecnico': pedro['id'], 'clientId': 'a', 'notas': 'Colocar nuevo equipo', 'resultado': 'Se coloco un nuevo router'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) la oficina abre la orden ya cerrada y pregunta algo puntual
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.click('#tabs [data-tab=ordenes]'); await po.click('[data-f=hechas]'); await po.wait_for_selector('[data-oid="o1"]')
        check('sin comentarios todavía, el botón no muestra número', (await po.inner_text('[data-oid="o1"] [data-oact=comentarios]')).strip() == 'Comentarios')
        await po.click('[data-oid="o1"] [data-oact=comentarios]'); await po.wait_for_selector('.sheet')
        check('avisa que todavía no hay comentarios', 'Todavía no hay comentarios' in await po.inner_text('.sheet'))
        await po.click('.sheet button[type=submit]')
        check('no deja comentar vacío', 'Escribí el comentario' in await po.inner_text('#toastRoot'))
        await po.fill('.sheet textarea', '¿Qué materiales usaste? Los padres preguntan cuánto cobrarles.')
        await po.click('.sheet button[type=submit]')
        await po.wait_for_selector('.sheet', state='detached')
        check('avisa que se agregó el comentario', 'Comentario agregado' in await po.inner_text('#toastRoot'))
        o1 = orden(TA, 'o1', cur)
        check('queda guardado en el servidor con quién y cuándo', len(o1.get('comentarios') or []) == 1 and o1['comentarios'][0]['quien'] == 'Laura' and 'materiales' in o1['comentarios'][0]['texto'], o1)
        await po.wait_for_selector('[data-oid="o1"] [data-oact=comentarios]:has-text("(1)")', timeout=8000)
        check('el botón ahora muestra «Comentarios (1)»', True)
        # 2) un técnico ajeno a la orden no la ve en su lista (no es suya ni está libre): no puede comentarla
        api('POST', '/api/users', {'usuario': 'otro', 'nombre': 'Otro', 'role': 'tecnico', 'clave': 'otro1234'}, TA)
        pt2 = await login(await nuevo(), 'otro', 'otro1234')
        await pt2.click('#tabs [data-tab=ordenes]'); await pt2.click('[data-f=hechas]')
        check('un técnico ajeno ni siquiera ve esta orden cerrada', await pt2.query_selector('[data-oid="o1"]') is None)
        # 3) el técnico asignado entra, ve el pedido de la oficina y contesta
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.click('#tabs [data-tab=ordenes]'); await pt.click('[data-f=hechas]'); await pt.wait_for_selector('[data-oid="o1"] [data-oact=comentarios]:has-text("(1)")', timeout=8000)
        check('el técnico dueño sí la ve, con el comentario de la oficina', True)
        await pt.click('[data-oid="o1"] [data-oact=comentarios]'); await pt.wait_for_selector('.sheet')
        sheet = await pt.inner_text('.sheet')
        check('el técnico ve la pregunta de Laura con su nombre', 'Laura' in sheet and 'materiales' in sheet, sheet)
        await pt.fill('.sheet textarea', 'Se usó un router nuevo y 5 metros de cable UTP.')
        await pt.click('.sheet button[type=submit]'); await pt.wait_for_selector('.sheet', state='detached')
        o1 = orden(TA, 'o1', cur)
        coms = o1.get('comentarios') or []
        check('queda el segundo comentario, a nombre de Pedro y en orden', len(coms) == 2 and coms[1]['quien'] == 'Pedro' and 'router nuevo' in coms[1]['texto'], coms)
        # 4) a la oficina (que sigue con la pantalla abierta) le llega en vivo, sin recargar
        await po.wait_for_selector('[data-oid="o1"] [data-oact=comentarios]:has-text("(2)")', timeout=8000)
        check('a la oficina le aparece en vivo, sin recargar', True)
        await po.click('[data-oid="o1"] [data-oact=comentarios]'); await po.wait_for_selector('.sheet')
        sheet2 = await po.inner_text('.sheet')
        check('la oficina ve ahí mismo la respuesta del técnico', 'Pedro' in sheet2 and 'router nuevo' in sheet2, sheet2)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
