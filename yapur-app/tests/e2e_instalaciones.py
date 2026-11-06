# Pestaña «Instalaciones»: cuántas se hicieron por día, semana y mes, con el gráfico que se toca, el detalle por técnico y la lista de clientes.
# Chromium real contra el servidor de verdad (workerd).
import asyncio, datetime, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('YAPUR_SHOTS', '')
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
def lunes(d): return d - datetime.timedelta(days=d.weekday())
def iso(d): return d.isoformat()

async def main():
    hoy = datetime.date.today(); ayer = hoy - datetime.timedelta(days=1)
    d8 = hoy - datetime.timedelta(days=8); d40 = hoy - datetime.timedelta(days=40)
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'juan', 'nombre': 'Juan', 'role': 'tecnico', 'clave': 'juan1234'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro'); juan = next(u for u in ul['users'] if u['usuario'] == 'juan'); laura = next(u for u in ul['users'] if u['usuario'] == 'laura')
    for cid, nombre in (('a', 'Ana Alonso'), ('b', 'Beto Bravo'), ('c', 'Carla Cruz'), ('d', 'Dario Diaz'), ('e', 'Elena Esteche'), ('f', 'Fabian Funes'), ('g', 'Gaby Gil')):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nombre, 'estado': 'activo', 'dir': 'Calle ' + cid.upper() + ' 100', 'loc': 'Añatuya'}}}}, TA)
    # (id, cliente, técnico, estado, cierre, extras)
    ordenes = [
        ('o1', 'a', pedro['id'], 'hecha', iso(hoy) + ' 10:00', {}),
        ('o2', 'b', juan['id'], 'hecha', iso(hoy) + ' 14:00', {}),
        ('o3', 'c', pedro['id'], 'hecha', iso(hoy) + ' 16:30', {'sinCobro': 'oficina'}),
        ('o4', 'd', pedro['id'], 'hecha', iso(ayer) + ' 09:15', {}),
        ('o5', 'e', juan['id'], 'hecha', iso(d8) + ' 11:00', {}),
        ('o6', 'f', pedro['id'], 'hecha', iso(d40) + ' 12:00', {}),
        ('o7', 'g', juan['id'], 'pendiente', None, {}),   # abierta, programada para hoy: «sin hacer»
    ]
    for oid, cid, tec, est, cierre, extra in ordenes:
        o = {'tipo': 'instalacion', 'clientId': cid, 'estado': est, 'prioridad': 'normal', 'fecha': iso(hoy), 'creado': (cierre or iso(hoy))[:10], 'tecnico': tec}
        if cierre: o['cierre'] = cierre
        o.update(extra)
        api('PATCH', '/api/doc/ordenes/' + o['creado'][:7], {'data': {'items': {oid: o}}}, TA)
    # una instalación cobrada por la oficina, sin orden
    api('PATCH', '/api/doc/clientes/' + shard('h'), {'data': {'items': {'h': {'nombre': 'Hilda Herrera', 'estado': 'activo', 'dir': 'Calle H 100', 'loc': 'Añatuya'}}}}, TA)
    st, jp = api('PATCH', '/api/doc/pagos/%s-s%02d' % (iso(hoy)[:4], fnv('h') % 32), {'data': {'items': {'px': {'c': 'h', 'concepto': 'instalacion', 'monto': 65000, 'metodo': 'efectivo', 'fecha': iso(hoy), 'hora': '11:30', 'recibo': 'RPX', 'por': laura['id'], 'porNombre': 'Laura'}}}}, TA)
    check('se cargó el cobro sin orden', st == 200, jp)
    # lo que tiene que dar
    eventos = [(hoy, 'pedro'), (hoy, 'juan'), (hoy, 'pedro'), (hoy, '_'), (ayer, 'pedro'), (d8, 'juan'), (d40, 'pedro')]
    n_dia = sum(1 for d, _ in eventos if d == hoy)
    n_ayer = sum(1 for d, _ in eventos if d == ayer)
    n_sem = sum(1 for d, _ in eventos if lunes(d) == lunes(hoy))
    n_sem_ant = sum(1 for d, _ in eventos if lunes(d) == lunes(hoy) - datetime.timedelta(days=7))
    n_mes = sum(1 for d, _ in eventos if (d.year, d.month) == (hoy.year, hoy.month))
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, device_scale_factor=1)
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        async def kpis(pg):
            return [int(x) for x in await pg.evaluate("[...document.querySelectorAll('#in .kpis .kpi .n')].map(e=>e.textContent)")]
        async def titulo(pg): return (await pg.inner_text('#in .in-nav .tt')).replace('\n', ' | ')
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        tabs = await pg.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
        check('el administrador tiene la pestaña «Instalaciones», después de «Órdenes»', 'instalaciones' in tabs and tabs.index('instalaciones') == tabs.index('ordenes') + 1, tabs)
        await pg.wait_for_function("S.loaded.ordenes && S.loaded.pagos && S.ordenes.size >= 7", timeout=10000)
        # Resumen: recuadro que lleva a la pestaña
        await pg.click('#tabs [data-tab=resumen]'); await pg.wait_for_selector('#rs .kpi')
        tile = await pg.evaluate("(()=>{const e=[...document.querySelectorAll('#rs .kpi.tap[data-go=instalaciones]')][0];return e?e.innerText.replace(/\\s+/g,' '):null})()")
        check('el Resumen cuenta las instalaciones del mes y las de hoy', tile is not None and tile.startswith(str(n_mes)) and ('hoy %d' % n_dia) in tile, tile)
        await pg.focus('#rs .kpi.tap[data-go=instalaciones]'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('#in .in-nav')
        check('y se abre también con el teclado', await pg.evaluate("S.tab") == 'instalaciones')
        # día
        check('arranca en «Día», con la fecha de hoy y «Hoy»', 'Hoy' in await titulo(pg) and str(hoy.day) in await titulo(pg) and await pg.get_attribute('#in [data-k=dia]', 'aria-pressed') == 'true', await titulo(pg))
        k = await kpis(pg)
        check('día: instaladas hoy, las de ayer y las que quedaron sin hacer', k == [n_dia, n_ayer, 1], k)
        items = await pg.evaluate("[...document.querySelectorAll('#in-list .item')].map(e=>e.innerText.replace(/\\s+/g,' '))")
        check('la lista trae un renglón por instalación, con el cliente y el técnico', len(items) == n_dia and any('Ana Alonso' in x and 'Pedro' in x and '10:00' in x for x in items), items)
        check('la instalación cerrada sin cobrar lo dice', sum('Sin cobrar' in x for x in items) == 1 and any('Carla Cruz' in x and 'Sin cobrar' in x for x in items), items)
        check('el cobro sin orden queda marcado «Sin orden»', sum('Sin orden' in x for x in items) == 1 and any('Hilda Herrera' in x and 'Sin orden' in x for x in items), items)
        check('avisa que hay una sin cobrar', '1 instalación todavía sin cobrar' in await pg.inner_text('#in .notice'), await pg.inner_text('#in .notice'))
        tec = await pg.evaluate("[...document.querySelectorAll('#in table tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ').trim())")
        check('por técnico: Pedro 2, Juan 1 y 1 sin técnico (la cargó la oficina)', tec == ['Pedro 2', 'Juan 1', 'Sin técnico 1'], tec)
        if SHOTS: await pg.screenshot(path=SHOTS + '/inst_dia.png', full_page=True)
        # tocar un renglón abre al cliente
        await pg.click('#in-list [data-open-client]:has-text("Ana Alonso")')
        await pg.wait_for_selector('.sheet')
        check('tocar un renglón abre la ficha del cliente', 'Ana Alonso' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]'); await pg.wait_for_selector('.sheet', state='detached')
        # semana y mes
        await pg.click('#in [data-k=sem]'); await pg.wait_for_function("document.querySelector('#in .in-nav .tt b').textContent.startsWith('Semana')")
        k = await kpis(pg)
        check('semana: las de esta semana y las de la anterior', k[:2] == [n_sem, n_sem_ant], [k, n_sem, n_sem_ant])
        check('con un renglón por día en la lista', await pg.evaluate("document.querySelectorAll('#in-list .in-day').length") >= 1)
        if SHOTS: await pg.screenshot(path=SHOTS + '/inst_sem.png', full_page=True)
        await pg.click('#in [data-k=mes]'); await pg.wait_for_function("!document.querySelector('#in .in-nav .tt b').textContent.startsWith('Semana')")
        k = await kpis(pg)
        mes_ant = sum(1 for d, _ in eventos if (d.year, d.month) == ((hoy.replace(day=1) - datetime.timedelta(days=1)).year, (hoy.replace(day=1) - datetime.timedelta(days=1)).month))
        check('mes: las de este mes y las del mes anterior', k[:2] == [n_mes, mes_ant], [k, n_mes, mes_ant])
        if SHOTS: await pg.screenshot(path=SHOTS + '/inst_mes.png', full_page=True)
        # navegar
        await pg.click('#in [data-k=dia]'); await pg.wait_for_function("document.querySelector('#in .in-nav .tt b').textContent.includes('%d')" % hoy.day)
        check('«siguiente» no se puede apretar en el período de hoy', await pg.is_disabled('#in [data-n="1"]'))
        check('y no hay «Volver a hoy»', await pg.query_selector('#in [data-n=hoy]') is None)
        await pg.click('#in [data-n="-1"]'); await pg.wait_for_function("document.querySelector('#in .in-nav .tt .small') && document.querySelector('#in .in-nav .tt .small').textContent==='Ayer'")
        k = await kpis(pg)
        check('con «‹» se ve el día anterior', k[0] == n_ayer and k[1] == sum(1 for d, _ in eventos if d == ayer - datetime.timedelta(days=1)), k)
        check('aparece «Volver a hoy» y «›» se puede apretar', await pg.query_selector('#in [data-n=hoy]') is not None and not await pg.is_disabled('#in [data-n="1"]'))
        await pg.click('#in [data-n=hoy]'); await pg.wait_for_function("document.querySelector('#in .in-nav .tt .small').textContent==='Hoy'")
        check('«Volver a hoy» vuelve', (await kpis(pg))[0] == n_dia)
        # tocar una barra del gráfico: hace 8 días
        await pg.click('#in .bar[data-b="%s"]' % iso(d8)); await pg.wait_for_function("document.querySelector('#in .bar.now').dataset.b==='%s'" % iso(d8))
        check('tocar una barra elige ese día', (await kpis(pg))[0] == 1 and 'Dario' not in await pg.inner_text('#in-list') and 'Elena Esteche' in await pg.inner_text('#in-list'), await pg.inner_text('#in-list'))
        # un día sin instalaciones
        vacio = next(hoy - datetime.timedelta(days=i) for i in range(2, 12) if all(d != hoy - datetime.timedelta(days=i) for d, _ in eventos))
        await pg.click('#in .bar[data-b="%s"]' % iso(vacio)); await pg.wait_for_function("document.querySelector('#in .bar.now').dataset.b==='%s'" % iso(vacio))
        check('un día sin instalaciones lo dice', 'No hubo instalaciones ese día' in await pg.inner_text('#in-list') and await pg.query_selector('#in table') is None)
        check('el gráfico tiene 14 días y la página no se corre para el costado', await pg.evaluate("document.querySelectorAll('#in .bar').length") == 14 and await pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), await pg.evaluate("document.documentElement.scrollWidth"))
        # la oficina también la ve; el técnico no
        po = await login(await nuevo(), 'laura', 'laura123')
        to = await po.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
        check('la oficina tiene la pestaña', 'instalaciones' in to, to)
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        tt = await pt.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
        check('el técnico no la tiene', 'instalaciones' not in tt, tt)
        await pt.wait_for_function("S.loaded.ordenes")
        check('ni el recuadro en su Resumen (no tiene Resumen)', 'resumen' not in tt)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
