# Red: OLT (origen de toda la fibra). A diferencia del splitter (relación fija 1x2, 1x4…) tiene una
# cantidad libre de puertos, como una caja NAP. Caso real que pidió Mauro:
# OLT de 8 puertos -> botella -> splitter 1x2, cuya primera salida sigue la red (a una caja) y cuya
# segunda salida alimenta una botella secundaria, que a su vez tiene su propio splitter 1x4.
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
    api('POST', '/api/users', {'usuario': 'sinred2', 'nombre': 'Sin Red 2', 'role': 'tecnico', 'clave': 'sinred2123', 'permisos': {'red': False}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=red]')
        await pg.wait_for_selector('#rd-new-olt')

        # 1) la OLT: tiene una cantidad libre de puertos (no una relación fija), y no tiene «Sale de» (es el origen)
        await pg.click('#rd-new-olt'); await pg.wait_for_selector('#rform')
        check('al elegir OLT se esconden los puertos de caja, la relación y «Sale de»; aparece la cantidad de puertos',
              await pg.evaluate("document.querySelector('#rf-puertos-w').hidden") is True
              and await pg.evaluate("document.querySelector('#rf-rel-w').hidden") is True
              and await pg.evaluate("document.querySelector('#rf-padre-w').hidden") is True
              and await pg.evaluate("document.querySelector('#rf-oltp-w').hidden") is False)
        await pg.fill('#rf-nombre', 'OLT-01')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('puertos')", timeout=4000)
        check('sin cargar la cantidad de puertos no deja guardar la OLT', await pg.evaluate("S.red.size") == 0)
        await pg.fill('#rf-oltp', '8')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 1", timeout=6000)
        await pg.wait_for_selector('.sheet .pelos', timeout=6000)
        shb = await pg.inner_text('.sheet')
        check('la OLT nueva se abre sola con sus 8 puertos libres', await pg.locator('.sheet .pelo').count() == 8 and 'Puertos (8)' in shb and '0 de 8 en uso' in shb, shb[:400])
        await pg.click('.sheet [data-close]')
        olt1 = await red_id(pg, 'OLT-01')

        # 2) la botella de empalme sale de la OLT
        await pg.click('#rd-new-emp'); await pg.wait_for_selector('#rform')
        check('en una botella «Sale de» sigue visible', await pg.evaluate("document.querySelector('#rf-padre-w').hidden") is False)
        await pg.fill('#rf-nombre', 'BE-01'); await pg.fill('#rf-hilos', '12')
        opts = await pg.evaluate("[...document.querySelectorAll('#rf-padre option')].map(o=>o.textContent)")
        check('la OLT aparece en el desplegable «Sale de»', any('OLT-01 · OLT' in o for o in opts), opts)
        await pg.select_option('#rf-padre', label='OLT-01 · OLT')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 2", timeout=6000)
        shb = await pg.inner_text('.sheet')
        check('la botella dice que sale de la OLT', 'Sale de' in shb and 'OLT-01' in shb, shb[:400])
        await pg.click('.sheet [data-close]')
        be1 = await red_id(pg, 'BE-01')

        # 3) un puerto de la OLT lleva a la botella: el editor dice «puerto», no «salida», y no tiene PON
        await pg.evaluate(f"openRed('{olt1}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        check('el editor del puerto dice «Estado del puerto» y no tiene campo de PON',
              await pg.inner_text('label[for=sl-e]') == 'Estado del puerto'
              and await pg.input_value('#sl-e') == 'conectado'
              and await pg.evaluate("!document.querySelector('#sl-pon')"))
        await pg.select_option('#sl-a', be1); await pg.fill('#sl-n', 'Sale a BE-01')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="1"].est-empalmado', timeout=8000)
        shb = await pg.inner_text('.sheet')
        check('el puerto 1 queda conectado y se cuenta en uso', '1/8 puertos en uso' in shb, shb[:400])
        check('«De acá salen» lista la botella', 'De acá salen' in shb and 'BE-01' in shb, shb)
        await pg.click('.sheet [data-close]')

        # 4) la botella dice que llega por la OLT
        await pg.evaluate(f"openRed('{be1}')"); await pg.wait_for_selector('.sheet h2')
        shb = await pg.inner_text('.sheet')
        check('la botella dice que llega por la OLT, salida 1', 'Llega por' in shb and 'OLT-01 · salida 1' in shb, shb[:500])
        await pg.click('.sheet [data-close]')

        # 5) splitter 1x2 que sale de la botella: su primera salida sigue a una caja, la segunda a una botella secundaria
        await pg.click('#rd-new-split'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'SPL-01'); await pg.select_option('#rf-rel', '2')
        await pg.select_option('#rf-padre', label='BE-01 · Botella de empalme')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 3", timeout=6000)
        await pg.click('.sheet [data-close]')
        spl1 = await red_id(pg, 'SPL-01')
        await pg.evaluate(f"openRed('{be1}')"); await pg.wait_for_selector('.sheet [data-pelo="1"]')
        await pg.click('.sheet [data-pelo="1"]'); await pg.wait_for_selector('#pl-form')
        await pg.select_option('#pl-a', spl1); await pg.fill('#pl-n', 'Entra al splitter')
        await pg.click('#pl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-pelo="1"].est-empalmado', timeout=8000)
        await pg.click('.sheet [data-close]')

        await pg.click('#rd-new-nap'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'NAP-01'); await pg.fill('#rf-puertos', '8')
        await pg.select_option('#rf-padre', label='SPL-01 · Splitter')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_selector('.sheet .nap-face', timeout=6000)
        await pg.click('.sheet [data-close]')
        nap1 = await red_id(pg, 'NAP-01')
        await pg.evaluate(f"openRed('{spl1}')"); await pg.wait_for_selector('.sheet [data-salida="1"]')
        await pg.click('.sheet [data-salida="1"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', nap1)
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="1"].est-empalmado', timeout=8000)

        # 6) la segunda salida del splitter 1x2 alimenta una botella secundaria, con su propio splitter 1x4
        await pg.click('.sheet [data-close]')
        await pg.click('#rd-new-emp'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'BE-02 (secundaria)'); await pg.fill('#rf-hilos', '12')
        opts = await pg.evaluate("[...document.querySelectorAll('#rf-padre option')].map(o=>o.textContent)")
        check('el splitter aparece en el desplegable «Sale de» de la nueva botella', any('SPL-01 · Splitter' in o for o in opts), opts)
        await pg.select_option('#rf-padre', label='SPL-01 · Splitter')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 5", timeout=6000)
        await pg.click('.sheet [data-close]')
        be2 = await red_id(pg, 'BE-02 (secundaria)')
        await pg.evaluate(f"openRed('{spl1}')"); await pg.wait_for_selector('.sheet [data-salida="2"]')
        await pg.click('.sheet [data-salida="2"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', be2); await pg.fill('#sl-n', 'Botella secundaria')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="2"].est-empalmado', timeout=8000)
        shb = await pg.inner_text('.sheet')
        check('el splitter 1x2 manda su primera salida a la caja y la segunda a la botella secundaria', 'NAP-01' in shb and 'BE-02' in shb and '2/2 salidas en uso' in shb, shb)
        await pg.click('.sheet [data-close]')

        await pg.evaluate(f"openRed('{be2}')"); await pg.wait_for_selector('.sheet h2')
        shb = await pg.inner_text('.sheet')
        check('la botella secundaria dice que llega por la 2ª salida del splitter, con la nota', 'Llega por' in shb and 'SPL-01 · salida 2' in shb, shb[:500])
        await pg.click('.sheet [data-close]')

        await pg.click('#rd-new-split'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-nombre', 'SPL-02'); await pg.select_option('#rf-rel', '4')
        await pg.select_option('#rf-padre', label='BE-02 (secundaria) · Botella de empalme')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("S.red.size === 6", timeout=6000)
        await pg.click('.sheet [data-close]')
        spl2 = await red_id(pg, 'SPL-02')
        await pg.evaluate(f"openRed('{be2}')"); await pg.wait_for_selector('.sheet [data-pelo="1"]')
        await pg.click('.sheet [data-pelo="1"]'); await pg.wait_for_selector('#pl-form')
        await pg.select_option('#pl-a', spl2)
        await pg.click('#pl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-pelo="1"].est-empalmado', timeout=8000)
        shb = await pg.inner_text('.sheet')
        check('la botella secundaria reparte en un splitter 1x4 propio, que completa el resto', 'Cajas que conecta' in shb and 'SPL-02' in shb, shb)
        await pg.click('.sheet [data-close]')
        await pg.evaluate(f"openRed('{spl2}')"); await pg.wait_for_selector('.sheet h2')
        shb = await pg.inner_text('.sheet')
        check('el splitter 1x4 dice que llega por la botella secundaria', 'Llega por' in shb and 'BE-02' in shb and 'pelo 1' in shb, shb[:500])
        await pg.click('.sheet [data-close]')

        # 7) filtro «OLT» aísla la OLT
        await pg.click('#rd-seg [data-f=olt]')
        lst = await pg.inner_text('#rd-list')
        check('el filtro «OLT» deja solo la OLT', 'OLT-01' in lst and 'BE-01' not in lst and 'SPL-01' not in lst and 'NAP-01' not in lst, lst)
        check('la fila de la OLT muestra la cantidad de puertos y cuántos están en uso', '8 puertos' in lst and '1/8' in lst, lst)
        await pg.click('#rd-seg [data-f=todos]')

        # 8) el CSV trae la fila de la OLT (puertos y salidas usadas, sin relación de splitter)
        async with pg.expect_download() as dl:
            await pg.click('#rd-csv')
        d = await dl.value
        txt = open(await d.path(), encoding='utf-8-sig').read()
        fila = next((l for l in txt.splitlines() if l.startswith('OLT,OLT-01,')), None)
        cols = fila.split(',') if fila else []
        check('el CSV trae la fila de la OLT con 8 puertos, 1 salida usada y sin relación de splitter', fila is not None and cols[4] == '8' and cols[6] == '' and cols[7] == '1', fila)

        # 9) no deja reducir la cantidad de puertos de la OLT si un puerto de más tiene datos
        await pg.evaluate(f"openRed('{olt1}')"); await pg.wait_for_selector('.sheet .pelos')
        await pg.click('.sheet [data-salida="8"]'); await pg.wait_for_selector('#sl-form')
        await pg.select_option('#sl-a', nap1); await pg.fill('#sl-n', 'reservado para más adelante')
        await pg.click('#sl-form button[type=submit]')
        await pg.wait_for_selector('.sheet [data-salida="8"].est-empalmado', timeout=8000)
        await pg.click('.sheet [data-act=editar]'); await pg.wait_for_selector('#rform')
        await pg.fill('#rf-oltp', '4')
        await pg.click('#rform button[type=submit]')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('menos puertos')", timeout=4000)
        check('avisa que el puerto 8 tiene datos y no deja bajar la cantidad de puertos', True)
        await pg.click('.sheet [data-close]')

        # 10) no se elimina una OLT de la que sale otro punto de la red
        await pg.evaluate(f"openRed('{olt1}')"); await pg.wait_for_selector('.sheet .pelos')
        await pg.click('.sheet [data-act=editar]'); await pg.wait_for_selector('#rform')
        await pg.click('#rf-del')
        await pg.wait_for_function("document.querySelector('#toastRoot').textContent.includes('salen')", timeout=4000)
        check('no deja eliminar la OLT porque de ahí sale la botella', True)
        await pg.click('.sheet [data-close]')

        # 11) sin permiso de red, la ficha de la OLT queda de solo lectura
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctx2, 'sinred2', 'sinred2123')
        await pg2.wait_for_function("S.loaded.red", timeout=8000)
        await pg2.evaluate(f"openRed('{olt1}')"); await pg2.wait_for_selector('.sheet .pelos')
        check('sin permiso de red, la OLT se ve pero sin botón «Editar» ni puertos tocables', await pg2.evaluate("!document.querySelector('.sheet [data-act=editar]')") and await pg2.evaluate("!document.querySelector('.sheet button.pelo')"))
        await br.close()
    print('\nERRORES:', ERR if ERR else 'ninguno')
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)

asyncio.run(main())
