# Recibo por WhatsApp de los cobros del técnico, en pantalla: lo que ve el técnico, la oficina y el administrador.
# Chromium real contra el servidor de verdad (workerd) y un WhatsApp de mentira (wa_mock.js).
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']; WA = os.environ['YAPUR_WA']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def wa(path): return json.loads(urllib.request.urlopen(WA + path, timeout=10).read())
def shard(cid):   # igual que clientShard() de la app
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)

ERR = []
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación: la prueba lo contesta «Ahora no»
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
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
async def shot(pg, nombre):   # capturas para mirar el aspecto (solo si se pide con VIS_OUT)
    if os.environ.get('VIS_OUT'): await pg.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'wa_' + nombre + '.png'))
async def toast(pg, txt, ms=6000):
    await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes(%s)" % json.dumps(txt), timeout=ms)
async def cobrar(pg, cid):
    await pg.evaluate("openCobro(%s)" % json.dumps(cid))
    await pg.wait_for_selector('#cb-go')
    await pg.click('#cb-go')
    await pg.wait_for_selector('.rc', timeout=8000)
    return await pg.inner_text('.sheet')

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {'cobrarCampo': True}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    for cid, c in {'a': {'nombre': 'Ana Paz', 'tel': '3844 56-2605', 'estado': 'pendiente', 'dir': 'Calle 1'},
                   'b': {'nombre': 'Beto Sin Teléfono', 'estado': 'pendiente', 'dir': 'Calle 2'},
                   'c': {'nombre': 'Carla Cuarta', 'tel': '3844 11-2233', 'estado': 'pendiente', 'dir': 'Calle 3'}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c

        # 1) el administrador mira «Recibo por WhatsApp» en Ajustes
        ctxA = await nuevo(); A = await login(ctxA, 'mauro', 'claveSegura1')
        await A.click('#tabs [data-tab=ajustes]'); await A.wait_for_selector('#aj-wa-body')
        await A.wait_for_function("document.querySelector('#aj-wa-body').textContent.includes('Conectado')", timeout=8000)
        check('Ajustes dice «Conectado» y el envío automático está encendido', await A.evaluate("document.querySelector('#aj-wa-auto').checked") is True)
        await A.evaluate("document.querySelector('#aj-wa-body').scrollIntoView()"); await shot(A, 'ajustes')
        check('la pantalla no muestra ninguna clave', 'TOKEN-E2E' not in await A.content() and '555000111222' not in await A.content())
        await A.fill('#aj-wa-tel', '3844 56-2605'); await A.click('#aj-wa-test button')
        await toast(A, 'Mensaje enviado')
        lg = wa('/__log')
        check('«Mandar prueba» llega a WhatsApp con datos de ejemplo', len(lg) == 1 and lg[0]['body']['to'] == '5493844562605' and 'R-PRUEBA' in json.dumps(lg[0]['body']), lg)
        await A.fill('#aj-wa-tel', '12'); await A.click('#aj-wa-test button')
        await toast(A, 'código de área')
        check('con un número que no sirve avisa qué falta', True)
        wa('/__limpiar')

        # 2) el técnico cobra: el recibo le sale solo al cliente
        ctxP = await nuevo(); P = await login(ctxP, 'pedro', 'pedro123')
        await P.wait_for_function('S.clientes.size >= 3', timeout=10000)
        check('el técnico sabe que el recibo sale solo', await P.evaluate("S.ajustes.waActivo") is True)
        modal = await cobrar(P, 'a')
        check('el recibo del técnico dice que le llega solo al cliente por WhatsApp', 'El recibo le llega solo al cliente por WhatsApp.' in modal, modal[-300:])
        check('y no le ofrece mandarlo a mano (el cliente lo recibiría dos veces)', await P.query_selector('#rc-wa') is None)
        for _ in range(50):
            lg = wa('/__log')
            if lg: break
            await asyncio.sleep(0.1)
        check('WhatsApp recibió el recibo de Ana', len(lg) == 1 and lg[0]['body']['to'] == '5493844562605' and lg[0]['body']['template']['name'] == 'recibo_cobro', lg)
        await shot(P, 'recibo_tecnico')
        await P.click('.sheet [data-close]')
        await P.click('#tabs [data-tab=miscobros]'); await P.wait_for_selector('#mc-body')
        await P.wait_for_function("document.querySelector('#mc-body').textContent.includes('WhatsApp enviado')", timeout=15000)
        check('«Mis cobros» marca ese cobro como «WhatsApp enviado»', True)

        # 3) la oficina ve el recibo y que salió
        ctxL = await nuevo(); L = await login(ctxL, 'laura', 'laura123')
        await L.wait_for_function('S.pagos.size >= 1', timeout=10000)
        await L.click('#tabs [data-tab=cobranzas]'); await L.click('#cb-sub [data-s=caja]'); await L.wait_for_selector('#cb-caja')
        caja = await L.inner_text('#cb-caja')
        check('la caja de la oficina muestra el cobro del técnico: «cobró Pedro» y «WhatsApp enviado»', 'cobró Pedro' in caja and 'WhatsApp enviado' in caja, caja[:300])
        await L.click('#cb-caja [data-receipt]'); await L.wait_for_selector('.rc')
        rc = await L.inner_text('.sheet')
        check('el recibo dice a qué número y cuándo se mandó', re.search(r'Enviado por WhatsApp a \+5493844562605 el \d\d/\d\d a las \d\d:\d\d\.', rc) is not None, rc[-300:])
        check('la oficina puede «Volver a enviar solo» y sigue el botón manual', await L.query_selector('#rc-wa-re') is not None and 'Volver a enviar solo' in await L.inner_text('#rc-wa-re') and await L.query_selector('#rc-wa') is not None)
        await shot(L, 'recibo_oficina')
        await L.click('.sheet [data-close]')

        # 4) fallas: un cliente sin teléfono y un rechazo de WhatsApp
        modal = await cobrar(P, 'b')
        check('al cobrar a un cliente sin teléfono, el recibo del técnico empieza diciendo que sale solo', 'llega solo' in modal)
        await P.wait_for_function("document.querySelector('.sheet') && document.querySelector('.sheet').textContent.includes('No se envió por WhatsApp')", timeout=12000)
        check('y a los segundos se corrige solo: avisa que no salió y vuelve el botón para mandarlo él', await P.query_selector('#rc-wa') is not None and 'llega solo' not in await P.inner_text('.sheet'))
        await P.click('.sheet [data-close]')
        wa('/__modo?m=e400')
        await cobrar(P, 'c'); await P.click('.sheet [data-close]')
        await L.wait_for_function("(document.querySelector('#cb-caja').textContent.match(/WhatsApp: no se envió/g) || []).length === 2", timeout=15000)
        await shot(L, 'caja_fallas')
        aviso = await L.inner_text('#cb-wa-aviso')
        check('la oficina ve las dos fallas en la caja y un aviso arriba', '2 recibos no llegaron' in aviso and 'Reintentar los que fallaron' in aviso, aviso)
        # el técnico, al volver a mirar, ve el motivo y puede mandarlo él
        await P.evaluate("loadMisCobros()")
        await P.wait_for_function("[...S.pagos.values()].some(p => p.wa && p.wa.e === 'sin_tel')", timeout=8000)
        rb = await P.evaluate("[...S.pagos.values()].find(p => p.wa && p.wa.e === 'sin_tel').recibo")
        await P.evaluate("openReceipt(%s)" % json.dumps(rb)); await P.wait_for_selector('.rc')
        rp = await P.inner_text('.sheet')
        check('si no salió, el técnico ve el motivo y vuelve el botón para mandarlo él', 'No se envió por WhatsApp' in rp and 'no tiene teléfono' in rp and 'llega solo' not in rp and await P.query_selector('#rc-wa') is not None, rp[-300:])
        await P.click('.sheet [data-close]')
        # la oficina reintenta todos: WhatsApp ya anda; el de sin teléfono no (hace falta cargar el número)
        wa('/__modo?m=ok'); wa('/__limpiar')
        await L.click('#cb-wa-re')
        await toast(L, 'Se reintentaron 1: 1 enviado')
        await L.wait_for_function("(document.querySelector('#cb-caja').textContent.match(/WhatsApp: no se envió/g) || []).length === 1", timeout=10000)
        check('«Reintentar los que fallaron» manda el que había rechazado WhatsApp y deja el que no tiene teléfono', len(wa('/__log')) == 1 and '1 recibo no llegó' in await L.inner_text('#cb-wa-aviso'))
        # se carga el teléfono y se reintenta ese recibo
        rb2 = await L.evaluate("[...S.pagos.values()].find(p => p.wa && p.wa.e === 'sin_tel').recibo")
        await L.evaluate("openReceipt(%s)" % json.dumps(rb2)); await L.wait_for_selector('.rc')
        rl = await L.inner_text('.sheet')
        check('el recibo sin teléfono explica el motivo y ofrece «Reintentar envío»', 'No se envió por WhatsApp: El cliente no tiene teléfono cargado.' in rl and 'Reintentar envío' in await L.inner_text('#rc-wa-re'), rl[-300:])
        api('PATCH', '/api/doc/clientes/' + shard('b'), {'data': {'items': {'b': {'tel': '3844 33-4455'}}}}, TA)
        await asyncio.sleep(0.5)
        wa('/__limpiar')
        await L.click('#rc-wa-re')
        await toast(L, 'Recibo enviado por WhatsApp')
        lg = wa('/__log')
        check('con el número cargado el reintento sale', len(lg) == 1 and lg[0]['body']['to'] == '5493844334455', lg)
        await L.wait_for_function("!document.querySelector('#cb-wa-aviso')", timeout=10000)
        check('y el aviso de la caja desaparece', True)

        # 5) el administrador apaga el envío automático: el técnico vuelve a mandarlo a mano
        await A.click('#aj-wa-auto')
        await toast(A, 'ya no se manda solo')
        await P.wait_for_function('S.ajustes.waActivo === false', timeout=10000)
        n0 = len(wa('/__log'))
        modal = await cobrar(P, 'a')
        check('apagado: el recibo del técnico vuelve a traer «Enviar por WhatsApp» y no dice que sale solo', await P.query_selector('#rc-wa') is not None and 'llega solo' not in modal)
        await asyncio.sleep(0.8)
        check('apagado: no se mandó nada solo', len(wa('/__log')) == n0, wa('/__log'))
        await P.click('.sheet [data-close]')
        await A.click('#aj-wa-auto')
        await toast(A, 'El recibo se manda solo por WhatsApp')
        await ctxP.close(); await ctxL.close(); await ctxA.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
