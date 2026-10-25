# Routers MikroTik: el administrador da de alta un router, copia el script, el «router» (simulado con pedidos HTTP) manda su lista
# y desde la app se importan los clientes detectados. Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None, raw=None, headers=None):
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'text/plain' if raw is not None else 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

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

def enviar(token, run, partes):
    """lo que haría el script del router: tandas de líneas separadas por tabulaciones, la última con fin=1"""
    out = []
    for i, body in enumerate(partes, 1):
        st, j = api('POST', f'/api/router/ingest?run={run}&part={i}&fin={1 if i == len(partes) else 0}', token=token, raw=body)
        out.append((st, j))
    return out

LINEAS_1 = '\n'.join([
    '#\tADMIN02\t7.15.1',
    'Q\tJuan Perez\t10.10.0.5/32\t20000000/20000000\tfalse\tnone\tcalle 1',
    'Q\tRango de prueba\t10.20.0.0/24\t5M/5M\tfalse\tnone\t',
    'Q\tAna Lopez\t10.10.0.6/32\t20M/20M\ttrue\tnone\t',
    'Q\tCliente Ya Cargado\t10.10.0.7/32\t20M/20M\tfalse\tnone\t']) + '\n'
LINEAS_2 = '\n'.join([
    'D\t10.40.0.9\tAA:BB:CC:DD:EE:FF\tdhcp1\tfalse\tPedro Diaz',
    'F\tplan20\t20M/20M',
    'P\tmaria\tpppoe\tplan20\t\tfalse\tMaria Gomez',
    'P\tvpn-admin\tovpn\tdefault\t\tfalse\t',
    '#\tfin']) + '\n'

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/planes/p20', {'data': {'nombre': 'Hogar 20', 'bajada': 20, 'subida': 20, 'precio': 12000}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('ya'), {'data': {'items': {'ya': {'nombre': 'Cliente Ya Cargado', 'estado': 'activo', 'planId': 'p20', 'ip': '10.10.0.7', 'dir': 'Calle 9'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 1000, 'height': 900}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 1', timeout=10000)

        # 1) alta del router y script
        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-newr')
        check('Ajustes muestra «Routers MikroTik» y explica que no puede cortar', 'no entra' in await pg.inner_text('#aj-newr >> xpath=ancestor::div[contains(@class,"card")]'))
        await pg.wait_for_function("document.querySelector('#aj-routers').textContent.includes('No hay routers')", timeout=5000)
        await pg.click('#aj-newr')
        await pg.wait_for_selector('#rtform')
        check('por defecto lee solo IP fija', await pg.evaluate("[...document.querySelectorAll('[data-kind]')].filter(i=>i.checked).map(i=>i.dataset.kind).join()") == 'q')
        await pg.fill('#rt-nombre', 'ADMIN02')
        await pg.check('[data-kind=p]'); await pg.check('[data-kind=d]')
        await pg.click('#rtform button[type=submit]')
        await pg.wait_for_selector('.sheet [data-copy-label=Script]', timeout=8000)
        script = await pg.get_attribute('.sheet [data-copy-label=Script]', 'data-copy')
        m = re.search(r':local token "([^"]+)"', script)
        check('muestra el script con el token del router', m is not None and re.match(r'^r[0-9a-f]{10}\.', m.group(1)), script[:300])
        token = m.group(1)
        check('el script lee colas, DHCP y PPPoE, sin contraseñas y con permisos mínimos', all(x in script for x in ['/queue simple find', '/ip dhcp-server lease find', '/ppp secret find', 'policy=read,test']) and 'password' not in script.lower())
        check('la prueba de conexión apunta a este servidor', BASE + '/api/status' in await pg.get_attribute('.sheet [data-copy-label=Prueba]', 'data-copy'))
        check('el script apunta a este servidor', f':local url "{BASE}/api/router/ingest"' in script)
        await pg.click('.sheet [data-close]')
        await pg.wait_for_function("document.querySelector('#aj-routers').textContent.includes('Todavía no mandó')", timeout=5000)
        check('el router figura como que todavía no mandó nada', 'ADMIN02' in await pg.inner_text('#aj-routers') and 'Clientes detectados' not in await pg.inner_text('#aj-routers'))

        # 2) el «router» manda su lista (en dos tandas)
        r = enviar(token, 'prueba1', [LINEAS_1, LINEAS_2])
        check('el servidor acepta las dos tandas', r[0][0] == 200 and r[1][0] == 200 and r[1][1]['total'] == 8, r)
        await pg.click('#aj-refr')
        await pg.wait_for_function("document.querySelector('#aj-routers').textContent.includes('8 registros')", timeout=5000)
        txt = await pg.inner_text('#aj-routers')
        check('la lista muestra cuándo llegó, cuántos registros y la versión', 'recién' in txt and 'RouterOS 7.15.1' in txt and 'Clientes detectados' in txt, txt)

        # 3) clientes detectados
        await pg.click('#aj-routers [data-rt=det]')
        await pg.wait_for_selector('#dt-list table', timeout=8000)
        kp = await pg.evaluate("[...document.querySelectorAll('.sheet .kpi .n')].map(e=>e.textContent)")
        check('detecta 5 clientes: 4 nuevos y 1 ya cargado', kp == ['5', '4', '1'], kp)
        check('avisa de la cola con rango y del usuario VPN que no toma como clientes', '1 colas con rangos' in await pg.inner_text('.sheet') and '1 usuarios PPP que no son PPPoE' in await pg.inner_text('.sheet'), await pg.inner_text('.sheet .hint'))
        check('el botón ofrece importar los 4 nuevos', '4 clientes nuevos' in await pg.inner_text('#dt-go'))
        await pg.click('#dt-tipo [data-t=pppoe]')
        check('filtrar por PPPoE deja 1', '1 cliente nuevo' in await pg.inner_text('#dt-go'), await pg.inner_text('#dt-go'))
        await pg.click('#dt-tipo [data-t=todos]')
        await pg.fill('#dt-q', 'ana')
        check('la búsqueda filtra por nombre', '1 cliente nuevo' in await pg.inner_text('#dt-go'))
        await pg.fill('#dt-q', '')
        await pg.click('#dt-go')
        await pg.wait_for_selector('.sheet [data-act=yes]')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function('S.clientes.size === 5', timeout=10000)
        cl = {c['nombre']: c for c in S_clientes(TA)}
        j_, a_, p_, m_ = cl.get('Juan Perez'), cl.get('Ana Lopez'), cl.get('Pedro Diaz'), cl.get('Maria Gomez')
        check('importó a Juan con IP, plan por velocidad, nodo y mes de cobro', j_ and j_['ip'] == '10.10.0.5' and j_['planId'] == 'p20' and j_['nodo'] == 'ADMIN02' and j_['estado'] == 'activo' and j_['desde'] == time.strftime('%Y-%m'), j_)
        check('la cola deshabilitada entra como suspendido', a_ and a_['estado'] == 'suspendido', a_)
        check('DHCP guarda la MAC y PPPoE el usuario', p_ and p_['equipo'] == 'AA:BB:CC:DD:EE:FF' and p_['ip'] == '10.40.0.9' and m_ and m_['usuario'] == 'maria' and m_['planId'] == 'p20', [p_, m_])
        check('no se importó ni el rango ni la VPN ni se repitió el que ya estaba', 'Rango de prueba' not in cl and 'vpn-admin' not in cl and sum(1 for c in S_clientes(TA) if c['nombre'] == 'Cliente Ya Cargado') == 1)

        # 4) reabrir: ya no quedan nuevos
        await pg.click('#aj-routers [data-rt=det]')
        await pg.wait_for_selector('#dt-list', timeout=8000)
        await pg.wait_for_function("document.querySelector('#dt-go') && document.querySelector('#dt-go').textContent.includes('0 clientes nuevos')", timeout=5000)
        check('al reabrir no quedan nuevos y no deja importar de nuevo', await pg.evaluate("document.querySelector('#dt-go').disabled") is True)
        await pg.click('#dt-est [data-e=todos]')
        check('con «Todos» se ven los 5', '5' == (await pg.evaluate("[...document.querySelectorAll('.sheet .kpi .n')].map(e=>e.textContent)"))[0])
        await pg.click('.sheet [data-close]')

        # 5) pedir el script de nuevo cambia el token
        await pg.click('#aj-routers [data-rt=script]')
        await pg.wait_for_selector('.sheet [data-act=yes]')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_selector('.sheet [data-copy-label=Script]')
        token2 = re.search(r':local token "([^"]+)"', await pg.get_attribute('.sheet [data-copy-label=Script]', 'data-copy')).group(1)
        check('el script nuevo trae otro token y el anterior deja de valer', token2 != token and enviar(token, 'x1', ['#\tfin\n'])[0][0] == 401 and enviar(token2, 'x2', ['#\tfin\n'])[0][0] == 200)
        await pg.click('.sheet [data-close]')

        # 6) un router que solo tiene IP fija
        await pg.click('#aj-newr'); await pg.wait_for_selector('#rtform')
        await pg.fill('#rt-nombre', 'FM04')
        await pg.click('#rtform button[type=submit]')
        await pg.wait_for_selector('.sheet [data-copy-label=Script]')
        sq = await pg.get_attribute('.sheet [data-copy-label=Script]', 'data-copy')
        check('un router con solo IP fija no lee PPPoE ni DHCP', '/queue simple find' in sq and '/ppp' not in sq and 'dhcp-server' not in sq)
        await pg.click('.sheet [data-close]')
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)

def S_clientes(tok):
    st, j = api('GET', '/api/sync', None, tok)
    out = []
    for d in j['cols']['clientes']: out += list(d['data'].get('items', {}).values())
    return out
asyncio.run(main())
