# Puerto libre de una caja NAP: al tocarlo se elige directo al cliente «por instalar» o «ya instalado» (sin tener que escribir), los más cercanos primero.
# Chromium real contra el servidor de verdad (workerd). El técnico ve solo sus instalaciones y pocos «ya instalados».
import asyncio, json, os, sys, time, urllib.request, urllib.error
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
def shard(cid):   # igual que clientShard() de la app
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)
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
def cliente(tok, cid):
    st, j = api('GET', '/api/doc/clientes/' + shard(cid), None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(cid)
async def ids(pg): return await pg.evaluate("[...document.querySelectorAll('#as-list [data-as]')].map(b=>b.dataset.as)")
async def prs(pg, t): return await pg.get_attribute('#as-seg [data-t=%s]' % t, 'aria-pressed')

async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    api('PATCH', '/api/doc/red/puntos', {'data': {'items': {
        'n1': {'tipo': 'nap', 'nombre': 'Caja 1', 'puertos': 8, 'lat': -28.46662, 'lng': -62.83699, 'creado': 1, 'mod': 1},
        'n2': {'tipo': 'nap', 'nombre': 'Caja 2', 'puertos': 8, 'lat': -28.5, 'lng': -62.9, 'creado': 1, 'mod': 1}}}}, TA)
    cl = {
        'pn': {'nombre': 'Pend Con Orden', 'estado': 'pendiente', 'dir': 'Calle 10', 'loc': 'Añatuya'},
        'pc': {'nombre': 'Pend Cerca', 'estado': 'pendiente', 'dir': 'Calle 11', 'loc': 'Añatuya', 'lat': -28.4668, 'lng': -62.8371},
        'pa': {'nombre': 'Pend Alejado', 'estado': 'pendiente', 'dir': 'Calle 12', 'loc': 'Añatuya', 'lat': -28.49, 'lng': -62.86},
        'pp': {'nombre': 'Pend Ya Puesto', 'estado': 'pendiente', 'dir': 'Calle 13', 'nap': 'n1', 'napPuerto': 5},
        'ia': {'nombre': 'Inst Cerca', 'estado': 'activo', 'dir': 'Calle 20', 'loc': 'Añatuya', 'lat': -28.4667, 'lng': -62.8372},
        'ib': {'nombre': 'Inst Lejos', 'estado': 'activo', 'dir': 'Calle 21', 'loc': 'Añatuya', 'lat': -28.48, 'lng': -62.85},
        'ic': {'nombre': 'Inst Sin Geo', 'estado': 'activo', 'dir': 'Calle 22'},
        'ie': {'nombre': 'Inst En Caja Dos', 'estado': 'activo', 'dir': 'Calle 23', 'nap': 'n2', 'napPuerto': 3},
        'is': {'nombre': 'Inst Sin Puerto', 'estado': 'activo', 'dir': 'Calle 24', 'nap': 'n1'},
        'ip': {'nombre': 'Inst Puesto', 'estado': 'activo', 'dir': 'Calle 25', 'nap': 'n1', 'napPuerto': 2},
        'bj': {'nombre': 'Baja Cliente', 'estado': 'baja', 'dir': 'Calle 26'}}
    for k in range(1, 7): cl['x%d' % k] = {'nombre': 'Zeta %d' % k, 'estado': 'activo', 'dir': 'Calle 3%d' % k}
    for cid, c in cl.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: dict(c, planId='p1', tel='3844000000')}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'instalacion', 'clientId': 'pn', 'estado': 'pendiente', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': pedro['id']}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el administrador toca un puerto libre y ya ve a quién elegir, sin escribir nada
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.clientes.size === %d && S.loaded.red" % len(cl), timeout=10000)
        await pg.evaluate("openRed('n1')"); await pg.wait_for_selector('.sheet [data-free="1"]')
        hint = await pg.inner_text('.sheet')
        check('la caja avisa que se puede elegir un cliente por instalar o ya instalado', 'por instalar' in hint and 'ya instalado' in hint, hint[:500])
        await pg.click('.sheet [data-free="1"]'); await pg.wait_for_selector('#as-seg')
        check('el título dice «Puerto 1 · Caja 1»', 'Puerto 1' in await pg.inner_text('.sheet h2') and 'Caja 1' in await pg.inner_text('.sheet h2'))
        check('hay dos solapas: «Por instalar (3)» y «Ya instalados (10)»', (await pg.inner_text('#as-seg [data-t=nuevo]')).strip() == 'Por instalar (3)' and (await pg.inner_text('#as-seg [data-t=ya]')).strip() == 'Ya instalados (10)', await pg.inner_text('#as-seg'))
        check('abre en «Por instalar» y sin escribir nada ya hay una lista para tocar', await prs(pg, 'nuevo') == 'true' and await prs(pg, 'ya') == 'false' and await pg.input_value('#as-q') == '')
        lista = await ids(pg)
        check('«Por instalar»: primero el que tiene una instalación abierta, después el más cercano y al final el más lejos', lista == ['pn', 'pc', 'pa'], lista)
        check('no aparecen los que ya ocupan un puerto de esta caja ni los dados de baja', 'pp' not in lista and 'bj' not in lista)
        txt = await pg.inner_text('#as-list')
        check('los que tienen ubicación muestran a cuántos metros están de la caja', await pg.locator('#as-list [data-as="pc"] .chip.info').count() == 1 and await pg.locator('#as-list [data-as="pa"] .chip.info').count() == 1 and await pg.locator('#as-list [data-as="pn"] .chip.info').count() == 0 and ' m' in await pg.inner_text('#as-list [data-as="pc"] .chip.info'), txt)
        check('cada fila muestra nombre y calle (sin repetir «Sin caja» en todas)', 'Pend Cerca' in txt and 'Calle 11' in txt and 'Sin caja' not in txt, txt)
        # ya instalados
        await pg.click('#as-seg [data-t=ya]'); await pg.wait_for_selector('#as-list [data-as="is"]')
        lista = await ids(pg)
        check('«Ya instalados»: primero el de esta caja sin puerto, luego por cercanía, luego los que no tienen ubicación', lista[:4] == ['is', 'ia', 'ib', 'ic'] and lista[4:] == ['x%d' % k for k in range(1, 7)], lista)
        check('no aparecen los que ya tienen puerto en esta u otra caja, ni los de baja, ni los por instalar', all(x not in lista for x in ('ip', 'ie', 'bj', 'pn', 'pc')), lista)
        check('la solapa elegida queda marcada y muestra una ayuda', await prs(pg, 'ya') == 'true' and 'todavía no tienen caja' in await pg.inner_text('#as-hint'), await pg.inner_text('#as-hint'))
        check('«Inst Cerca» dice a cuántos metros está', ' m' in await pg.inner_text('#as-list [data-as="ia"] .chip.info'))
        # escribir busca entre todos (incluso a uno que ya está en otra caja)
        await pg.fill('#as-q', 'dos'); await pg.wait_for_selector('#as-list [data-as="ie"]')
        check('al escribir se busca entre todos y se ve en qué caja y puerto figura', await ids(pg) == ['ie'] and 'Caja 2' in await pg.inner_text('#as-list') and 'p. 3' in await pg.inner_text('#as-list'), await pg.inner_text('#as-list'))
        check('mientras se busca ninguna solapa queda marcada', await prs(pg, 'nuevo') == 'false' and await prs(pg, 'ya') == 'false')
        await pg.fill('#as-q', 'cerca'); await pg.wait_for_selector('#as-list [data-as="pc"]')
        check('en la búsqueda sí se marca «Sin caja» a quien no tiene', 'Sin caja' in await pg.inner_text('#as-list [data-as="pc"]'))
        await pg.fill('#as-q', 'pend'); await pg.wait_for_selector('#as-list [data-as="pp"]')
        check('la búsqueda marca «Por instalar» en los abonados nuevos', 'Por instalar' in await pg.inner_text('#as-list [data-as="pc"]'), await pg.inner_text('#as-list [data-as="pc"]'))
        await pg.fill('#as-q', '')
        await pg.wait_for_selector('#as-list [data-as="is"]')
        check('al borrar lo escrito vuelve la lista de la solapa', (await ids(pg))[0] == 'is' and await prs(pg, 'ya') == 'true')
        await pg.click('.sheet [data-close]'); await pg.wait_for_selector('.sheet', state='detached')

        # 2) el técnico: solo sus instalaciones, y pocos «ya instalados»
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.wait_for_function("S.clientes.size === %d && S.loaded.red" % len(cl), timeout=10000)
        await pt.evaluate("openRed('n1')"); await pt.wait_for_selector('.sheet [data-free="8"]')
        await pt.click('.sheet [data-free="8"]'); await pt.wait_for_selector('#as-seg')
        check('el técnico ve «Por instalar (1)»: solo el abonado de su orden; los otros no', (await pt.inner_text('#as-seg [data-t=nuevo]')).strip() == 'Por instalar (1)' and await ids(pt) == ['pn'], [await pt.inner_text('#as-seg'), await ids(pt)])
        check('y no ve cuántos clientes ya instalados hay', (await pt.inner_text('#as-seg [data-t=ya]')).strip() == 'Ya instalados')
        await pt.click('#as-seg [data-t=ya]'); await pt.wait_for_selector('#as-list [data-as="is"]')
        lt = await ids(pt)
        check('en «Ya instalados» ve 8 como máximo y le avisa que escriba el nombre', len(lt) == 8 and lt[:2] == ['is', 'ia'] and 'Se muestran 8 de 10' in await pt.inner_text('#as-hint'), [lt, await pt.inner_text('#as-hint')])
        txt = await pt.inner_text('#as-list')
        check('sin teléfono ni datos de facturación', '3844000000' not in txt and '$' not in txt and '20000' not in txt, txt)
        await pt.click('#as-seg [data-t=nuevo]'); await pt.wait_for_selector('#as-list [data-as="pn"]')
        await pt.click('#as-list [data-as="pn"]')
        await pt.wait_for_selector('.sheet [data-cl="pn"]', timeout=8000)
        pn = cliente(TA, 'pn')
        check('el técnico lo carga en el puerto 8 y sigue «Por instalar» (no se lo activa solo)', pn.get('nap') == 'n1' and pn.get('napPuerto') == 8 and pn.get('estado') == 'pendiente', pn)
        await pt.close()

        # 3) el administrador carga a un ya instalado, a uno sin puerto y pasa a otro de caja
        await pg.evaluate("openRed('n1')"); await pg.wait_for_selector('.sheet [data-free="1"]')
        await pg.click('.sheet [data-free="1"]'); await pg.wait_for_selector('#as-seg')
        check('«Por instalar» ya no ofrece al que el técnico acaba de cargar', (await pg.inner_text('#as-seg [data-t=nuevo]')).strip() == 'Por instalar (2)' and await ids(pg) == ['pc', 'pa'], await ids(pg))
        await pg.click('#as-seg [data-t=ya]'); await pg.wait_for_selector('#as-list [data-as="ia"]')
        await pg.click('#as-list [data-as="ia"]'); await pg.wait_for_selector('.sheet [data-cl="ia"]', timeout=8000)
        ia = cliente(TA, 'ia')
        check('tocar a «Inst Cerca» lo deja en el puerto 1 y se ve en el dibujo de la caja', ia.get('nap') == 'n1' and ia.get('napPuerto') == 1 and 'Inst Cerca' in await pg.inner_text('.sheet [data-cl="ia"]'), ia)
        await pg.click('.sheet [data-free="6"]'); await pg.wait_for_selector('#as-seg')
        await pg.click('#as-seg [data-t=ya]'); await pg.wait_for_selector('#as-list [data-as="is"]')
        check('el cliente de esta caja que no tenía puerto aparece primero', (await ids(pg))[0] == 'is' and 'Caja 1' in await pg.inner_text('#as-list [data-as="is"]'), await ids(pg))
        await pg.click('#as-list [data-as="is"]'); await pg.wait_for_selector('.sheet [data-cl="is"]', timeout=8000)
        check('queda en el puerto 6', cliente(TA, 'is').get('napPuerto') == 6)
        check('y ya no figura en «Para revisar»', 'Para revisar' not in await pg.inner_text('.sheet'), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-free="7"]'); await pg.wait_for_selector('#as-seg')
        await pg.fill('#as-q', 'dos'); await pg.wait_for_selector('#as-list [data-as="ie"]'); await pg.click('#as-list [data-as="ie"]')
        await pg.wait_for_selector('.sheet [data-act=yes]')
        check('uno que figura en otra caja pide confirmar antes de pasarlo', 'Caja 2' in await pg.inner_text('.sheet') and 'puerto 7' in await pg.inner_text('.sheet'), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-act=no]'); await pg.wait_for_selector('#as-q')
        check('si cancela vuelve a la búsqueda y no cambia nada', await pg.input_value('#as-q') == 'dos' and cliente(TA, 'ie').get('nap') == 'n2')
        await pg.click('#as-list [data-as="ie"]'); await pg.wait_for_selector('.sheet [data-act=yes]'); await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_selector('.sheet [data-cl="ie"]', timeout=8000)
        ie = cliente(TA, 'ie')
        check('al confirmar pasa a la caja 1, puerto 7', ie.get('nap') == 'n1' and ie.get('napPuerto') == 7, ie)
        # un puerto libre sin nadie a quien elegir en «Por instalar»
        await pg.click('.sheet [data-free="3"]'); await pg.wait_for_selector('#as-seg')
        await pg.click('#as-seg [data-t=nuevo]')
        await pg.click('#as-list [data-as="pc"]'); await pg.wait_for_selector('.sheet [data-cl="pc"]', timeout=8000)
        await pg.click('.sheet [data-free="4"]'); await pg.wait_for_selector('#as-seg')
        check('«Por instalar» ofrece al único que queda', await ids(pg) == ['pa'] and (await pg.inner_text('#as-seg [data-t=nuevo]')).strip() == 'Por instalar (1)', await ids(pg))
        await pg.click('#as-list [data-as="pa"]'); await pg.wait_for_selector('.sheet [data-cl="pa"]', timeout=8000)
        await pg.evaluate("openAsignarPuerto('n2', 1)"); await pg.wait_for_selector('#as-seg')
        check('cuando ya no queda nadie por instalar abre en «Ya instalados» y lo dice', await prs(pg, 'ya') == 'true', await pg.inner_text('#as-seg'))
        await pg.click('#as-seg [data-t=nuevo]')
        check('y la solapa «Por instalar» vacía explica que hay que escribir el nombre', 'No hay abonados por instalar' in await pg.inner_text('#as-hint') and await pg.locator('#as-list .item').count() == 0, await pg.inner_text('#as-hint'))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
