# Plano de la red: el árbol de conexiones (OLT, botellas, splitters y cajas) dibujado solo a partir de lo
# ya cargado, con los mismos colores que las salidas y los pelos, para que Mauro pueda revisar el diseño y,
# si hace falta, imprimirlo. Un permiso nuevo («redPlano», apagado por defecto en los técnicos) deja elegir
# si un técnico lo puede ver.
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
    # un técnico, al entrar, ve el aviso de ubicación en horario laboral: la prueba lo acepta como lo haría una persona (si no lo
    # acepta, y es horario laboral, la app no lo deja usarla hasta que lo haga: ver gateCheck en p07c_ubic.js)
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

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'sinplano', 'nombre': 'Sin Plano', 'role': 'tecnico', 'clave': 'sinplano123', 'permisos': {'red': True, 'redPlano': False, 'redPlanoCajas': False}}, TA)
    api('POST', '/api/users', {'usuario': 'conplano', 'nombre': 'Con Plano', 'role': 'tecnico', 'clave': 'conplano123', 'permisos': {'red': True, 'redPlano': True}}, TA)
    api('POST', '/api/users', {'usuario': 'solocajas', 'nombre': 'Solo Cajas', 'role': 'tecnico', 'clave': 'solocajas123', 'permisos': {'red': True, 'redPlano': False, 'redPlanoCajas': True}}, TA)

    def red(items):
        return api('PATCH', '/api/doc/red/puntos', {'data': {'items': items}}, TA)

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=red]')
        await pg.wait_for_selector('#rd-plano', timeout=8000)

        # 1) todavía sin nada cargado: el botón ya está (es parte de la barra de herramientas) pero avisa que no hay nada para dibujar
        await pg.click('#rd-plano')
        await pg.wait_for_selector('.sheet', timeout=6000)
        check('sin puntos cargados, el plano avisa que no hay nada para dibujar', 'no hay nada para dibujar' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]')

        # 2) se arma la red: OLT -> botella -> splitter 1x2, cuya salida 1 sigue a un segundo splitter (1x4) y
        #    la salida 2 a una botella secundaria con su propio splitter; en el segundo splitter se agrega
        #    además una caja «declarada» (Sale de) pero sin anotar por cuál salida sale todavía
        st, _ = red({'o1': {'tipo': 'olt', 'nombre': 'OLT-01', 'puertos': 8, 'padre': None, 'creado': 1, 'mod': 1}}); assert st == 200
        red({'e1': {'tipo': 'empalme', 'nombre': 'BE-01', 'padre': 'o1', 'fibra': 'Fibra 4', 'hilos': 4, 'xtubo': 12, 'creado': 1, 'mod': 1}})
        red({'o1': {'salidas': {1: {'e': 'conectado', 'a': 'e1', 'n': ''}}, 'mod': 2}})
        red({'s1': {'tipo': 'splitter', 'nombre': 'SPL-01', 'padre': 'e1', 'rel': 2, 'creado': 1, 'mod': 1}})
        red({'e1': {'pelos': {1: {'e': 'empalmado', 'p': 1, 'a': 's1', 'n': ''}}, 'mod': 2}})
        red({'s2': {'tipo': 'splitter', 'nombre': 'SPL-02', 'padre': 's1', 'rel': 4, 'creado': 1, 'mod': 1}})
        red({'s1': {'salidas': {1: {'e': 'conectado', 'a': 's2', 'n': ''}}, 'mod': 2}})
        red({'e2': {'tipo': 'empalme', 'nombre': 'BE-02 (secundaria)', 'padre': 's1', 'fibra': 'Secundaria', 'hilos': 4, 'xtubo': 12, 'creado': 1, 'mod': 1}})
        red({'s1': {'salidas': {2: {'e': 'conectado', 'a': 'e2', 'n': ''}}, 'mod': 3}})
        red({'n1': {'tipo': 'nap', 'nombre': 'NAP-01', 'padre': 's2', 'puertos': 16, 'creado': 1, 'mod': 1}})
        red({'s2': {'salidas': {1: {'e': 'conectado', 'a': 'n1', 'n': ''}}, 'mod': 2}})
        red({'n3': {'tipo': 'nap', 'nombre': 'NAP-03 (sin salida anotada)', 'padre': 's2', 'puertos': 8, 'creado': 1, 'mod': 1}})   # declarada, pero sin pelo/salida
        red({'s3': {'tipo': 'splitter', 'nombre': 'SPL-03', 'padre': 'e2', 'rel': 4, 'creado': 1, 'mod': 1}})
        red({'e2': {'pelos': {1: {'e': 'empalmado', 'p': 1, 'a': 's3', 'n': ''}}, 'mod': 2}})

        await pg.wait_for_function("S.red.size === 8", timeout=8000)
        await pg.click('#rd-plano')
        await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        n_nodes = await pg.locator('.pnode').count()
        n_edges = await pg.locator('.pedge').count()
        names = await pg.evaluate("[...document.querySelectorAll('.pnode title')].map(t=>t.textContent)")
        check('el plano dibuja los 8 puntos de la red', n_nodes == 8, names)
        check('el plano dibuja las 7 conexiones (de las 8 cajas, todas menos la OLT llegan por algo)', n_edges == 7)
        check('están los nombres de todos los puntos', all(x in names for x in ['OLT-01', 'BE-01', 'SPL-01', 'SPL-02', 'BE-02 (secundaria)', 'NAP-01', 'NAP-03 (sin salida anotada)', 'SPL-03']), names)
        check('la OLT se dibuja de color distinto (el origen de la red)', await pg.locator('.pnode.olt').count() == 1)
        check('las cajas NAP tienen su propia clase de color', await pg.locator('.pnode.nap').count() == 2)
        check('las botellas de empalme tienen su propia clase de color', await pg.locator('.pnode.empalme').count() == 2)
        check('sin ningún PON marcado todavía en las fibras, no se dibuja ningún recuadro de PON', await pg.locator('.pgroup').count() == 0)

        # 2b) perímetro por PON: se marca «PON vivos» en las dos botellas (BE-01 con 2 PON compartidos en la
        #     misma fibra, BE-02 con 1 solo) y debe aparecer un recuadro con su etiqueta por cada una
        red({'e1': {'pons': [3, 1], 'mod': 3}})
        red({'e2': {'pons': [2], 'mod': 3}})
        await pg.wait_for_function("S.red.get('e1').pons && S.red.get('e1').pons.length === 2", timeout=4000)
        await pg.click('#pln-ref')
        await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        labels = await pg.evaluate("[...document.querySelectorAll('.pgroup .pgroup-txt')].map(t=>t.textContent)")
        check('aparece un recuadro de PON por cada fibra con PON marcado', await pg.locator('.pgroup').count() == 2, labels)
        check('la fibra con 2 PON juntos los junta en una sola etiqueta, ordenados', 'PON 1 + PON 3' in labels, labels)
        check('la otra fibra muestra su propio PON', 'PON 2' in labels, labels)
        colors = await pg.evaluate("[...document.querySelectorAll('.pgroup')].map(g=>g.getAttribute('style')||'')")
        check('cada recuadro tiene su propio color para distinguirse', len(set(colors)) == 2, colors)

        # 3) los colores de las conexiones son los mismos que ya se ven en la ficha de cada salida/pelo (azul = color 1, naranja = color 2)
        styles = await pg.evaluate("[...document.querySelectorAll('.pedge')].map(e=>e.getAttribute('style')||'')")
        check('la conexión por la salida 1 (azul) tiene el color azul del código de 12 colores', any('2f6fdc' in s for s in styles), styles)
        check('la conexión por la salida 2 (naranja, la botella secundaria) tiene el color naranja', any('f08a24' in s for s in styles), styles)
        check('la caja NAP-03, declarada pero sin salida anotada todavía, se dibuja con línea punteada (avisa que falta cargar ese dato)', await pg.locator('.pedge.sinconectar').count() == 1)

        # 4) tocar una caja del plano abre su ficha, igual que en el resto de la app
        await pg.locator('.pnode.nap').first.click()
        await pg.wait_for_selector('.sheet-body h2', timeout=5000)
        check('tocar una caja del plano abre su ficha', 'NAP-0' in await pg.inner_text('.sheet-body h2'), await pg.inner_text('.sheet-body h2'))
        await pg.click('.sheet [data-close]')

        # 5) acercar / alejar / tamaño real cambian el zoom del dibujo
        await pg.click('#rd-plano'); await pg.wait_for_selector('.plano-wrap svg', timeout=8000)
        t0 = await pg.get_attribute('#pln-canvas', 'style')
        await pg.click('#pln-mas')
        t1 = await pg.get_attribute('#pln-canvas', 'style')
        check('«Acercar» cambia el zoom del plano', t0 != t1, (t0, t1))
        await pg.click('#pln-100')
        t2 = await pg.get_attribute('#pln-canvas', 'style')
        check('«Tamaño real» vuelve a escala 1', 'scale(1)' in t2, t2)

        # 6) imprimir: igual que el recibo, en el celular (APK) le pasa el HTML listo a Android
        ctxp = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctxp.add_init_script("window.__calls = []; window.__r = 'ok'; window.YapurApp = { printHtml: (h, t) => { window.__calls.push(['printHtml', h, t]); return window.__r; } };")
        await ctxp.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(ctxp, 'mauro', 'claveSegura1')
        await pg2.click('#tabs [data-tab=red]')
        await pg2.wait_for_selector('#rd-plano', timeout=8000)
        await pg2.click('#rd-plano'); await pg2.wait_for_selector('.plano-wrap svg', timeout=8000)
        await pg2.click('#pln-print')
        calls = await pg2.evaluate('window.__calls')
        html = calls[0][1] if calls else ''
        check('«Imprimir» le pasa a Android el plano listo para imprimir, en hoja apaisada', len(calls) == 1 and calls[0][2] == 'Plano de la red' and 'OLT-01' in html and 'size:A4 landscape' in html, [c[0] for c in calls])
        await pg2.evaluate("window.__r = 'No se pudo abrir la impresión.'")
        await pg2.click('#pln-print')
        check('si Android no puede, avisa', 'No se pudo abrir la impresión' in await pg2.inner_text('#toastRoot'))
        await ctxp.close()

        # 7) el permiso nuevo: un técnico sin «redPlano» no ve el botón; con el permiso, lo ve y puede abrir el plano (de solo lectura)
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pgA = await login(ctx2, 'sinplano', 'sinplano123')
        await pgA.click('#tabs [data-tab=red]')
        await pgA.wait_for_selector('#rd-list', timeout=8000)
        check('un técnico sin el permiso «redPlano» no ve «Ver plano de la red»', await pgA.locator('#rd-plano').count() == 0)
        await ctx2.close()

        ctx3 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
        await ctx3.route('**/fonts.g*/**', lambda r: r.abort())
        pgB = await login(ctx3, 'conplano', 'conplano123')
        await pgB.click('#tabs [data-tab=red]')
        await pgB.wait_for_selector('#rd-plano', timeout=8000)
        check('un técnico con el permiso «redPlano» sí ve el botón', await pgB.locator('#rd-plano').count() == 1)
        await pgB.click('#rd-plano'); await pgB.wait_for_selector('.plano-wrap svg', timeout=8000)
        check('y puede ver el plano con los 8 puntos', await pgB.locator('.pnode').count() == 8)
        await ctx3.close()

        # 8) el permiso «redPlanoCajas»: ve el botón «Ver cajas NAP» y un plano simplificado, nomás con las 2 cajas NAP,
        #    sin la OLT, las botellas ni los splitters, y sin líneas (no hay jerarquía que dibujar). El texto no dice
        #    «solo cajas» para no insinuarle al técnico que le están ocultando algo más.
        ctx4 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
        await ctx4.route('**/fonts.g*/**', lambda r: r.abort())
        pgC = await login(ctx4, 'solocajas', 'solocajas123')
        await pgC.click('#tabs [data-tab=red]')
        await pgC.wait_for_selector('#rd-plano', timeout=8000)
        check('con el permiso «redPlanoCajas» el botón dice «Ver cajas NAP»', 'Ver cajas NAP' in await pgC.inner_text('#rd-plano'))
        await pgC.click('#rd-plano'); await pgC.wait_for_selector('.plano-wrap svg', timeout=8000)
        names4 = await pgC.evaluate("[...document.querySelectorAll('.pnode title')].map(t=>t.textContent)")
        check('el plano simplificado dibuja solo las 2 cajas NAP (nada de OLT, botellas ni splitters)', sorted(names4) == ['NAP-01', 'NAP-03 (sin salida anotada)'], names4)
        check('no dibuja ninguna línea (no hay splitters que conecten)', await pgC.locator('.pedge').count() == 0)
        check('el título del modal dice «Cajas NAP»', 'Cajas NAP' == (await pgC.inner_text('.sheet-head h2')).strip())
        await ctx4.close()

        await br.close()
    check('sin errores de la página', not ERR, ERR)
    print(f'\n{sum(res)} ok, {len(res) - sum(res)} con fallas'); sys.exit(0 if all(res) else 1)

asyncio.run(main())
