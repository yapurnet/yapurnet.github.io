# Caja NAP «iluminada» (ya empalmada, se ve verde) o «sin empalmar» (todavía gris): una caja nueva arranca sin
# empalmar hasta que alguien la marca a mano desde su ficha. Es un dato de esa caja física en particular, así
# que no se copia al «Clonar con todo lo que cuelga» (la copia siempre arranca sin empalmar, como una caja nueva).
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

    # NAP-GRIS: caja nueva, sin el campo «iluminada» (arranca sin empalmar). NAP-VERDE: ya cargada como iluminada.
    red({'n1': {'tipo': 'nap', 'nombre': 'NAP-GRIS', 'padre': None, 'puertos': 8, 'creado': 1, 'mod': 1}})
    red({'n2': {'tipo': 'nap', 'nombre': 'NAP-VERDE', 'padre': None, 'puertos': 8, 'iluminada': True, 'creado': 1, 'mod': 1}})

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

        # 1) el plano dibuja NAP-GRIS en gris (apagada) y NAP-VERDE en su color normal
        await pg.click('#rd-plano')
        await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        check('el plano dibuja las 2 cajas', await pg.locator('.pnode.nap').count() == 2)
        check('NAP-GRIS (sin empalmar) se dibuja con la clase «apagada»', await pg.locator('.pnode.nap.apagada').count() == 1)
        await pg.click('.sheet [data-close]')

        # 2) la lista muestra el cartel «Sin empalmar» solo en la caja que todavía no está marcada
        rowGris = pg.locator('[data-open-red]', has_text='NAP-GRIS')
        rowVerde = pg.locator('[data-open-red]', has_text='NAP-VERDE')
        check('NAP-GRIS tiene el cartel «Sin empalmar» en la lista', await rowGris.locator('.chip', has_text='Sin empalmar').count() == 1)
        check('NAP-VERDE no tiene ese cartel', await rowVerde.locator('.chip', has_text='Sin empalmar').count() == 0)

        # 3) el filtro «Sin empalmar» muestra solo NAP-GRIS
        await pg.click('[data-f="sinempalmar"]')
        await pg.wait_for_timeout(200)
        check('el filtro «Sin empalmar» muestra solo esa caja', await pg.locator('[data-open-red]').count() == 1 and await pg.locator('[data-open-red]', has_text='NAP-GRIS').count() == 1)
        await pg.click('[data-f="todos"]')

        # 4) la ficha de NAP-GRIS: cartel «Sin empalmar» y botón «Marcar iluminada»
        await abrir('NAP-GRIS')
        sheet = await pg.inner_text('.sheet')
        check('la ficha avisa «Sin empalmar»', 'Sin empalmar' in sheet)
        check('ofrece «Marcar iluminada»', await pg.locator('.sheet button:has-text("Marcar iluminada")').count() == 1)

        # 5) marcarla como iluminada: toast, chip y botón cambian
        await pg.click('.sheet button:has-text("Marcar iluminada")')
        await pg.wait_for_selector('.toast:has-text("marcada como iluminada")', timeout=5000)
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        sheet2 = await pg.inner_text('.sheet')
        check('ahora la ficha dice «Iluminada»', 'Iluminada' in sheet2 and 'Sin empalmar' not in sheet2)
        check('el botón ahora ofrece volver a «sin empalmar»', await pg.locator('.sheet button:has-text("Marcar sin empalmar")').count() == 1)

        # 6) el plano ya no la dibuja gris
        await pg.click('.sheet [data-close]')
        await pg.click('#rd-plano')
        await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        check('ya no queda ninguna caja gris en el plano', await pg.locator('.pnode.nap.apagada').count() == 0)
        await pg.click('.sheet [data-close]')

        # 7) clonar NAP-GRIS (ya iluminada): la copia arranca sin empalmar, no hereda el estado del original
        await abrir('NAP-GRIS')
        await pg.click('.sheet button:has-text("Clonar con todo lo que cuelga")')
        await pg.wait_for_selector('#cl-form', timeout=6000)
        await pg.fill('#cl-prefijo', 'COPIA')
        await pg.click('#cl-form button[type=submit]')
        await pg.wait_for_selector('.sheet:has-text("Confirmar")', timeout=6000)
        await pg.click('.sheet button:has-text("Clonar 1 punto")')
        await pg.wait_for_selector('.toast:has-text("1 puntos creados")', timeout=6000)
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        sheet3 = await pg.inner_text('.sheet')
        check('la copia de una caja iluminada arranca sin empalmar (no copia el estado)', 'Sin empalmar' in sheet3)
        await pg.click('.sheet [data-close]')

        # 8) volver a marcar NAP-GRIS como sin empalmar: el botón es un ida y vuelta
        await abrir('NAP-GRIS')
        await pg.click('.sheet button:has-text("Marcar sin empalmar")')
        await pg.wait_for_selector('.toast:has-text("marcada como sin empalmar")', timeout=5000)
        await pg.wait_for_selector('.sheet-body h2', timeout=6000)
        sheet4 = await pg.inner_text('.sheet')
        check('vuelve a avisar «Sin empalmar»', 'Sin empalmar' in sheet4)
        await pg.click('.sheet [data-close]')

        check('sin errores de consola ni del navegador', len(ERR) == 0, ERR[:5])
        await br.close()

    print(f'\n{sum(res)} ok / {len(res) - sum(res)} con fallas de {len(res)}')
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
