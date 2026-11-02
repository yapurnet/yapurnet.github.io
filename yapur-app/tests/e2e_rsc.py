# Completar la IP de los clientes ya cargados con los exports .rsc de los routers: Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def shard(cid):   # igual que clientShard() de la app
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)
ERR = []
def S_clientes(tok):
    st, j = api('GET', '/api/sync', None, tok)
    out = {}
    for d in j['cols']['clientes']: out.update(d['data'].get('items', {}))
    return out

ADMIN = b'\n'.join([
    b'# nov/02/2026 10:00:00 by RouterOS 6.49.10',
    b'/queue simple add max-limit=10M/10M name="Mu\\C3\\B1oz Ana-12" target=10.1.0.5/32 comment="00012 - Mu\\C3\\B1oz Ana"',
    b'/queue simple add max-limit=10M/10M name="Casta\\F1o Luis" target=10.1.0.6/32',
    b'/queue simple add name="Sosa Raul" target=10.1.0.20/32',
    b'/queue simple add name="Sosa Raul" target=10.1.0.21/32',
    b'/queue simple add name="Eva Lopez" target=10.1.0.30/32',
    b'/ppp secret add name=jperez@yapur password=SECRETO123 profile=p1 service=pppoe remote-address=10.1.0.7 comment="Juan Perez"',
    b'/ip dhcp-server lease add address=10.1.0.9 mac-address=AA:BB:CC:DD:EE:01 comment="Pedro Diaz" server=s1',
    b'/interface wireless security-profiles add name=wifi wpa2-pre-shared-key=CLAVEWIFI99 mode=dynamic-keys'])
