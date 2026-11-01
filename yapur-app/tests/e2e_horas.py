# Horas trabajadas: la semana de cada técnico en la oficina, el detalle y la corrección de un día, copiar/CSV, y «Mis horas» en el celular del técnico.
import asyncio, datetime, json, os, sys, time, urllib.request, urllib.error
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
async def login(ctx, user, clave, tab='#tabs .tab'):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector(tab, timeout=10000)
    return pg

def ar(dt=None): return (dt or datetime.datetime.utcnow()) - datetime.timedelta(hours=3)
def ms(fecha, h, m=0):   # hora argentina de una fecha, en milisegundos
    y, mo, d = map(int, fecha.split('-'))
    return int(datetime.datetime(y, mo, d, h, m, tzinfo=datetime.timezone.utc).timestamp() * 1000) + 3 * 3600 * 1000

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro11'}, TA)
    TP = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro11'})[1]['token']
    api('POST', '/api/ubicacion/acepto', {}, TP); api('POST', '/api/jornada/acepto', {}, TP)
    api('POST', '/api/ubicacion/plan', {'desde': 0, 'hasta': 24, 'cortado': None, 'dias': {str(d): 'corrido' for d in range(7)}, 'fechas': {}}, TA)
    api('POST', '/api/jornada/base', {'lat': -28.4601, 'lng': -62.8302, 'radio': 40, 'tol': 10, 'dias': [0, 1, 2, 3, 4, 5, 6]}, TA)
    idP = [x for x in api('GET', '/api/ubicaciones', None, TA)[1]['tecnicos'] if x['nombre'] == 'Pedro'][0]['id']
    hoyD = ar().date(); hoy = hoyD.isoformat()
    lunes = hoyD - datetime.timedelta(days=hoyD.weekday())
    # dos días de la semana pasada, cargados por la oficina: 4 h 30 + 4 h = 8:30 y 8 h
    d1 = (lunes - datetime.timedelta(days=7)).isoformat(); d2 = (lunes - datetime.timedelta(days=6)).isoformat()
    s, r = api('POST', '/api/jornada/ajuste', {'uid': idP, 'dia': d1, 'segs': [[ms(d1, 8), ms(d1, 12, 30)], [ms(d1, 17), ms(d1, 21)]], 'nota': 'Se le apagó el celular'}, TA)
    check('(se cargó un día de la semana pasada: 8:30)', s == 200 and r['min'] == 510, r)
    s, r = api('POST', '/api/jornada/ajuste', {'uid': idP, 'dia': d2, 'segs': [[ms(d2, 8), ms(d2, 16)]], 'nota': ''}, TA)
    check('(y otro de 8:00)', s == 200 and r['min'] == 480, r)
    # hoy, de verdad: el celular llega a la base hace un rato (si recién pasó la medianoche las posiciones caerían en otro día)
    minHoy = ar().hour * 60 + ar().minute
    vivo = minHoy >= 20
    if vivo:
        s, r = api('POST', '/api/ubicacion', {'pts': [{'lat': -28.4601, 'lng': -62.8302, 'acc': 8, 'ts': int(time.time() * 1000) - 6 * 60000}]}, TP)
    # y ayer, si todavía es de esta semana, para que el técnico tenga algo que ver además de hoy
    ayer = (hoyD - datetime.timedelta(days=1)).isoformat(); ayerEsta = hoyD.weekday() > 0
    if ayerEsta: api('POST', '/api/jornada/ajuste', {'uid': idP, 'dia': ayer, 'segs': [[ms(ayer, 9), ms(ayer, 13)]], 'nota': 'Salió temprano'}, TA)

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        actx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, accept_downloads=True)
        await actx.route('**/fonts.g*/**', lambda r: r.abort())
        ap = await login(actx, 'mauro', 'claveSegura1')
        await ap.click('#tabs [data-tab=tecnicos]')
        await ap.wait_for_selector('#tu-vista')
        check('la pestaña Técnicos tiene «Dónde están» y «Horas trabajadas», y arranca en la primera', await ap.get_attribute('#tu-vista [data-v=pos]', 'aria-pressed') == 'true' and await ap.evaluate("document.querySelector('#hr-wrap').hidden"))
        await ap.click('#tu-vista [data-v=horas]')
        await ap.wait_for_function("document.querySelectorAll('#hr-out .tcard').length === 1", timeout=8000)
        check('al elegir «Horas trabajadas» se esconde la lista de posiciones y aparece la semana', await ap.evaluate("document.querySelector('#tu-pos').hidden && !document.querySelector('#hr-wrap').hidden") and await ap.get_attribute('#tu-vista [data-v=horas]', 'aria-pressed') == 'true')
        hdr = await ap.inner_text('#hr-out .hr-nav')
        check('el título dice «Semana del … al …» y no hay «Esta semana» porque ya estamos en ella', 'Semana del' in hdr and 'Esta semana' not in hdr, hdr)
        check('la tarjeta de Pedro tiene siete casillas, una por día', await ap.locator('#hr-out .tcard .hrc').count() == 7)
        check('«semana siguiente» está apagado en la semana actual', await ap.is_disabled('[data-hr-nav="7"]'))
        if vivo:
            c = await ap.evaluate("(() => { const c = document.querySelector('#hr-out .hrc.hoy'); return c ? [c.className, c.innerText] : null; })()")
            check('hoy figura «en curso» con unos minutos', c and 'en_curso' in c[0] and c[1].split('\n')[-1].startswith('0:'), c)
        else:
            print('ok   (salteado: recién pasó la medianoche)')
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horas-semana.png'), full_page=True)

        # --- la semana pasada
        await ap.click('[data-hr-nav="-7"]')
        await ap.wait_for_function("((document.querySelector('#hr-out .tcard .hr-tot')||{}).innerText||'').includes('16 h 30')", timeout=8000)
        check('la semana anterior suma 16 h 30 min (8:30 + 8:00)', True)
        check('y aparece «Esta semana» para volver', 'Esta semana' in await ap.inner_text('#hr-out .hr-nav'))
        c1 = await ap.evaluate(f"(() => {{ const c = document.querySelector('[data-hr=\"{idP}|{d1}\"]'); return [c.className, c.innerText.replace(/\\n/g, ' ')]; }})()")
        check('el día de 8:30 se ve «8:30*» y marcado como corregido', 'corregido' in c1[0] and '8:30*' in c1[1], c1)
        check('el día sin registro se ve con guion', await ap.evaluate("[...document.querySelectorAll('#hr-out .hrc.sin_registro')].every(c => c.innerText.includes('–'))") and await ap.locator('#hr-out .hrc.sin_registro').count() == 5)
        txt = await ap.inner_text('#hr-out')
        check('dice el promedio por día trabajado (8 h 15 min) y que * es a mano', '8 h 15 min' in txt and 'cargado a mano' in txt, txt)
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horas-semana-pasada.png'), full_page=True)

        # --- detalle de un día
        await ap.click(f'[data-hr="{idP}|{d1}"]'); await ap.wait_for_selector('#hd-corr')
        m = await ap.inner_text('.modal, [role=dialog]') if await ap.locator('.modal, [role=dialog]').count() else await ap.inner_text('body')
        check('el detalle muestra 8 h 30 min, los dos tramos y el motivo', '8 h 30 min' in m and '08:00 a 12:30' in m and '17:00 a 21:00' in m and 'Se le apagó el celular' in m, m)
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horas-detalle.png'), full_page=True)

        # --- corregir
        await ap.click('#hd-corr'); await ap.wait_for_selector('#hc-form')
        check('el cuadro de corrección trae los dos tramos cargados', await ap.input_value('#hc-a0') == '08:00' and await ap.input_value('#hc-b0') == '12:30' and await ap.input_value('#hc-a1') == '17:00' and await ap.input_value('#hc-b1') == '21:00')
        await ap.fill('#hc-b0', '07:00'); await ap.click('#hc-form button[type=submit]'); await ap.wait_for_timeout(400)
        check('un «hasta» antes del «desde» no se guarda y el cuadro queda abierto', await ap.locator('#hc-form').count() == 1 and api('GET', f'/api/jornada/horas?desde={d1}&dias=1', None, TA)[1]['tecnicos'][0]['dias'][0]['min'] == 510)
        await ap.fill('#hc-b0', '12:00'); await ap.fill('#hc-n', 'Volvió antes del almuerzo')
        await ap.click('#hc-form button[type=submit]')
        await ap.wait_for_function("!document.querySelector('#hc-form')", timeout=8000)
        await ap.wait_for_function(f"((document.querySelector('[data-hr=\"{idP}|{d1}\"]')||{{}}).innerText||'').includes('8:00*')", timeout=8000)
        x = api('GET', f'/api/jornada/horas?desde={d1}&dias=1', None, TA)[1]['tecnicos'][0]['dias'][0]
        check('queda guardado: 8:00 (4 h + 4 h), con el motivo y quién lo cambió', x['min'] == 480 and x['ajuste']['nota'] == 'Volvió antes del almuerzo' and x['ajuste']['por'] == 'Mauro', x)
        check('y la tarjeta se actualiza sola (total 16 h)', '16 h' in await ap.inner_text('#hr-out .tcard .hr-tot') and '30' not in await ap.inner_text('#hr-out .tcard .hr-tot'))

        # --- copiar y CSV
        await ap.evaluate("window.__copiado = ''; navigator.clipboard.writeText = t => { window.__copiado = t; return Promise.resolve(); }")
        await ap.click('#hr-copy'); await ap.wait_for_timeout(300)
        copiado = await ap.evaluate("window.__copiado")
        check('«Copiar el resumen» deja Pedro con su total y sus días', 'Pedro: 16 h' in copiado and '16,00 h' in copiado and '(corregido)' in copiado and '8 h' in copiado, copiado)
        async with ap.expect_download(timeout=8000) as dl: await ap.click('#hr-csv')
        d = await dl.value
        csv = open(await d.path(), encoding='utf-8-sig').read()
        check('el CSV baja con un nombre con la fecha y una fila por día más el total', d.suggested_filename.startswith('horas-') and d.suggested_filename.endswith('.csv') and 'Técnico,Fecha' in csv and 'Pedro,TOTAL' in csv and '8:00' in csv and '08:00-12:00 | 17:00-21:00' in csv, (d.suggested_filename, csv))

        # --- volver al cálculo automático (el día lo cargó la oficina: no hay nada automático)
        await ap.click(f'[data-hr="{idP}|{d2}"]'); await ap.wait_for_selector('#hd-corr')
        await ap.click('#hd-corr'); await ap.wait_for_selector('#hc-form')
        check('un día de un solo tramo muestra un solo par de horas', await ap.locator('#hc-a1').count() == 0 and await ap.input_value('#hc-a0') == '08:00' and await ap.input_value('#hc-b0') == '16:00')
        await ap.click('#hc-auto')
        await ap.wait_for_function(f"!!(document.querySelector('[data-hr=\"{idP}|{d2}\"]')||{{classList:{{contains:()=>false}}}}).classList.contains('sin_registro')", timeout=8000)
        check('«Volver al cálculo automático» en un día cargado a mano lo deja sin registro', True)

        # --- esta semana
        await ap.click('[data-hr-nav="0"]')
        await ap.wait_for_function("(document.querySelector('#hr-out .hr-nav')||{innerText:'Esta semana'}).innerText.includes('Esta semana') === false", timeout=8000)
        check('«Esta semana» vuelve a la actual', await ap.is_disabled('[data-hr-nav="7"]'))
        await ap.click('#tu-vista [data-v=pos]')
        check('y «Dónde están» vuelve a la lista de posiciones', await ap.evaluate("!document.querySelector('#tu-pos').hidden && document.querySelector('#hr-wrap').hidden"))

        if vivo:
            await ap.wait_for_function("document.querySelector('#tu-out .tjor') && document.querySelector('#tu-out .tjor').innerText.includes('Horas:')", timeout=8000)
            tj = await ap.inner_text('#tu-out .tjor')
            check('en «Dónde están», la tarjeta de Pedro trae una etiqueta con las horas de hoy', 'Horas:' in tj and 'hasta ahora' in tj, tj)

        # --- el celular del técnico
        tctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await tctx.route('**/fonts.g*/**', lambda r: r.abort())
        tp = await login(tctx, 'pedro', 'pedro11', '#jrBar:not([hidden])' if vivo else '#tabs .tab')
        if vivo:
            await tp.wait_for_function("document.querySelector('#jr-hs')", timeout=8000)
            bar = await tp.inner_text('#jrBar')
            check('la barra del técnico dice cuánto lleva hoy y en la semana', 'Hoy' in bar and 'semana' in bar and 'Mis horas' in bar, bar)
            if os.environ.get('VIS_OUT'): await tp.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horas-tecnico-barra.png'))
            await tp.click('#jr-hs'); await tp.wait_for_selector('.hr-list')
            lista = await tp.inner_text('.hr-list')
            check('«Mis horas» lista sus días de la semana' + (' (hoy y ayer)' if ayerEsta else ' (hoy)'), ('4 h' in lista and 'Corregido' in lista) if ayerEsta else 'En curso' in lista, lista)
            check('y le explica cómo se cuentan y a quién avisar si hay un error', 'avisale a la oficina' in await tp.inner_text('body'))
            if os.environ.get('VIS_OUT'): await tp.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horas-tecnico-modal.png'))
        else:
            print('ok   (salteado: recién pasó la medianoche)')
        # el técnico no ve la pestaña de técnicos ni puede corregir
        check('el técnico no tiene la pestaña Técnicos', await tp.locator('#tabs [data-tab=tecnicos]').count() == 0)
        s, r = api('POST', '/api/jornada/ajuste', {'uid': idP, 'dia': d1, 'segs': [[ms(d1, 8), ms(d1, 20)]]}, TP)
        check('y si lo intenta a mano, el servidor no se lo permite', s in (401, 403), (s, r))
        await br.close()
    check('sin errores en la consola ni de página', not ERR, ERR[:5])
    n = len(res); bad = res.count(False)
    print(f'\n{n - bad}/{n} ok')
    sys.exit(1 if bad else 0)

asyncio.run(main())
