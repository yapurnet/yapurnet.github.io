import asyncio, json, os, random, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BASE = os.environ['YAPUR_BASE']          # lo define run_e2e.js (servidor de verdad en la computadora)
CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, 'tests', 'shots'))
os.makedirs(SHOTS, exist_ok=True)

results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {extra}'))

def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, None

async def tabs_of(pg):
    return await pg.eval_on_selector_all('#tabs .tab', 'els => els.map(e => e.textContent.replace(/[0-9]+$/, "").trim())')

async def login_ui(pg, user, clave):
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user)
    await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)

async def main():
    code = CODE
    errors = []
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
            async def newctx(name, csp=True):
                ctx = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=csp)
                pg = await ctx.new_page()
                pg.on('pageerror', lambda e, n=name: errors.append(f'[{n}] PAGEERROR {e}'))
                pg.on('console', lambda m, n=name: errors.append(f'[{n}] CONSOLE {m.text}') if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
                await ctx.route('**/fonts.g*/**', lambda r: r.abort())
                return ctx, pg

            # ---------- instalación ----------
            ctxA, A = await newctx('admin')
            await A.goto(BASE, wait_until='domcontentloaded')
            await A.wait_for_selector('#su-form', timeout=8000)
            await A.screenshot(path=f'{SHOTS}/01_instalacion.png')
            await A.fill('#su-code', 'CODIGOMALO')
            await A.fill('#su-nom', 'Mauro'); await A.fill('#su-user', 'mauro'); await A.fill('#su-pass', 'claveSegura1')
            await A.click('#su-form button[type=submit]')
            await A.wait_for_selector('.toast.bad', timeout=5000)
            check('instalación con código malo avisa y no entra', await A.query_selector('#su-form') is not None)
            await A.fill('#su-code', code)
            await A.click('#su-form button[type=submit]')
            await A.wait_for_selector('#tabs .tab', timeout=10000)
            await A.wait_for_timeout(600)
            chip = await A.inner_text('#roleChip')
            check('el administrador entra y ve su nombre arriba', chip.strip() == 'Mauro', chip)
            tabsA = await tabs_of(A)
            check('el administrador ve todas las pestañas', all(t in tabsA for t in ['Resumen', 'Cobranzas', 'Clientes', 'Órdenes', 'Planes', 'Ajustes']), tabsA)
            await A.screenshot(path=f'{SHOTS}/02_admin_resumen.png')

            # ---------- datos de prueba desde la API ----------
            st, j = api('POST', '/api/login', {'usuario': 'mauro', 'clave': 'claveSegura1'})
            TA = j['token']
            api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'bajada': 50, 'subida': 25, 'precio': 20000, 'activo': True}}, TA)
            cur = time.strftime('%Y-%m')
            items = {f'cli{i}': {'nombre': f'Cliente {i}', 'codigo': str(i), 'tel': '3844 56-2605', 'dir': f'Calle {i}', 'estado': 'activo', 'planId': 'p1', 'desde': cur, 'ciclo': 1, 'alta': cur + '-01', 'lat': -28.46 - i / 1000, 'lng': -62.83, 'precio': None, 'dni': '3011122' + str(i)} for i in range(1, 6)}
            st, _ = api('PATCH', '/api/doc/clientes/c00', {'data': {'items': items}}, TA)
            check('datos de prueba cargados', st == 200, st)
            await A.wait_for_function('S.clientes.size === 5', timeout=5000)
            check('el administrador ve los clientes nuevos en vivo (sin recargar)', True)

            # ---------- la app respeta la política de seguridad (CSP) del servidor ----------
            ctxS, Sx = await newctx('csp', csp=False)
            await login_ui(Sx, 'mauro', 'claveSegura1')
            await Sx.click('#tabs [data-tab=clientes]')
            await Sx.wait_for_selector('[data-open-client]', timeout=8000)
            await Sx.click('[data-open-client]')
            await Sx.wait_for_selector('.sheet', timeout=5000)
            await Sx.wait_for_timeout(500)
            check('la app funciona con la política de seguridad estricta (sin errores de CSP)', not any('Content Security Policy' in e for e in errors), [e for e in errors if 'Content Security' in e])
            await ctxS.close()

            # ---------- crear usuarios desde la pantalla de Ajustes ----------
            await A.click('#tabs [data-tab=ajustes]')
            await A.wait_for_selector('#aj-newp')
            await A.click('#aj-newp')
            await A.wait_for_selector('#uform')
            await A.fill('#uf-nombre', 'Laura Gómez'); await A.fill('#uf-user', 'laura'); await A.select_option('#uf-role', 'oficina')
            await A.click('#uf-gen')
            claveL = await A.input_value('#uf-clave')
            check('se genera una clave', len(claveL) == 8, claveL)
            await A.screenshot(path=f'{SHOTS}/03_nuevo_usuario.png')
            await A.click('#uform button[type=submit]')
            await A.wait_for_selector('text=Usuario creado', timeout=5000)
            await A.screenshot(path=f'{SHOTS}/04_datos_acceso.png')
            await A.click('.sheet [data-close].btn.primary')
            await A.wait_for_function("document.querySelector('#aj-users').textContent.includes('Laura')", timeout=5000)
            # técnico
            await A.click('#aj-newp'); await A.wait_for_selector('#uform')
            await A.fill('#uf-nombre', 'Pedro Díaz'); await A.fill('#uf-user', 'pedro'); await A.fill('#uf-clave', 'pedro123'); await A.fill('#uf-tel', '3844111222')
            await A.click('#uform button[type=submit]')
            await A.wait_for_selector('text=Usuario creado', timeout=5000)
            await A.click('.sheet [data-close].btn.primary')
            await A.wait_for_function("document.querySelector('#aj-users').textContent.includes('Pedro')", timeout=5000)
            await A.screenshot(path=f'{SHOTS}/05_usuarios.png', full_page=True)
            check('los usuarios nuevos figuran en la lista', True)
            st, ul = api('GET', '/api/users', token=TA)
            pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
            laura = next(u for u in ul['users'] if u['usuario'] == 'laura')
            check('quedaron guardados con su tipo', pedro['role'] == 'tecnico' and laura['role'] == 'oficina')

            # ---------- oficina ----------
            ctxB, B = await newctx('oficina')
            await login_ui(B, 'laura', claveL)
            await B.wait_for_function('S.clientes.size === 5 && S.loaded.pagos', timeout=8000)
            tabsB = await tabs_of(B)
            check('oficina ve Cobranzas y Clientes, no Ajustes ni Planes de administrador', 'Cobranzas' in tabsB and 'Clientes' in tabsB and 'Ajustes' not in tabsB, tabsB)
            await B.screenshot(path=f'{SHOTS}/06_oficina.png')
            await B.evaluate("openCobro('cli1')")
            await B.wait_for_selector('#cb-go')
            await B.screenshot(path=f'{SHOTS}/07_cobro.png')
            await B.click('#cb-go')
            await B.wait_for_selector('.toast:has-text("Cobro registrado")', timeout=6000)
            check('la oficina registra un cobro', True)
            # el cobro llega en vivo al administrador
            await A.wait_for_function('S.pagos.size >= 1', timeout=6000)
            check('el administrador ve el cobro al instante', True)
            st, doc = api('GET', '/api/doc/pagos/' + time.strftime('%Y') + '-s' + '%02d' % 0, token=TA)
            st, sync = api('GET', '/api/sync', token=TA)
            pagos = [it for d in sync['cols'].get('pagos', []) for it in d['data']['items'].values()]
            check('el pago quedó a nombre de Laura (lo pone el servidor)', len(pagos) == 1 and pagos[0]['por'] == laura['id'], pagos)

            # ---------- técnico ----------
            ctxC, C = await newctx('tecnico')
            await login_ui(C, 'pedro', 'pedro123')
            await C.wait_for_function('S.clientes.size === 5', timeout=8000)
            tabsC = await tabs_of(C)
            check('el técnico no ve dinero ni ajustes', not any(t in tabsC for t in ['Resumen', 'Cobranzas', 'Planes', 'Ajustes']) and 'Órdenes' in tabsC, tabsC)
            await C.screenshot(path=f'{SHOTS}/08_tecnico.png')
            r = await C.evaluate("NET.api('GET','/api/doc/pagos/2026-s00').then(j=>j,e=>({err:e.message}))")
            check('el servidor no le entrega pagos al técnico', r.get('data') is None, r)
            r = await C.evaluate("NET.api('PATCH','/api/doc/clientes/c00',{data:{items:{cli1:{precio:1}}}}).then(()=>'permitido',e=>e.status)")
            check('el técnico no puede cambiar precios aunque lo intente a mano', r == 403, r)
            r = await C.evaluate("S.clientes.get('cli1').dni")
            check('el técnico no recibe el DNI', r is None, r)
            # una orden creada por el administrador llega en vivo al técnico
            api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'falla', 'clientId': 'cli2', 'estado': 'pendiente', 'prioridad': 'normal', 'fecha': time.strftime('%Y-%m-%d'), 'creado': time.strftime('%Y-%m-%d'), 'tecnico': pedro['id'], 'detalle': 'Sin señal'}}}}, TA)
            await C.wait_for_function('S.ordenes.size === 1', timeout=6000)
            await C.click('#tabs [data-tab=ordenes]')
            await C.wait_for_timeout(500)
            body = await C.inner_text('#view')
            check('la orden asignada aparece en la pantalla del técnico', 'Falla' in body or 'Sin señal' in body, body[:200])
            await C.screenshot(path=f'{SHOTS}/09_tecnico_ordenes.png')

            # ---------- la oficina pierde un permiso en vivo ----------
            api('PATCH', f'/api/users/{laura["id"]}', {'permisos': {'cobrar': False, 'caja': False, 'promesas': False}}, TA)
            await B.wait_for_function("!S.perms.cobrar", timeout=6000)
            await B.wait_for_timeout(300)
            tabsB2 = await tabs_of(B)
            check('al cambiarle los permisos, la pantalla de oficina se actualiza sola', 'Cobranzas' not in tabsB2, tabsB2)

            # ---------- sin señal: la app abre con los datos guardados ----------
            await C.wait_for_timeout(5000)  # deja que se guarde la copia local
            await ctxC.route('**/api/**', lambda r: r.abort())
            await C.reload(wait_until='domcontentloaded')
            await C.wait_for_selector('#tabs .tab', timeout=8000)
            await C.wait_for_function('S.clientes.size === 5', timeout=5000)
            check('sin conexión, el técnico igual ve los clientes guardados', True)
            await C.wait_for_selector('#netBar:not([hidden])', timeout=8000)
            check('y la app avisa que no hay conexión', 'Sin conexión' in await C.inner_text('#netBar'))
            await C.screenshot(path=f'{SHOTS}/10_sin_conexion.png')
            await ctxC.unroute('**/api/**')

            # ---------- service worker: la app abre aunque el equipo no tenga ninguna red ----------
            await C.reload(wait_until='domcontentloaded')
            await C.wait_for_function('S.synced !== false && NET.online', timeout=10000)
            await C.wait_for_function("navigator.serviceWorker.ready.then(r=>!!r.active)", timeout=8000)
            await C.wait_for_function("navigator.serviceWorker.controller !== null || true", timeout=2000)
            await C.reload(wait_until='domcontentloaded')    # ya controlada por el service worker
            await C.wait_for_function("navigator.serviceWorker.controller !== null", timeout=8000)
            await C.wait_for_timeout(5000)                   # deja que se guarde la copia local
            await ctxC.set_offline(True)
            await C.reload(wait_until='domcontentloaded')
            await C.wait_for_selector('#tabs .tab', timeout=10000)
            await C.wait_for_function('S.clientes.size === 5', timeout=5000)
            check('sin ninguna red, la app abre igual (service worker + copia local)', True)
            await C.screenshot(path=f'{SHOTS}/10b_sin_red_total.png')
            await ctxC.set_offline(False)

            # ---------- desactivar al técnico: se le cierra la sesión en vivo ----------
            await C.reload(wait_until='domcontentloaded')
            await C.wait_for_function('S.synced !== false && NET.online', timeout=10000)
            await A.click('#tabs [data-tab=ajustes]')
            await A.wait_for_selector('#aj-users [data-u-act=off]')
            btn = await A.query_selector(f'#aj-users [data-u="{pedro["id"]}"][data-u-act=off]')
            await btn.click()
            await A.wait_for_selector('.sheet [data-act=yes]')
            await A.click('.sheet [data-act=yes]')
            await C.wait_for_selector('#lg-form', timeout=10000)
            msg = await C.inner_text('#view')
            check('al desactivarlo, el técnico queda afuera al instante', 'Entrar' in msg)
            check('y se le explica por qué', 'desactivado' in msg or 'terminó' in msg, msg[:200])
            await C.screenshot(path=f'{SHOTS}/11_expulsado.png')
            await C.fill('#lg-user', 'pedro'); await C.fill('#lg-pass', 'pedro123')
            await C.click('#lg-form button[type=submit]')
            await C.wait_for_selector('.toast.bad', timeout=5000)
            check('no puede volver a entrar', await C.query_selector('#lg-form') is not None)

            # ---------- mi cuenta ----------
            await B.evaluate("closeModal()")   # el recibo del cobro sigue abierto
            await B.click('#roleChip')
            await B.wait_for_selector('#ac-form')
            await B.screenshot(path=f'{SHOTS}/12_mi_cuenta.png')
            await B.fill('#ac-act', claveL); await B.fill('#ac-new', 'nuevaclave1')
            await B.click('#ac-form button[type=submit]')
            await B.wait_for_selector('.toast:has-text("Clave cambiada")', timeout=5000)
            st, _ = api('POST', '/api/login', {'usuario': 'laura', 'clave': 'nuevaclave1'})
            check('la persona cambia su propia clave', st == 200, st)
            await B.click('#roleChip')
            await B.click('#ac-out')
            await B.wait_for_selector('#lg-form', timeout=8000)
            check('cerrar sesión vuelve a la pantalla de entrada', True)

            # ---------- copia de seguridad ----------
            await A.evaluate("ACC.loaded=false")
            r = await A.evaluate("NET.api('GET','/api/backup').then(j=>({docs:j.docs.length,users:j.users.length}))")
            check('el administrador puede bajar la copia completa', r['docs'] >= 3 and r['users'] == 3, r)
            await A.screenshot(path=f'{SHOTS}/13_ajustes.png', full_page=True)
            await br.close()
    finally:
        pass
    print('\nERRORES DE CONSOLA/PÁGINA:', 'ninguno' if not errors else '')
    for e in errors: print('  ', e)
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)} ok, {len(bad)} con fallas')
    sys.exit(1 if bad or errors else 0)

asyncio.run(main())
