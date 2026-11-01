# Jornada laboral: el ingreso se anota solo cuando el celular del técnico aparece en la base, el fin cuando vuelve, y la oficina lo ve en «Técnicos».
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
def ar_hora(ms): return int(time.strftime('%H', time.gmtime(ms / 1000 - 3 * 3600)))

BASEPOS = (-28.4601, -62.8302)
LEJOS = (-28.6, -62.9)

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    for u, n, tel in (('pedro', 'Pedro', '3844111111'), ('juan', 'Juan', ''), ('luis', 'Luis', '3844222222')):
        api('POST', '/api/users', {'usuario': u, 'nombre': n, 'role': 'tecnico', 'clave': u + '11', 'tel': tel}, TA)
    now_ms = int(time.time() * 1000); desde = max(0, ar_hora(now_ms) - 2)
    api('POST', '/api/ubicacion/horario', {'desde': desde, 'hasta': 24}, TA)
    st, j = api('POST', '/api/jornada/base', {'lat': BASEPOS[0], 'lng': BASEPOS[1], 'radio': 40, 'tol': 10, 'dias': [0, 1, 2, 3, 4, 5, 6]}, TA)
    check('el administrador carga la base', st == 200 and j['base']['lat'] == BASEPOS[0], (st, j))
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        def ctx_con(lat, lng, acc=8):
            return br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': lat, 'longitude': lng, 'accuracy': acc}, permissions=['geolocation'])
        # --- Pedro llega a la base con la app abierta
        pctx = await ctx_con(*BASEPOS); await pctx.route('**/fonts.g*/**', lambda r: r.abort())
        pp = await login(pctx, 'pedro', 'pedro11')
        await pp.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000)
        await pp.click('[role=dialog] [data-act=si]')
        await pp.wait_for_selector('#jrBar:not([hidden])', timeout=8000)
        barra = await pp.inner_text('#jrBar')
        check('el técnico ve el aviso de jornada en la barra (no en un cartel que bloquea)', 'Desde ahora se anota tu jornada' in barra and 'Entendido' in barra and await pp.evaluate("!document.querySelector('[role=dialog]')"), barra)
        for _ in range(40):
            st, jj = api('GET', '/api/jornada', None, api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro11'})[1]['token'])
            if jj['fila']: break
            await asyncio.sleep(0.25)
        check('sin tocar nada, el servidor anota el ingreso con la posición del celular en la base', jj['fila'] and jj['fila']['origen'] == 'base' and jj['fila']['dist'] <= 5 and jj['enterado'] is False, jj)
        await pp.click('#jr-info')
        await pp.wait_for_selector('[role=dialog]')
        txt = await pp.inner_text('[role=dialog]')
        check('«Más info» explica el ingreso y el fin', 'Ingreso' in txt and 'volvés a la base' in txt, txt[:300])
        await pp.click('#jr-ok2')
        await pp.wait_for_function("document.querySelector('#jrBar').innerText.includes('Tu jornada laboral comenzó a las')", timeout=8000)
        barra = await pp.inner_text('#jrBar')
        check('al tocar «Entendido» la barra dice a qué hora comenzó la jornada, en la base', 'Tu jornada laboral comenzó a las' in barra and 'en la base' in barra and 'Entendido' not in barra, barra)
        if os.environ.get('VIS_OUT'): await pp.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'jornada-tecnico.png'))
        # cuando vuelve a la base, la barra dice que terminó (se simula el dato del servidor)
        fin = await pp.evaluate("""(()=>{const f=JR.st.fila;JR.st=Object.assign({},JR.st,{fila:Object.assign({},f,{regreso:f.ingreso+9*3600e3+18*60e3,enBase:true})});jornadaBarra();return document.querySelector('#jrBar').innerText;})()""")
        check('al volver a la base la barra dice cuándo terminó y cuánto duró', 'terminó a las' in fin and '9 h 18 min' in fin, fin)
        await pctx.close()   # que la página no mande más posiciones: lo que sigue se simula con el servidor
        # --- Juan empieza lejos de la base: la jornada la inicia a mano
        jctx = await ctx_con(*LEJOS); await jctx.route('**/fonts.g*/**', lambda r: r.abort())
        jp = await login(jctx, 'juan', 'juan11')
        await jp.wait_for_selector('[role=dialog] [data-act=si]', timeout=8000)
        await jp.click('[role=dialog] [data-act=si]')
        await jp.wait_for_selector('#jr-ok', timeout=8000)
        await jp.click('#jr-ok')
        await jp.wait_for_selector('#jr-ini', timeout=8000)
        barra = await jp.inner_text('#jrBar')
        check('lejos de la base: «Todavía no empezó tu jornada» con el botón para iniciarla', 'Todavía no empezó tu jornada' in barra and 'Iniciar jornada' in barra, barra)
        await jp.click('#jr-ini')
        await jp.wait_for_timeout(400); await jctx.set_geolocation({'latitude': LEJOS[0], 'longitude': LEJOS[1], 'accuracy': 8})   # el GPS simulado entrega la posición a quien la pide
        await jp.wait_for_function("document.querySelector('#jrBar').innerText.includes('Tu jornada laboral comenzó a las')", timeout=15000)
        barra = await jp.inner_text('#jrBar')
        st, jf = api('GET', '/api/jornada', None, api('POST', '/api/login', {'usuario': 'juan', 'clave': 'juan11'})[1]['token'])
        check('iniciada a mano: figura «manual», con la distancia a la base, y la barra no dice «en la base»', jf['fila']['origen'] == 'manual' and (jf['fila']['dist'] or 0) > 1000 and 'en la base' not in barra, (jf, barra))
        await jctx.close()
        # --- Pedro termina el día: sale y vuelve a la base (lo simula el servidor, con puntos en orden)
        TP = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro11'})[1]['token']
        t0 = int(time.time() * 1000)
        api('POST', '/api/ubicacion', {'pts': [{'lat': LEJOS[0], 'lng': LEJOS[1], 'acc': 8, 'ts': t0 + 25000}]}, TP)
        api('POST', '/api/ubicacion', {'pts': [{'lat': BASEPOS[0], 'lng': BASEPOS[1], 'acc': 8, 'ts': t0 + 55000}]}, TP)
        st, jj = api('GET', '/api/jornada', None, TP)
        check('al volver a la base queda el regreso (el fin del día)', jj['fila']['regreso'] and jj['fila']['enBase'] is True, jj['fila'])
        # --- la oficina mira
        actx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': BASEPOS[0] + 0.0002, 'longitude': BASEPOS[1], 'accuracy': 5}, permissions=['geolocation'])
        await actx.route('**/fonts.g*/**', lambda r: r.abort())
        ap = await login(actx, 'mauro', 'claveSegura1')
        check('el administrador no ve la barra de jornada (no es técnico)', await ap.evaluate("document.querySelector('#jrBar').hidden"))
        await ap.click('#tabs [data-tab=tecnicos]')
        await ap.wait_for_function("document.querySelectorAll('.tcard').length === 3", timeout=8000)
        cards = await ap.evaluate("[...document.querySelectorAll('.tcard')].map(c=>c.innerText)")
        pe = next(c for c in cards if 'Pedro' in c); ju = next(c for c in cards if 'Juan' in c); lu = next(c for c in cards if 'Luis' in c)
        check('Pedro: ingresó, terminó y cuánto duró; ingresó en la base', 'Ingresó ' in pe and 'Terminó ' in pe and 'jornada de' in pe and 'Ingresó en la base' in pe, pe)
        check('Juan: ingresó a mano y a cuántos metros de la base', 'Ingresó ' in ju and 'Inició a mano' in ju and 'de la base' in ju and 'Terminó' not in ju, ju)
        check('Luis, que no apareció: «Sin ingreso»', 'Sin ingreso' in lu, lu)
        check('el técnico sin ingreso sube al principio de la lista', cards[0].startswith('Luis'), cards[0][:40])
        cartel = await ap.inner_text('#tu-ingreso')
        check('arriba, el cartel de quiénes no ingresaron hoy', 'Sin ingreso hoy' in cartel and 'Luis' in cartel and 'Pedro' not in cartel and 'Juan' not in cartel, cartel)
        base = await ap.inner_text('#tu-base')
        check('se explica la jornada: hora esperada, tolerancia, días y que la base está cargada', f'a las {desde}:00' in base and '10 min' in base and 'Lun' in base and 'Base cargada' in base, base)
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'jornada-oficina.png'))
        # --- cargar la base con el GPS del celular de quien administra
        await ap.click('#tu-bs')
        await ap.wait_for_selector('#jb-form')
        check('el cuadro muestra la base actual', BASEPOS[0].__str__()[:8] in await ap.input_value('#jb-geo'), await ap.input_value('#jb-geo'))
        await ap.fill('#jb-geo', '')
        check('sin tocar nada, el radio que se ofrece es el de la base (40 m)', await ap.input_value('#jb-radio') == '40')
        # el GPS simulado entrega la posición que tenga puesta al empezar a mirar: se pone primero una que no estorbe y se espera a que llegue
        async def lecturas():
            return await ap.evaluate("+((document.querySelector('#jb-st').innerText.match(/Lecturas: (\\d+)/) || [0, 0])[1])")
        async def poner(d, a):
            n0 = await lecturas()
            await actx.set_geolocation({'latitude': BASEPOS[0] + d, 'longitude': BASEPOS[1], 'accuracy': a})
            await ap.wait_for_function("n0 => +((document.querySelector('#jb-st').innerText.match(/Lecturas: (\\d+)/) || [0, 0])[1]) > n0", arg=n0, timeout=8000)
        # 1) una toma imprecisa (±60 m): se completa pero avisa que no sirve para una base chica
        await actx.set_geolocation({'latitude': BASEPOS[0] + 0.0004, 'longitude': BASEPOS[1], 'accuracy': 60})
        await ap.click('#jb-gps')
        await ap.wait_for_timeout(800)
        await poner(0.00041, 60)
        await ap.click('#jb-gps')   # tocar de nuevo termina con lo que haya
        await ap.wait_for_function("/Promedio de \\d lecturas? \\(±60 m\\)/.test(document.querySelector('#jb-st').innerText)", timeout=8000)
        check('una toma de ±60 m se avisa como poco precisa', 'poco precisa' in await ap.inner_text('#jb-st') and 'bad' in (await ap.get_attribute('#jb-st', 'class')))
        # 2) una toma buena: varias lecturas, se promedian y queda la precisión informada. Una lectura mala (±200 m) se descarta.
        await ap.fill('#jb-geo', '')
        await actx.set_geolocation({'latitude': BASEPOS[0] + 0.0009, 'longitude': BASEPOS[1], 'accuracy': 200})
        await ap.click('#jb-gps')
        await ap.wait_for_timeout(800)
        pts = [(0.00020, 6), (0.00022, 5), (0.00018, 8)]
        for d, a in pts:
            await poner(d, a)
        check('mientras toma lecturas muestra cuántas lleva y la mejor precisión', '±5 m' in await ap.inner_text('#jb-st'), await ap.inner_text('#jb-st'))
        await ap.click('#jb-gps')
        await ap.wait_for_function("document.querySelector('#jb-st').innerText.includes('Promedio de 3 lecturas')", timeout=8000)
        geo = await ap.input_value('#jb-geo')
        lat, lng = [float(x) for x in geo.split(',')]
        w = [1 / (max(a, 3) ** 2) for _, a in pts]
        esperado = BASEPOS[0] + sum(d * k for (d, _), k in zip(pts, w)) / sum(w)
        check('la base queda en el promedio de las lecturas, con más peso a las más precisas', abs(lat - esperado) < 2e-6 and abs(lng - BASEPOS[1]) < 1e-6, (geo, esperado))
        check('con ±5 m se da por buena', 'ok' in (await ap.get_attribute('#jb-st', 'class')) and 'Guardá' in await ap.inner_text('#jb-st'), await ap.inner_text('#jb-st'))
        await ap.fill('#jb-radio', '5')
        await ap.click('#jb-form button[type=submit]')
        await ap.wait_for_timeout(500)
        check('un radio de 5 m no se guarda y el cuadro sigue abierto', await ap.evaluate("!!document.querySelector('#jb-form')") and api('GET', '/api/ubicaciones', None, TA)[1]['jornada']['radio'] == 40)
        await ap.fill('#jb-radio', '200')
        await ap.click('[data-dia="0"]')   # el domingo se desmarca
        await ap.click('#jb-form button[type=submit]')
        await ap.wait_for_function("document.querySelector('#tu-base').innerText.includes('radio 200 m')", timeout=8000)
        cfg = api('GET', '/api/ubicaciones', None, TA)[1]['jornada']
        check('la base nueva, el radio y los días quedan guardados', abs(cfg['base']['lat'] - lat) < 1e-5 and cfg['radio'] == 200 and 0 not in cfg['dias'] and len(cfg['dias']) == 6, cfg)
        await ap.click('#tu-bs')
        await ap.wait_for_selector('#jb-quitar')
        await ap.click('#jb-quitar')
        await ap.wait_for_function("document.querySelector('#tu-base').innerText.includes('Todavía sin base')", timeout=8000)
        check('«Quitar la base» deja todo sin base', api('GET', '/api/ubicaciones', None, TA)[1]['jornada']['base'] is None)
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
