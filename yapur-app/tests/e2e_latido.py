# Latido del celular y alerta para la oficina: el técnico se entera de qué más se ve, la página manda el latido recién cuando él lo vio,
# la oficina ve el motivo del corte (ubicación apagada, sin permiso), la distancia a la base y, con 15 min o más sin señal, el contador y la barra.
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
async def login(ctx, user, clave, gateable=False):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    if gateable:
        # un técnico sin permiso de ubicación, en horario laboral, queda bloqueado (sin pestañas): esta prueba igual puede seguir,
        # porque #latBar y #ubChip viven fuera de #view/#tabs y el bloqueo no los toca. #roleChip confirma que entró igual.
        await pg.wait_for_selector('#roleChip:not([hidden])', timeout=10000)
    else:
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg
def lista(tok):
    return api('GET', '/api/ubicaciones', None, tok)[1]
def tec(tok, nombre):
    return next(x for x in lista(tok)['tecnicos'] if x['nombre'] == nombre)
async def espera(fn, seg=12):
    for _ in range(int(seg * 4)):
        v = fn()
        if v: return v
        await asyncio.sleep(0.25)
    return None

# la página de un técnico sin permiso de ubicación: el navegador responde «denegado», como Android cuando se le saca el permiso a la app
SIN_PERMISO = """
(() => {
  const err = { code: 1, message: 'denied', PERMISSION_DENIED: 1 };
  navigator.geolocation.watchPosition = (ok, ko) => { setTimeout(() => ko && ko(err), 200); return 1; };
  navigator.geolocation.getCurrentPosition = (ok, ko) => { setTimeout(() => ko && ko(err), 200); };
  navigator.permissions.query = () => Promise.resolve({ state: 'denied' });
})();
"""

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    for u, n, tel in [('pedro', 'Pedro', ''), ('ana', 'Ana', ''), ('cris', 'Cris', ''), ('luis', 'Luis Gómez', '3844222222'), ('tomi', 'Tomi', ''), ('nico', 'Nico', '')]:
        api('POST', '/api/users', {'usuario': u, 'nombre': n, 'role': 'tecnico', 'clave': u + '1234', **({'tel': tel} if tel else {})}, TA)
    api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)   # a cualquier hora del día en que se corra la prueba
    api('POST', '/api/jornada/base', {'lat': -28.4601, 'lng': -62.8302, 'radio': 40, 'tol': 10, 'dias': [0, 1, 2, 3, 4, 5, 6]}, TA)
    tok = {u: api('POST', '/api/login', {'usuario': u, 'clave': u + '1234'})[1]['token'] for u in ['pedro', 'ana', 'cris', 'luis', 'tomi', 'nico']}
    for u in ['pedro', 'cris', 'luis', 'tomi', 'nico']: api('POST', '/api/ubicacion/acepto', {}, tok[u])   # ya habían aceptado el aviso de antes
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        geo = {'latitude': -28.4601, 'longitude': -62.8302, 'accuracy': 15}
        async def ctx_tec(sin_permiso=False):
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            if sin_permiso: await c.add_init_script(SIN_PERMISO)
            return c

        # --- Pedro ya había aceptado el aviso de antes: un cartel le explica lo nuevo y el latido arranca cuando toca «Entendido»
        pp = await login(await ctx_tec(), 'pedro', 'pedro1234')
        await pp.wait_for_selector('#latBar:not([hidden])', timeout=8000)
        txt = await pp.inner_text('#latBar')
        check('cartel para quien ya había aceptado: dice qué se ve, el horario y que no lleva posición', 'ubicación o la app están apagadas' in txt and 'batería' in txt and 'de 0 a 24 h' in txt and 'ninguna posición' in txt and 'fuera del horario' in txt, txt)
        await asyncio.sleep(2.5)
        check('mientras no toca «Entendido» no se manda ningún latido', tec(TA, 'Pedro')['latido'] is None, tec(TA, 'Pedro')['latido'])
        await pp.click('#lat-ok')
        check('al tocar «Entendido» el cartel se va', await pp.evaluate("document.querySelector('#latBar').hidden"))
        lt = await espera(lambda: tec(TA, 'Pedro')['latido'])
        check('desde ahí el servidor recibe el latido de la página (sin GPS ni permisos que no sabe), y nada más que ts, batería y vía', bool(lt) and lt['via'] == 'web' and sorted(lt.keys()) == ['bat', 'ts', 'via'], lt)
        pe = tec(TA, 'Pedro')
        check('con el permiso dado y la ubicación andando no figura ningún tramo apagado', pe['apagados'] == [] and pe['motivo'] is None, (pe['apagados'], pe['motivo']))
        await pp.reload(wait_until='domcontentloaded'); await pp.wait_for_selector('#tabs .tab', timeout=10000); await pp.wait_for_timeout(1500)
        check('al volver a abrir la app el cartel no vuelve', await pp.evaluate("document.querySelector('#latBar').hidden"))

        # --- Ana acepta recién: el aviso ya lo explica, no hay cartel aparte y el latido arranca solo
        ap_ = await login(await ctx_tec(), 'ana', 'ana1234')
        await ap_.wait_for_selector('[role=dialog]', timeout=8000)
        av = await ap_.inner_text('[role=dialog]')
        check('el aviso nuevo dice que también se ve si la ubicación o la app están apagadas y la batería', 'también ve si la ubicación o la app están apagadas y cuánta batería te queda' in av and 'fuera del horario' in av, av[-700:])
        await ap_.click('[data-act=si]')
        await ap_.wait_for_selector('#ubChip', timeout=8000)
        check('quien acepta recién no ve el cartel de «lo nuevo»', await ap_.evaluate("document.querySelector('#latBar').hidden"))
        check('y su latido llega solo', bool(await espera(lambda: tec(TA, 'Ana')['latido'])), tec(TA, 'Ana')['latido'])

        # --- Cris: la app sin permiso de ubicación → el servidor anota el tramo «sin permiso»
        cp = await login(await ctx_tec(sin_permiso=True), 'cris', 'cris1234', gateable=True)
        await cp.wait_for_selector('#latBar:not([hidden])', timeout=8000)
        await cp.click('#lat-ok')
        ab = await espera(lambda: tec(TA, 'Cris')['apagados'])
        check('sin permiso de ubicación: queda anotado el tramo, abierto', bool(ab) and ab[0]['tipo'] == 'permiso' and ab[0]['hasta'] is None, ab)
        check('y en el celular se ve «Ubicación sin permiso»', 'sin permiso' in (await cp.inner_text('#ubChip')).lower(), await cp.inner_text('#ubChip'))
        check('sin permiso, en horario laboral, tampoco la deja usar la app (bloqueo por ubicación)', await cp.evaluate("document.querySelectorAll('#tabs .tab').length") == 0)

        # --- la oficina mira: Luis dejó de mandar y su celular dice que tiene la ubicación apagada
        now = int(time.time() * 1000)
        ar_dia = lambda ms: time.strftime('%Y-%m-%d', time.gmtime(ms / 1000 - 3 * 3600))
        mc = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await mc.route('**/fonts.g*/**', lambda r: r.abort())
        if ar_dia(now - 14 * 60000) != ar_dia(now):
            check('(salteado: recién pasó la medianoche)', True)
        else:
            api('POST', '/api/ubicacion', {'pts': [{'lat': -28.41, 'lng': -62.81, 'acc': 7, 'ts': now - 14 * 60000}, {'lat': -28.411, 'lng': -62.811, 'acc': 7, 'ts': now - 13 * 60000}]}, tok['luis'])
            api('POST', '/api/ubicacion/latido', {'gps': 0, 'red': 0, 'perm': 1, 'bat': 40, 'via': 'apk'}, tok['luis'])
            mp = await login(mc, 'mauro', 'claveSegura1')
            await mp.click('#tabs [data-tab=tecnicos]')
            await mp.wait_for_function("[...document.querySelectorAll('.tcard')].some(c=>c.innerText.includes('Luis'))", timeout=8000)
            cards = await mp.evaluate("[...document.querySelectorAll('.tcard')].map(c=>({t:c.innerText,h:[...c.querySelectorAll('a')].map(a=>a.href)}))")
            lu = next(c for c in cards if 'Luis' in c['t'])
            check('Luis: «Motivo probable» dice que tiene la ubicación del celular apagada, desde qué hora', 'Motivo probable' in lu['t'] and 'ubicación del celular apagada' in lu['t'], lu['t'])
            check('Luis: el detalle de tramos apagados figura (1 tramo, sigue)', 'Ubicación apagada o sin permiso' in lu['t'] and '1 tramo' in lu['t'], lu['t'])
            check('Luis: la última posición dice a cuánto está de la base', 'de la base' in lu['t'] and ' km ' in lu['t'], lu['t'])
            check('Luis: el cartel de arriba suma el motivo corto', 'ubicación apagada' in (await mp.inner_text('#tu-alerta')), await mp.inner_text('#tu-alerta'))
            wa = next((h for h in lu['h'] if 'wa.me' in h or 'whatsapp' in h), '')
            import urllib.parse
            check('«Avisarle por WhatsApp» ya le dice que prenda la ubicación', 'prendela' in urllib.parse.unquote(wa).lower(), urllib.parse.unquote(wa))
            pe = next(c for c in cards if 'Pedro' in c['t'])
            check('Pedro (en el punto de la base): figura «en la base»', 'en la base' in pe['t'], pe['t'])
            cr = next(c for c in cards if 'Cris' in c['t'])['t']
            check('Cris: la tarjeta dice que la app no tiene permiso de ubicación y resume el tramo', 'La app no tiene permiso de ubicación desde las' in cr and 'Ubicación apagada o sin permiso' in cr and '1 tramo' in cr, cr)
            det = await mp.evaluate("[...document.querySelectorAll('.tcard')].find(c=>c.innerText.includes('Cris')).querySelector('details:last-of-type').innerHTML")
            check('y el detalle del tramo dice «ahora» mientras sigue así', 'la app sin permiso de ubicación' in det and 'a ahora' in det, det)
            ni = next(c for c in cards if 'Nico' in c['t'])['t']
            check('Nico: aceptó pero nunca mandó ni un latido → igual aparece un «Motivo probable» explicando que puede no tener la app instalada', 'Todavía no mandó su posición' in ni and 'Motivo probable' in ni and 'YAPUR Gestión' in ni and 'Permitir todo el tiempo' in ni, ni)

        # --- 15 min o más sin señal en horario: contador rojo en la pestaña y barra arriba (solo si ya pasaron 15 min desde las 00:00)
        api('POST', '/api/ubicacion/latido', {'gps': 1, 'red': 1, 'perm': 1, 'bat': 3, 'via': 'apk'}, tok['tomi'])   # Tomi aceptó y nunca mandó una posición
        minhoy = ((now // 60000) - 180) % 1440
        if minhoy < 20:
            check('(salteado: recién pasó la medianoche, todavía no hay 15 min de horario)', True)
        else:
            mp2 = await login(await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}), 'mauro', 'claveSegura1')
            await mp2.wait_for_selector('#tabs [data-tab=tecnicos] .count.bad', timeout=10000)
            n = int(await mp2.inner_text('#tabs [data-tab=tecnicos] .count.bad'))
            check('la pestaña «Técnicos» muestra el contador rojo de los que llevan 15 min o más sin señal', n >= 1, n)
            await mp2.wait_for_selector('#tecBar:not([hidden])', timeout=8000)
            bar = await mp2.inner_text('#tecBar')
            check('arriba (en cualquier pestaña) aparece la barra con el nombre, los minutos y el motivo', 'sin señal en horario' in bar and 'Tomi' in bar and 'min' in bar and 'el celular no da posiciones' in bar, bar)
            await mp2.click('#tb-ocultar')
            check('«Ocultar 30 min» saca la barra (el contador queda)', await mp2.evaluate("document.querySelector('#tecBar').hidden") and await mp2.evaluate("!!document.querySelector('#tabs [data-tab=tecnicos] .count.bad')"))
            await mp2.reload(wait_until='domcontentloaded'); await mp2.wait_for_selector('#tecBar:not([hidden])', timeout=12000)
            await mp2.click('#tb-ver')
            await mp2.wait_for_selector('.tcard', timeout=8000)
            check('«Ver técnicos» abre la pestaña y la barra se va (ya está a la vista)', await mp2.evaluate("document.querySelector('#tabs [data-tab=tecnicos]').getAttribute('aria-selected')") == 'true' and await mp2.evaluate("document.querySelector('#tecBar').hidden"))

        # --- quien no ve a los técnicos no tiene ni contador ni barra
        api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura1'}, TA)
        op = await login(await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}), 'ofi', 'laura1')
        await op.wait_for_timeout(2500)
        check('la oficina sin el permiso «ver técnicos» no ve ni contador ni barra', await op.evaluate("!document.querySelector('#tabs [data-tab=tecnicos]') && document.querySelector('#tecBar').hidden"))
        await br.close()
    print('\nERRORES:', ERR if ERR else 'ninguno')
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)

asyncio.run(main())
