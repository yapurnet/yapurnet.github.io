# Equipos (dispositivos), de punta a punta con dos teléfonos: el administrador y un técnico. El técnico entra desde un equipo nuevo y queda
# esperando; al administrador le avisa en vivo; lo aprueba; el técnico entra; el administrador lo bloquea y al técnico se le cierra la sesión.
import asyncio, json, os, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res, ERR = [], []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

async def main():
    s, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro', 'did': 'dev-api-admin-0000001'})
    api('POST', '/api/users', {'usuario': 'tec1', 'nombre': 'Pedro Técnico', 'role': 'tecnico', 'clave': 'pedro1'}, j['token'])
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        mk = lambda: br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True, user_agent='Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')
        ctxA, ctxB = await mk(), await mk()
        for c in (ctxA, ctxB): await c.route('**/fonts.g*/**', lambda r: r.abort())
        async def abrir(ctx, user, clave):
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
            await pg.goto(BASE, wait_until='domcontentloaded'); await pg.wait_for_selector('#lg-form, #tabs .tab', timeout=8000)
            if await pg.locator('#lg-form').count():
                await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave); await pg.click('#lg-form button[type=submit]')
            return pg
        shot = lambda pg, n: pg.screenshot(path=os.path.join(SHOTS, n)) if SHOTS else asyncio.sleep(0)

        # administrador
        A = await abrir(ctxA, 'mauro', 'claveSegura1')
        await A.wait_for_selector('#tabs .tab', timeout=10000)
        await A.wait_for_function('S.ready && NET.online', timeout=15000)
        check('el equipo nuevo del administrador entra sin pedir aprobación', await A.locator('#tabs .tab').count() > 0)
        await A.click('#tabs [data-tab=ajustes]'); await A.wait_for_selector('#aj-disp-list')
        await A.wait_for_function("document.querySelector('#aj-disp-list').textContent.includes('este equipo')", timeout=8000)
        lst = await A.inner_text('#aj-disp-list')
        check('Ajustes tiene la tarjeta «Dispositivos» con el equipo del administrador marcado como «este equipo»', 'este equipo' in lst and 'Autorizado' in lst and 'Android 13' in lst, lst)
        check('la aprobación de equipos nuevos viene encendida', await A.is_checked('#aj-disp-req'))
        check('no hay aviso de pendientes todavía', await A.is_hidden('#devBar'))

        # técnico en un equipo nuevo
        B = await abrir(ctxB, 'tec1', 'pedro1')
        await B.wait_for_selector('#lg-dev', timeout=10000)
        msg = await B.inner_text('#lg-dev')
        cod = await B.evaluate("NET.did.slice(0,6).toUpperCase()")
        check('el técnico NO entra: la pantalla le explica que el equipo no está autorizado y le da su código', 'todavía no está autorizado' in msg and cod in msg and await B.locator('#tabs .tab').count() == 0, msg)
        if SHOTS: await shot(B, 'disp-tecnico-espera.png')

        # el administrador se entera en vivo
        await A.wait_for_function("!document.querySelector('#devBar').hidden", timeout=10000)
        bar = await A.inner_text('#devBar')
        check('al administrador le aparece el aviso arriba, sin recargar', '1 equipo pide entrar' in bar, bar)
        await A.click('#devBar'); await A.wait_for_function("document.querySelector('#aj-disp-list').textContent.includes('Esperando tu aprobación')", timeout=8000)
        lst = await A.inner_text('#aj-disp-list')
        check('la lista muestra primero el equipo pendiente: quién, modelo, código y los botones', 'Pedro Técnico' in lst and 'SM-A135M' in lst and cod in lst and 'Aprobar' in lst and 'Bloquear' in lst, lst)
        if SHOTS: await A.evaluate("document.querySelector('#aj-disp-list').closest('.card').scrollIntoView()"); await shot(A, 'disp-admin-pendiente.png')

        # aprobar
        await A.click('#aj-disp-list [data-disp-act=aprobar]')
        await A.wait_for_function("!document.querySelector('#aj-disp-list').textContent.includes('Esperando tu aprobación')", timeout=8000)
        check('al aprobar, el aviso de arriba desaparece', await A.is_hidden('#devBar'))
        await B.fill('#lg-pass', 'pedro1'); await B.click('#lg-form button[type=submit]')
        await B.wait_for_selector('#tabs .tab', timeout=15000)
        check('con el equipo aprobado, el técnico entra', await B.locator('#tabs .tab').count() > 0)
        await B.wait_for_function('S.ready && NET.online', timeout=15000)

        # bloquear: se le cierra la sesión en el acto
        await A.click('#aj-disp-ref'); await A.wait_for_function("document.querySelector('#aj-disp-list').textContent.includes('Con sesión abierta')", timeout=8000)
        if SHOTS: await A.evaluate("document.querySelector('#aj-disp-list').closest('.card').scrollIntoView()"); await shot(A, 'disp-admin-autorizado.png')
        await A.click('#aj-disp-list [data-disp-act=bloquear]'); await A.wait_for_selector('.sheet-body [data-act=yes]'); await A.click('.sheet-body [data-act=yes]')
        await A.wait_for_function("document.querySelector('#aj-disp-list').textContent.includes('Bloqueado')", timeout=8000)
        await B.wait_for_selector('#lg-form', timeout=15000)
        check('al bloquearlo, el teléfono del técnico vuelve solo a la pantalla de entrada', await B.locator('#tabs .tab').count() == 0)
        await B.fill('#lg-user', 'tec1'); await B.fill('#lg-pass', 'pedro1'); await B.click('#lg-form button[type=submit]')
        await B.wait_for_selector('#lg-dev', timeout=10000)
        msg = await B.inner_text('#lg-dev')
        check('y si prueba entrar de nuevo, le dice que el equipo fue bloqueado', 'fue bloqueado' in msg, msg)
        # el administrador puede permitirlo de nuevo
        await A.click('#aj-disp-list [data-disp-act=aprobar]'); await A.wait_for_function("!document.querySelector('#aj-disp-list').textContent.includes('Bloqueado')", timeout=8000)
        await B.fill('#lg-pass', 'pedro1'); await B.click('#lg-form button[type=submit]'); await B.wait_for_selector('#tabs .tab', timeout=15000)
        check('«Permitir de nuevo» lo habilita', True)

        # el técnico no ve la tarjeta de dispositivos
        await B.wait_for_function('S.ready', timeout=15000)
        check('el técnico no ve «Dispositivos» ni el aviso', await B.locator('#aj-disp-list').count() == 0 and await B.is_hidden('#devBar'))
        await br.close()
    check('sin errores de JavaScript en las pantallas', not ERR, ERR)
    print('\nERRORES: ' + ('ninguno' if not ERR else '; '.join(ERR)))
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    raise SystemExit(0 if all(res) and not ERR else 1)
asyncio.run(main())
