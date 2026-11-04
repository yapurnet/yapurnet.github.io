# Probar la conexión de un cliente: la oficina toca «Probar conexión» en la ficha, un «router» (simulado con pedidos HTTP) toma el pedido,
# hace el ping y manda el resultado; el administrador arma el script del router en Ajustes. Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None, raw=None):
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'text/plain' if raw is not None else 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def japi(method, path, body=None, token=None):
    st, txt = api(method, path, body, token)
    try: return st, json.loads(txt or 'null')
    except Exception: return st, txt

def shard(cid):   # igual que clientShard() de la app
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)

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

async def router_atiende(tk, rec, esperar=20, tras_tomar=None):
    """lo que haría el script del router: consulta cada tanto; si hay una prueba, la «hace» y manda cuántos paquetes volvieron"""
    t0 = time.time()
    while time.time() - t0 < esperar:
        st, txt = await asyncio.to_thread(api, 'GET', '/api/router/ping', None, tk)
        if st == 200 and txt:
            pid, ip = txt.split(',')[0].split(':')
            if tras_tomar: await tras_tomar()
            await asyncio.to_thread(api, 'POST', f'/api/router/ping?id={pid}&sent=4&rec={rec}', None, tk, 'x')
            return pid, ip
        await asyncio.sleep(0.3)
    return None

