# Red: splitters (dividen la señal en varias salidas). Caso real que pidió Mauro:
# botella (pelo) -> splitter 1x2 -> splitter 1x4 -> splitter 1x2 (en la NAP primaria) -> NAP primaria + NAP secundaria con la salida que sobra.
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
async def red_id(pg, nombre): return await pg.evaluate("n => { const p=[...S.red.values()].find(x=>x.nombre===n); return p?p.id:null; }", nombre)

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'sinred', 'nombre': 'Sin Red', 'role': 'tecnico', 'clave': 'sinred123', 'permisos': {'red': False}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=red]')
        await pg.wait_for_selector('#rd-new-split')

        # 1) la botella de empalme, origen de todo
        await pg.click('#rd-new-emp'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'BE-01'); await pg.fill('#rf-hilos', '12')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 1", timeout=6000)
        await pg.click('.sheet [data-close]')

        # 2) splitter 1x2 que sale de la botella
        await pg.click('#rd-new-split'); await pg.wait_for_selector('#rform')
        check('al elegir splitter se esconden los puertos y aparece la relación', await pg.evaluate("document.querySelector('#rf-puertos-w').hidden") is True and await pg.evaluate("document.querySelector('#rf-rel-w').hidden") is False)
        await pg.fill('#rf-nombre', 'SPL-01')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('relaci')", timeout=4000)
        check('sin elegir relación no deja guardar el splitter', await pg.evaluate("S.red.size") == 1)
        await pg.select_option('#rf-rel', '2')
        await pg.select_option('#rf-padre', label='BE-01 · Botella de empalme')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 2", timeout=6000)
        await pg.wait_for_selector('.sheet .pelos', timeout=6000)
        shb = await pg.inner_text('.sheet')
        check('el splitter nuevo se abre solo con sus 2 salidas libres', await pg.locator('.sheet .pelo').count() == 2 and 'Salidas (1x2)' in shb and '0 de 2 en uso' in shb, shb[:400])
        check('dice de qué botella sale', 'Sale de' in shb and 'BE-01' in shb, shb[:400])
        await pg.click('.sheet [data-close]')
        spl1 = await red_id(pg, 'SPL-01')

        # 3) el pelo de la botella lleva al splitter (el dropdown ya lista splitters como destino)
        be1 = await red_id(pg, 'BE-01')
        await pg.evaluate(f"openRed('{be1}')"); await pg.wait_for_selector('.sheet [data-pelo="1"]')
        await pg.click('.sheet [data-pelo="1"]'); await pg.wait_for_selector('#pl-form')
        opts = await pg.evaluate("[...document.querySelectorAll('#pl-a option')].map(o=>o.textContent)")
        check('el pelo puede llevar a un splitter (aparece en el desplegable con su tipo)', any('SPL-01 · Splitter' in o for o in opts), opts)
        await pg.select_option('#pl-a', spl1); await pg.fill('#pl-n', 'Entra al splitter')
        await pg.click('#pl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-pelo="1"].est-empalmado', timeout=8000)
        check('«Cajas que conecta» de la botella lista el splitter', 'Cajas que conecta' in await pg.inner_text('.sheet') and 'SPL-01' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]')

        # 4) el splitter dice «Llega por» la botella
        await pg.evaluate(f"openRed('{spl1}')"); await pg.wait_for_selector('.sheet .pelos')
        shb = await pg.inner_text('.sheet')
        check('el splitter dice que llega por el pelo 1 de la botella', 'Llega por' in shb and 'BE-01' in shb and 'pelo 1' in shb, shb[:500])

        # 5) una salida del splitter 1x2 lleva a un segundo splitter 1x4
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        check('el editor de la salida propone «Conectado» y no tiene campo de PON', await pg.input_value('#sl-e') == 'conectado' and await pg.evaluate("!document.querySelector('#sl-pon')"))
        await pg.click('#sl-cancel')
        await pg.click('.sheet [data-close]')
        await pg.click('#rd-new-split'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'SPL-02'); await pg.select_option('#rf-rel', '4')
        await pg.select_option('#rf-padre', label='SPL-01 · Splitter')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 3", timeout=6000)
        await pg.click('.sheet [data-close]')
        spl2 = await red_id(pg, 'SPL-02')
        await pg.evaluate(f"openRed('{spl1}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', spl2); await pg.fill('#sl-n', 'Pigtail azul')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="1"].est-empalmado', timeout=8000)
        shb = await pg.inner_text('.sheet')
        check('la salida 1 queda conectada a SPL-02 y se cuenta en uso', '1/2 salidas en uso' in shb or '1 de 2 en uso' in shb, shb[:400])
        check('«De acá salen» lista el segundo splitter', 'De acá salen' in shb and 'SPL-02' in shb, shb)
        await pg.click('.sheet [data-close]')

        # 6) un tercer splitter 1x2 «en la NAP primaria»: una salida la alimenta a ella y la otra va a una NAP secundaria
        await pg.click('#rd-new-split'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'SPL-03'); await pg.select_option('#rf-rel', '2')
        await pg.select_option('#rf-padre', label='SPL-02 · Splitter')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 4", timeout=6000)
        await pg.click('.sheet [data-close]')
        spl3 = await red_id(pg, 'SPL-03')
        await pg.evaluate(f"openRed('{spl2}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', spl3); await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="1"].est-empalmado', timeout=8000)
        await pg.click('.sheet [data-close]')

        for nombre in ['NAP-PRIMARIA', 'NAP-SECUNDARIA']:
            await pg.click('#rd-new-nap'); await pg.wait_for_selector('#rform')
            await pg.fill('#rf-nombre', nombre); await pg.fill('#rf-puertos', '8')
            await pg.select_option('#rf-padre', label='SPL-03 · Splitter')
            await pg.click('#rform button[type=submit]')
            await pg.wait_for_selector('.sheet .nap-face', timeout=6000)
            await pg.click('.sheet [data-close]')
        napp = await red_id(pg, 'NAP-PRIMARIA'); naps = await red_id(pg, 'NAP-SECUNDARIA')
        await pg.evaluate(f"openRed('{spl3}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', napp); await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="1"].est-empalmado', timeout=8000)
        await pg.click('.sheet [data-salida="2"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', naps); await pg.fill('#sl-n', 'Sigue al poste 4')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="2"].est-empalmado', timeout=8000)
        shb = await pg.inner_text('.sheet')
        check('el splitter de la NAP primaria manda una salida a ella y la otra a la secundaria', 'NAP-PRIMARIA' in shb and 'NAP-SECUNDARIA' in shb and '2/2 salidas en uso' in shb, shb)
        await pg.click('.sheet [data-close]')

        # 7) la NAP primaria dice que llega por el splitter, y la secundaria también
        await pg.evaluate(f"openRed('{napp}')"); await pg.wait_for_selector('.sheet h2')
        shb = await pg.inner_text('.sheet')
        check('la NAP primaria dice que llega por SPL-03, salida 1', 'Llega por' in shb and 'SPL-03' in shb and 'salida 1' in shb, shb[:500])
        await pg.click('.sheet [data-close]')
        await pg.evaluate(f"openRed('{naps}')"); await pg.wait_for_selector('.sheet h2')
        shb = await pg.inner_text('.sheet')
        check('la NAP secundaria dice que llega por SPL-03, salida 2', 'Llega por' in shb and 'SPL-03 · salida 2' in shb, shb[:500])
        await pg.click('.sheet [data-close]')

        # 8) colores: cada salida tiene su color igual que los pelos de una botella
        await pg.evaluate(f"openRed('{spl1}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        aria = await pg.get_attribute('.sheet [data-salida="1"]', 'aria-label')
        check('la salida 1 es azul (primer color de la paleta), igual que el pelo 1 de una botella', 'azul' in aria.lower(), aria)
        await pg.click('.sheet [data-close]')

        # 9) filtro «Splitters» y el CSV traen la relación y las salidas usadas
        await pg.click('#rd-seg [data-f=splitter]')
        lst = await pg.inner_text('#rd-list')
        check('el filtro «Splitters» deja solo los 3 splitters', 'SPL-01' in lst and 'SPL-02' in lst and 'SPL-03' in lst and 'Caja NAP' not in lst and 'Botella de empalme' not in lst, lst)
        check('la lista muestra la relación y cuántas salidas están en uso', '1x2' in lst and '1x4' in lst, lst)
        await pg.click('#rd-seg [data-f=todos]')
        async with pg.expect_download() as dl:
            await pg.click('#rd-csv')
        d = await dl.value
        txt = open(await d.path(), encoding='utf-8-sig').read()
        check('el CSV trae las columnas de relación y salidas usadas, con los splitters cargados', 'relación splitter' in txt and 'salidas usadas' in txt and 'Splitter,SPL-01' in txt and ',1x2,1,' in txt and ',1x4,1,' in txt, txt)

        # 10) no deja reducir la relación de un splitter si alguna salida de más tiene datos cargados
        await pg.evaluate(f"openRed('{spl2}')"); await pg.wait_for_selector('.sheet .pelos')
        await pg.click('.sheet [data-salida="3"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', spl3); await pg.fill('#sl-n', 'reservado para más adelante')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="3"].est-empalmado', timeout=8000)
        await pg.click('.sheet [data-act=editar]'); await pg.wait_for_selector('#rform')
        await pg.select_option('#rf-rel', '2')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('menos salidas')", timeout=4000)
        check('avisa que la salida 3 tiene datos y no deja bajar la relación', True)
        await pg.click('.sheet [data-close]')

        # 11) sin el permiso de red no hay pestaña «Red», pero igual se puede abrir la ficha de un splitter (desde un cliente, por ejemplo) y queda sin tocar
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'sinred', 'sinred123')
        await pg2.wait_for_function("S.loaded.red", timeout=8000)
        check('sin permiso de red no tiene la pestaña «Red»', 'Red' not in ' '.join([await x.inner_text() for x in await pg2.locator('#tabs .tab').all()]))
        await pg2.evaluate(f"openRed('{spl1}')"); await pg2.wait_for_selector('.sheet .pelos')
        check('ve el splitter pero sin botón «Editar» ni salidas tocables', await pg2.evaluate("!document.querySelector('.sheet [data-act=editar]')") and await pg2.evaluate("!document.querySelector('.sheet button.pelo')"))
        await br.close()
    print('\nERRORES:', ERR if ERR else 'ninguno')
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)

asyncio.run(main())
