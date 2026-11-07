# Bloqueo de la app por ubicación, dentro del horario laboral: si el técnico no aceptó compartir su ubicación, le sacaron el
# permiso del navegador, o (según lo que informa el puente nativo del APK) tiene el GPS del celular apagado, no puede usar la
# app para nada hasta que lo solucione; fuera de horario no se le exige nada, y se destraba solo (sin recargar la página).
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
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    return pg
def tabs_count(pg): return pg.evaluate("document.querySelectorAll('#tabs .tab').length")

SIN_PERMISO = """
  const err = { code: 1, message: 'denied', PERMISSION_DENIED: 1 };
  navigator.geolocation.watchPosition = (ok, ko) => { setTimeout(() => ko && ko(err), 100); return 1; };
  navigator.geolocation.getCurrentPosition = (ok, ko) => { setTimeout(() => ko && ko(err), 100); };
  navigator.permissions.query = () => Promise.resolve({ state: 'denied' });
"""
FAKE_NATIVO = """
  window.__gps = '0';
  window.YapurApp = {
    startLocationSiempre: () => 'ok', ubicacionSiempre: () => 'no', activarLatido: () => 'si', stopLocation: () => {},
    ubicEstado: () => '1' + window.__gps,
    abrirAjustesUbicacion: () => { window.__abrio = true; }
  };
"""

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    for u in ['ana', 'beto', 'caro', 'dani']:
        api('POST', '/api/users', {'usuario': u, 'nombre': u.capitalize(), 'role': 'tecnico', 'clave': u + '1234'}, TA)
    ahora_h = int((time.time() / 3600 - 3) % 24)   # hora actual en Argentina (UTC-3)
    otra = (ahora_h + 12) % 24                      # 12 h de diferencia: siempre fuera de la hora de ahora
    geo = {'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])

        # --- 1) dentro de horario, todavía no aceptó el aviso: no puede usar la app para nada hasta que lo acepte
        api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)
        c1 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
        await c1.route('**/fonts.g*/**', lambda r: r.abort())
        pg1 = await login(c1, 'ana', 'ana1234')
        await pg1.wait_for_selector('[role=dialog] [data-act=no]', timeout=8000)
        await pg1.click('[role=dialog] [data-act=no]')
        await pg1.wait_for_selector('#gt-ok', timeout=8000)
        check('sin aceptar el aviso, en horario laboral, no aparece ninguna pestaña', await tabs_count(pg1) == 0)
        txt1 = await pg1.inner_text('#view')
        check('la pantalla explica que hace falta aceptar para poder usar la app', 'Ubicación en horario laboral' in txt1 and 'Entendido, aceptar' in txt1, txt1[:200])
        await pg1.click('#gt-ok')
        await pg1.wait_for_selector('#tabs .tab', timeout=8000)
        check('apenas acepta, se destraba solo (sin recargar la página) y aparecen las pestañas', True)

        # --- 2) dentro de horario, aceptó, pero le sacaron el permiso de ubicación del navegador: tampoco puede usar la app
        c2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await c2.route('**/fonts.g*/**', lambda r: r.abort())
        await c2.add_init_script(SIN_PERMISO)
        pg2 = await login(c2, 'beto', 'beto1234')
        await pg2.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000)
        await pg2.click('[role=dialog] [data-act=si]')
        await pg2.wait_for_selector('#gt-retry', timeout=8000)
        txt2 = await pg2.inner_text('#view')
        check('sin el permiso del navegador, en horario laboral, tampoco deja usar la app', 'permiso de ubicación' in txt2.lower(), txt2[:200])
        check('(y sigue sin aparecer ninguna pestaña)', await tabs_count(pg2) == 0)
        # el permiso del navegador no se vuelve a consultar solo (nadie quiere que el sitio repregunte todo el tiempo): hace
        # falta tocar «Ya lo di: revisar de nuevo», que es lo que simulamos arreglando el permiso y tocando ese botón
        await pg2.evaluate("UB.denied=false")   # simula que ya le dio el permiso de nuevo
        await pg2.click('#gt-retry')
        await pg2.wait_for_selector('#tabs .tab', timeout=8000)
        check('al tocar «Ya lo di: revisar de nuevo» con el permiso ya arreglado, se destraba', True)

        # --- 3) fuera de horario: no se exige nada, aunque no haya aceptado el aviso ni tenga permiso
        api('POST', '/api/ubicacion/horario', {'desde': otra, 'hasta': (otra + 1) % 24 or 24}, TA)
        c3 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await c3.route('**/fonts.g*/**', lambda r: r.abort())
        pg3 = await login(c3, 'caro', 'caro1234')
        await pg3.wait_for_selector('#tabs .tab', timeout=8000)
        check('fuera de horario, aunque no haya aceptado el aviso, se puede usar la app normalmente', await tabs_count(pg3) > 0)

        # --- 4) dentro de horario, con el puente nativo (APK): el GPS del celular está apagado
        api('POST', '/api/ubicacion/horario', {'desde': 0, 'hasta': 24}, TA)
        c4 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation=geo, permissions=['geolocation'])
        await c4.route('**/fonts.g*/**', lambda r: r.abort())
        await c4.add_init_script(FAKE_NATIVO)
        pg4 = await login(c4, 'dani', 'dani1234')
        await pg4.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000)
        await pg4.click('[role=dialog] [data-act=si]')
        await pg4.wait_for_selector('#gt-gps', timeout=8000)
        txt4 = await pg4.inner_text('#view')
        check('con el GPS del celular apagado (según el puente nativo), tampoco deja usar la app', 'ubicación del celular está apagada' in txt4.lower(), txt4[:200])
        check('(y sigue sin aparecer ninguna pestaña)', await tabs_count(pg4) == 0)
        await pg4.click('#gt-gps')
        await pg4.wait_for_timeout(200)
        check('«Prender ubicación» llama al puente nativo para abrir los ajustes de ubicación del celular', await pg4.evaluate("window.__abrio === true"))
        await pg4.evaluate("window.__gps = '1'")   # simula que ya la prendió
        await pg4.wait_for_selector('#tabs .tab', timeout=8000)
        check('al prenderla, se destraba solo (el chequeo rápido la vuelve a consultar cada pocos segundos)', True)

        await br.close()
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
