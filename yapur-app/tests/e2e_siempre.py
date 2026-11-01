# GPS siempre activo (APK nuevo): el servicio nativo queda andando con la app cerrada y la página solo lo mantiene al día.
# El puente de Android (window.YapurApp) es un doble que anota las llamadas.
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

# el puente nuevo (con startLocationSiempre) y el viejo (solo startLocation / startLocationTramos), más un contador del GPS de la ventana
INIT = '''
  window.__nat = {sempre: [], tramos: [], stops: 0, pedir: 0, bg: '__BG__', ret: '__RET__'};
  window.YapurApp = {
    startLocationSiempre: t => { window.__nat.sempre.push(t); return window.__nat.ret; },
    startLocationTramos: (t, x) => { window.__nat.tramos.push([t, x]); return window.__nat.ret; },
    startLocation: (t, d, h) => { window.__nat.tramos.push([t, d + '-' + h]); return window.__nat.ret; },
    ubicacionSiempre: () => window.__nat.bg,
    pedirUbicacionSiempre: () => { window.__nat.pedir++; return 'pedido'; },
    stopLocation: () => { window.__nat.stops++; }
  };
  window.__watch = {n: 0, cleared: 0};
  const gl = navigator.geolocation, w = gl.watchPosition.bind(gl), c = gl.clearWatch.bind(gl);
  gl.watchPosition = (...a) => { window.__watch.n++; return w(...a); };
  gl.clearWatch = (...a) => { window.__watch.cleared++; return c(...a); };
'''
def init(bg='no', ret='ok'): return INIT.replace('__BG__', bg).replace('__RET__', ret)

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    for u, n in (('pedro', 'Pedro'), ('juan', 'Juan'), ('luis', 'Luis')):
        api('POST', '/api/users', {'usuario': u, 'nombre': n, 'role': 'tecnico', 'clave': u + '11'}, TA)
    api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)   # a cualquier hora del día en que se corra la prueba
    # Juan ya había aceptado el aviso de antes («con la app abierta»)
    TJ = api('POST', '/api/login', {'usuario': 'juan', 'clave': 'juan11'})[1]['token']; api('POST', '/api/ubicacion/acepto', {}, TJ)
    geo = {'latitude': -28.4601, 'longitude': -62.8302, 'accuracy': 15}
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def ctx(bg='no', ret='ok'):
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort()); await c.add_init_script(init(bg, ret)); return c

        # --- técnico nuevo: el aviso dice que se comparte con la app cerrada
        pc = await ctx()
        pp = await login(pc, 'pedro', 'pedro11')
        await pp.wait_for_selector('[role=dialog]', timeout=8000)
        txt = await pp.inner_text('[role=dialog]')
        check('el aviso dice que se comparte aunque la app esté cerrada y pide «Permitir todo el tiempo»', 'aunque la app esté cerrada' in txt and 'Permitir todo el tiempo' in txt and 'se borra' in txt.lower() and 'Si cerrás sesión, se corta todo' in txt, txt[:400])
        await pp.click('[data-act=si]')
        await pp.wait_for_function('window.__nat.sempre.length >= 1', timeout=8000)
        tk = await pp.evaluate('[window.__nat.sempre[0], NET.token]')
        check('la página le pasa al servicio solo la sesión (el horario lo pide él al servidor)', tk[0] == tk[1] and await pp.evaluate('window.__nat.tramos.length') == 0, tk)
        await pp.wait_for_timeout(1200)
        check('la página no usa el GPS de la ventana: ya manda el servicio', await pp.evaluate('window.__watch.n') == 0 and await pp.evaluate('UB.nat') is True)
        # --- falta el permiso «todo el tiempo»: se lo explica y queda un botón arriba
        await pp.wait_for_function("[...document.querySelectorAll('[role=dialog] h2')].some(h => h.innerText.includes('todo el tiempo'))", timeout=8000)
        mod = await pp.inner_text('[role=dialog]')
        check('se le explica el permiso «todo el tiempo» y cómo darlo', 'Permitir todo el tiempo' in mod and 'Ubicación' in mod and 'Activar' in mod, mod[:300])
        await pp.click('#ub-bg')
        check('«Activar» le pide a Android el permiso (una vez)', await pp.evaluate('window.__nat.pedir') == 1)
        await pp.wait_for_selector('#ubChipBg', timeout=5000)
        check('mientras no lo dé, queda un cartel «Activar ubicación todo el tiempo» arriba', 'todo el tiempo' in await pp.inner_text('#ubChipBg'))
        await pp.click('#ubChipBg'); await pp.wait_for_selector('#ub-bg')
        await pp.click('#ub-bg')
        check('y tocándolo se lo vuelve a ofrecer', await pp.evaluate('window.__nat.pedir') == 2)
        await pp.evaluate("window.__nat.bg = 'si'; ubicLoop()")
        await pp.wait_for_function("!document.querySelector('#ubChipBg')", timeout=5000)
        check('cuando Android lo da, el cartel desaparece solo', True)
        n0 = await pp.evaluate('window.__nat.sempre.length')
        # --- fuera de horario el servicio NO se detiene (queda en espera y vuelve solo)
        h = time.gmtime(time.time() - 3 * 3600).tm_hour
        d, hh = (h + 2, h + 3) if h <= 20 else (0, h - 1)
        api('POST', '/api/ubicacion/horario', {'desde': d, 'hasta': hh}, TA)
        await pp.evaluate("UB.stTs = 0; ubicRefrescar().then(ubicLoop)")
        await pp.wait_for_function(f'window.__nat.sempre.length > {n0}', timeout=8000)
        chip = await pp.inner_text('#ubChip')
        check('fuera de horario la página sigue manteniendo el servicio y NO lo detiene', await pp.evaluate('window.__nat.stops') == 0 and 'fuera de horario' in chip.lower(), (await pp.evaluate('window.__nat.stops'), chip))
        api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)
        await pp.evaluate('NET.logout()')
        await pp.wait_for_function('window.__nat.stops >= 1', timeout=5000)
        check('al cerrar sesión se detiene el servicio y se borra la sesión guardada', True)

        # --- técnico que había aceptado el aviso de antes: lo nuevo se avisa aparte
        jc = await ctx()
        jp = await login(jc, 'juan', 'juan11')
        await jp.wait_for_selector('[role=dialog]', timeout=8000)
        txt = await jp.inner_text('[role=dialog]')
        check('quien ya había aceptado ve un aviso aparte: también con la app cerrada', 'Ubicación también con la app cerrada' in txt and 'Entendido, activar' in txt, txt[:300])
        await jp.click('[data-act=no]')
        await jp.wait_for_function('window.__nat.tramos.length >= 1', timeout=8000)
        check('si dice «Ahora no» sigue como antes: el servicio solo en horario y con la app abierta', await jp.evaluate('window.__nat.sempre.length') == 0 and await jp.evaluate('window.__nat.stops') == 0)
        check('y no se le pide el permiso «todo el tiempo»', await jp.evaluate('window.__nat.pedir') == 0 and await jp.evaluate("!document.querySelector('#ubChipBg')"))
        # al volver a abrir la app lo vuelve a preguntar; esta vez acepta
        jc2 = await ctx()
        jp2 = await login(jc2, 'juan', 'juan11')
        await jp2.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000)
        await jp2.click('[data-act=si]')
        await jp2.wait_for_function('window.__nat.sempre.length >= 1', timeout=8000)
        check('si acepta, pasa al servicio siempre activo', await jp2.evaluate('window.__nat.tramos.length') == 0)
        await jp2.reload(); await jp2.wait_for_selector('#tabs .tab', timeout=10000)
        await jp2.wait_for_function('window.__nat.sempre.length >= 1', timeout=8000)
        check('y no se lo vuelve a preguntar la próxima vez (queda guardado en el celular)', await jp2.evaluate("!document.querySelector('[role=dialog] [data-act=si]')"))

        # --- sin el permiso común de ubicación el servicio no arranca: la página usa el GPS de la ventana (que lo pide) y después lo suelta
        lc = await ctx(ret='permiso')
        lp = await login(lc, 'luis', 'luis11')
        await lp.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000); await lp.click('[data-act=si]')
        await lp.wait_for_function('window.__watch.n >= 1', timeout=8000)
        check('sin permiso para el servicio, la página usa el GPS de la ventana y no pide «todo el tiempo» todavía', await lp.evaluate('UB.nat') is False and await lp.evaluate('window.__nat.pedir') == 0 and await lp.evaluate("!document.querySelector('[role=dialog]')"))
        await lp.evaluate("window.__nat.ret = 'ok'; ubicLoop()")
        await lp.wait_for_function('window.__watch.cleared >= 1 && UB.nat === true && UB.watch === null', timeout=5000)
        check('cuando el servicio arranca, la página apaga su propio GPS', True)
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
