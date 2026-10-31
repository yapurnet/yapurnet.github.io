# Empezar a cobrar de cero: todos pasan a cobrarse desde el mes que se elige y lo que debían queda como «deuda anterior» (aparte, sin cortes).
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
SHOTS = os.environ.get('VIS_OUT')
async def shot(pg, name):
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, name + '.png'))
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
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'bajada': 50, 'subida': 20, 'precio': 20000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    m1, m2, m3 = add_months(CUR, -1), add_months(CUR, -2), add_months(CUR, -3)
    base = {'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1', 'ciclo': 1}
    cl = {'ana': {'nombre': 'Ana Alday', 'tel': '3844000001', 'desde': m2, 'alta': m2 + '-01'},        # pagó todo: sin deuda
          'beto': {'nombre': 'Beto Benítez', 'tel': '3844000002', 'desde': m1, 'alta': m1 + '-01'},   # debe este mes
          'carla': {'nombre': 'Carla Cano', 'tel': '3844000003', 'desde': m3, 'alta': m3 + '-01'},    # debe cuatro meses
          'dora': {'nombre': 'Dora Díaz', 'tel': '3844000004', 'desde': NEXT, 'alta': CUR + '-01'},   # ya empieza el mes que viene
          'eli': {'nombre': 'Eli Echeverría', 'tel': '3844000005', 'estado': 'pendiente', 'desde': m1, 'alta': m1 + '-01'},
          'fede': {'nombre': 'Fede Fares', 'tel': '3844000006', 'estado': 'suspendido', 'desde': m1, 'alta': m1 + '-01'}}   # suspendido, debe dos meses
    for cid, c in cl.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {**base, **c}}}}, TA)
    def pago(cid, per, pid):
        api('PATCH', '/api/doc/pagos/%s-s%02d' % (per[:4], fnv(cid) % 32), {'data': {'items': {pid: {'c': cid, 'concepto': 'mensualidad', 'per': per, 'monto': 20000, 'fecha': per + '-05', 'hora': '10:00', 'recibo': 'R' + pid, 'metodo': 'efectivo'}}}}, TA)
    for per in (m2, m1, CUR): pago('ana', per, 'a' + per)
    pago('beto', m1, 'b' + m1)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 6 && S.pagos.size === 4 && S.loaded.pagos', timeout=10000)

        # 1) cuenta previa: qué se mueve y cuánto queda como deuda anterior
        r = await pg.evaluate("(() => { const o = bulkCero('%s'); return {n: o.cambian.length, con: o.conDeuda, sin: o.sinDeuda, monto: o.monto, ya: o.yaDesde, omit: o.omitidos}; })()" % NEXT)
        check('se mueven 4 clientes: 3 con deuda y 1 al día; Dora (ya empieza) y Eli (por instalar) no', r == {'n': 4, 'con': 3, 'sin': 1, 'monto': 140000, 'ya': 1, 'omit': 1}, r)
        check('antes de empezar Carla figura debiendo meses y puede estar «A cortar»', await pg.evaluate("billing(S.clientes.get('carla')).vencidos >= 3 && cutState(S.clientes.get('carla')).k === 'cortar'"))

        # 2) la herramienta, desde Ajustes
        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-cero')
        await pg.click('#aj-cero')
        await pg.wait_for_selector('#cz-mes')
        check('el mes viene en el siguiente al actual', await pg.input_value('#cz-mes') == NEXT, await pg.input_value('#cz-mes'))
        await shot(pg, 'cero_modal')
        txt = await pg.inner_text('#cz-out')
        check('el resumen cuenta los clientes y la deuda que se anota aparte', '4 clientes empiezan' in txt and '3 clientes' in txt and '140.000' in txt, txt)
        await pg.click('#cz-go')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("['ana','beto','carla','fede'].every(i => S.clientes.get(i).desde === '%s')" % NEXT, timeout=8000)
        d = {i: doc('clientes', shard(i), TA)['items'][i] for i in ('ana', 'beto', 'carla', 'dora', 'eli', 'fede')}
        check('los 4 quedan con «cobrar desde» en el mes elegido; Dora y Eli no cambian', all(d[i]['desde'] == NEXT for i in ('ana', 'beto', 'carla', 'fede')) and d['dora']['desde'] == NEXT and d['eli']['desde'] == m1, {i: d[i]['desde'] for i in d})
        check('Ana (al día) no queda con deuda anterior', 'deudaAnt' not in d['ana'] or not d['ana'].get('deudaAnt'))
        check('Beto: debe este mes, queda como deuda anterior', d['beto']['deudaAnt']['m'] == 20000 and d['beto']['deudaAnt']['det'], d['beto'])
        check('Carla: cuatro meses = 80.000 y el detalle dice cuáles', d['carla']['deudaAnt']['m'] == 80000 and '4 meses' in d['carla']['deudaAnt']['det'], d['carla'])
        check('Fede (suspendido): dos meses', d['fede']['deudaAnt']['m'] == 40000, d['fede'])
        check('nadie debe mensualidades ni está «A cortar» (queda en cero)', await pg.evaluate("['ana','beto','carla','fede'].every(i => { const c = S.clientes.get(i); return billing(c).deuda === 0 && billing(c).vencidos === 0 && ['ok','plazo'].includes(cutState(c).k); })"))
        check('la deuda anterior no entra en «Morosos» ni en cortes', await pg.evaluate("cortesData().cortar.length === 0 && [...S.clientes.values()].filter(c => billing(c).vencidos > 0).length === 0"))
        check('correrlo de nuevo no mueve a nadie', await pg.evaluate("bulkCero('%s').cambian.length === 0" % NEXT))

        # 3) dónde se ve
        await pg.click('#tabs [data-tab=clientes]')
        await pg.wait_for_selector('#cl-list .item')
        await pg.click('#cl-seg [data-f=dant]')
        await pg.wait_for_function("document.querySelectorAll('#cl-list .item').length === 3", timeout=4000)
        await shot(pg, 'cero_clientes')
        lst = await pg.inner_text('#cl-list')
        check('Clientes: el filtro «Deuda anterior» muestra a los 3 y cada uno lleva su chip', 'Carla Cano' in lst and 'Beto' in lst and 'Fede' in lst and 'Ana' not in lst and 'Deuda anterior · $ 80.000' in lst.replace('\xa0', ' '), lst)
        await pg.evaluate("openClient('carla')")
        await pg.wait_for_selector('[data-act=cobrar-da]')
        await shot(pg, 'cero_ficha')
        fic = (await pg.inner_text('.sheet')).replace('\xa0', ' ')
        check('la ficha avisa la deuda, de qué meses y que no genera cortes', 'Deuda anterior: $ 80.000' in fic and '4 meses' in fic and 'no genera cortes' in fic, fic[:400])
        await pg.evaluate("closeModal()")
        await pg.click('#tabs [data-tab=cobranzas]')
        await pg.click('#cb-sub [data-s=dant]')
        await pg.wait_for_selector('#cb-dlist .item')
        await shot(pg, 'cero_cobranzas')
        ct = (await pg.inner_text('#cb-body')).replace('\xa0', ' ')
        check('Cobranzas: pestaña «Deuda anterior» con el total por cobrar y la lista', '3 con deuda' in ct and '$ 140.000 por cobrar' in ct and 'Carla Cano' in ct, ct[:300])
        check('el primero de la lista es el que más debe', (await pg.inner_text('#cb-dlist .item .t')).startswith('Carla'))
        await pg.click('#tabs [data-tab=resumen]')
        await pg.wait_for_selector('.kpi.tap')
        await shot(pg, 'cero_resumen')
        kp = (await pg.inner_text('.kpi.tap')).replace('\xa0', ' ')
        check('Resumen: contador de deuda anterior que lleva a la pestaña', '140.000' in kp and '3 clientes' in kp, kp)

        # 4) cobrar la deuda anterior (parcial) con recibo
        await pg.evaluate("openCobro('beto', 'deuda_anterior')")
        await pg.wait_for_selector('#cb-con')
        check('el cobro abre en «Deuda anterior» con el monto completo', await pg.evaluate("document.querySelector('#cb-con [aria-pressed=true]').dataset.con") == 'deuda_anterior' and await pg.input_value('#cb-monto') == '20000', await pg.input_value('#cb-monto'))
        await pg.fill('#cb-monto', '99999'); await pg.click('#cb-go')
        await pg.wait_for_timeout(400)
        check('no deja cobrar más de lo que debe', await pg.evaluate("[...S.pagos.values()].filter(p => p.concepto === 'deuda_anterior').length") == 0)
        await pg.fill('#cb-monto', '5000'); await pg.click('#cb-go')
        await pg.wait_for_selector('.rc')
        await shot(pg, 'cero_recibo')
        rc = (await pg.inner_text('.rc')).replace('\xa0', ' ')
        check('el recibo dice «Deuda anterior» con el detalle y el monto', 'Deuda anterior' in rc and '5.000' in rc, rc[:300])
        wa = await pg.query_selector('#rc-wa')
        href = await wa.get_attribute('href') if wa else ''
        check('el recibo trae el botón «Enviar por WhatsApp» al número del cliente con el texto del recibo', wa is not None and href.startswith('https://wa.me/5493844000002?text=') and 'Deuda%20anterior' in href, href[:120])
        check('a Beto le quedan 15.000 y el cobro no tocó sus mensualidades', await pg.evaluate("deudaAntRest(S.clientes.get('beto')) === 15000 && billing(S.clientes.get('beto')).deuda === 0"))
        await pg.evaluate("closeModal()")
        rid = await pg.evaluate("[...S.pagos.values()].find(p => p.concepto === 'deuda_anterior').recibo")
        pid = await pg.evaluate("[...S.pagos.values()].find(p => p.concepto === 'deuda_anterior').id")
        pdoc = await pg.evaluate("[...S.pagos.values()].find(p => p.concepto === 'deuda_anterior')._doc")
        # al anular el cobro la deuda vuelve
        st, _ = api('PATCH', '/api/doc/pagos/' + pdoc, {'data': {'items': {pid: {'anulado': True, 'anuladoMotivo': 'prueba', 'anuladoFecha': time.strftime('%Y-%m-%d')}}}}, TA)
        await pg.wait_for_function("deudaAntRest(S.clientes.get('beto')) === 20000", timeout=6000)
        check('al anular el cobro, la deuda anterior vuelve a 20.000', True)

        # 5) darla por saldada
        await pg.evaluate("void saldarDeudaAnt('fede')")
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("deudaAntRest(S.clientes.get('fede')) === 0", timeout=6000)
        check('«Dar por saldada» deja a Fede sin deuda anterior y sin chip', await pg.evaluate("deudaAntChip(S.clientes.get('fede')) === ''"))

        # 6) editar a mano desde la ficha (por ejemplo, una deuda que figuraba en las notas)
        await pg.evaluate("openClientForm('ana')")
        await pg.wait_for_selector('#cf-da')
        await pg.fill('#cf-da', '12.500'); await pg.fill('#cf-dad', 'Instalación pendiente')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("deudaAntRest(S.clientes.get('ana')) === 12500", timeout=6000)
        check('se puede cargar una deuda anterior a mano', await pg.evaluate("S.clientes.get('ana').deudaAnt.det") == 'Instalación pendiente')
        # 7) cliente sin teléfono: el botón de WhatsApp igual está y pide el número en el momento
        await ctx.route('https://wa.me/**', lambda r: r.abort())
        await pg.evaluate("S.clientes.get('ana').tel = ''")
        rid = await pg.evaluate("[...S.pagos.values()].find(p => p.c === 'ana').recibo")
        await pg.evaluate("openReceipt(%s)" % json.dumps(rid))
        await pg.wait_for_selector('#rc-wa')
        check('sin teléfono cargado el botón de WhatsApp aparece igual', await pg.evaluate("document.querySelector('#rc-wa').tagName") == 'BUTTON' and await pg.evaluate("document.querySelector('#rc-tel').hidden"))
        await pg.click('#rc-wa')
        await pg.fill('#rc-num', '3844 56-26'); await shot(pg, 'cero_wa')
        check('al tocarlo pide el número', not await pg.evaluate("document.querySelector('#rc-tel').hidden"))
        await pg.fill('#rc-num', '123')
        check('con un número incompleto no arma el enlace', await pg.evaluate("document.querySelector('#rc-wa-go').getAttribute('href')") == '#')
        await pg.fill('#rc-num', '3844 56-2605')
        h2 = await pg.evaluate("document.querySelector('#rc-wa-go').href")
        check('con el número completo arma el enlace de WhatsApp con el recibo', h2.startswith('https://wa.me/5493844562605?text='), h2[:100])
        async with ctx.expect_page() as popup:
            await pg.click('#rc-wa-go')
        pop = await popup.value
        await pop.close()
        await pg.wait_for_function("S.clientes.get('ana').tel === '3844 56-2605'", timeout=6000)
        check('y guarda el número en la ficha del cliente', doc('clientes', shard('ana'), TA)['items']['ana']['tel'] == '3844 56-2605')

        # 8) «No dejar deuda anterior»: se perdona lo que debían (meses sin pagar y deuda anterior ya cargada)
        api('PATCH', '/api/doc/clientes/' + shard('gaby'), {'data': {'items': {'gaby': {**base, 'nombre': 'Gaby Gómez', 'tel': '3844000008', 'desde': m2, 'alta': m2 + '-01'}}}}, TA)
        await pg.wait_for_function("S.clientes.has('gaby')", timeout=6000)
        antes = await pg.evaluate("['ana','beto','carla'].map(i => deudaAntRest(S.clientes.get(i)))")
        check('antes de perdonar: Ana, Beto y Carla tienen deuda anterior cargada (12.500, 20.000 y 80.000)', antes == [12500, 20000, 80000], antes)
        await pg.evaluate("closeModal()")   # quedaba abierto el recibo del paso anterior
        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-cero')
        await pg.click('#aj-cero')
        await pg.wait_for_selector('#cz-perdon')
        check('la casilla «No dejar deuda anterior» viene sin marcar (hay que elegirla)', await pg.is_checked('#cz-perdon') is False)
        await pg.check('#cz-perdon')
        await pg.wait_for_function("document.querySelector('#cz-out').textContent.includes('se perdonan')", timeout=4000)
        txt = (await pg.inner_text('#cz-out')).replace('\xa0', ' ')
        await shot(pg, 'cero_perdon')
        check('el resumen cuenta los meses que se perdonan (Gaby, 3 meses = 60.000) y la deuda anterior que se salda (3 clientes, 112.500)', 'Meses sin pagar que se perdonan' in txt and '1 cliente · $ 60.000' in txt and '3 clientes · $ 112.500' in txt and '1 cliente empieza' in txt, txt)
        check('el botón dice a cuántos pone en cero (los 3 saldados y Gaby)', 'Poner a 4 en cero' in txt, txt)
        await pg.click('#cz-go')
        conf = await pg.inner_text('.sheet')
        check('antes de confirmar avisa que se perdona y que no se puede cobrar después', 'PERDONA' in conf and '60.000' in conf.replace('\xa0', ' ') and '112.500' in conf.replace('\xa0', ' '), conf[:300])
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("['ana','beto','carla'].every(i => deudaAntRest(S.clientes.get(i)) === 0) && S.clientes.get('gaby').desde === '%s'" % NEXT, timeout=8000)
        g = doc('clientes', shard('gaby'), TA)['items']['gaby']
        check('Gaby empieza a cobrarse desde el mes elegido y no queda ninguna deuda anotada', g['desde'] == NEXT and not g.get('deudaAnt'), g)
        check('Gaby no debe mensualidades ni queda «A cortar»', await pg.evaluate("billing(S.clientes.get('gaby')).deuda === 0 && cutState(S.clientes.get('gaby')).k !== 'cortar'"))
        check('nadie en el sistema tiene deuda anterior pendiente', await pg.evaluate("[...S.clientes.values()].every(c => deudaAntRest(c) === 0)"))
        check('en el servidor la deuda anterior de Carla quedó saldada (sin tocar los cobros)', doc('clientes', shard('carla'), TA)['items']['carla']['deudaAnt']['m'] == 0 and doc('clientes', shard('carla'), TA)['items']['carla']['desde'] == NEXT)
        await pg.click('#tabs [data-tab=cobranzas]')
        await pg.click('#cb-sub [data-s=dant]')
        await pg.wait_for_function("document.querySelector('#cb-dtot') && document.querySelector('#cb-dtot').textContent.includes('Nadie tiene deuda anterior')", timeout=6000)
        check('Cobranzas → Deuda anterior queda vacía', True)
        check('correrlo de nuevo perdonando no mueve a nadie', await pg.evaluate("bulkCero('%s', true).cambian.length === 0" % NEXT))
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
