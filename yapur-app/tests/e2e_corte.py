# Corte manual del GPS de un técnico: botón «Cortar GPS» / «Reanudar GPS» en la pestaña Técnicos (solo el administrador)
# y lo que ve el celular del técnico cuando la oficina se lo corta (le llega en vivo, sin esperar).
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
hhmm_ar = lambda ms: time.strftime('%H:%M', time.gmtime(ms / 1000 - 3 * 3600))
card = lambda nombre: f"[...document.querySelectorAll('.tcard')].find(c=>c.querySelector('h3').innerText.includes('{nombre}'))"

async def main():
    now0 = int(time.time() * 1000)
    if ((now0 - 3 * 3600e3) % 864e5) / 60e3 < 15:
        check('(salteado: recién pasó la medianoche)', True); return
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura1', 'permisos': {'verTecnicos': True}}, TA)
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro1'}, TA)
    api('POST', '/api/users', {'usuario': 'juan', 'nombre': 'Juan', 'role': 'tecnico', 'clave': 'juan11'}, TA)
    api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)
    api('POST', '/api/jornada/base', {'lat': -28.4601, 'lng': -62.8302, 'radio': 40, 'tol': 10, 'dias': [0, 1, 2, 3, 4, 5, 6]}, TA)
    TP = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro1'})[1]['token']
    api('POST', '/api/ubicacion/acepto', {}, TP); api('POST', '/api/jornada/acepto', {}, TP)
    # Pedro: llega a la base hace 14 minutos y se va; Juan no aceptó el aviso
    now = int(time.time() * 1000)
    api('POST', '/api/ubicacion', {'pts': [{'lat': -28.4601, 'lng': -62.8302, 'acc': 10, 'ts': now - 14 * 60000}, {'lat': -28.6, 'lng': -62.9, 'acc': 10, 'ts': now - 12 * 60000}, {'lat': -28.61, 'lng': -62.91, 'acc': 10, 'ts': now - 6 * 60000}]}, TP)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        geo = {'latitude': -28.62, 'longitude': -62.92, 'accuracy': 15}
        # --- el administrador
        actx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await actx.route('**/fonts.g*/**', lambda r: r.abort())
        ap = await login(actx, 'mauro', 'claveSegura1')
        await ap.click('#tabs [data-tab=tecnicos]')
        await ap.wait_for_function("document.querySelectorAll('.tcard').length === 2", timeout=8000)
        pe = await ap.evaluate(f"{card('Pedro')}.innerText"); ju = await ap.evaluate(f"{card('Juan')}.innerText")
        check('Pedro, que aceptó el aviso, tiene el botón «Cortar GPS»', 'Cortar GPS' in pe and 'Reanudar' not in pe, pe)
        check('Juan, que todavía no aceptó el aviso, no lo tiene', 'Cortar GPS' not in ju, ju)
        # --- el técnico mira desde su celular
        tctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
        await tctx.route('**/fonts.g*/**', lambda r: r.abort())
        tp = await login(tctx, 'pedro', 'pedro1')
        await tp.wait_for_selector('#ubChip', timeout=10000)
        check('el técnico ve «Ubicación activa»', 'Ubicación activa' in await tp.inner_text('#ubChip'), await tp.inner_text('#ubChip'))
        # --- el administrador abre el cuadro y corta a una hora de hace 5 minutos
        await ap.evaluate(f"{card('Pedro')}.querySelector('[data-gps-cortar]').click()")
        await ap.wait_for_selector('#cg-form', timeout=5000)
        txt = await ap.inner_text('#cg-form')
        check('el cuadro explica qué pasa y pide la hora', 'fin de su jornada' in txt and await ap.evaluate("document.querySelector('#cg-h').type") == 'time', txt[:300])
        v0 = await ap.input_value('#cg-h')
        check('la hora viene con la de ahora (hora de Argentina)', v0 == hhmm_ar(int(time.time() * 1000)) or v0 == hhmm_ar(int(time.time() * 1000) - 60000), v0)
        await ap.fill('#cg-h', '')
        await ap.click('#cg-form button[type=submit]')
        await ap.wait_for_timeout(500)
        check('sin hora no se corta y el cuadro sigue abierto', await ap.evaluate("!!document.querySelector('#cg-form')") and api('GET', '/api/ubicacion/estado', None, TP)[1]['corte'] is None)
        corte_hm = hhmm_ar(int(time.time() * 1000) - 5 * 60000)
        await ap.fill('#cg-h', corte_hm)
        await ap.click('#cg-form button[type=submit]')
        await ap.wait_for_function(f"(()=>{{const c={card('Pedro')};return c&&c.innerText.includes('GPS cortado a las {corte_hm}');}})()", timeout=8000)
        pe = await ap.evaluate(f"{card('Pedro')}.innerText")
        check('la tarjeta de Pedro dice «GPS cortado a las HH:MM» y ofrece «Reanudar GPS»', f'GPS cortado a las {corte_hm}' in pe and 'Reanudar GPS' in pe and 'Cortar GPS' not in pe, pe)
        check('su jornada figura terminada en el corte, avisando que fue a mano', f'Terminó {corte_hm}' in pe and 'GPS cortado a mano' in pe, pe)
        corte = api('GET', '/api/ubicacion/estado', None, TP)[1]['corte']
        check('el servidor tiene la hora del corte', corte and hhmm_ar(corte) == corte_hm, corte)
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'tecnicos-corte.png'))
        # --- el celular del técnico se entera en vivo
        await tp.wait_for_function("document.querySelector('#ubChip') && document.querySelector('#ubChip').innerText.includes('cortada por la oficina')", timeout=10000)
        check('el técnico ve «Ubicación cortada por la oficina» sin esperar ni recargar', True)
        bar = await tp.evaluate("document.querySelector('#jrBar') ? document.querySelector('#jrBar').innerText : ''")
        check('y su barra de jornada dice que la oficina cortó la ubicación', 'la oficina cortó tu ubicación' in bar, bar)
        if os.environ.get('VIS_OUT'): await tp.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'tecnico-cortado.png'))
        # --- reanudar
        await ap.evaluate(f"{card('Pedro')}.querySelector('[data-gps-reanudar]').click()")
        await ap.wait_for_function(f"(()=>{{const c={card('Pedro')};return c&&!c.innerText.includes('GPS cortado')&&c.innerText.includes('Cortar GPS');}})()", timeout=8000)
        check('«Reanudar GPS»: la tarjeta vuelve a ofrecer «Cortar GPS»', api('GET', '/api/ubicacion/estado', None, TP)[1]['corte'] is None)
        await tp.wait_for_function("document.querySelector('#ubChip') && document.querySelector('#ubChip').innerText.includes('Ubicación activa')", timeout=10000)
        check('el técnico vuelve a ver «Ubicación activa»', True)
        # --- un día pasado no ofrece el botón; la oficina con permiso no puede cortar
        await ap.fill('#tu-dia', '2001-01-08'); await ap.dispatch_event('#tu-dia', 'change')
        await ap.wait_for_function("document.querySelector('#tu-dia').value === '2001-01-08'", timeout=5000)
        await ap.wait_for_timeout(1200)
        check('en un día pasado no hay botón para cortar', await ap.evaluate("!document.querySelector('[data-gps-cortar]') && !document.querySelector('[data-gps-reanudar]')"))
        octx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await octx.route('**/fonts.g*/**', lambda r: r.abort())
        op = await login(octx, 'ofi', 'laura1')
        await op.click('#tabs [data-tab=tecnicos]')
        await op.wait_for_selector('.tcard', timeout=8000)
        check('la oficina con permiso para ver técnicos no tiene el botón de cortar', await op.evaluate("!document.querySelector('[data-gps-cortar]') && !document.querySelector('[data-gps-reanudar]')"))
        st, j = api('POST', '/api/ubicacion/cortar', {'uid': api('GET', '/api/users', None, TA)[1]['users'][0]['id']}, api('POST', '/api/login', {'usuario': 'ofi', 'clave': 'laura1'})[1]['token'])
        check('y el servidor tampoco se lo deja hacer', st == 403, [st, j])
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
