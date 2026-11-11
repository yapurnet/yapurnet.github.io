# Servidor de respaldo en la app: tarjeta de Ajustes, cartel «en espera», pasar a trabajar en el respaldo (el otro se entera en vivo),
# cartel de «el servidor llegó al límite» con el botón para abrir el respaldo y la pantalla del respaldo todavía vacío.
import asyncio, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; BASE_B = os.environ['YAPUR_BASE_B']; CODE = os.environ['YAPUR_CODE']
VIS = os.environ.get('VIS_OUT', '')
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(base, method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
ERR = []
def watch(pg):
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
async def entrar(ctx, base):
    pg = await ctx.new_page(); watch(pg)
    await pg.goto(base, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=10000)
    await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1')
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=12000)
    return pg
async def ajustes(pg):
    await pg.click('#tabs .tab[data-tab=ajustes]')
    await pg.wait_for_function("document.querySelector('#resp-st') && !document.querySelector('#resp-st').innerText.includes('Mirando')", timeout=15000)
    return await pg.inner_text('#resp-st')
async def main():
    st, j = api(BASE, 'POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    TA = j['token']
    api(BASE, 'PATCH', '/api/doc/clientes/c01', {'data': {'items': {'cA': {'nombre': 'Cejas Rosa', 'codigo': '77', 'estado': 'activo'}}}}, TA)
    ok = False
    for _ in range(80):
        s, _j = api(BASE_B, 'POST', '/api/login', {'usuario': 'mauro', 'clave': 'claveSegura1'})
        if s == 200: ok = True; break
        time.sleep(0.4)
    check('(preparación) el respaldo recibió la copia', ok)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctxA = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        ctxB = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        for c in (ctxA, ctxB): await c.route('**/fonts.g*/**', lambda r: r.abort())
        pgA = await entrar(ctxA, BASE); pgB = await entrar(ctxB, BASE_B)

        # --- servidor activo: tarjeta de Ajustes y sin cartel ---
        tx = await ajustes(pgA)
        check('en el activo no hay cartel de espera', await pgA.is_hidden('#respBar'))
        check('la tarjeta del activo dice que está trabajando, que el otro está en espera y al día', 'Activo' in tx and 'en espera' in tx and 'ninguno' in tx, tx)
        check('el activo ofrece mandar la copia completa y no «Pasar a este servidor»', await pgA.is_visible('#resp-sync') and not await pgA.is_visible('#resp-act2'))
        if VIS: await pgA.screenshot(path=VIS + '/respaldo_activo.png')

        # --- servidor en espera: cartel, tarjeta y no deja guardar ---
        await pgB.wait_for_selector('#respBar:not([hidden])', timeout=8000)
        tb = await pgB.inner_text('#respBar')
        check('el respaldo muestra el cartel «en espera» con el botón para pasar a este servidor', 'en espera' in tb.lower() and await pgB.is_visible('#resp-act'), tb)
        tx = await ajustes(pgB)
        check('la tarjeta del respaldo dice que está en espera y ofrece pasar a este servidor', 'En espera' in tx and await pgB.is_visible('#resp-act2') and not await pgB.is_visible('#resp-sync'), tx)
        if VIS: await pgB.screenshot(path=VIS + '/respaldo_espera.png')
        await pgB.wait_for_function("NET.online === true", timeout=8000)
        check('el respaldo en espera mantiene la conexión en vivo (sin el cartel de «sin conexión»)', await pgB.is_hidden('#netBar'))
        r = await pgB.evaluate("NET.api('PATCH','/api/doc/clientes/c01',{data:{items:{cA:{nombre:'x'}}}}).then(()=>'ok',e=>e.code)")
        check('en el respaldo no se puede guardar nada', r == 'respaldo_espera', r)

        # --- pasar a trabajar en el respaldo: el otro se entera en vivo ---
        await pgB.click('#respBar #resp-act')
        await pgB.wait_for_selector('.sheet [data-act=yes]', timeout=5000)
        async with pgB.expect_navigation(timeout=20000):
            await pgB.click('.sheet [data-act=yes]')
        await pgB.wait_for_selector('#tabs .tab', timeout=15000)
        await asyncio.sleep(0.5)
        check('después de activarlo, el respaldo ya no muestra el cartel de espera', await pgB.is_hidden('#respBar'))
        await pgA.wait_for_selector('#respBar:not([hidden])', timeout=15000)
        ta = await pgA.inner_text('#respBar')
        check('el servidor que dejó de ser el activo muestra el cartel de espera sin recargar', 'en espera' in ta.lower(), ta)
        s, _j = api(BASE_B, 'POST', '/api/login', {'usuario': 'mauro', 'clave': 'claveSegura1'})
        s2, _j2 = api(BASE_B, 'PATCH', '/api/doc/clientes/c01', {'data': {'items': {'cA': {'nombre': 'Trabajando en B'}}}}, _j['token'])
        check('el nuevo activo guarda cambios', s2 == 200, _j2)

        # --- el servidor no responde por el tope del día: el cartel ofrece el respaldo ---
        await pgA.reload(); await pgA.wait_for_selector('#tabs .tab', timeout=12000)
        await pgA.route('**/api/**', lambda r: r.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'La base de datos del servidor no responde: Exceeded allowed rows read in Durable Objects free tier.', 'code': 'unavailable', 'limite': True, 'respaldo': BASE_B})))
        r = await pgA.evaluate("NET.api('GET','/api/me').then(()=>'ok',e=>e.status)")
        check('(simulación) el servidor contesta que llegó al tope del día', r == 503, r)
        await pgA.wait_for_function("document.querySelector('#respBar') && document.querySelector('#respBar').innerText.includes('límite')", timeout=5000)
        ta = await pgA.inner_text('#respBar')
        check('aparece el cartel con el motivo y el botón para abrir el respaldo', 'límite' in ta and '127.0.0.1' in ta and await pgA.is_visible('#resp-abrir'), ta)
        if VIS: await pgA.screenshot(path=VIS + '/respaldo_limite.png')
        await pgA.unroute('**/api/**')
        await pgA.evaluate("NET.api('GET','/api/me')")
        await asyncio.sleep(0.4)
        check('cuando el servidor vuelve a responder el cartel desaparece', await pgA.is_hidden('#respBar') or 'límite' not in await pgA.inner_text('#respBar'))

        # --- el respaldo todavía vacío (recién creado) ---
        ctxC = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        pgC = await ctxC.new_page(); watch(pgC)
        await pgC.route('**/api/status', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'v': 'x', 'needsSetup': False, 'nube': 'cloudflare', 'respaldo': {'rol': 'espera', 'vacio': True}})))
        await pgC.goto(BASE, wait_until='domcontentloaded')
        await pgC.wait_for_selector('#rv-retry', timeout=8000)
        tc = await pgC.inner_text('#view')
        check('el respaldo vacío explica que todavía no recibió la copia (y no ofrece crear un administrador)', 'todavía no recibió la copia' in tc and 'Instalación' not in tc, tc)
        if VIS: await pgC.screenshot(path=VIS + '/respaldo_vacio.png')
        await br.close()
    check('sin errores de consola', not ERR, ERR[:3])
    print(f'\n{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
