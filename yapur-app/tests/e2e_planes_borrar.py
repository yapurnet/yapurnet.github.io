# Eliminar planes: solo el administrador y solo si ningún cliente (activo, de baja o en su historial de precios) lo usa.
# Chromium real contra el servidor de verdad.
import asyncio, json, os, sys, urllib.request, urllib.error
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
def shard(cid):
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)

ERR = []
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and 'status of 4' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg
def existe(pid, token):
    st, j = api('GET', '/api/doc/planes/' + pid, None, token); return bool(j and j.get('exists'))

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    for pid, nom in {'pusado': 'Plan en uso', 'pbaja': 'Plan de una baja', 'phist': 'Plan de antes', 'plibre': 'Plan libre', 'plibre2': 'Plan libre dos', 'plibre3': 'Plan que se ocupa'}.items():
        api('PUT', '/api/doc/planes/' + pid, {'data': {'nombre': nom, 'bajada': 50, 'subida': 20, 'precio': 20000, 'activo': True}}, TA)
    for cid, c in {
        'ana': {'nombre': 'Ana Activa', 'estado': 'activo', 'planId': 'pusado'},
        'beto': {'nombre': 'Beto Baja', 'estado': 'baja', 'planId': 'pbaja'},
        'carlos': {'nombre': 'Carlos Historia', 'estado': 'activo', 'planId': 'pusado', 'hp': [{'h': '2026-01', 'planId': 'phist', 'precio': 18000, 'extras': []}]}}.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: c}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.clientes.size === 3 && S.planes.size === 6", timeout=10000)
        # una segunda pantalla del mismo administrador, para ver el borrado en vivo
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'mauro', 'claveSegura1')
        await pg2.wait_for_function("S.planes.size === 6", timeout=10000)

        # 1) planes en uso: no hay botón de eliminar y se explica por qué
        for pid, frag in [('pusado', '2 clientes'), ('pbaja', '1 cliente dado de baja'), ('phist', 'historial de precios de 1 cliente')]:
            await pg.evaluate(f"openPlanForm('{pid}')"); await pg.wait_for_selector('#pform')
            uso = await pg.inner_text('#pf-uso') if await pg.query_selector('#pf-uso') else ''
            check(f'«{pid}»: sin botón «Eliminar plan» y explica que figura en {frag}', await pg.query_selector('#pf-del') is None and frag in uso and 'destildá' in uso, uso)
            await pg.click('.sheet [data-close]')

        # 2) plan sin clientes: el botón está; cancelar la confirmación no borra nada
        await pg.evaluate("openPlanForm('plibre2')"); await pg.wait_for_selector('#pf-del')
        check('un plan sin clientes muestra «Eliminar plan» y no el aviso de uso', await pg.query_selector('#pf-uso') is None)
        await pg.click('#pf-del'); await pg.wait_for_selector('.sheet [data-act=no]')
        check('pide confirmar y dice que ningún cliente lo usa', 'Ningún cliente lo usa' in await pg.inner_text('.sheet'), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-act=no]')
        check('al cancelar el plan sigue (en pantalla y en el servidor)', await pg.evaluate("S.planes.has('plibre2')") and existe('plibre2', TA))

        # 3) eliminarlo de verdad: desaparece del servidor, de la lista y de la otra pantalla en vivo
        await pg.evaluate("openPlanForm('plibre')"); await pg.wait_for_selector('#pf-del')
        await pg.click('#pf-del'); await pg.wait_for_selector('.sheet [data-act=yes]')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("!S.planes.has('plibre')", timeout=6000)
        check('el plan eliminado desaparece del servidor', not existe('plibre', TA))
        check('y sale del listado de la misma pantalla sin recargar', await pg.evaluate("S.planes.size") == 5 and await pg.evaluate("[...S.planes.values()].every(p => p.nombre !== 'Plan libre')"))
        await pg2.wait_for_function("!S.planes.has('plibre')", timeout=6000)
        check('en la otra pantalla también desaparece, en vivo', await pg2.evaluate("S.planes.size") == 5)
        check('se avisó «Plan eliminado»', 'Plan eliminado' in await pg.inner_text('#toastRoot'))
        check('el formulario se cerró', await pg.query_selector('#pform') is None)
        # al volver a entrar no reaparece
        pg3 = await ctx2.new_page()   # la sesión ya está abierta en ese navegador: entra directo
        await pg3.goto(BASE, wait_until='domcontentloaded'); await pg3.wait_for_selector('#tabs .tab', timeout=10000)
        await pg3.wait_for_function("S.planes.size === 5", timeout=10000)
        check('al volver a entrar el plan no reaparece', await pg3.evaluate("S.planes.has('plibre')") is False)
        await pg3.close()

        # 4) el plan se ocupa justo mientras el administrador tiene el formulario abierto: no se borra
        await pg.evaluate("openPlanForm('plibre3')"); await pg.wait_for_selector('#pf-del')
        api('PATCH', '/api/doc/clientes/' + shard('dora'), {'data': {'items': {'dora': {'nombre': 'Dora Nueva', 'estado': 'activo', 'planId': 'plibre3'}}}}, TA)
        await pg.wait_for_function("S.clientes.has('dora')", timeout=6000)
        await pg.click('#pf-del')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('No se puede eliminar')", timeout=4000)
        check('si en ese momento lo ocupó un cliente, avisa y no abre la confirmación', await pg.query_selector('.sheet [data-act=yes]') is None and 'figura en 1 cliente' in await pg.inner_text('#toastRoot'), await pg.inner_text('#toastRoot'))
        check('el plan sigue en el servidor', existe('plibre3', TA))
        await pg.click('.sheet [data-close]')
        # lo mismo si la pantalla no se enteró: el servidor igual lo rechaza
        st, j = api('DELETE', '/api/doc/planes/plibre3', None, TA)
        check('y el servidor también lo rechaza con un motivo claro', st == 409 and 'Plan que se ocupa' in j['error'], j)

        # 5) la oficina no puede eliminar planes
        ctx4 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx4.route('**/fonts.g*/**', lambda r: r.abort())
        pg4 = await login(ctx4, 'laura', 'laura123')
        await pg4.wait_for_function("S.planes.size === 5", timeout=10000)
        check('la oficina no es administradora', await pg4.evaluate("isAdmin()") is False)
        await pg4.evaluate("openPlanForm('plibre2')")
        await pg4.wait_for_timeout(500)
        check('la oficina no ve el botón «Eliminar plan»', await pg4.query_selector('#pf-del') is None)
        st, j = api('POST', '/api/login', {'usuario': 'laura', 'clave': 'laura123'})
        st, j2 = api('DELETE', '/api/doc/planes/plibre2', None, j['token'])
        check('y el servidor tampoco la deja', st == 403 and existe('plibre2', TA), j2)

        await ctx4.close(); await ctx2.close(); await ctx.close(); await br.close()
    print('\nERRORES:', ERR or 'ninguno')
    bad = [e for e in ERR]
    n = sum(res)
    print(f'{n} ok, {len(res) - n} con fallas')
    sys.exit(1 if (len(res) - n) or bad else 0)

asyncio.run(main())
