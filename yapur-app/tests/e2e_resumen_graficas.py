# Dos gráficos nuevos en el Resumen (ven la pestaña quienes tengan el permiso «resumen»; oficina no lo tiene por default):
# - «Clientes: altas y bajas»: una barra verde (altas, por c.alta) y una roja (bajas, por c.bajaFecha) por cada uno de los
#   últimos 6 meses, con el neto en el pie.
# - «Órdenes cerradas por técnico»: una barra horizontal por técnico con lo que cerró ESTE mes (incluye a los que cerraron 0,
#   para que se note quién no hizo nada); no cuenta lo abierto ni lo cerrado en otro mes.
# Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.request, urllib.error
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
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
def addmonths(ym, n):
    y, m = map(int, ym.split('-')); m += n; y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return '%04d-%02d' % (y, m)
ERR = []
async def sin_aviso(pg):
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

async def main():
    hoy = datetime.date.today(); cur = hoy.strftime('%Y-%m'); prev = addmonths(cur, -1)
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'juan', 'nombre': 'Juan', 'role': 'tecnico', 'clave': 'juan1234'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro'); juan = next(u for u in ul['users'] if u['usuario'] == 'juan')
    # clientes: 2 altas este mes, 1 alta el mes pasado, 1 baja este mes
    clientes = {
        'a': {'nombre': 'Ana Alonso', 'estado': 'activo', 'dir': 'Calle A', 'loc': 'Añatuya', 'alta': cur + '-05'},
        'b': {'nombre': 'Beto Bravo', 'estado': 'activo', 'dir': 'Calle B', 'loc': 'Añatuya', 'alta': cur + '-12'},
        'c': {'nombre': 'Carla Cruz', 'estado': 'activo', 'dir': 'Calle C', 'loc': 'Añatuya', 'alta': prev + '-20'},
        'd': {'nombre': 'Dario Diaz', 'estado': 'baja', 'dir': 'Calle D', 'loc': 'Añatuya', 'alta': prev + '-01', 'bajaFecha': cur + '-03', 'bajaMotivo': 'Se mudó'},
    }
    for cid, data in clientes.items(): api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: data}}}, TA)
    # órdenes: Pedro cierra 2 este mes; Juan no cierra ninguna este mes (pero sí 1 el mes pasado, y tiene 1 abierta este mes: ninguna de las dos cuenta)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {
        'o1': {'tipo': 'visita', 'estado': 'hecha', 'tecnico': pedro['id'], 'clientId': 'a', 'cierre': cur + '-10 09:00', 'creado': cur + '-10'},
        'o2': {'tipo': 'falla', 'estado': 'hecha', 'tecnico': pedro['id'], 'clientId': 'b', 'cierre': cur + '-15 11:00', 'creado': cur + '-15'},
        'o3': {'tipo': 'visita', 'estado': 'pendiente', 'tecnico': juan['id'], 'clientId': 'c', 'creado': cur + '-01'},
    }}}, TA)
    api('PATCH', '/api/doc/ordenes/' + prev, {'data': {'items': {
        'o4': {'tipo': 'visita', 'estado': 'hecha', 'tecnico': juan['id'], 'clientId': 'c', 'cierre': prev + '-10 09:00', 'creado': prev + '-10'},
    }}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.loaded.ordenes && S.loaded.clientes && S.clientes.size >= 4", timeout=10000)
        await pg.click('#tabs [data-tab=resumen]'); await pg.wait_for_selector('#rs .kpi')
        # altas y bajas
        await pg.wait_for_selector('#rs .bars2 .grp')
        grupos = await pg.evaluate("[...document.querySelectorAll('#rs .bars2 .grp')].map(g=>g.title)")
        check('hay 6 meses en el gráfico de altas y bajas', len(grupos) == 6, grupos)
        check('este mes: 2 altas (Ana y Beto) y 1 baja (Dario)', any('2 altas, 1 baja' in g for g in grupos), grupos)
        check('el mes pasado: 2 altas (Carla y Dario, que se dio de alta en octubre) y 0 bajas', any(g.startswith('Octubre') and '2 altas, 0 bajas' in g for g in grupos), grupos)
        hint_evol = await pg.evaluate("document.querySelector('#rs .bars2').closest('.card').querySelector('.hint').textContent")
        check('el pie dice el neto de los últimos 6 meses (4 altas - 1 baja = +3)', '+3 clientes netos' in hint_evol, hint_evol)
        # órdenes cerradas por técnico
        await pg.wait_for_selector('#rs .hbars .hbar-row')
        filas = await pg.evaluate("[...document.querySelectorAll('#rs .hbars .hbar-row')].map(r=>({nom:r.querySelector('.hbar-lbl').textContent,n:r.querySelector('.hbar-val').textContent}))")
        check('Pedro aparece con 2 (las dos que cerró este mes, no cuenta la de Juan de pendiente ni la del mes pasado)', any(f['nom'] == 'Pedro' and f['n'] == '2' for f in filas), filas)
        check('Juan aparece con 0 (no cerró ninguna este mes, aunque tenga una pendiente y otra del mes pasado)', any(f['nom'] == 'Juan' and f['n'] == '0' for f in filas), filas)
        check('Pedro va primero (más arriba, por tener más)', filas[0]['nom'] == 'Pedro', filas)
        # la oficina (perfil por default: resumen=false, ya lo prueba e2e_instalaciones.py) ni tiene la pestaña Resumen,
        # y el técnico tampoco; acá solo se confirma que las pestañas no cambiaron con este agregado
        po = await login(await nuevo(), 'laura', 'laura123')
        to = await po.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
        check('la oficina no tiene Resumen (su perfil no tiene ese permiso)', 'resumen' not in to, to)
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        tt = await pt.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
        check('el técnico no tiene Resumen', 'resumen' not in tt, tt)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
