# Horario de corrido o cortado (con siesta): el cuadro de la oficina, el botón «Hoy», cómo se ve en la lista de técnicos y cómo decide la app del técnico.
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

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro11'}, TA)
    TP = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro11'})[1]['token']
    api('POST', '/api/ubicacion/acepto', {}, TP)
    ahora = time.gmtime(time.time() - 3 * 3600); hoy = time.strftime('%Y-%m-%d', ahora); h0 = ahora.tm_hour; min0 = ahora.tm_min
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        actx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await actx.route('**/fonts.g*/**', lambda r: r.abort())
        ap = await login(actx, 'mauro', 'claveSegura1')
        await ap.click('#tabs [data-tab=tecnicos]')
        await ap.wait_for_function("document.querySelectorAll('.tcard').length === 1", timeout=8000)
        txt = await ap.inner_text('#tu-horario')
        check('por defecto el día es de corrido y el texto lo dice', 'de corrido' in txt and 'de 8 a 20 h' in txt, txt)

        # --- el cuadro de horario
        await ap.click('#tu-hz'); await ap.wait_for_selector('#hz-form')
        check('sin horario cortado cargado, el cuadro de la siesta está escondido', await ap.evaluate("document.querySelector('#hz-cbox').hidden") and not await ap.is_checked('#hz-c'))
        await ap.click('#hz-c')
        check('al tildar «También hay días con horario cortado» aparecen mañana, tarde y los días', not await ap.evaluate("document.querySelector('#hz-cbox').hidden") and await ap.input_value('#hz-m0') == '8' and await ap.input_value('#hz-m1') == '13' and await ap.input_value('#hz-t0') == '17' and await ap.input_value('#hz-t1') == '22')
        if os.environ.get('VIS_OUT'): await ap.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'horario-cortado.png'), full_page=True)
        # validaciones
        await ap.fill('#hz-m1', '18'); await ap.click('#hz-form button[type=submit]'); await ap.wait_for_timeout(500)
        check('una mañana que termina después de que empieza la tarde no se guarda y el cuadro sigue abierto', await ap.evaluate("!!document.querySelector('#hz-form')") and api('GET', '/api/ubicaciones', None, TA)[1]['plan']['cortado'] is None)
        await ap.fill('#hz-m1', '13')
        for d in (1, 2, 3, 4, 5, 6): await ap.click(f'[data-dc="{d}"]')
        check('el domingo queda sin tildar', not await ap.is_checked('[data-dc="0"]'))
        # un día puntual
        await ap.select_option('#hz-fm', 'cortado'); await ap.click('#hz-fa')
        lista = await ap.inner_text('#hz-fl')
        check('el día puntual agregado aparece en la lista', hoy.split('-')[2] in lista and 'cortado' in lista, lista)
        await ap.click('#hz-form button[type=submit]')
        await ap.wait_for_function("document.querySelector('#tu-horario').innerText.includes('cortado')", timeout=8000)
        plan = api('GET', '/api/ubicaciones', None, TA)[1]['plan']
        check('queda guardado: mañana, tarde, los días y el día puntual', plan['cortado'] == {'m': [8, 13], 't': [17, 22]} and all(plan['dias'][str(d)] == 'cortado' for d in range(1, 7)) and plan['dias']['0'] == 'corrido' and plan['fechas'].get(hoy) == 'cortado', plan)
        txt = await ap.inner_text('#tu-horario')
        check('el texto dice que hoy es cortado y las dos franjas', 'cortado' in txt and 'de 8 a 13 y de 17 a 22 h' in txt, txt)
        jb = await ap.inner_text('#tu-base')
        check('y que se espera el ingreso a las 8 y la retoma a las 17', 'ingreso a las 8:00 y la retoma a las 17:00' in jb, jb)

        # --- el botón «Hoy»
        await ap.click('#tu-hoy')
        await ap.wait_for_function("document.querySelector('#tu-horario').innerText.includes('de corrido')", timeout=8000)
        check('«Hoy: cortado / de corrido» pasa solo hoy a de corrido y deja el resto', api('GET', '/api/ubicaciones', None, TA)[1]['plan']['fechas'].get(hoy) == 'corrido' and api('GET', '/api/ubicaciones', None, TA)[1]['plan']['cortado'] is not None)
        await ap.click('#tu-hoy')
        await ap.wait_for_function("document.querySelector('#tu-horario').innerText.includes('cortado')", timeout=8000)
        check('y vuelve a cortado con otro toque', api('GET', '/api/ubicaciones', None, TA)[1]['plan']['fechas'].get(hoy) == 'cortado')
        # quitar el día puntual desde el cuadro
        await ap.click('#tu-hz'); await ap.wait_for_selector('#hz-form')
        check('el cuadro muestra lo ya cargado', await ap.is_checked('#hz-c') and await ap.is_checked('[data-dc="2"]') and not await ap.is_checked('[data-dc="0"]'))
        await ap.click('[data-qf]'); await ap.click('#hz-form button[type=submit]')
        await ap.wait_for_function("!document.querySelector('#hz-form')", timeout=8000)
        await ap.wait_for_timeout(300)
        check('«Quitar» saca el día puntual', hoy not in api('GET', '/api/ubicaciones', None, TA)[1]['plan']['fechas'])

        # --- cómo se ve cada técnico en un día cortado (datos armados a mano)
        out = await ap.evaluate("""(()=>{
          const d={dia:'2026-10-28',hoy:'2026-10-28'};const H=3600e3,t0=Date.parse('2026-10-28T00:00:00-03:00');
          const base={enterado:true,origen:'base',dist:3,enBase:true,cortado:true,tarde:false,atrasoMin:2,sinRetomar:false,ingreso:t0+8.03*H,regreso:null,ingreso2:null,tarde2:false,atraso2Min:0};
          const J=(o)=>jornadaTec({jornada:Object.assign({},base,o)},d);
          return {
            siesta:J({estado:'siesta',regreso:t0+13.08*H}),
            retomo:J({estado:'trabajando',regreso:t0+13.08*H,ingreso2:t0+17.05*H}),
            tarde:J({estado:'trabajando',ingreso2:t0+17.42*H,tarde2:true,atraso2Min:25}),
            sin:J({estado:'trabajando',sinRetomar:true,regreso:t0+13.08*H}),
            fin:J({estado:'termino',regreso:t0+21.84*H,ingreso2:t0+17.05*H}),
            corrido:J({estado:'termino',cortado:false,regreso:t0+19.9*H})
          };})()""")
        check('en la siesta: «En siesta» y a qué hora volvió a la base', 'En siesta' in out['siesta'] and 'volvió a la base' in out['siesta'] and 'Terminó' not in out['siesta'], out['siesta'])
        check('retomó a las 17:03: chip «Retomó»', 'Retomó 17:03' in out['retomo'] and 'tarde' not in out['retomo'].split('Retomó')[1], out['retomo'])
        check('retomó a las 17:25: «25 min tarde»', 'Retomó 17:25 · 25 min tarde' in out['tarde'], out['tarde'])
        check('sin retomar: chip rojo «No retomó a la tarde»', 'No retomó a la tarde' in out['sin'], out['sin'])
        check('el fin del día de un día cortado no suma la siesta: «Terminó 21:50» sin «jornada de»', 'Terminó 21:50' in out['fin'] and 'jornada de' not in out['fin'], out['fin'])
        check('de corrido sigue diciendo cuánto duró la jornada', 'jornada de 11 h 52 min' in out['corrido'], out['corrido'])
        await actx.close()

        # --- la app del técnico: dentro/fuera de horario con uno o dos tramos, y qué hace con el servicio de Android
        if h0 < 2 or h0 > 21 or min0 < 2 or min0 > 57:
            print('(salteado: con esta hora del día las pruebas de «dentro y fuera de horario» caerían cerca de un cambio de hora)')
        else:
            tctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 8}, permissions=['geolocation'])
            await tctx.route('**/fonts.g*/**', lambda r: r.abort())
            # hoy cortado con la siesta AHORA: el aviso lo dice con los dos tramos
            api('POST', '/api/ubicacion/plan', {'desde': 0, 'hasta': 24, 'cortado': {'m': [0, h0], 't': [h0 + 1, 24]}, 'dias': {str(d): 'corrido' for d in range(7)}, 'fechas': {hoy: 'cortado'}}, TA)
            tp = await login(tctx, 'pedro', 'pedro11')
            await tp.wait_for_function("UB.st && UB.st.tramos", timeout=8000)
            check('la app del técnico recibe los dos tramos de hoy', await tp.evaluate("UB.st.tramos.length") == 2)
            check('en la siesta figura fuera de horario', await tp.evaluate("ubDentro()") is False)
            chip = await tp.inner_text('#ubChip')
            check('el chip dice «fuera de horario»', 'fuera de horario' in chip.lower(), chip)
            titulo = await tp.get_attribute('#ubChip', 'title')
            check('y su detalle muestra las dos franjas', f'de 0 a {h0} y de {h0 + 1} a 24 h' in (titulo or ''), titulo)
            r = await tp.evaluate("""(h0)=>{
              const out={};
              UB.st=Object.assign({},UB.st,{tramos:[[0,h0+1],[h0+2,24]]});out.manana=ubDentro();
              UB.st=Object.assign({},UB.st,{tramos:[[0,1],[2,h0+1]]});out.tarde=ubDentro();
              UB.st=Object.assign({},UB.st,{tramos:[[0,h0],[h0+1,24]]});out.siesta=ubDentro();
              delete UB.st.tramos;UB.st.desde=0;UB.st.hasta=24;out.viejo=ubDentro();
              return out;}""", h0)
            check('dentro en el tramo de la mañana, dentro en el de la tarde, fuera en la siesta', r['manana'] is True and r['tarde'] is True and r['siesta'] is False, r)
            check('con datos del formato viejo (solo desde/hasta) sigue andando', r['viejo'] is True)
            # el servicio de Android: se arranca con los tramos, y en la siesta no se detiene si la versión nueva lo pausa sola
            r = await tp.evaluate("""async (h0)=>{
              const calls=[];const nueva={startLocation:(tk,a,b)=>{calls.push(['v',a,b]);return 'ok';},startLocationTramos:(tk,s)=>{calls.push(['t',s]);return 'ok';},stopLocation:()=>{calls.push(['stop']);}};
              const vieja={startLocation:(tk,a,b)=>{calls.push(['v',a,b]);return 'ok';},stopLocation:()=>{calls.push(['stop']);}};
              UB.denied=false;UB.nat=false;UB.st=Object.assign({},UB.st,{acepto:true,aplica:true,tramos:[[0,1],[2,h0+1]]});
              window.YapurApp=nueva;ubicLoop();const enTarde=calls.slice();calls.length=0;
              UB.st=Object.assign({},UB.st,{tramos:[[0,h0],[h0+1,24]]});UB.nat=true;ubicLoop();const siestaNueva=calls.slice();calls.length=0;
              window.YapurApp=vieja;UB.nat=true;ubicLoop();const siestaVieja=calls.slice();calls.length=0;
              UB.st=Object.assign({},UB.st,{tramos:[[0,1],[2,h0]]});UB.nat=true;window.YapurApp=nueva;ubicLoop();const despues=calls.slice();
              UB.st=Object.assign({},UB.st,{tramos:[[0,24]]});window.YapurApp=vieja;calls.length=0;ubicLoop();const corridoViejo=calls.slice();
              return {enTarde,siestaNueva,siestaVieja,despues,corridoViejo};}""", h0)
            check('en el tramo de la tarde arranca el servicio de Android con los dos tramos', r['enTarde'] == [['t', f'0-1,2-{h0 + 1}']], r['enTarde'])
            check('en la siesta con la app nueva NO lo detiene (se pausa solo)', r['siestaNueva'] == [], r['siestaNueva'])
            check('en la siesta con la app vieja sí lo detiene', r['siestaVieja'] == [['stop']], r['siestaVieja'])
            check('después del último tramo del día lo detiene', r['despues'] == [['stop']], r['despues'])
            check('con la app vieja, de corrido: arranca con desde y hasta como siempre', r['corridoViejo'] == [['v', 0, 24]], r['corridoViejo'])
            # el horario nuevo se levanta solo sin cerrar la app
            api('POST', '/api/ubicacion/plan', {'desde': 0, 'hasta': 24, 'cortado': None, 'dias': {str(d): 'corrido' for d in range(7)}, 'fechas': {}}, TA)
            r = await tp.evaluate("async ()=>{UB.stTs=0;await ubicRefrescar();return UB.st.tramos;}")
            check('si la oficina cambia el horario, la app lo toma sola (sin tener que cerrarla)', r == [[0, 24]], r)
            await tctx.close()
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
