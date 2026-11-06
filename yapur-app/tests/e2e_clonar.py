# Clonar con todo lo que cuelga: copiar una rama entera de la red (splitters, botellas y cajas) en un solo paso,
# para repetir rápido un esquema ya armado (por ejemplo, la rama de un puerto PON) en otro punto de la red, en vez
# de cargar cada punto a mano. La copia trae la estructura (tipo, puertos, relación del splitter, pelos, salidas,
# con quién conecta cada una) pero no la ubicación, la referencia, las notas, la fibra, los PON vivos ni «qué hay
# que hacer»: son datos de ese punto físico en particular.
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

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']

    def red(items):
        st, j = api('PATCH', '/api/doc/red/puntos', {'data': {'items': items}}, TA)
        print('red patch', st, j if st >= 400 else 'ok')
        return j

    # OLT -> empalme (BE-PON1, con referencia y notas propias) -> splitter 1x2 (SPL-PON1) -> NAP-A, NAP-B
    # y un splitter chico colgado del splitter (SPL-SUB), para probar que no se puede clonar colgando de su propio hijo.
    red({'o1': {'tipo': 'olt', 'nombre': 'OLT-1', 'puertos': 2, 'padre': None, 'creado': 1, 'mod': 1}})
    red({'e1': {'tipo': 'empalme', 'nombre': 'BE-PON1', 'padre': 'o1', 'fibra': 'Fibra original', 'hilos': 4, 'xtubo': 12, 'ref': 'Poste original', 'notas': 'Nota original', 'creado': 1, 'mod': 1}})
    red({'o1': {'salidas': {1: {'e': 'conectado', 'a': 'e1', 'n': ''}}, 'mod': 2}})
    red({'s1': {'tipo': 'splitter', 'nombre': 'SPL-PON1', 'padre': 'e1', 'rel': 2, 'ref': 'Poste splitter', 'creado': 1, 'mod': 1}})
    red({'e1': {'pelos': {1: {'e': 'empalmado', 'p': 1, 'a': 's1', 'n': 'nota pelo original'}}, 'mod': 2}})
    red({'n1': {'tipo': 'nap', 'nombre': 'NAP-A', 'padre': 's1', 'puertos': 8, 'creado': 1, 'mod': 1}})
    red({'s1': {'salidas': {1: {'e': 'conectado', 'a': 'n1', 'n': ''}}, 'mod': 2}})
    red({'n2': {'tipo': 'nap', 'nombre': 'NAP-B', 'padre': 's1', 'puertos': 8, 'creado': 1, 'mod': 1}})
    red({'s1': {'salidas': {2: {'e': 'conectado', 'a': 'n2', 'n': ''}}, 'mod': 3}})
    red({'s2': {'tipo': 'splitter', 'nombre': 'SPL-SUB', 'padre': 's1', 'rel': 2, 'creado': 1, 'mod': 1}})

    # rama aparte, pensada para probar «buscar y reemplazar»: todos los nombres contienen «PON1»
    red({'e9': {'tipo': 'empalme', 'nombre': 'BOTELLA PON1 TEST', 'padre': None, 'hilos': 4, 'xtubo': 12, 'creado': 1, 'mod': 1}})
    red({'s9': {'tipo': 'splitter', 'nombre': 'SPLIT PON1 TEST', 'padre': 'e9', 'rel': 2, 'creado': 1, 'mod': 1}})
    red({'e9': {'pelos': {1: {'e': 'empalmado', 'p': 1, 'a': 's9', 'n': ''}}, 'mod': 2}})
    red({'n9': {'tipo': 'nap', 'nombre': 'CAJA PON1 TEST', 'padre': 's9', 'puertos': 8, 'creado': 1, 'mod': 1}})
    red({'s9': {'salidas': {1: {'e': 'conectado', 'a': 'n9', 'n': ''}}, 'mod': 2}})

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=red]')
        await pg.wait_for_selector('#rd-list', timeout=8000)

        async def abrir(nombre):
            rid = await pg.evaluate("n => { const p = [...S.red.values()].find(p => p.nombre === n); return p && p.id; }", nombre)
            assert rid, f'no se encontró «{nombre}» en S.red'
            await pg.click(f'[data-open-red="{rid}"]')
            await pg.wait_for_selector('.sheet-body h2', timeout=6000)
            return rid

        # 1) la OLT no tiene botón de clonar
        await abrir('OLT-1')
        check('la OLT no tiene botón «Clonar con todo lo que cuelga»', await pg.locator('.sheet button:has-text("Clonar con todo lo que cuelga")').count() == 0)
        await pg.click('.sheet [data-close]')

        # 2) clonar BE-PON1 (y lo que cuelga: SPL-PON1, SPL-SUB, NAP-A, NAP-B = 5 puntos) colgando de la OLT, prefijo «PON2»
        await abrir('BE-PON1')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)

        # 2a) sin prefijo: avisa y no manda nada
        antes = await pg.evaluate('S.red.size')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.toast:has-text("Poné un prefijo")', timeout=4000)
        check('sin prefijo, no crea nada', await pg.evaluate('S.red.size') == antes)

        # 2b) con padre y prefijo: pide confirmación con la cantidad correcta (5: BE-PON1, SPL-PON1, SPL-SUB, NAP-A, NAP-B)
        await pg.select_option('#cl-padre', label='OLT-1 · OLT')
        await pg.fill('#cl-prefijo', 'PON2')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.sheet:has-text("Confirmar")', timeout=6000)
        check('la confirmación avisa que se crean 5 puntos', '5 puntos' in await pg.inner_text('.sheet'))
        await pg.click('.sheet button:has-text("Clonar 5 puntos")')

        await pg.wait_for_selector('.toast:has-text("5 puntos creados")', timeout=6000)
        check('toast de 5 puntos creados', True)
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        h2 = (await pg.inner_text('.sheet-body h2')).strip()
        check('se abre la ficha de la copia de BE-PON1', h2 == 'PON2 BE-PON1', h2)
        sheet = await pg.inner_text('.sheet')
        check('«Sale de» apunta a la OLT elegida', 'OLT-1' in sheet)
        check('no trae la referencia del original', 'Poste original' not in sheet)
        check('no trae las notas del original', 'Nota original' not in sheet)
        check('«De acá salen» muestra la copia del splitter, no el original', 'PON2 SPL-PON1' in sheet and 'SPL-PON1' not in sheet.replace('PON2 SPL-PON1', ''))

        # entrar al splitter clonado y revisar que colgó su propio sub-splitter y las 2 cajas, todos clonados
        await pg.click('[data-red]:has-text("PON2 SPL-PON1")')
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        sheet2 = await pg.inner_text('.sheet')
        check('el splitter clonado conecta con su sub-splitter y las 2 cajas, todos clonados', all(x in sheet2 for x in ['PON2 SPL-SUB', 'PON2 NAP-A', 'PON2 NAP-B']))
        await pg.click('.sheet [data-close]')

        # 3) clonar de nuevo con el mismo prefijo: nombres repetidos, no crea nada
        await abrir('BE-PON1')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)
        await pg.select_option('#cl-padre', label='OLT-1 · OLT')
        await pg.fill('#cl-prefijo', 'PON2')
        antes2 = await pg.evaluate('S.red.size')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.toast:has-text("Ya hay un punto llamado")', timeout=5000)
        check('prefijo repetido: avisa y no crea nada', await pg.evaluate('S.red.size') == antes2)
        await pg.click('.sheet [data-close]')

        # 4) el selector «De dónde sale la copia» no ofrece colgar la copia de uno de sus propios descendientes
        await abrir('SPL-PON1')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)
        opciones = await pg.locator('#cl-padre option').all_inner_texts()
        check('no ofrece su propio sub-splitter (SPL-SUB) como destino', 'SPL-SUB · Splitter' not in opciones, opciones)
        check('sí ofrece la OLT y la botella original como destino', 'OLT-1 · OLT' in opciones and 'BE-PON1 · Botella de empalme' in opciones, opciones)
        await pg.click('.sheet [data-close]')

        # 5) el plano dibuja la rama original y la copia sin errores (redArbol compartido entre plano y clonar):
        #    6 originales (OLT, BE-PON1, SPL-PON1, SPL-SUB, NAP-A, NAP-B) + 5 de la copia + 3 de la rama de prueba de buscar/reemplazar = 14
        await pg.click('#rd-plano')
        await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        nnodes = await pg.locator('.pnode').count()
        check('el plano dibuja los 14 puntos (6 originales + 5 de la copia + 3 de la rama de prueba)', nnodes == 14, nnodes)
        await pg.click('.sheet [data-close]')

        # 6) clonar con «buscar y reemplazar» solo (sin prefijo): todos los nombres de la rama contienen «PON1»
        await abrir('BOTELLA PON1 TEST')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)
        await pg.fill('#cl-buscar', 'PON1')
        await pg.fill('#cl-reemplazar', 'PON7')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.sheet:has-text("Confirmar")', timeout=6000)
        check('buscar/reemplazar sin prefijo: pide confirmar 3 puntos', '3 puntos' in await pg.inner_text('.sheet'))
        await pg.click('.sheet button:has-text("Clonar 3 puntos")')
        await pg.wait_for_selector('.toast:has-text("3 puntos creados")', timeout=6000)
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        h2b = (await pg.inner_text('.sheet-body h2')).strip()
        check('el reemplazo cambia «PON1» por «PON7» en el nombre, sin agregar prefijo', h2b == 'BOTELLA PON7 TEST', h2b)
        sheetb = await pg.inner_text('.sheet')
        check('cuelga el splitter con el reemplazo (no el original)', 'SPLIT PON7 TEST' in sheetb and 'PON1' not in sheetb)

        # entrar al splitter clonado y revisar que la caja también se reemplazó
        await pg.click('[data-red]:has-text("SPLIT PON7 TEST")')
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        sheetb2 = await pg.inner_text('.sheet')
        check('la caja clonada también tiene el reemplazo, no el original', 'CAJA PON7 TEST' in sheetb2 and 'PON1' not in sheetb2)
        await pg.click('.sheet [data-close]')

        # 7) repetir el mismo buscar/reemplazar: los nombres resultantes chocan con los que ya creó el paso anterior
        await abrir('BOTELLA PON1 TEST')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)
        await pg.fill('#cl-buscar', 'PON1')
        await pg.fill('#cl-reemplazar', 'PON7')
        antes3 = await pg.evaluate('S.red.size')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.toast:has-text("Ya hay un punto llamado")', timeout=5000)
        check('buscar/reemplazar repetido: avisa y no crea nada', await pg.evaluate('S.red.size') == antes3)
        await pg.click('.sheet [data-close]')

        check('sin errores de consola ni del navegador', len(ERR) == 0, ERR[:5])
        await br.close()

    print(f'\n{sum(res)} ok / {len(res) - sum(res)} con fallas de {len(res)}')
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
