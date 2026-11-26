# Cortes automáticos en la pantalla: en Cortes, el botón de cada cliente y el masivo piden confirmación (ahora cortan de verdad el internet) y mandan la orden de corte a los routers;
# en Ajustes → Routers se eligen los nodos que corta cada router (a cada uno le llegan solo los cortes de sus clientes) y el estado dice a quién le toca. Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'), flush=True)
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
async def confirmar(pg, si):
    await pg.wait_for_selector('[role=dialog] [data-act=yes]', timeout=4000)
    txt = await pg.inner_text('[role=dialog]')
    await pg.click('[role=dialog] [data-act=%s]' % ('yes' if si else 'no'))
    await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    return txt

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    base = {'estado': 'activo', 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': '2026-01-01', 'desde': '2026-01', 'ciclo': 1, 'precio': 20000}
    for cid, nom, ip, nodo in (('k1', 'Moroso Uno', '10.40.0.1', 'BOMBEROS'), ('k2', 'Moroso Dos', '10.40.0.2', 'FM'), ('k3', 'Moroso Tres', '10.40.0.3', 'FM')):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: dict(base, nombre=nom, ip=ip, nodo=nodo)}}}, TA)
    st, j = api('POST', '/api/routers', {'nombre': 'ADMIN_BOMBEROS', 'kinds': ['q']}, TA); rb = j['router']['id']
    st, j = api('POST', '/api/routers', {'nombre': 'ADMIN_FM', 'kinds': ['q']}, TA); rf = j['router']['id']
    TB = api('POST', f'/api/routers/{rb}/reco-token', {}, TA)[1]['token']; TF = api('POST', f'/api/routers/{rf}/reco-token', {}, TA)[1]['token']
    def poll(T):
        rq = urllib.request.Request(BASE + '/api/router/reco?v=2', headers={'Authorization': 'Bearer ' + T})
        return [x.split(':') for x in urllib.request.urlopen(rq).read().decode().split(',') if x]
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1100, 'height': 1000}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')

        # ---- Ajustes → Routers: nodos ----
        await pg.evaluate("loadRouters()"); await pg.wait_for_function("RT.loaded&&RT.list.length===2", timeout=6000)
        await pg.evaluate(f"openRouterForm('{rb}')"); await pg.wait_for_selector('#rtform [data-nodo]')
        nodos = await pg.eval_on_selector_all('#rtform [data-nodo]', 'e=>e.map(x=>x.dataset.nodo)')
        check('el formulario del router ofrece los nodos de los clientes para marcar', sorted(nodos) == ['BOMBEROS', 'FM'], nodos)
        check('todavía ninguno marcado (el router recibiría los cortes de todos)', await pg.eval_on_selector_all('#rtform [data-nodo]', 'e=>e.every(x=>!x.checked)'))
        await pg.check('#rtform [data-nodo="BOMBEROS"]'); await pg.click('#rtform button[type=submit]')
        await pg.wait_for_function(f"RT.list.find(r=>r.id==='{rb}').nodos==='BOMBEROS'", timeout=6000)
        check('al guardar queda el nodo marcado en el router', True)
        await pg.evaluate(f"openRouterForm('{rf}')"); await pg.wait_for_selector('#rtform [data-nodo]')
        await pg.check('#rtform [data-nodo="FM"]'); await pg.click('#rtform button[type=submit]')
        await pg.wait_for_function(f"RT.list.find(r=>r.id==='{rf}').nodos==='FM'", timeout=6000)
        await pg.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=\"aj-routers\"></div>')"); await pg.evaluate("renderRouters()")
        tx = await pg.inner_text('#aj-routers')
        check('la lista de routers dice qué nodos corta cada uno', 'corta los nodos: BOMBEROS' in tx and 'corta los nodos: FM' in tx, tx)
        await pg.evaluate("openRecoScript(RT.list[0],'r.tk')"); await pg.wait_for_selector('[role=dialog] textarea')
        tn = await pg.inner_text('[role=dialog]')
        check('el modal del script explica que corta (agrega la IP con el nombre) y que reconecta (borra la entrada)', 'agrega la IP' in tn and 'borra esa entrada' in tn and 'Cortes y reconexión automáticos · ADMIN_BOMBEROS' in tn, tn[:200])
        await pg.keyboard.press('Escape')

        # ---- Cortes ----
        await pg.evaluate("document.querySelector('[data-tab=\"cobranzas\"]').click()")
        await pg.wait_for_selector('button:has-text("A cortar")'); await pg.click('button:has-text("A cortar")')
        await pg.wait_for_selector('[data-susp="k1"]')
        check('el botón de cada cliente dice «Suspender y cortar»', 'Suspender y cortar' in await pg.inner_text('[data-susp="k1"]'))
        bulk = await pg.inner_text('[data-bulk="susp"]')
        check('el botón masivo dice cuántos corta', 'Suspender y cortar a los 3' in bulk, bulk)
        await pg.click('[data-susp="k1"]'); t = await confirmar(pg, False)
        check('cortar a uno pide confirmación y avisa que se le corta el internet', 'Moroso Uno' in t and 'corta el internet' in t, t)
        await pg.wait_for_timeout(500)
        check('si se cancela no pasa nada: sigue activo y no hay órdenes', await pg.evaluate("S.clientes.get('k1').estado") == 'activo' and poll(TB) == [] and poll(TF) == [])
        await pg.click('[data-susp="k1"]'); await confirmar(pg, True)
        await pg.wait_for_function("S.clientes.get('k1').estado==='suspendido'", timeout=6000)
        ob = poll(TB)
        check('al confirmar, BOMBEROS recibe la orden de corte con la IP y el nombre completo', len(ob) == 1 and ob[0][1:] == ['c', '10.40.0.1', '', 'Moroso Uno'], ob)
        check('y FM no (no es de su nodo)', poll(TF) == [])
        await pg.evaluate("void bulkCortes('susp')"); t = await confirmar(pg, False)
        check('el corte masivo pide confirmación con la cantidad', '¿Suspender y cortar a 2 clientes?' in t and 'en menos de un minuto' in t, t)
        await pg.evaluate("void bulkCortes('susp')"); await confirmar(pg, True)
        await pg.wait_for_function("S.clientes.get('k2').estado==='suspendido'&&S.clientes.get('k3').estado==='suspendido'", timeout=8000)
        of = poll(TF)
        check('FM recibe los cortes de sus dos clientes', sorted(x[4] for x in of) == ['Moroso Dos', 'Moroso Tres'] and all(x[1] == 'c' for x in of), of)
        check('BOMBEROS sigue con el suyo y no recibe los de FM', [x[2] for x in poll(TB)] == ['10.40.0.1'])

        # tarjeta de estado en Cortes
        await pg.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=\"cx-t\"></div>')")
        await pg.evaluate("drawRecoEstado(document.getElementById('cx-t'))"); await pg.wait_for_selector('#cx-t .card', timeout=6000)
        tx = await pg.inner_text('#cx-t')
        check('la tarjeta de Cortes muestra los cortes pendientes y en qué router falta', 'Cortar' in tx and 'Moroso Uno' in tx and 'falta en ADMIN_BOMBEROS' in tx and 'falta en ADMIN_FM' in tx, tx)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
