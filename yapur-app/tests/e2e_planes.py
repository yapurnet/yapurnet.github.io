# Empezar a cobrar de cero: todos pasan a cobrarse desde el mes que se elige y lo que debían queda como «deuda anterior» (aparte, sin cortes).
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
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
def add_months(ym, n):
    y, m = map(int, ym.split('-')); t = y * 12 + (m - 1) + n
    return '%d-%02d' % (t // 12, t % 12 + 1)

CUR = time.strftime('%Y-%m'); NEXT = add_months(CUR, 1)
ERR = []
SHOTS = os.environ.get('VIS_OUT')
async def shot(pg, name):
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, name + '.png'))
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
def doc(coll, did, token):
    st, j = api('GET', f'/api/doc/{coll}/{did}', None, token); return j['data'] if j and j.get('data') else {}

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/planes/p100', {'data': {'nombre': 'Plan 100', 'bajada': 100, 'subida': 100, 'precio': 18000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    api('PUT', '/api/doc/planes/p200', {'data': {'nombre': 'Plan 200', 'bajada': 200, 'subida': 200, 'precio': 19000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    base = {'estado': 'activo', 'dir': 'Calle 1', 'ciclo': 1, 'desde': NEXT, 'alta': '2026-01-01'}
    cl = {'ana': {'nombre': 'Ana Alda', 'precio': 17000},
          'beto': {'nombre': 'Bos Beto', 'precio': 18000, 'hp': [{'h': CUR, 'planId': None, 'precio': 17000, 'extras': []}]},   # ya subido por el bloque de 17 a 18
          'carlos': {'nombre': 'Carlos Cruz', 'precio': 32000, 'tel': '3844000003'},
          'dora': {'nombre': 'Dora Dix', 'precio': 15000},
          'gaby': {'nombre': 'Gaby Gil', 'precio': 28000}}
    for cid, c in cl.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {**base, **c}}}}, TA)
    csv_txt = '\ufeffnombre;plan;servicios;precio especial\r\nAna Alda;Plan 100;;\r\nBeto Bos;Plan 100;;\r\nCruz Carlos;Plan 100;Multimedia;\r\nDora Dix;Sin plan;Multimedia;\r\nNadie Nunca;Plan 200;;\r\nGaby Gil;;;\r\n'
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 5 && S.planes.size === 2', timeout=10000)
        price = "([id, per]) => priceAt(S.clientes.get(id), per)"
        check('antes: Ana paga 17.000 por precio propio', await pg.evaluate(price, ['ana', NEXT]) == 17000)
        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-imp')
        await pg.click('#aj-imp')
        await pg.wait_for_selector('#imp-act')
        check('el modo «actualizar» viene apagado y el mes no se ve', not await pg.is_checked('#imp-act') and await pg.evaluate("document.querySelector('#imp-vig-box').hidden"))
        await pg.check('#imp-act')
        check('al tildarlo aparece «rigen desde» con el mes siguiente', not await pg.evaluate("document.querySelector('#imp-vig-box').hidden") and await pg.input_value('#imp-vig') == NEXT, await pg.input_value('#imp-vig'))
        await pg.set_input_files('#imp-file', {'name': 'planes.csv', 'mimeType': 'text/csv', 'buffer': csv_txt.encode('utf-8')})
        await pg.wait_for_selector('#imp-go')
        txt = await pg.inner_text('#imp-out')
        check('el resumen dice cuántos se actualizan y que no crea nuevos', '4 clientes se actualizan' in txt and 'Plan 100: 3' in txt and 'Sin cliente con ese nombre' in txt and 'no se crean clientes nuevos' in txt, txt[:400])
        check('el botón dice «Actualizar 4»', (await pg.inner_text('#imp-go')).strip() == 'Actualizar 4', await pg.inner_text('#imp-go'))
        await pg.click('#imp-go')
        await pg.wait_for_function("S.clientes.get('carlos').planId === 'p100'", timeout=8000)
        await pg.wait_for_function("S.clientes.size === 5")
        d = {i: doc('clientes', shard(i), TA)['items'][i] for i in cl}
        check('no se creó ningún cliente nuevo', await pg.evaluate("S.clientes.size") == 5)
        check('Ana: Plan 100, sin precio propio; octubre 17.000 y noviembre 18.000', d['ana']['planId'] == 'p100' and d['ana'].get('precio') is None and await pg.evaluate(price, ['ana', CUR]) == 17000 and await pg.evaluate(price, ['ana', NEXT]) == 18000, d['ana'])
        check('Beto: no se duplica el historial; octubre 17.000 y noviembre 18.000', len(d['beto']['hp']) == 1 and await pg.evaluate(price, ['beto', CUR]) == 17000 and await pg.evaluate(price, ['beto', NEXT]) == 18000, d['beto'])
        check('Carlos: Plan 100 + Multimedia = 33.000 desde noviembre; antes 32.000', await pg.evaluate(price, ['carlos', NEXT]) == 33000 and await pg.evaluate(price, ['carlos', CUR]) == 32000 and d['carlos']['extras'] == ['multimedia'], d['carlos'])
        check('Dora: solo Multimedia = 15.000, sin plan', d['dora'].get('planId') is None and d['dora']['extras'] == ['multimedia'] and await pg.evaluate(price, ['dora', NEXT]) == 15000, d['dora'])
        check('Gaby (fila sin plan ni servicios) queda como estaba', d['gaby'].get('precio') == 28000 and not d['gaby'].get('planId') and not d['gaby'].get('hp'), d['gaby'])
        check('el resto de los datos de Carlos no se tocó', d['carlos']['tel'] == '3844000003' and d['carlos']['dir'] == 'Calle 1' and d['carlos']['desde'] == NEXT)
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
