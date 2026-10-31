# Ubicación de los técnicos: aviso y aceptación en la app del técnico, envío al servidor y pestaña «Técnicos» de quien la mira.
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
def lista(tok):
    st, j = api('GET', '/api/ubicaciones', None, tok); return j

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura1'}, TA)
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro1'}, TA)
    api('POST', '/api/users', {'usuario': 'juan', 'nombre': 'Juan', 'role': 'tecnico', 'clave': 'juan11'}, TA)
    api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)   # a cualquier hora del día en que se corra la prueba
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        geo = {'latitude': -28.4601, 'longitude': -62.8302, 'accuracy': 15}
        tctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
        await tctx.route('**/fonts.g*/**', lambda r: r.abort())
        # --- Pedro acepta el aviso
        pp = await login(tctx, 'pedro', 'pedro1')
        await pp.wait_for_selector('[role=dialog]', timeout=8000)
        txt = await pp.inner_text('[role=dialog]')
        check('al entrar, el técnico ve el aviso con el horario', 'Ubicación en horario laboral' in txt and 'de 0 a 24 h' in txt and 'se borra' in txt.lower(), txt[:300])
        await pp.click('[data-act=si]')
        await pp.wait_for_selector('#ubChip', timeout=8000)
        check('queda un cartel «Ubicación activa» en el encabezado', 'Ubicación activa' in await pp.inner_text('#ubChip'), await pp.inner_text('#ubChip'))
        for _ in range(40):
            d = lista(TA); ped = next(x for x in d['tecnicos'] if x['nombre'] == 'Pedro')
            if ped['puntos'] >= 1: break
            await asyncio.sleep(0.25)
        check('el servidor recibe su posición con las coordenadas del celular', ped['puntos'] >= 1 and abs(ped['ultima']['lat'] - geo['latitude']) < 1e-5 and abs(ped['ultima']['lng'] - geo['longitude']) < 1e-5 and ped['ultima']['acc'] == 15, ped)
        # --- Juan dice «Ahora no»
        jctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
        await jctx.route('**/fonts.g*/**', lambda r: r.abort())
        jp = await login(jctx, 'juan', 'juan11')
        await jp.wait_for_selector('[role=dialog]', timeout=8000)
        await jp.click('[data-act=no]')
        await jp.wait_for_timeout(2500)
        d = lista(TA); jua = next(x for x in d['tecnicos'] if x['nombre'] == 'Juan')
        check('si dice «Ahora no», no se manda ni se guarda nada y no hay cartel', jua['acepto'] is False and jua['puntos'] == 0 and await jp.evaluate("!document.querySelector('#ubChip')"), jua)
        # un par de puntos más de Pedro para tener recorrido
        now = int(time.time() * 1000)
        api('POST', '/api/ubicacion', {'pts': [{'lat': -28.47, 'lng': -62.84, 'acc': 8, 'ts': now - 4 * 60000}, {'lat': -28.48, 'lng': -62.85, 'acc': 8, 'ts': now - 2 * 60000}]}, (api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro1'})[1])['token'])
        # --- el administrador mira
        actx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await actx.route('**/fonts.g*/**', lambda r: r.abort())
        ap = await login(actx, 'mauro', 'claveSegura1')
        tabs = await ap.inner_text('#tabs')
        check('el administrador ve la pestaña «Técnicos»', 'Técnicos' in tabs, tabs)
        await ap.click('#tabs [data-tab=tecnicos]')
        await ap.wait_for_selector('.tcard', timeout=8000)
        await ap.wait_for_function("document.querySelectorAll('.tcard').length === 2", timeout=8000)
        cards = await ap.evaluate("[...document.querySelectorAll('.tcard')].map(c=>({t:c.innerText,h:[...c.querySelectorAll('a')].map(a=>a.href)}))")
        pe = next(c for c in cards if 'Pedro' in c['t']); ju = next(c for c in cards if 'Juan' in c['t'])
        check('Pedro: en línea, con su precisión, y botón para ver el mapa en su última posición', 'En línea' in pe['t'] and '±' in pe['t'] and any('query=' in h and 'maps' in h for h in pe['h']), pe)
        check('Pedro: tiene recorrido del día (más de un punto)', any('/maps/dir/' in h and 'origin=-28.47' in h for h in pe['h']), pe['h'])
        check('Juan: «Todavía no aceptó el aviso», sin botón de mapa', 'Todavía no aceptó el aviso' in ju['t'] and not any('maps' in h for h in ju['h']), ju)
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'tecnicos.png'))
        if os.environ.get('VIS_OUT'): await pp.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'tecnico-chip.png'))
        check('se explica el horario y los días que se guarda', 'de 0 a 24 h' in await ap.inner_text('#tu-horario') and '14 días' in await ap.inner_text('#tu-horario'), await ap.inner_text('#tu-horario'))
        # --- el horario se cambia desde la pantalla
        await ap.click('#tu-hz')
        await ap.wait_for_selector('#hz-form')
        await ap.fill('#hz-d', '20'); await ap.fill('#hz-h', '8')
        await ap.click('#hz-form button[type=submit]')
        await ap.wait_for_timeout(600)
        check('un horario al revés no se guarda y el cuadro sigue abierto', await ap.evaluate("!!document.querySelector('#hz-form')") and lista(TA)['horario']['desde'] == 0)
        await ap.fill('#hz-d', '8'); await ap.fill('#hz-h', '20')
        await ap.click('#hz-form button[type=submit]')
        await ap.wait_for_function("document.querySelector('#tu-horario').innerText.includes('de 8 a 20 h')", timeout=8000)
        check('el horario nuevo queda en el servidor y en pantalla', lista(TA)['horario'] == {'desde': 8, 'hasta': 20})
        # --- la oficina sin permiso no ve la pestaña; con permiso, sí
        octx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await octx.route('**/fonts.g*/**', lambda r: r.abort())
        op = await login(octx, 'ofi', 'laura1')
        check('la oficina sin el permiso no ve «Técnicos»', 'Técnicos' not in await op.inner_text('#tabs'), await op.inner_text('#tabs'))
        users = api('GET', '/api/users', None, TA)[1]['users']; ofi = next(u for u in users if u['usuario'] == 'ofi')
        api('PATCH', '/api/users/' + ofi['id'], {'permisos': {'verTecnicos': True}}, TA)
        await op.wait_for_function("document.querySelector('#tabs').innerText.includes('Técnicos')", timeout=10000)
        check('al darle el permiso, la pestaña aparece sin volver a entrar', True)
        await op.click('#tabs [data-tab=tecnicos]')
        await op.wait_for_selector('.tcard', timeout=8000)
        check('la oficina con permiso no puede cambiar el horario (no hay botón)', await op.evaluate("!document.querySelector('#tu-hz')"))
        # --- los técnicos no ven la pestaña
        check('el técnico no tiene la pestaña «Técnicos»', 'Técnicos' not in await pp.inner_text('#tabs'), await pp.inner_text('#tabs'))
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
