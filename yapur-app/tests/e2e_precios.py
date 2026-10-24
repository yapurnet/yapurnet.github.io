# Precios con vigencia por mes: un aumento, un servicio nuevo o una corrección, hechos desde las pantallas del administrador.
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
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
def add_months(ym, n):
    y, m = map(int, ym.split('-')); t = y * 12 + (m - 1) + n
    return '%d-%02d' % (t // 12, t % 12 + 1)

CUR = time.strftime('%Y-%m'); NEXT = add_months(CUR, 1)
ERR = []
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg
def doc(coll, did, token):
    st, j = api('GET', f'/api/doc/{coll}/{did}', None, token); return j['data'] if j and j.get('data') else {}

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {}}, TA)
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'bajada': 50, 'subida': 20, 'precio': 20000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    api('PUT', '/api/doc/planes/p15', {'data': {'nombre': 'Plan_15', 'bajada': 15, 'subida': 5, 'precio': 17, 'tecnologia': 'fibra', 'activo': True}}, TA)
    m3 = add_months(CUR, -3)
    for cid, c in {'ana': {'nombre': 'Ana Paga', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1', 'tel': '3844000001', 'desde': m3, 'alta': m3 + '-01', 'ciclo': 1},
                   'pablo': {'nombre': 'Pablo Plan15', 'estado': 'activo', 'planId': 'p15', 'dir': 'Calle 2', 'tel': '3844000002', 'desde': m3, 'alta': m3 + '-01', 'ciclo': 1}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    for per in [add_months(CUR, -3), add_months(CUR, -2), add_months(CUR, -1)]:
        pid = 'pg' + per
        api('PATCH', '/api/doc/pagos/%s-s%02d' % (per[:4], fnv('ana') % 32), {'data': {'items': {pid: {'c': 'ana', 'concepto': 'mensualidad', 'per': per, 'monto': 20000, 'fecha': per + '-05', 'hora': '10:00', 'recibo': 'R' + per, 'metodo': 'efectivo'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 2 && S.pagos.size === 3 && S.planes.size === 2', timeout=10000)
        debt = "(id) => billing(S.clientes.get(id)).periods.filter(p => p.per < '%s').map(p => p.rest)" % CUR

        # 1) aumento del plan: rige desde el mes siguiente
        check('antes de tocar nada Ana no debe nada de los meses anteriores', await pg.evaluate(debt, 'ana') == [0, 0, 0])
        await pg.evaluate("openPlanForm('p1')")
        await pg.wait_for_selector('#pform')
        check('el precio se muestra tal cual y el aviso «rige desde» está escondido', await pg.input_value('#pf-precio') == '20000' and await pg.evaluate("document.querySelector('#pf-vig').hidden"))
        await pg.fill('#pf-precio', '25000')
        check('al cambiar el precio aparece «rige desde» con el mes siguiente', not await pg.evaluate("document.querySelector('#pf-vig').hidden") and await pg.input_value('#pf-vig-mes') == NEXT, await pg.input_value('#pf-vig-mes'))
        check('y se ofrece corregir un error de carga (el plan no tiene historial)', await pg.query_selector('#pf-vig-fix') is not None)
        await pg.click('#pform button[type=submit]')
        await pg.wait_for_function("S.planes.get('p1').precio === 25000", timeout=6000)
        d = doc('planes', 'p1', TA)
        check('el plan guarda el precio anterior y el nuevo con su mes', d['precio'] == 25000 and d['hist'] == [{'d': '0000-00', 'p': 20000}, {'d': NEXT, 'p': 25000}], d)
        check('Ana no pasa a deber nada de los meses ya cobrados', await pg.evaluate(debt, 'ana') == [0, 0, 0])
        check('el precio de hoy sigue siendo 20.000 hasta que llegue el mes', await pg.evaluate("planNow(S.planes.get('p1')) === 20000 && priceOf(S.clientes.get('ana')) === 20000"))
        await pg.click('#tabs [data-tab=planes]')
        await pg.wait_for_selector('#pl-list .plan')
        txt = await pg.inner_text('#pl-list')
        check('la tarjeta del plan avisa el aumento programado', 'Desde' in txt and '25.000' in txt, txt[:300])

        # 2) editar otra cosa del plan no pisa el historial
        await pg.evaluate("openPlanForm('p1')"); await pg.wait_for_selector('#pform')
        await pg.fill('#pf-nombre', 'Hogar 50 Plus')
        await pg.click('#pform button[type=submit]')
        await pg.wait_for_function("S.planes.get('p1').nombre === 'Hogar 50 Plus'", timeout=6000)
        d = doc('planes', 'p1', TA)
        check('cambiar el nombre no toca el precio ni el historial', d['precio'] == 25000 and len(d['hist']) == 2, d)

        # 3) corrección del Plan_15 ($17 por error)
        check('Plan_15 mal cargado: Pablo debe $17 por mes', await pg.evaluate("billing(S.clientes.get('pablo')).periods[0].price") == 17)
        await pg.evaluate("openPlanForm('p15')"); await pg.wait_for_selector('#pform')
        await pg.fill('#pf-precio', '17000')
        await pg.check('#pf-vig-fix')
        await pg.click('#pform button[type=submit]')
        await pg.wait_for_function("S.planes.get('p15').precio === 17000", timeout=6000)
        d = doc('planes', 'p15', TA)
        check('corregido: queda en $17.000 sin historial', d['precio'] == 17000 and 'hist' not in d, d)
        check('y rige en todos los meses de Pablo', await pg.evaluate("billing(S.clientes.get('pablo')).periods.every(p => p.price === 17000)"))

        # 4) aumento de un servicio extra
        await pg.evaluate("openServicioForm('multimedia')"); await pg.wait_for_selector('#svform')
        await pg.fill('#sv-precio', '18000')
        check('el servicio también pregunta desde qué mes', not await pg.evaluate("document.querySelector('#sv-vig').hidden") and await pg.input_value('#sv-vig-mes') == NEXT)
        await pg.click('#svform button[type=submit]')
        await pg.wait_for_function("(S.ajustes.servicios||[]).some(s => s.id === 'multimedia' && s.precio === 18000)", timeout=6000)
        mm = await pg.evaluate("S.ajustes.servicios.find(s => s.id === 'multimedia')")
        check('Multimedia guarda 15.000 hasta ahora y 18.000 desde el mes siguiente', mm['hist'] == [{'d': '0000-00', 'p': 15000}, {'d': NEXT, 'p': 18000}], mm)
        check('hoy Multimedia sigue valiendo 15.000', await pg.evaluate("planNow(S.ajustes.servicios.find(s => s.id === 'multimedia'))") == 15000)

        # 5) a Ana se le agrega Multimedia este mes
        await pg.evaluate("openClientForm('ana')"); await pg.wait_for_selector('#cform')
        check('al abrir el cliente no se pregunta nada de vigencia', await pg.evaluate("document.querySelector('#cf-vig').hidden"))
        await pg.check('[data-extra=multimedia]')
        check('al agregarle un servicio pregunta desde qué mes (este mes por defecto)', not await pg.evaluate("document.querySelector('#cf-vig').hidden") and await pg.input_value('#cf-vig-mes') == CUR)
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("(S.clientes.get('ana').extras||[]).includes('multimedia')", timeout=6000)
        a = doc('clientes', shard('ana'), TA)['items']['ana']
        check('queda guardado cómo estaba hasta el mes anterior', a['hp'] == [{'h': add_months(CUR, -1), 'planId': 'p1', 'precio': None, 'extras': []}] and a['extras'] == ['multimedia'], a)
        check('los meses cobrados siguen sin deuda', await pg.evaluate(debt, 'ana') == [0, 0, 0])
        check('este mes ya incluye el servicio (20.000 + 15.000)', await pg.evaluate("billing(S.clientes.get('ana')).periods.find(p => p.per === '%s').price" % CUR) == 35000)

        # 6) cambiar de nuevo en el mismo mes se toma como corrección (no se reescribe el pasado)
        await pg.evaluate("openClientForm('ana')"); await pg.wait_for_selector('#cform')
        check('el mínimo de «rige desde» es el mes en que empezó la situación actual', await pg.get_attribute('#cf-vig-mes', 'min') == CUR, await pg.get_attribute('#cf-vig-mes', 'min'))
        await pg.check('[data-extra=multimedia_net]')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("(S.clientes.get('ana').extras||[]).includes('multimedia_net')", timeout=6000)
        a = doc('clientes', shard('ana'), TA)['items']['ana']
        check('el segundo cambio del mismo mes no agrega historial', len(a['hp']) == 1 and sorted(a['extras']) == ['multimedia', 'multimedia_net'], a)
        check('y los meses anteriores siguen intactos', await pg.evaluate(debt, 'ana') == [0, 0, 0])
        await ctx.close()

        # 7) el técnico no recibe precios ni historiales
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'pedro', 'pedro123')
        await pg2.wait_for_function("S.planes.size === 2 && S.loaded.clientes", timeout=10000)
        check('al técnico no le llegan precios ni historial de planes', await pg2.evaluate("[...S.planes.values()].every(p => p.precio === undefined && p.hist === undefined)"))
        check('ni historial de cambios de los clientes', await pg2.evaluate("[...S.clientes.values()].every(c => c.hp === undefined && c.precio === undefined)"))
        await ctx2.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
