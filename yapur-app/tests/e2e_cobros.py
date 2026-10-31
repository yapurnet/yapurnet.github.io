# Cobros del técnico en la calle (instalaciones, reclamos, reconexiones) y cierre de caja por cobrador.
# Chromium real contra el servidor de verdad (workerd).
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
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    await sin_aviso(pg)
    return pg

async def tabs(pg): return await pg.evaluate("[...document.querySelectorAll('#tabs .tab')].map(b=>b.textContent.replace(/\\d+$/,'').trim())")
def pagos_hoy(tok):
    st, j = api('GET', '/api/mis-cobros?dias=1', None, tok)
    return [it for d in (j or {}).get('docs', []) for it in d['data']['items'].values()]

async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {'cobrarCampo': True}}, TA)
    api('POST', '/api/users', {'usuario': 'sincobro', 'nombre': 'Sin Cobro', 'role': 'tecnico', 'clave': 'sincobro123', 'permisos': {}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro'); sin = next(u for u in ul['users'] if u['usuario'] == 'sincobro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    for cid, c in {
        'a': {'nombre': 'Ana Activa', 'estado': 'activo', 'planId': 'p1', 'dir': 'Calle 1', 'tel': '3844000001', 'desde': cur},
        'd': {'nombre': 'Darío Instalar', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle 4', 'tel': '3844000004'}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    for oid, cid, tec in (('o1', 'd', pedro['id']), ('o2', 'a', pedro['id']), ('o3', 'a', sin['id']), ('o4', 'a', pedro['id'])):
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {oid: {'tipo': 'instalacion' if oid == 'o1' else ('visita' if oid == 'o4' else 'falla'), 'clientId': cid, 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': tec}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        ctx = await nuevo()

        # 1) el técnico con permiso ve «Mis cobros» y cobra una instalación a un cliente pendiente
        pg = await login(ctx, 'pedro', 'pedro123')
        await pg.wait_for_function('S.clientes.size >= 1', timeout=10000)
        t = await tabs(pg)
        check('el técnico con permiso ve la pestaña «Mis cobros»', 'Mis cobros' in t, t)
        check('no ve Cobranzas ni la caja general', 'Cobranzas' not in t and 'Caja' not in t, t)
        await pg.click('#tabs [data-tab=miscobros]')
        await pg.wait_for_selector('#mc-pick .cp-in')
        check('empieza sin cobros y lo explica', 'Todavía no cobraste nada' in await pg.inner_text('#mc-body'))
        await pg.fill('#mc-pick .cp-in', 'Darío')
        await pg.click('#mc-pick [data-pick]')
        await pg.wait_for_selector('#cb-go')
        botones = await pg.evaluate("[...document.querySelectorAll('#cb-con button')].map(b=>b.textContent.trim())")
        check('al cobrar en la calle no existe «Mensualidad»', 'Mensualidad' not in botones and 'Instalación' in botones and 'Reclamo o visita técnica' in botones, botones)
        check('la fecha del cobro es hoy y no se puede cambiar', await pg.evaluate("document.querySelector('#cb-fecha').disabled") is True and await pg.input_value('#cb-fecha') == hoy)
        await pg.fill('#cb-monto', '15000')
        await pg.fill('#cb-nota-o', 'Instalación completa')
        await pg.click('#cb-go')
        await pg.wait_for_selector('.rc', timeout=8000)
        rec = await pg.inner_text('.rc')
        check('muestra el recibo con el concepto y el total', 'Instalación' in rec and '15.000' in rec and 'Darío Instalar' in rec, rec)
        await pg.click('.sheet [data-close]')
        mis = pagos_hoy(pedro_tok := api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token'])
        check('el servidor lo guardó a nombre del técnico', len(mis) == 1 and mis[0]['por'] == pedro['id'] and mis[0]['porNombre'] == 'Pedro' and mis[0]['concepto'] == 'instalacion' and mis[0]['monto'] == 15000 and mis[0]['fecha'] == hoy, mis)
        await pg.wait_for_function("document.querySelector('#mc-body').textContent.includes('15.000')", timeout=5000)
        check('«Mis cobros» muestra lo cobrado hoy', 'Cobrado hoy' in await pg.inner_text('#mc-body'))

        # 2) cerrar una orden con cobro (falla/reclamo → concepto «Reclamo»)
        await pg.evaluate("openFinishOrder(S.ordenes.get('o2'))")
        await pg.wait_for_selector('#ff-cobro')
        check('el cierre de la orden ofrece «Cobré este trabajo» con el concepto según el tipo', await pg.input_value('#ff-con') == 'reclamo')
        await pg.fill('#ff-res', 'Se cambió el conector.')
        await pg.check('#ff-cobro')
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('monto')", timeout=4000)
        check('si tildó el cobro y no puso monto no cierra la orden', (await pg.evaluate("S.ordenes.get('o2').estado")) == 'en_curso')
        await pg.fill('#ff-monto', '3500'); await pg.select_option('#ff-met', 'transferencia')
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_selector('.rc', timeout=8000)
        check('cierra la orden y abre el recibo del cobro', (await pg.evaluate("S.ordenes.get('o2').estado")) == 'hecha' and 'Reclamo' in await pg.inner_text('.rc'), await pg.inner_text('.rc'))
        await pg.click('.sheet [data-close]')
        mis = pagos_hoy(pedro_tok)
        check('quedan 2 cobros del técnico (15.000 efectivo + 3.500 transferencia)', sorted((m['monto'], m['metodo']) for m in mis) == [(3500, 'transferencia'), (15000, 'efectivo')], mis)

        # 3) desde la ficha de un cliente activo no puede cobrar mensualidad
        await pg.evaluate("openClient('a')")
        await pg.wait_for_selector('.sheet [data-act=cobrar]')
        check('en la ficha de un cliente aparece «Cobrar instalación o reclamo»', 'Cobrar instalación o reclamo' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-act=cobrar]'); await pg.wait_for_selector('#cb-go')
        check('no puede marcar meses de mensualidad', await pg.query_selector('#cb-mens:not([hidden])') is None)
        await pg.click('.sheet [data-close]')
        # el servidor lo impide aunque lo intente por afuera
        st, j = api('PATCH', '/api/doc/pagos/' + hoy[:4] + '-s00', {'data': {'items': {'x1': {'c': 'a', 'concepto': 'mensualidad', 'per': cur, 'monto': 20000, 'metodo': 'efectivo', 'fecha': hoy, 'recibo': 'RX'}}}}, pedro_tok)
        check('el servidor rechaza una mensualidad del técnico', st == 400 or st == 403, (st, j))

        # 4) el técnico sin permiso no ve nada de esto
        ctx2 = await nuevo(); pg2 = await login(ctx2, 'sincobro', 'sincobro123')
        await pg2.wait_for_function('S.loaded && S.loaded.ordenes', timeout=10000)
        check('sin el permiso no aparece «Mis cobros»', 'Mis cobros' not in await tabs(pg2), await tabs(pg2))
        await pg2.evaluate("openFinishOrder(S.ordenes.get('o3'))")
        await pg2.wait_for_selector('#ff-res')
        check('sin el permiso el cierre de la orden no ofrece cobrar', await pg2.query_selector('#ff-cobro') is None)
        await pg2.click('.sheet [data-close]')

        # 5) la oficina cobra una mensualidad y mira el cierre de caja por cobrador
        ctx3 = await nuevo(); pg3 = await login(ctx3, 'laura', 'laura123')
        await pg3.wait_for_function('S.clientes.size === 2 && S.pagos.size >= 2', timeout=10000)
        await pg3.evaluate("openCobro('a')"); await pg3.wait_for_selector('#cb-go')
        check('la oficina sí ve «Mensualidad» como concepto', 'Mensualidad' in await pg3.inner_text('#cb-con'))
        await pg3.fill('#cb-monto', '20000'); await pg3.click('#cb-go')
        await pg3.wait_for_selector('.rc', timeout=8000)
        await pg3.click('.sheet [data-close]')
        await pg3.click('#tabs [data-tab=cobranzas]')
        await pg3.click('#cb-sub [data-s=caja]')
        await pg3.wait_for_selector('#cb-caja')
        await pg3.wait_for_function("document.querySelector('#cb-caja').textContent.includes('Por cobrador')", timeout=6000)
        caja = await pg3.inner_text('#cb-caja')
        filas = await pg3.evaluate("[...document.querySelectorAll('#cb-caja table tbody tr')].map(r=>[...r.cells].map(c=>c.textContent.trim()))")
        por = {f[0]: f for f in filas}
        check('la caja separa lo que cobró cada persona', set(por) == {'Pedro', 'Laura'}, filas)
        check('Pedro: 2 recibos, efectivo 15.000, otros medios 3.500, total 18.500', por['Pedro'][1] == '2' and '15.000' in por['Pedro'][2] and '3.500' in por['Pedro'][3] and '18.500' in por['Pedro'][4], por['Pedro'])
        check('Laura: 1 recibo de 20.000 en efectivo', por['Laura'][1] == '1' and '20.000' in por['Laura'][2] and '20.000' in por['Laura'][4], por['Laura'])
        check('el total de la caja del día suma todo (38.500)', '38.500' in caja, caja[:200])
        check('cada cobro dice quién lo hizo', 'cobró Pedro' in caja and 'cobró Laura' in caja)

        # 6) reabrir la app con la copia guardada en el celular (los cobros llegan después, de la sincronización)
        await pg3.wait_for_timeout(5000)   # la copia local se guarda a los 4 s
        async def lento(route):
            await asyncio.sleep(3); await route.continue_()
        await ctx3.route('**/api/sync', lento)
        await pg3.reload(wait_until='domcontentloaded')
        await pg3.wait_for_selector('#tabs .tab', timeout=10000)
        await pg3.click('#tabs [data-tab=cobranzas]')
        await pg3.click('#cb-sub [data-s=caja]')
        txt = await pg3.inner_text('#cb-body')
        check('abierta con los datos del celular no dice «sin permiso»: avisa que está cargando los cobros', 'No tenés permiso' not in txt and 'Cargando los cobros' in txt, txt)
        await pg3.wait_for_function("document.querySelector('#cb-caja') && document.querySelector('#cb-caja').textContent.includes('Por cobrador')", timeout=15000)
        check('al llegar la sincronización muestra la caja completa y sin errores', await pg3.evaluate("!S.errors.pagos") and 'Pedro' in await pg3.inner_text('#cb-caja'))
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
