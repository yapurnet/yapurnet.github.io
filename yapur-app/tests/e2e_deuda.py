# «Pagar deuda»: se escribe cuánto paga el cliente y se reparte entre varios medios (efectivo + transferencia) en un solo recibo.
# Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def shard(cid):
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)
def pagos(tok, cid):
    st, j = api('GET', '/api/sync', None, tok)
    return sorted([p for d in j['cols']['pagos'] for p in d['data'].get('items', {}).values() if p.get('c') == cid], key=lambda p: (p.get('per') or '', p['metodo']))
ERR = []
async def sin_aviso(pg):
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass
async def login(br, user, clave, w=420):
    ctx = await br.new_context(bypass_csp=True, viewport={'width': w, 'height': 900})
    await ctx.route('**/fonts.g*/**', lambda r: r.abort())
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
async def sheet(pg): return await pg.inner_text('.sheet')

async def main():
    cur = time.strftime('%Y-%m'); y, m = int(cur[:4]), int(cur[5:])
    prev = '%04d-%02d' % (y - 1, 12) if m == 1 else '%04d-%02d' % (y, m - 1)
    hoy = time.strftime('%Y-%m-%d')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Brenda', 'role': 'oficina', 'clave': 'brenda123'}, TA)
    api('POST', '/api/users', {'usuario': 'tec', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'fernando1', 'permisos': {'clientesTodos': True, 'cobrarCampo': True}}, TA)
    api('PUT', '/api/doc/planes/p17', {'data': {'nombre': 'Hogar 150', 'bajada': 15, 'subida': 15, 'precio': 17000}}, TA)
    base = {'estado': 'activo', 'planId': 'p17', 'dir': 'Calle 1', 'tel': '3844000001', 'alta': '2026-01-10'}
    sig = '%04d-%02d' % (y + 1, 1) if m == 12 else '%04d-%02d' % (y, m + 1)
    fix = {'cJ': dict(base, nombre='Toloza Jorge', desde=sig, deudaAnt={'m': 19000, 'det': 'Septiembre (2.000) y octubre (17.000)', 'f': hoy}),
           'cM': dict(base, nombre='Dos Meses', desde=prev),
           'cOk': dict(base, nombre='Al Dia', desde=cur),
           'cD': dict(base, nombre='Debe Mes Pasado', desde=prev)}
    for cid, c in fix.items(): api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        pg = await login(br, 'ofi', 'brenda123')
        await pg.wait_for_function('S.clientes.size === 4 && S.loaded.pagos', timeout=15000)
        await pg.evaluate("openClient('cJ')"); await pg.wait_for_selector('[data-act=pagar-deuda]')
        check('un cliente con deuda tiene el botón «Pagar deuda» en la ficha', True)
        await pg.evaluate("closeModal(); openClient('cOk')"); await pg.wait_for_selector('[data-act=cobrar]')
        check('un cliente que solo tiene el mes en curso (todavía sin vencer) no tiene deuda: no hay «Pagar deuda»', await pg.evaluate("billing(S.clientes.get('cOk')).periods.filter(p=>p.per==='%s').every(p=>p.venc)" % cur) or await pg.query_selector('[data-act=pagar-deuda]') is None)
        await pg.evaluate("closeModal(); openClient('cJ')"); await pg.click('[data-act=pagar-deuda]')
        await pg.wait_for_selector('#pd-rows .pd-row')
        s = await sheet(pg)
        s = s.replace('\xa0', ' ')
        check('muestra lo que debe: la deuda anterior (septiembre y octubre) y el total 19.000', 'Deuda anterior' in s and 'Septiembre (2.000) y octubre (17.000)' in s and 'Total que debe' in s and '19.000' in s, s[:300])
        check('arranca con una fila en efectivo por el total', await pg.input_value('.pd-row [data-monto]') == '19000' and await pg.input_value('.pd-row [data-met]') == 'efectivo')
        check('y dice que cubre toda la deuda', 'Cubre toda la deuda' in await pg.inner_text('#pd-sum'))
        await pg.click('#pd-add')
        check('«Agregar otro medio de pago» suma una fila en transferencia', await pg.evaluate("[...document.querySelectorAll('.pd-row [data-met]')].map(s=>s.value).join()") == 'efectivo,transferencia')
        await pg.fill('.pd-row[data-i="0"] [data-monto]', '15000')
        await pg.wait_for_function("document.querySelector('.pd-row[data-i=\"1\"] [data-monto]').value === '4000'", timeout=3000)
        check('al escribir 15.000 en efectivo, la transferencia se completa sola con 4.000', 'Cubre toda la deuda' in await pg.inner_text('#pd-sum'))
        prev_txt = await pg.inner_text('#pd-prev-l')
        check('muestra cómo queda aplicado: la deuda anterior, 15.000 efectivo + 4.000 transferencia', 'Deuda anterior' in prev_txt and '15.000 efectivo' in prev_txt.replace('\xa0', ' ') and '4.000 transferencia' in prev_txt.replace('\xa0', ' '), prev_txt)
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'deuda-form.png'))
        await pg.click('#pd-go'); await pg.wait_for_selector('.rc', timeout=8000)
        rc = (await pg.inner_text('.rc')).replace('\xa0', ' ')
        check('sale un solo recibo, con «Contado + Transferencia» y el total 19.000', 'Contado + Transferencia' in rc and '19.000' in rc, rc[:600])
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'deuda-recibo.png'))
        ps = pagos(TA, 'cJ')
        recs = {p['recibo'] for p in ps}
        check('en el servidor: un recibo, 19.000 en total', len(recs) == 1 and sum(p['monto'] for p in ps) == 19000, ps)
        ef = sum(p['monto'] for p in ps if p['metodo'] == 'efectivo'); tr = sum(p['monto'] for p in ps if p['metodo'] == 'transferencia')
        check('15.000 en efectivo y 4.000 en transferencia', ef == 15000 and tr == 4000, (ef, tr))
        check('todo se aplica a la deuda anterior (septiembre y octubre) y no toca el mes que viene', all(p['concepto'] == 'deuda_anterior' for p in ps) and len(ps) == 2, ps)
        check('y la deuda anterior queda saldada', await pg.evaluate("deudaAntRest(S.clientes.get('cJ')) === 0"))
        await pg.evaluate("closeModal(); openClient('cJ')"); await pg.wait_for_selector('[data-act=cobrar]')
        check('y el botón «Pagar deuda» desaparece', await pg.query_selector('[data-act=pagar-deuda]') is None)

        # pago parcial / con el mes en curso: la deuda es lo vencido; el mes que todavía no vence se puede sumar
        venc_cur = await pg.evaluate("billing(S.clientes.get('cM')).periods.find(p=>p.per==='%s').venc" % cur)
        deuda = 34000 if venc_cur else 17000
        await pg.evaluate("closeModal(); openClient('cM')"); await pg.click('[data-act=pagar-deuda]'); await pg.wait_for_selector('#pd-rows .pd-row')
        s = (await sheet(pg)).replace('\xa0', ' ')
        check('con un mes vencido: el total que debe es %s' % ('34.000' if venc_cur else '17.000'), 'Total que debe' in s and ('34.000' if venc_cur else '17.000') in s, s[:400])
        if not venc_cur:
            check('el mes en curso, sin vencer, se aclara que no es deuda', 'todavía no vence' in s and 'no es deuda' in s, s)
        if not venc_cur:
            # «Pagar todo»: deuda + el mes en curso, sin tener que calcular el monto
            check('hay «Pagar todo (34.000)» y «Solo la deuda (17.000)»', (await pg.inner_text('#pd-alcance')).replace('\xa0', ' ').count('34.000') == 1 and '17.000' in (await pg.inner_text('#pd-alcance')).replace('\xa0', ' '))
            await pg.click('#pd-alcance [data-meta=todo]')
            check('«Pagar todo» pone 34.000 en efectivo', await pg.input_value('.pd-row [data-monto]') == '34000')
            h = (await pg.inner_text('#pd-sum')).replace('\xa0', ' ')
            check('y avisa que cubre la deuda y el mes en curso', 'Cubre toda la deuda y' in h and '17.000' in h and 'mes en curso' in h, h)
            await pg.click('#pd-add')
            await pg.fill('.pd-row[data-i="0"] [data-monto]', '24000')
            await pg.wait_for_function("document.querySelector('.pd-row[data-i=\"1\"] [data-monto]').value === '10000'", timeout=3000)
            check('con «Pagar todo» y dos medios: 24.000 efectivo y la transferencia se completa con 10.000', True)
            pl = (await pg.inner_text('#pd-prev-l')).replace('\xa0', ' ')
            check('y el recibo muestra los dos meses', pl.count('de 20') == 2, pl)
            await pg.click('#pd-alcance [data-meta=deuda]')
            check('«Solo la deuda» con 24.000 ya escritos vuelve a una sola fila con 17.000', await pg.evaluate("document.querySelectorAll('.pd-row').length") == 1 and await pg.input_value('.pd-row [data-monto]') == '17000')
            await pg.click('#pd-alcance [data-meta=todo]'); await pg.click('#pd-add')
            await pg.fill('.pd-row[data-i="0"] [data-monto]', '10000')
            await pg.click('#pd-alcance [data-meta=deuda]')
            check('con 10.000 en efectivo, «Solo la deuda» deja la transferencia con 7.000', await pg.input_value('.pd-row[data-i="1"] [data-monto]') == '7000')
            await pg.click('[data-quitar="1"]')
            await pg.fill('.pd-row [data-monto]', '17000')
        else:
            check('sin mes en curso para sumar no aparece «Pagar todo»', await pg.query_selector('#pd-alcance') is None)
        await pg.fill('.pd-row [data-monto]', '10000')
        h = (await pg.inner_text('#pd-sum')).replace('\xa0', ' ')
        check('pagando 10.000 avisa cuánto queda de deuda', 'quedan' in h and ('24.000' if venc_cur else '7.000') in h, h)
        await pg.fill('.pd-row [data-monto]', '99999')
        check('si escribe de más, avisa y no deja registrar', 'Es más que lo que se puede cobrar' in await pg.inner_text('#pd-sum'))
        await pg.click('#pd-go')
        check('…el pago no se registró', len(pagos(TA, 'cM')) == 0 and await pg.query_selector('#pd-go') is not None)
        await pg.fill('.pd-row [data-monto]', '20000')
        h = (await pg.inner_text('#pd-sum')).replace('\xa0', ' ')
        if not venc_cur:
            check('con 20.000 cubre la deuda y suma 3.000 del mes en curso', 'Cubre toda la deuda y' in h and '3.000' in h and 'mes en curso' in h, h)
        await pg.click('#pd-go'); await pg.wait_for_selector('.rc', timeout=8000)
        ps = pagos(TA, 'cM')
        check('se aplica al mes más viejo (17.000) y 3.000 del siguiente', [(p['per'], p['monto']) for p in ps] == [(prev, 17000), (cur, 3000)] and all(p['metodo'] == 'efectivo' for p in ps), ps)
        await pg.evaluate("closeModal(); openClient('cM')"); await pg.wait_for_selector('[data-act=cobrar]')
        if venc_cur:
            check('queda debiendo 14.000 y sigue el botón', await pg.evaluate("deudaDe(S.clientes.get('cM')).total") == 14000 and await pg.query_selector('[data-act=pagar-deuda]') is not None)
        else:
            check('ya no debe nada vencido: no hay «Pagar deuda» y el mes en curso sigue con 14.000', await pg.query_selector('[data-act=pagar-deuda]') is None and await pg.evaluate("billing(S.clientes.get('cM'),true).periods.find(p=>p.per==='%s').rest" % cur) == 14000)

        # desde «Cobrar»
        await pg.evaluate("closeModal(); openCobro('cD')"); await pg.wait_for_selector('#cb-deuda')
        await pg.click('#cb-deuda'); await pg.wait_for_selector('#pd-rows .pd-row')
        check('desde «Cobrar» hay un acceso directo a «Pagar deuda»', 'Total que debe' in await sheet(pg))
        await pg.evaluate("closeModal()")

        # la lista «Cobrado hoy» junta el recibo
        await pg.click('#tabs [data-tab=cobranzas]'); await pg.wait_for_selector('#cb-hoylist .item')
        lst = (await pg.inner_text('#cb-hoylist')).replace('\xa0', ' ')
        check('«Cobrado hoy» muestra el recibo con los dos medios y el total, no un renglón suelto', 'Efectivo + Transferencia' in lst and '19.000' in lst, lst[:400])
        await pg.click('#cb-sub [data-s=caja]'); await pg.wait_for_selector('#cb-caja .kpi')
        kp = (await pg.inner_text('#cb-caja .kpis')).replace('\xa0', ' ')
        check('la caja del día suma cada medio por separado: 39.000 en total, 35.000 efectivo y 4.000 transferencia', all(x in kp for x in ('39.000', '35.000', '4.000')) and 'Transferencia' in kp and 'Efectivo' in kp, kp)

        # el técnico no ve «Pagar deuda»
        pt = await login(br, 'tec', 'fernando1')
        await pt.wait_for_function('S.clientes.size === 4', timeout=15000)
        await pt.evaluate("openClient('cM')"); await pt.wait_for_selector('.sheet h2')
        check('el técnico no ve «Pagar deuda» ni la deuda del cliente', await pt.query_selector('[data-act=pagar-deuda]') is None and 'quedan' not in await sheet(pt))
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