FM = b'/queue simple add name="Beto Bos" target=192.168.101.4/32 comment="Bos Beto"\n'

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    ids = {'ana': 'Ana Muñoz', 'luis': 'CASTAÑO LUIS', 'pedro': 'Diaz Pedro Alberto', 'sosa': 'Sosa Raul', 'lopez1': 'Lopez Eva', 'lopez2': 'Eva Lopez Casa',
           'nadie': 'Nadie Nunca', 'ivan': 'Torres Ivan', 'beto': 'Bos Beto', 'juan': 'Cliente Con Otro Nombre'}
    for k, nombre in ids.items():
        c = {'nombre': nombre, 'estado': 'activo'}
        if k == 'ivan': c['ip'] = '10.1.0.99'
        if k == 'juan': c['usuario'] = 'jperez@yapur'
        api('PATCH', '/api/doc/clientes/' + shard(k), {'data': {'items': {k: c}}}, TA)
    sent = []
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 1100, 'height': 1000}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        pg.on('request', lambda r: sent.append((r.url, r.post_data or '')))
        await pg.goto(BASE, wait_until='domcontentloaded')
        await pg.wait_for_selector('#lg-form', timeout=8000)
        await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1')
        await pg.click('#lg-form button[type=submit]')
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
        await pg.wait_for_function(f'S.clientes.size === {len(ids)}', timeout=10000)

        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-rsc')
        check('Ajustes → Routers ofrece «Completar IP con archivos .rsc»', 'Completar IP' in await pg.inner_text('#aj-rsc'))
        await pg.click('#aj-rsc')
        await pg.wait_for_selector('#rs-file', state='attached')
        check('explica que los archivos no se suben y que no toca los routers', 'no se suben ni se guardan' in await pg.inner_text('.sheet') and 'no se cambia nada en los routers' in await pg.inner_text('.sheet'))
        check('el selector de archivos no filtra por tipo', await pg.get_attribute('#rs-file', 'accept') is None and await pg.get_attribute('#rs-file', 'multiple') is not None)
        await pg.set_input_files('#rs-file', files=[{'name': 'admin-31-10-26.rsc', 'mimeType': 'text/plain', 'buffer': ADMIN}, {'name': 'fm-31-10-26.rsc', 'mimeType': 'text/plain', 'buffer': FM}])
        await pg.wait_for_selector('#rs-tab', timeout=8000)
        info = await pg.inner_text('#rs-out .hint')
        check('cuenta lo que leyó y de qué routers', 'Leí 2 archivos (admin, fm)' in info and '6 colas' in info, info)
        kp = await pg.evaluate("[...document.querySelectorAll('.sheet .kpi .n')].map(e=>e.textContent)")
        # seguros: Ana, Castaño, Juan (usuario), Beto · parecido: Pedro · revisar: Sosa, Lopez x2 · sin: Nadie · ya tienen: Torres
        check('seguros 4, parecidos 1, a revisar 3, sin coincidencia 1, ya tienen IP 1', kp == ['4', '1', '3', '1', '1'], kp)
        txt = await pg.inner_text('.sheet')
        check('el texto de la pantalla no trae las contraseñas del archivo', 'SECRETO123' not in txt and 'CLAVEWIFI99' not in txt)
        check('lee los nombres con ñ de las dos codificaciones', 'Muñoz Ana' in txt and 'Castaño Luis' in txt, txt[:600])
        boxes = await pg.evaluate("[...document.querySelectorAll('#rs-out [data-k]')].map(i=>i.checked)")
        check('los seguros vienen marcados', boxes == [True] * 4, boxes)
        check('el botón cuenta todo lo marcado (4 seguros + 1 parecido)', 'Guardar la IP de 5 clientes' in await pg.inner_text('#rs-go'), await pg.inner_text('#rs-go'))

        await pg.click('#rs-tab [data-t=parecido]')
        check('el parecido (Diaz Pedro Alberto / Pedro Diaz) viene marcado', await pg.evaluate("[...document.querySelectorAll('#rs-out [data-k]')].map(i=>i.checked)") == [True] and 'Pedro Diaz' in await pg.inner_text('#rs-out table'))
        
        await pg.click('#rs-tab [data-t=revisar]')
        check('los de revisar no vienen marcados', await pg.evaluate("[...document.querySelectorAll('#rs-out [data-k]')].map(i=>i.checked)") == [False] * 3)
        ops = await pg.evaluate("[...document.querySelectorAll('#rs-out [data-r=sosa]')].map(o=>o.parentElement.textContent)")
        check('Sosa Raul trae las dos IP para elegir, con el nombre y el router', len(ops) == 2 and '10.1.0.20' in ops[0] and '10.1.0.21' in ops[1] and '(admin)' in ops[0], ops)
        # los dos Lopez reclaman la misma IP: marcarlos a los dos no deja guardar
        await pg.check('#rs-out [aria-label="Marcar a Lopez Eva"]'); await pg.check('#rs-out [aria-label="Marcar a Eva Lopez Casa"]')
        await pg.click('#rs-go')
        await pg.wait_for_selector('.toast', timeout=4000)
        check('si dos clientes quedan con la misma IP, avisa y no guarda', 'marcada para 2 clientes' in await pg.inner_text('.toast'), await pg.inner_text('.toast'))
        check('no apareció ninguna confirmación', await pg.query_selector('.sheet [data-act=yes]') is None)
        await pg.uncheck('#rs-out [aria-label="Marcar a Eva Lopez Casa"]')
        # Sosa: elige la segunda IP y la marca
        await pg.check('#rs-out [data-r=sosa][value="1"]')
        check('elegir una IP marca al cliente', await pg.evaluate("document.querySelector('#rs-out [data-k=sosa]').checked") is True)
        await pg.fill('#rs-q', 'sosa')
        check('la búsqueda filtra', await pg.evaluate("document.querySelectorAll('#rs-out tbody tr').length") == 1)
        await pg.fill('#rs-q', '')
        await pg.click('#rs-tab [data-t=sin]')
        check('sin coincidencia lista a Nadie Nunca', 'Nadie Nunca' in await pg.inner_text('#rs-out table'))
        n = await pg.inner_text('#rs-go')
        check('el botón ofrece guardar 7 (4 seguros + parecido + Lopez Eva + Sosa)', 'Guardar la IP de 7 clientes' in n, n)

        # nada salió de la computadora hacia el servidor con el contenido de los archivos
        antes = len(sent)
        await pg.click('#rs-go')
        await pg.wait_for_selector('.sheet [data-act=yes]')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function('!document.querySelector("#rs-go")', timeout=10000)
        await pg.wait_for_function("[...S.clientes.values()].filter(c=>c.ip).length >= 8", timeout=10000)
        cl = S_clientes(TA)
        got = {k: cl[k].get('ip') for k in ids}
        check('guardó la IP de los seguros', got['ana'] == '10.1.0.5' and got['luis'] == '10.1.0.6' and got['juan'] == '10.1.0.7' and got['beto'] == '192.168.101.4', got)
        check('guardó la del parecido y la que elegí para Sosa', got['pedro'] == '10.1.0.9' and got['sosa'] == '10.1.0.21', got)
        check('guardó la de Lopez Eva y dejó a Eva Lopez Casa sin IP', got['lopez1'] == '10.1.0.30' and not got['lopez2'], got)
        check('no tocó a Nadie Nunca ni la IP que ya tenía Torres', not got['nadie'] and got['ivan'] == '10.1.0.99', got)
        check('solo se completó la IP (el resto del cliente queda igual)', cl['ana']['nombre'] == 'Ana Muñoz' and cl['ana']['estado'] == 'activo' and cl['juan']['usuario'] == 'jperez@yapur', cl['ana'])
        enviado = ' '.join(u + b for u, b in sent[antes:] + sent[:antes])
        check('el contenido de los archivos (nombres de routers, contraseñas) nunca viajó al servidor', 'SECRETO123' not in enviado and 'CLAVEWIFI99' not in enviado and 'wpa2-pre-shared-key' not in enviado)

        # reabrir con los mismos archivos: lo guardado ya no se ofrece
        await pg.click('#aj-rsc'); await pg.wait_for_selector('#rs-file', state='attached')
        await pg.set_input_files('#rs-file', files=[{'name': 'admin-31-10-26.rsc', 'mimeType': 'text/plain', 'buffer': ADMIN}, {'name': 'fm-31-10-26.rsc', 'mimeType': 'text/plain', 'buffer': FM}])
        await pg.wait_for_selector('#rs-tab', timeout=8000)
        kp = await pg.evaluate("[...document.querySelectorAll('.sheet .kpi .n')].map(e=>e.textContent)")
        check('al reabrir ya no ofrece lo guardado: Eva Lopez Casa (su IP ya es de Lopez Eva) y Nadie Nunca quedan sin coincidencia; 8 ya tienen IP', kp == ['0', '0', '0', '2', '8'], kp)
        check('con 0 marcados no deja guardar', await pg.evaluate("document.querySelector('#rs-go').disabled") is True)
        await pg.click('.sheet [data-close]')
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
