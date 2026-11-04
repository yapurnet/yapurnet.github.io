# El técnico no ve el plan contratado de los clientes (ni en la lista, ni en la ficha, ni la cola de MikroTik). Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def shard(cid):
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
    await sin_aviso(pg)
    return pg
async def nuevo(br):
    c = await br.new_context(bypass_csp=True, viewport={'width': 1000, 'height': 900})
    await c.route('**/fonts.g*/**', lambda r: r.abort())
    return c
async def sin_aviso(pg):
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo contesta «Ahora no» como lo haría una persona
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=4000)
    except Exception: pass
async def lista(pg):
    return await pg.evaluate("[...document.querySelectorAll('[data-open-client]')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())")

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/planes/p150', {'data': {'nombre': 'Hogar 150', 'bajada': 15, 'subida': 15, 'precio': 15000}}, TA)
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Brenda', 'role': 'oficina', 'clave': 'brenda123'}, TA)
    api('POST', '/api/users', {'usuario': 'tec', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'fernando1', 'permisos': {'clientesTodos': True}}, TA)
    for cid, nom, pl in [('cUno', 'Cliente Con Plan', 'p150'), ('cDos', 'Cliente Sin Plan', None)]:
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nom, 'estado': 'activo', 'planId': pl, 'ip': '10.1.0.5', 'dir': 'Calle 1', 'alta': '2026-01-10', 'desde': time.strftime('%Y-%m')}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 1000, 'height': 900})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())

        # 1) el técnico: ni plan, ni «Sin plan», ni cola de MikroTik
        pg = await login(ctx, 'tec', 'fernando1')
        await pg.wait_for_function('S.clientes.size === 2', timeout=10000)
        check('al técnico el servidor no le manda los planes ni el plan del cliente', await pg.evaluate("S.planes.size === 0 && ![...S.clientes.values()].some(c=>'planId' in c)"))
        await pg.click('#tabs [data-tab=clientes]')
        await pg.wait_for_selector('[data-open-client]')
        l = await lista(pg)
        check('la lista no muestra el plan (ni «Hogar 150»), ni «Sin plan»', len(l) == 2 and not any('Hogar' in x or '15/15' in x or 'Sin plan' in x for x in l), l)
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'plan-tecnico-lista.png'))
        await pg.evaluate("openClient('cUno')")
        await pg.wait_for_selector('.sheet .kv')
        ft = await pg.inner_text('.sheet')
        check('la ficha no tiene la fila «Plan» ni el nombre del plan', 'Hogar 150' not in ft and '15/15' not in ft and not await pg.evaluate("[...document.querySelectorAll('.sheet dt')].some(d=>d.textContent.trim()==='Plan')"), ft[:300])
        check('la ficha no ofrece «Copiar cola de MikroTik»', await pg.query_selector('[data-act=queue]') is None)
        check('sigue viendo lo que usa para trabajar (IP, domicilio)', '10.1.0.5' in ft and 'Calle 1' in ft, ft[:300])
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'plan-tecnico-ficha.png'))
        await pg.evaluate("closeModal()")
        await pg.evaluate("openClientForm('cUno')")
        await pg.wait_for_selector('#cf-geo, .sheet form, .sheet')
        check('el formulario «Editar datos técnicos» no trae el plan', await pg.query_selector('#cf-plan') is None)
        await pg.evaluate("closeModal()")

        # 2) la oficina sí lo ve
        po = await login(await nuevo(br), 'ofi', 'brenda123')
        await po.wait_for_function('S.clientes.size === 2 && S.planes.size === 1', timeout=10000)
        await po.click('#tabs [data-tab=clientes]')
        await po.wait_for_selector('[data-open-client]')
        l = await lista(po)
        check('la oficina ve «Hogar 150 · 15/15 Mbps» y «Sin plan»', any('Hogar 150' in x and '15/15 Mbps' in x for x in l) and any('Sin plan' in x for x in l), l)
        await po.evaluate("openClient('cUno')")
        await po.wait_for_selector('.sheet .kv')
        check('la ficha de la oficina tiene el plan y la cola de MikroTik', 'Hogar 150' in await po.inner_text('.sheet') and await po.query_selector('[data-act=queue]') is not None)
        await po.evaluate("closeModal()")

        # 3) el administrador en «Ver como…» el técnico ve lo mismo que el técnico
        pa = await login(await nuevo(br), 'mauro', 'claveSegura1')
        await pa.wait_for_function('S.clientes.size === 2', timeout=10000)
        tid = await pa.evaluate("S.ajustes.perfiles.find(p=>p.nombre==='Fernando Paz').id")
        await pa.evaluate(f"lsSet('viewAsP','{tid}'); S.tab=''; lsSet('tab',''); refreshAll();")
        await pa.wait_for_function("S.preview === true && !can('verPlan')", timeout=5000)
        await pa.click('#tabs [data-tab=clientes]')
        await pa.wait_for_selector('[data-open-client]')
        l = await lista(pa)
        check('«Ver como» el técnico no muestra el plan en la lista', len(l) == 2 and not any('Hogar' in x or 'Sin plan' in x for x in l), l)
        await pa.evaluate("openClient('cUno')")
        await pa.wait_for_selector('.sheet .kv')
        check('«Ver como» el técnico: la ficha sin plan ni cola', 'Hogar 150' not in await pa.inner_text('.sheet') and await pa.query_selector('[data-act=queue]') is None)
        await pa.evaluate("closeModal()")

        # 4) el permiso se puede dar a un técnico desde Ajustes
        st, j = api('GET', '/api/users', None, TA)
        uid = [u for u in j['users'] if u['usuario'] == 'tec'][0]['id']
        st, j = api('PATCH', '/api/users/' + uid, {'permisos': {'clientesTodos': True, 'verPlan': True}}, TA)
        await pg.wait_for_function("can('verPlan') && S.planes.size === 1", timeout=10000)
        await pg.click('#tabs [data-tab=clientes]')
        l = await lista(pg)
        check('al darle el permiso, el técnico ve el plan al instante', any('Hogar 150' in x for x in l), l)
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
