# Permiso «redSplitters»: un técnico sin él no ve los splitters ni la OLT en la pestaña Red (ni en listas, buscador,
# desplegables o fichas), no los puede cargar, y al editar una caja o un pelo que cuelga de un splitter oculto
# NO se corta esa conexión. Con el permiso (administrador, oficina o un técnico al que se lo prendan) se ve todo.
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
def nuevo_ctx(br):
    return br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'tecsin', 'nombre': 'Técnico sin splitters', 'role': 'tecnico', 'clave': 'tecsin123', 'permisos': {'red': True}}, TA)
    api('POST', '/api/users', {'usuario': 'teccon', 'nombre': 'Técnico con splitters', 'role': 'tecnico', 'clave': 'teccon123', 'permisos': {'red': True, 'redSplitters': True}}, TA)
    def red(items):
        st, j = api('PATCH', '/api/doc/red/puntos', {'data': {'items': items}}, TA); assert st == 200, (st, j); return j
    def punto(i):
        st, j = api('GET', '/api/doc/red/puntos', None, TA); return j['data']['items'][i]

    # OLT-01 -> BE-01 (su pelo 1 lleva al splitter) -> SPL-01 -> NAP-01 (sale del splitter)
    red({'o1': {'tipo': 'olt', 'nombre': 'OLT-01', 'puertos': 8, 'padre': None, 'creado': 1, 'mod': 1}})
    red({'e1': {'tipo': 'empalme', 'nombre': 'BE-01', 'padre': 'o1', 'fibra': 'Fibra 4', 'hilos': 4, 'xtubo': 12, 'creado': 1, 'mod': 1}})
    red({'s1': {'tipo': 'splitter', 'nombre': 'SPL-01', 'padre': 'e1', 'rel': 2, 'creado': 1, 'mod': 1}})
    red({'e1': {'pelos': {1: {'e': 'empalmado', 'p': 1, 'a': 's1', 'n': ''}}, 'mod': 2}})
    red({'n1': {'tipo': 'nap', 'nombre': 'NAP-01', 'padre': 's1', 'puertos': 16, 'creado': 1, 'mod': 1}})

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])

        # 1) el técnico sin el permiso: la lista, los filtros, los botones y el buscador
        ctx = await nuevo_ctx(br); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'tecsin', 'tecsin123')
        await pg.click('#tabs [data-tab=red]'); await pg.wait_for_selector('#rd-list .item', timeout=8000)
        await pg.wait_for_function("S.loaded.red", timeout=8000)
        chips = await pg.evaluate("[...document.querySelectorAll('#rd-seg button')].map(b=>b.textContent)")
        check('los filtros no incluyen OLT ni Splitters', 'OLT' not in chips and 'Splitters' not in chips and 'Cajas NAP' in chips and 'Empalmes' in chips, chips)
        check('no están los botones «Nuevo splitter» ni «Nueva OLT»', await pg.locator('#rd-new-split').count() == 0 and await pg.locator('#rd-new-olt').count() == 0)
        check('sí están «Nueva caja NAP» y «Nueva botella de empalme»', await pg.locator('#rd-new-nap').count() == 1 and await pg.locator('#rd-new-emp').count() == 1)
        check('el servidor no le mandó ni el splitter ni la OLT', await pg.evaluate("[...S.red.keys()].sort().join(',')") == 'e1,n1', await pg.evaluate("[...S.red.keys()].join(',')"))
        check('la lista muestra solo la caja y la botella', (await pg.inner_text('#rd-count')).startswith('2 puntos'), await pg.inner_text('#rd-count'))
        await pg.fill('#rd-q', 'SPL-01')
        check('buscar el nombre del splitter no encuentra nada (ni por la caja que sale de él)', 'Ningún punto coincide' in await pg.inner_text('#rd-list'), await pg.inner_text('#rd-list'))
        await pg.fill('#rd-q', '')

        # 2) la ficha de la caja: no dice de qué splitter sale
        await pg.evaluate("openRed('n1')"); await pg.wait_for_selector('.sheet h2')
        txt = await pg.inner_text('.sheet')
        check('la ficha de la caja no menciona el splitter', 'SPL-01' not in txt, txt)

        # 3) editar la caja NO le corta la conexión con el splitter oculto
        await pg.click('.sheet [data-act=editar]'); await pg.wait_for_selector('#rform')
        tipos = await pg.evaluate("[...document.querySelectorAll('#rf-tipo option')].map(o=>o.value)")
        check('el desplegable «Qué es» no ofrece splitter ni OLT', 'splitter' not in tipos and 'olt' not in tipos and 'nap' in tipos, tipos)
        padre = await pg.evaluate("(()=>{const s=document.querySelector('#rf-padre');return [s.value,s.options[s.selectedIndex].textContent]})()")
        check('«Sale de» queda en un punto que no ve su perfil, sin decir cuál', padre[0] == 's1' and 'SPL-01' not in padre[1], padre)
        opciones = await pg.evaluate("[...document.querySelectorAll('#rf-padre option')].map(o=>o.textContent).join('|')")
        check('el desplegable «Sale de» no lista ni la OLT ni el splitter', 'OLT-01' not in opciones and 'SPL-01' not in opciones and 'BE-01' in opciones, opciones)
        await pg.fill('#rf-notas', 'Revisada por el técnico')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.get('n1').notas === 'Revisada por el técnico'", timeout=6000)
        n1 = punto('n1')
        check('la caja guardó la nota y sigue saliendo del splitter', n1['notas'] == 'Revisada por el técnico' and n1['padre'] == 's1', n1)

        # 4) anotar otro pelo de la botella: el pelo 1 que lleva al splitter oculto no se toca; y si se edita, conserva el destino
        await pg.evaluate("openRed('e1')"); await pg.wait_for_selector('.sheet .pelos')
        txt = await pg.inner_text('.sheet')
        check('la ficha de la botella no menciona el splitter', 'SPL-01' not in txt and 'OLT-01' not in txt, txt)
        await pg.click('.sheet [data-pelo="1"]'); await pg.wait_for_selector('#pl-form')
        dest = await pg.evaluate("(()=>{const s=document.querySelector('#pl-a');return [s.value,s.options[s.selectedIndex].textContent]})()")
        check('«Lleva a» queda en un punto que no ve su perfil, sin decir cuál', dest[0] == 's1' and 'SPL-01' not in dest[1], dest)
        await pg.fill('#pl-n', 'revisado')
        await pg.click('#pl-form button[type=submit]')
        await pg.wait_for_function("(S.red.get('e1').pelos[1]||{}).n === 'revisado'", timeout=6000)
        e1 = punto('e1')
        check('el pelo guardó la nota y sigue llevando al splitter', e1['pelos']['1']['n'] == 'revisado' and e1['pelos']['1']['a'] == 's1' and e1['pelos']['1']['p'] == 1, e1['pelos'])
        await ctx.close()

        # 5) un técnico con el permiso, y el administrador, ven todo
        for user, clave in (('teccon', 'teccon123'), ('mauro', 'claveSegura1')):
            ctx = await nuevo_ctx(br); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
            pg = await login(ctx, user, clave)
            await pg.click('#tabs [data-tab=red]'); await pg.wait_for_selector('#rd-list .item', timeout=8000)
            await pg.wait_for_function("S.loaded.red && S.red.size === 4", timeout=8000)
            chips = await pg.evaluate("[...document.querySelectorAll('#rd-seg button')].map(b=>b.textContent)")
            check(f'{user}: los filtros incluyen OLT y Splitters', 'OLT' in chips and 'Splitters' in chips, chips)
            check(f'{user}: están los botones «Nuevo splitter» y «Nueva OLT»', await pg.locator('#rd-new-split').count() == 1 and await pg.locator('#rd-new-olt').count() == 1)
            check(f'{user}: la lista muestra los 4 puntos', (await pg.inner_text('#rd-count')).startswith('4 puntos'), await pg.inner_text('#rd-count'))
            await pg.evaluate("openRed('n1')"); await pg.wait_for_selector('.sheet h2')
            check(f'{user}: la ficha de la caja dice de qué splitter sale', 'SPL-01' in await pg.inner_text('.sheet'))
            await ctx.close()

        # 6) el administrador viendo la app como el técnico (vista previa) tampoco los ve, aunque el servidor se los mande
        ctx = await nuevo_ctx(br); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.loaded.red && S.red.size === 4", timeout=8000)
        pid = await pg.evaluate("(S.ajustes.perfiles.find(p=>p.nombre==='Técnico sin splitters')||{}).id")
        await pg.evaluate(f"lsSet('viewAsP','{pid}'); computePerms();")
        r = await pg.evaluate("[redList().length, redHas('s1'), redHas('o1'), redHas('n1')]")
        check('en vista previa de técnico el administrador no ve los splitters ni la OLT, pero sí las cajas', r == [2, False, False, True], r)
        await ctx.close()
        await br.close()
    check('sin errores de la página', not ERR, ERR)
    print(f'\n{sum(res)} ok, {len(res) - sum(res)} con fallas'); sys.exit(0 if all(res) else 1)

asyncio.run(main())
