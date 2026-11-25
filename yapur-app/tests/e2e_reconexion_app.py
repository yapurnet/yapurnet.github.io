# Reconexión automática en la app: al registrar un pago, el cliente suspendido que ya no debe pasa a activo solo (y el servidor lo manda a los routers); el script de reconexión del router es ASCII, solo reactiva y no corta; la pantalla de cortes muestra el estado. Chromium real contra workerd.
# según la hora, su nombre, que ya sale). Es un enlace editable de WhatsApp (nunca se manda solo), no una acción de la orden.
# Se ofrece igual de grande que «Salgo para allá» tanto en la orden propia como en una sin asignar todavía (ahí firma el que
# está por tomarla, y al tocarlo de paso la toma y la pasa a «en camino», como si hubiera tocado «Salgo para allá»). También
# se lo ofrece a un técnico con permiso de ver todas las órdenes (antes quedaba excluido, y se quedaba sin ninguna forma de
# avisarle al cliente). No lo tiene la oficina (ya tiene su propio «Enviar por WhatsApp» con los datos de la orden) ni un
# técnico ajeno a una orden ya asignada a otro. Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.parse, urllib.request, urllib.error
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
ERR = []
async def sin_aviso(pg):
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=si]', timeout=4000)
        await pg.click('[role=dialog] [data-act=si]')
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
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    cur = datetime.date.today().strftime('%Y-%m'); nxt = (datetime.date.today().replace(day=1) + datetime.timedelta(days=32)).strftime('%Y-%m')
    base = {'estado': 'suspendido', 'corteMora': cur + '-01', 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': cur + '-01', 'desde': nxt, 'ciclo': 1, 'precio': 20000}
    api('PATCH', '/api/doc/clientes/' + shard('pa'), {'data': {'items': {'pa': dict(base, nombre='Pagador Uno', ip='10.20.41.50')}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('pb'), {'data': {'items': {'pb': dict(base, nombre='Debe Todavia', ip='10.20.41.51', desde=cur)}}}, TA)
    st, j = api('POST', '/api/routers', {'nombre': 'ADMIN02', 'kinds': ['q']}, TA); rid = j['router']['id']
    st, j = api('POST', f'/api/routers/{rid}/reco-token', {}, TA); TK = j['token']
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1000, 'height': 900}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        check('el suspendido que no debe figura «para reconectar»', await pg.evaluate("aReconectar(S.clientes.get('pa'))"))
        check('el que todavía debe no', not await pg.evaluate("aReconectar(S.clientes.get('pb'))"))
        await pg.evaluate("reconectarAlPagar(S.clientes.get('pa'))")
        await pg.wait_for_function("S.clientes.get('pa').estado==='activo'", timeout=6000)
        check('al pagar, el cliente pasa a activo solo y queda anotada la fecha de reconexión', await pg.evaluate("S.clientes.get('pa').estado==='activo'&&!S.clientes.get('pa').corteMora&&!!S.clientes.get('pa').reconectado"))
        await pg.evaluate("reconectarAlPagar(S.clientes.get('pb'))")
        await pg.wait_for_timeout(800)
        check('el que sigue debiendo no se reconecta', await pg.evaluate("S.clientes.get('pb').estado==='suspendido'"))
        import urllib.request
        rq = urllib.request.Request(BASE + '/api/router/reco', headers={'Authorization': 'Bearer ' + TK})
        t = urllib.request.urlopen(rq).read().decode()
        check('el router recibe solo la IP del que pagó', t.endswith(':10.20.41.50:') and t.count(',') == 0 and '10.20.41.51' not in t, t)
        await pg.evaluate("openRecoScript({id:'%s',nombre:'ADMIN02'},'%s')" % (rid, TK)); await pg.wait_for_selector('[role=dialog] textarea')
        tas = await pg.eval_on_selector_all('[role=dialog] textarea', 'e=>e.map(x=>x.value)')
        sc = tas[0]
        check('el script lleva el token y la lista «Clientes Cortados»', TK in sc and 'Clientes Cortados' in sc and '/api/router/reco' in sc, sc[:200])
        check('el script solo reactiva: desactiva entradas y habilita usuarios, nunca corta', 'address-list disable' in sc and 'secret enable' in sc and 'address-list add' not in sc and 'secret disable' not in sc and 'address-list enable' not in sc and 'remove' not in sc.split('source={')[1])
        check('el script está en ASCII puro (el terminal de MikroTik no respeta las tildes)', all(ord(ch) < 128 for ch in sc))
        check('la programación corre cada minuto', 'interval=1m' in tas[1] and 'yapur-reconexion' in tas[1], tas[1])
        await pg.keyboard.press('Escape')
        await pg.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=\"cx-t\"></div>')")
        await pg.evaluate("drawRecoEstado(document.getElementById('cx-t'))"); await pg.wait_for_selector('#cx-t .card', timeout=6000)
        tx = await pg.inner_text('#cx-t')
        check('la pantalla de cortes muestra el router y a quién se reconectó', 'ADMIN02' in tx and 'Pagador Uno' in tx and 'falta en ADMIN02' in tx, tx)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