async def main():
    st, j = japi('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    japi('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura Oficina', 'role': 'oficina', 'clave': 'laura1'}, TA)
    japi('POST', '/api/users', {'usuario': 'sofia', 'nombre': 'Sofia Oficina', 'role': 'oficina', 'clave': 'sofia1'}, TA)
    japi('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro Tecnico', 'role': 'tecnico', 'clave': 'pedro1'}, TA)
    us = japi('GET', '/api/users', None, TA)[1]['users']
    sofia = next(u for u in us if u['usuario'] == 'sofia')
    st, j = japi('PATCH', '/api/users/' + sofia['id'], {'permisos': {'ping': False}}, TA)
    check('el administrador le apaga el ping a una usuaria', st == 200 and j['user']['perms']['ping'] is False, j)
    for cid, c in [('cAna', {'nombre': 'Ana Lopez', 'ip': '10.10.0.5', 'estado': 'activo', 'nodo': 'ADMIN02'}),
                   ('cSin', {'nombre': 'Sin IP', 'ip': '', 'estado': 'activo'}),
                   ('cDos', {'nombre': 'Dos IP', 'ip': '10.10.0.7, 10.10.0.8', 'estado': 'activo'})]:
        japi('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    st, R = japi('POST', '/api/routers', {'nombre': 'ADMIN02', 'kinds': ['q']}, TA)
    rid = R['router']['id']

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctxA = await br.new_context(bypass_csp=True, viewport={'width': 1000, 'height': 900}, accept_downloads=True)
        await ctxA.route('**/fonts.g*/**', lambda r: r.abort())
        pa = await login(ctxA, 'mauro', 'claveSegura1')

        # 1) Ajustes → Routers: el router figura «sin configurar» y el administrador arma su script de ping
        await pa.click('#tabs [data-tab=ajustes]')
        await pa.wait_for_function("document.querySelector('#aj-routers') && document.querySelector('#aj-routers').textContent.includes('ADMIN02')", timeout=8000)
        check('el router figura con las pruebas «sin configurar»', 'Pruebas de conexión: sin configurar' in await pa.inner_text('#aj-routers'), await pa.inner_text('#aj-routers'))
        await pa.click('#aj-routers [data-rt=pscript]')
        await pa.wait_for_selector('.sheet [data-act=yes]')
        await pa.click('.sheet [data-act=yes]')
        await pa.wait_for_selector('.sheet [data-copy-label=Script]', timeout=8000)
        script = await pa.get_attribute('.sheet [data-copy-label=Script]', 'data-copy')
        m = re.search(r'Authorization: Bearer (r[0-9a-f]{10}\.[A-Za-z0-9_-]+)"', script)
        check('el script lleva el acceso de pruebas del router y apunta a este servidor', m is not None and f':local base "{BASE}/api/router/ping"' in script, script[:400])
        tk = m.group(1)
        check('el script solo lee y hace ping, con permisos mínimos y sin contraseñas',
              'policy=read,test' in script and '/ping address=$ip' in script and 'password' not in script and '/queue' not in script and '/ppp' not in script and '/interface' not in script)
        check('el script va en ASCII puro (el terminal del router no respeta tildes)', all(ord(ch) < 128 for ch in script))
        prog = await pa.get_attribute('.sheet [data-copy-label=Programación]', 'data-copy')
        check('la programación corre el script cada 10 segundos', 'interval=10s' in prog and 'yapur-ping' in prog and 'policy=read,test' in prog, prog)
        check('el token de datos del router ya no sirve para ping y el de ping sí', api('GET', '/api/router/ping', None, R['token'])[0] == 401 and api('GET', '/api/router/ping', None, tk)[0] == 200)
        if SHOTS: await pa.screenshot(path=os.path.join(SHOTS, 'ping-script.png'))
        await pa.click('.sheet [data-close]')
        await pa.click('#aj-refr')
        await pa.wait_for_function("document.querySelector('#aj-routers').textContent.includes('atendiendo')", timeout=8000)
        check('al consultar el router, Ajustes lo muestra «atendiendo»', 'Pruebas de conexión: atendiendo' in await pa.inner_text('#aj-routers'), await pa.inner_text('#aj-routers'))
        check('el permiso «Probar la conexión» existe y viene activo para oficina y técnico', await pa.evaluate("PERMS.some(x=>x[0]==='ping') && PERM_DEF.oficina.ping===true && PERM_DEF.tecnico.ping===true && allPerms().ping===true"))

        # 2) la oficina prueba un cliente: responde, con pérdidas, no responde
        ctxL = await br.new_context(bypass_csp=True, viewport={'width': 420, 'height': 900})
        await ctxL.route('**/fonts.g*/**', lambda r: r.abort())
        pl = await login(ctxL, 'laura', 'laura1')
        await pl.wait_for_function('S.clientes.size === 3', timeout=10000)
        await pl.evaluate("openClient('cAna')")
        await pl.wait_for_selector('#png-btn', timeout=5000)
        check('la ficha muestra «Probar conexión» y la IP que se va a probar', '10.10.0.5' in await pl.inner_text('#png-out'))
        for rec, esperado, no_debe in [(4, 'Responde · 4 de 4', 'pérdidas'), (2, 'Responde con pérdidas · 2 de 4', None), (0, 'No responde · 0 de 4', None)]:
            tarea = asyncio.create_task(router_atiende(tk, rec))
            await pl.click('#png-btn')
            await pl.wait_for_function(f"document.querySelector('#png-out').textContent.includes({json.dumps(esperado.split(' · ')[0])}) && document.querySelector('#png-out').textContent.includes({json.dumps(esperado.split(' · ')[1])})", timeout=15000)
            tx = await pl.inner_text('#png-out'); cl = await pl.get_attribute('#png-out', 'class')
            tom = await tarea
            check(f'resultado {rec} de 4: «{esperado.split(" · ")[0]}»', tom is not None and tom[1] == '10.10.0.5' and esperado.replace(' · ', ' · ') in tx.replace('\n', ' ') and (no_debe is None or no_debe not in tx), (tx, tom))
            if SHOTS: await pl.screenshot(path=os.path.join(SHOTS, f'ping-ficha-{rec}.png'))
            check(f'color del aviso con {rec} de 4', ('ok' if rec == 4 else 'warn' if rec == 2 else 'bad') in cl, cl)
            check(f'dice qué router hizo la prueba ({rec} de 4)', 'ADMIN02' in tx, tx)
            check(f'el botón queda habilitado para probar de nuevo ({rec} de 4)', await pl.evaluate("!document.querySelector('#png-btn').disabled"))
        check('con 0 de 4 sugiere qué mirar (apagado, sin luz, cortado)', 'sin luz' in tx and 'cortado' in tx, tx)

        # 3) mientras el router hace el ping se ve «haciendo el ping»
        async def esperar_ui():
            await pl.wait_for_function("document.querySelector('#png-out').textContent.includes('haciendo el ping')", timeout=8000)
        tarea = asyncio.create_task(router_atiende(tk, 4, tras_tomar=esperar_ui))
        await pl.click('#png-btn')
        tom = await tarea
        check('mientras el router hace el ping, la ficha dice que lo está haciendo', tom is not None)
        await pl.wait_for_function("document.querySelector('#png-out').textContent.includes('Responde')", timeout=8000)

        # 4) si ningún router contesta a tiempo, avisa y no queda colgado
        await pl.click('#png-btn')
        await pl.wait_for_function("document.querySelector('#png-out').textContent.includes('no contestó a tiempo')", timeout=20000)
        check('si el router no contesta, dice que no contestó a tiempo y deja probar de nuevo', await pl.evaluate("!document.querySelector('#png-btn').disabled"))
        await asyncio.to_thread(api, 'GET', '/api/router/ping', None, tk)   # (limpia lo pendiente)

        # 5) clientes que no se pueden probar
        await pl.evaluate("openClient('cSin')")
        await pl.wait_for_selector('#png-box', timeout=5000)
        check('un cliente sin IP no tiene botón y explica por qué', await pl.query_selector('#png-btn') is None and 'una sola IP' in await pl.inner_text('#png-box'))
        await pl.evaluate("openClient('cDos')")
        await pl.wait_for_selector('#png-box', timeout=5000)
        check('un cliente con dos IP juntas tampoco se prueba', await pl.query_selector('#png-btn') is None and 'una sola IP' in await pl.inner_text('#png-box'))
        await ctxL.close()

        # 6) quien tiene el permiso apagado no ve nada
        ctxS = await br.new_context(bypass_csp=True, viewport={'width': 420, 'height': 900})
        await ctxS.route('**/fonts.g*/**', lambda r: r.abort())
        ps = await login(ctxS, 'sofia', 'sofia1')
        await ps.wait_for_function('S.clientes.size === 3', timeout=10000)
        await ps.evaluate("openClient('cAna')")
        await ps.wait_for_selector('.sheet h2', timeout=5000)
        check('con el permiso apagado la ficha no muestra la prueba de conexión', await ps.query_selector('#png-box') is None and not await ps.evaluate("can('ping')"))
        st, j = japi('POST', '/api/ping', {'cid': 'cAna'}, japi('POST', '/api/login', {'usuario': 'sofia', 'clave': 'sofia1'})[1]['token'])
        check('y el servidor tampoco se lo permite', st == 403, (st, j))
        await ctxS.close(); await ctxA.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
