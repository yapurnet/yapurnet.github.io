# Cobros del técnico en la calle (instalaciones, reclamos, reconexiones) y cierre de caja por cobrador.
# Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
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
ESTADO_PAGO = re.compile(r'\b(activo|suspendido)\b', re.I)   # lo que el técnico no debe ver de un cliente
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
        'd': {'nombre': 'Darío Instalar', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle 4', 'tel': '3844000004'},
        'e': {'nombre': 'Elena Suspendida', 'estado': 'suspendido', 'corteMora': '2026-10-20', 'planId': 'p1', 'dir': 'Calle 5', 'tel': '3844000005', 'desde': cur}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    for oid, cid, tec in (('o1', 'd', pedro['id']), ('o2', 'a', pedro['id']), ('o3', 'a', sin['id']), ('o4', 'a', pedro['id']), ('o5', 'e', pedro['id']), ('o6', 'a', pedro['id'])):
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {oid: {'tipo': 'instalacion' if oid in ('o1', 'o6') else ('visita' if oid == 'o4' else 'falla'), 'clientId': cid, 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': tec}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        ctx = await nuevo()

        # 1) el técnico con permiso ve «Mis cobros» y cobra una instalación a un cliente pendiente
        pg = await login(ctx, 'pedro', 'pedro123')
        await pg.wait_for_function('S.clientes.size >= 3', timeout=10000)
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
        check('a un cliente por instalar se le ofrece «Instalación», no «Reinstalación»', 'Reinstalación (mudanza)' not in botones and await pg.evaluate("document.querySelector('#cb-con [aria-pressed=true]').textContent") == 'Instalación', botones)
        check('el cobro no muestra lo cobrado antes a ese cliente (el técnico no ve los pagos)', await pg.query_selector('#cb-prev') is None)
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
        # la ficha de ese cliente no muestra pagos ni cuánto se le cobró
        await pg.evaluate("openClient('d')")
        await pg.wait_for_selector('.sheet [data-act=cobrar]')
        sh = await pg.inner_text('.sheet')
        check('la ficha del cliente no muestra lo cobrado ni los pagos', await pg.query_selector('#fc-cobros') is None and 'Lo cobrado' not in sh and '15.000' not in sh and 'cobró Pedro' not in sh, sh[:300])
        check('el cliente por instalar se ve como «Por instalar»', 'Por instalar' in sh)
        await pg.click('.sheet [data-close]')

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
        check('en la ficha de un cliente ya instalado aparece «Cobrar reclamo o reinstalación»', 'Cobrar reclamo o reinstalación' in await pg.inner_text('.sheet') and 'Cobrar instalación' not in await pg.inner_text('.sheet'))
        check('la ficha no dice si el cliente está activo o suspendido', not ESTADO_PAGO.search(await pg.inner_text('.sheet')), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-act=cobrar]'); await pg.wait_for_selector('#cb-go')
        check('no puede marcar meses de mensualidad', await pg.query_selector('#cb-mens:not([hidden])') is None)
        botones = await pg.evaluate("[...document.querySelectorAll('#cb-con button')].map(b=>b.textContent.trim())")
        check('a un cliente ya instalado no se le ofrece «Instalación»: se ofrece «Reinstalación (mudanza)»', botones == ['Reinstalación (mudanza)', 'Reconexión', 'Reclamo o visita técnica', 'Otro'], botones)
        check('y viene marcado «Reclamo o visita técnica», no una instalación', await pg.evaluate("document.querySelector('#cb-con [aria-pressed=true]').textContent") == 'Reclamo o visita técnica')
        check('explica que si se mudó se cobra la reinstalación', 'ya está instalado' in await pg.inner_text('.sheet') and 'Reinstalación (mudanza)' in await pg.inner_text('.sheet'))
        await pg.click('#cb-con [data-con=reinstalacion]'); await pg.fill('#cb-monto', '20000'); await pg.fill('#cb-nota-o', 'Mudanza a calle 9')
        await pg.click('#cb-go'); await pg.wait_for_selector('.rc', timeout=8000)
        check('cobra la reinstalación (mudanza) y el recibo lo dice', 'Reinstalación' in await pg.inner_text('.rc') and '20.000' in await pg.inner_text('.rc'), await pg.inner_text('.rc'))
        await pg.click('.sheet [data-close]')
        mis = pagos_hoy(pedro_tok)
        check('el servidor guardó la reinstalación a nombre del técnico', any(m['concepto'] == 'reinstalacion' and m['monto'] == 20000 and m['por'] == pedro['id'] for m in mis), mis)
        # el cierre de una orden de instalación sobre un cliente ya instalado (mudanza) propone reinstalación
        await pg.evaluate("openFinishOrder(S.ordenes.get('o6'))")
        await pg.wait_for_selector('#ff-cobro')
        optsc = await pg.evaluate("[...document.querySelectorAll('#ff-con option')].map(o=>o.value)")
        check('al cerrar una instalación sobre un cliente instalado propone «Reinstalación» y no ofrece «Instalación»', await pg.input_value('#ff-con') == 'reinstalacion' and 'instalacion' not in optsc, optsc)
        await pg.click('.sheet [data-close]')
        # el técnico no se entera de quién está activo o suspendido por falta de pago
        await pg.evaluate("openClient('e')")
        await pg.wait_for_selector('.sheet [data-act=cobrar]')
        sh = await pg.inner_text('.sheet')
        check('la ficha de un cliente suspendido no lo dice ni avisa del corte por falta de pago', not ESTADO_PAGO.search(sh) and 'falta de pago' not in sh and '20/10/2026' not in sh and await pg.query_selector('.sheet .notice.bad') is None, sh[:400])
        await pg.click('.sheet [data-close]')
        chips = await pg.evaluate("['a','e','d'].map(id => { const d = document.createElement('div'); d.innerHTML = clientRow(S.clientes.get(id)); return d.textContent; })")
        check('en la lista no aparece Activo ni Suspendido, pero sí «Por instalar»', not ESTADO_PAGO.search(chips[0]) and not ESTADO_PAGO.search(chips[1]) and 'Por instalar' in chips[2], chips)
        est = await pg.evaluate("['a','e','d'].map(id => S.clientes.get(id).estado)")
        check('el dato ni siquiera llega al teléfono: sin estado para activo y suspendido, «pendiente» para el que se instala', est == [None, None, 'pendiente'], est)
        await pg.click('#tabs [data-tab=clientes]')
        await pg.wait_for_selector('button[data-f]', timeout=5000)
        filtros = await pg.evaluate("[...document.querySelectorAll('button[data-f]')].map(b => b.textContent.trim())")
        check('los filtros de clientes no tienen «Activos» ni «Suspendidos»', filtros and 'Activos' not in filtros and 'Suspendidos' not in filtros and 'Por instalar' in filtros, filtros)
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
        await pg3.wait_for_function('S.clientes.size === 3 && S.pagos.size >= 2', timeout=10000)
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
        check('Pedro: 3 recibos (instalación 15.000, reclamo 3.500 y reinstalación 20.000): efectivo 35.000, otros medios 3.500, total 38.500', por['Pedro'][1] == '3' and '35.000' in por['Pedro'][2] and '3.500' in por['Pedro'][3] and '38.500' in por['Pedro'][4], por['Pedro'])
        check('la oficina sí ve si el cliente está activo o suspendido', await pg3.evaluate("S.clientes.get('a').estado === 'activo' && S.clientes.get('e').estado === 'suspendido'"))
        check('Laura: 1 recibo de 20.000 en efectivo', por['Laura'][1] == '1' and '20.000' in por['Laura'][2] and '20.000' in por['Laura'][4], por['Laura'])
        check('el total de la caja del día suma todo (58.500)', '58.500' in caja, caja[:200])
        check('cada cobro dice quién lo hizo', 'cobró Pedro' in caja and 'cobró Laura' in caja)

        # 5b) el administrador mira la app como la ve Pedro: «Mis cobros» muestra solo lo de Pedro y tampoco ve el estado de los clientes
        ctx5 = await nuevo(); pg5 = await login(ctx5, 'mauro', 'claveSegura1')
        await pg5.wait_for_function('S.clientes.size === 3 && S.pagos.size >= 4', timeout=10000)
        await pg5.evaluate("lsSet('viewAsP', %s); refreshAll()" % json.dumps(pedro['id']))
        await pg5.wait_for_function('S.preview === true', timeout=5000)
        await pg5.click('#tabs [data-tab=miscobros]')
        await pg5.wait_for_selector('#mc-body .kpi')
        mc = await pg5.inner_text('#mc-body')
        check('en la vista como Pedro, «Mis cobros» suma solo lo de Pedro (38.500) y no lo de la oficina', '38.500' in mc and '58.500' not in mc and 'Laura' not in mc, mc[:300])
        chips5 = await pg5.evaluate("['a', 'e'].map(id => { const d = document.createElement('div'); d.innerHTML = clientRow(S.clientes.get(id)); return d.textContent; })")
        check('y en esa vista la lista de clientes no muestra Activo ni Suspendido', not any(ESTADO_PAGO.search(c) for c in chips5), chips5)
        await ctx5.close()

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
