# Dar de baja a un cliente sin que desaparezca hasta que se confirme el retiro de los equipos en comodato. Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, re, sys, time, urllib.request, urllib.error
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
def cliente_srv(tok, cid):
    st, j = api('GET', '/api/sync', None, tok)
    for d in j['cols']['clientes']:
        if cid in d['data'].get('items', {}): return d['data']['items'][cid]
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
async def lista(pg):
    return await pg.evaluate("[...document.querySelectorAll('#cl-list [data-open-client], .list [data-open-client]')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())")

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/planes/p20', {'data': {'nombre': 'Hogar 20', 'bajada': 20, 'subida': 20, 'precio': 12000}}, TA)
    for cid, nom in [('cTito', 'Tito Casa'), ('cSin', 'Sin Equipo'), ('cOtro', 'Otro Cliente')]:
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nom, 'estado': 'activo', 'planId': 'p20', 'ip': '10.1.0.5', 'dir': 'Calle 1', 'alta': '2026-01-10', 'desde': time.strftime('%Y-%m')}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 1000, 'height': 900})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 3', timeout=10000)
        await pg.click('#tabs [data-tab=clientes]')
        await pg.wait_for_selector('#cl-seg')
        chips = await pg.evaluate("[...document.querySelectorAll('#cl-seg button')].map(b=>b.textContent)")
        check('la lista tiene los filtros «Equipos por retirar» y «Bajas»', 'Equipos por retirar' in chips and 'Bajas' in chips, chips)

        # 1) dar de baja con equipos en comodato
        await pg.evaluate("openClient('cTito')")
        await pg.wait_for_selector('[data-act=baja]')
        await pg.click('[data-act=baja]')
        await pg.wait_for_selector('#bjform')
        check('el formulario ofrece retirar equipos y crear la orden, ya tildados', await pg.evaluate("document.querySelector('#bj-eq').checked && document.querySelector('#bj-ord').checked"))
        await pg.fill('#bj-mot', 'Se mudó de pueblo')
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'baja-form.png'))
        await pg.click('#bjform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cTito').estado === 'baja'", timeout=8000)
        c = cliente_srv(TA, 'cTito')
        check('en el servidor queda de baja con retiro pendiente, fecha y motivo', c['estado'] == 'baja' and c['retiro'] == 'pend' and c['bajaFecha'] == time.strftime('%Y-%m-%d') and c['bajaMotivo'] == 'Se mudó de pueblo', c)
        check('conserva el resto de la ficha (nombre, IP, plan)', c['nombre'] == 'Tito Casa' and c['ip'] == '10.1.0.5' and c['planId'] == 'p20', c)
        st, j = api('GET', '/api/sync', None, TA)
        ords = [o for d in j['cols']['ordenes'] for o in d['data'].get('items', {}).values()]
        ro = [o for o in ords if o.get('clientId') == 'cTito']
        check('se creó una orden «Retiro de equipo» sin asignar', len(ro) == 1 and ro[0]['tipo'] == 'retiro' and ro[0]['estado'] == 'pendiente' and not ro[0].get('tecnico'), ro)
        await pg.evaluate("closeModal()")
        txt = await pg.inner_text('.sheet') if await pg.query_selector('.sheet') else ''

        # 2) sigue en «Todos» con el aviso; aparece en «Equipos por retirar» y en «Bajas»
        await pg.click('#cl-seg [data-f=todos]')
        l = await lista(pg)
        check('en «Todos» sigue el cliente con «Baja · retirar equipo»', any('Tito Casa' in x and 'Baja · retirar equipo' in x for x in l), l)
        await pg.click('#cl-seg [data-f=retirar]')
        l = await lista(pg)
        check('«Equipos por retirar» lo lista', len(l) == 1 and 'Tito Casa' in l[0], l)
        await pg.click('#cl-seg [data-f=baja]')
        l = await lista(pg)
        check('«Bajas» lo lista', any('Tito Casa' in x for x in l), l)
        if SHOTS:
            await pg.click('#cl-seg [data-f=todos]'); await pg.screenshot(path=os.path.join(SHOTS, 'baja-lista.png'))
        await pg.evaluate("openClient('cTito')")
        await pg.wait_for_selector('[data-act=retiro-ok]')
        ft = await pg.inner_text('.sheet')
        check('la ficha avisa que falta retirar los equipos y ya no ofrece «Dar de baja»', 'Falta retirar los equipos' in ft and await pg.query_selector('[data-act=baja]') is None, ft[:300])
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'baja-ficha.png'))
        check('un cliente de baja no se factura ni aparece para cobrar', await pg.evaluate("billing(S.clientes.get('cTito')).aplica === false"))

        # 3) confirmar el retiro: sale de «Todos», sigue en «Bajas»
        await pg.click('[data-act=retiro-ok]')
        await pg.wait_for_selector('.sheet [data-act=yes]')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("S.clientes.get('cTito').retiro === 'ok'", timeout=8000)
        c = cliente_srv(TA, 'cTito')
        check('queda con el retiro confirmado y su fecha', c['retiro'] == 'ok' and c['retiroFecha'] == time.strftime('%Y-%m-%d') and c['estado'] == 'baja', c)
        await pg.click('#cl-seg [data-f=todos]')
        l = await lista(pg)
        check('ya no aparece en «Todos»', not any('Tito Casa' in x for x in l), l)
        await pg.click('#cl-seg [data-f=retirar]')
        check('ya no figura en «Equipos por retirar»', len(await lista(pg)) == 0)
        await pg.click('#cl-seg [data-f=baja]')
        l = await lista(pg)
        check('sigue en «Bajas» y se puede buscar ahí', any('Tito Casa' in x for x in l), l)
        await pg.fill('#cl-q', 'tito')
        await pg.wait_for_function("document.querySelectorAll('[data-open-client]').length === 1", timeout=5000)

        # 4) baja sin equipos: no queda pendiente y no crea orden
        await pg.fill('#cl-q', '')
        await pg.evaluate("openClient('cSin')")
        await pg.wait_for_selector('[data-act=baja]'); await pg.click('[data-act=baja]'); await pg.wait_for_selector('#bjform')
        await pg.uncheck('#bj-eq')
        check('sin equipos, se desactiva la orden de retiro', await pg.evaluate("document.querySelector('#bj-ord').disabled && !document.querySelector('#bj-ord').checked"))
        await pg.click('#bjform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cSin').estado === 'baja'", timeout=8000)
        c = cliente_srv(TA, 'cSin')
        st, j = api('GET', '/api/sync', None, TA)
        ords = [o for d in j['cols']['ordenes'] for o in d['data'].get('items', {}).values() if o.get('clientId') == 'cSin']
        check('baja directa: sin retiro pendiente y sin orden', c['estado'] == 'baja' and c['retiro'] == '' and not ords, (c, ords))
        await pg.click('#cl-seg [data-f=todos]')
        check('y sale de «Todos» en el acto', not any('Sin Equipo' in x for x in await lista(pg)))

        # 5) el técnico cierra la orden de retiro y se confirma el retiro desde ahí
        await pg.evaluate("openClient('cOtro')")
        await pg.wait_for_selector('[data-act=baja]'); await pg.click('[data-act=baja]'); await pg.wait_for_selector('#bjform')
        await pg.click('#bjform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cOtro').retiro === 'pend'", timeout=8000)
        await pg.wait_for_function("[...S.ordenes.values()].some(o=>o.clientId==='cOtro'&&o.tipo==='retiro')", timeout=8000)  # la orden llega un instante después que el cliente
        oid = await pg.evaluate("[...S.ordenes.values()].find(o=>o.clientId==='cOtro'&&o.tipo==='retiro').id")
        await pg.evaluate(f"closeModal(); openFinishOrder(S.ordenes.get('{oid}'))")
        await pg.wait_for_selector('#fform')
        check('al cerrar la orden de retiro ofrece confirmar que se retiraron los equipos', 'se retiraron los equipos' in await pg.inner_text('#fform'))
        await pg.fill('#ff-res', 'Se retiró la ONU y el router')
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cOtro').retiro === 'ok'", timeout=8000)
        c = cliente_srv(TA, 'cOtro')
        check('el cierre de la orden deja el retiro confirmado', c['retiro'] == 'ok' and c['estado'] == 'baja', c)
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
