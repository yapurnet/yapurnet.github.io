# Migrar un cliente de antena a fibra óptica (y de fibra a antena, en una mudanza a un lugar sin fibra): el técnico anota la IP de antes y la de ahora,
# el domicilio nuevo si se mudó, el equipo nuevo (modelo y MAC) y qué equipos retira, y queda un historial en la ficha. Chromium real contra el servidor de verdad (workerd).
import asyncio, json, os, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def shard(cid):
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)
ERR = []
async def nuevo(br, w=1000, h=900):
    c = await br.new_context(bypass_csp=True, viewport={'width': w, 'height': h}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
    await c.route('**/fonts.g*/**', lambda r: r.abort())
    return c
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
async def shot(pg, name):
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, name))
def cliente_srv(tok, cid):
    st, j = api('GET', '/api/doc/clientes/' + shard(cid), None, tok)
    return j['data']['items'][cid]
async def toast(pg, txt, t=5000):
    await pg.wait_for_function("t => [...document.querySelectorAll('.toast')].some(x => x.textContent.includes(t))", arg=txt, timeout=t)

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'tec', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'fernando1', 'permisos': {'clientesTodos': True}}, TA)
    base = {'estado': 'activo', 'dir': 'Calle 9 N° 123', 'loc': 'Añatuya', 'tel': '3844123456', 'alta': '2026-01-10', 'desde': time.strftime('%Y-%m')}
    ant = [{'t': 'Antena', 'd': 'CPE Ubiquiti LiteBeam Gen2', 's': '24:A4:3C:01:02:AB', 'n': 1, 'e': 'nuevo', 'o': ''},
           {'t': 'Fuente o adaptador', 'd': 'Inyector de corriente PoE', 's': '', 'n': 1, 'e': 'nuevo', 'o': ''},
           {'t': 'Router Wi-Fi', 'd': 'TP-Link Archer C6', 's': '50:D4:F7:A1:B2:C3', 'n': 1, 'e': 'usado', 'o': 'del cliente'}]
    fib = [{'t': 'ONU', 'd': 'Huawei HG8145V5', 's': '2C:3A:E8:99:88:77', 'n': 1, 'e': 'nuevo', 'o': ''},
           {'t': 'Fuente o adaptador', 'd': 'Fuente de corriente de la ONU', 's': '', 'n': 1, 'e': 'nuevo', 'o': ''},
           {'t': 'Router Wi-Fi', 'd': 'TP-Link Archer C6', 's': '50:D4:F7:11:22:33', 'n': 1, 'e': 'usado', 'o': 'del cliente'}]
    for cid, extra in [('cUno', {'nombre': 'Cejas Rosa', 'codigo': '77', 'tec': 'wireless', 'ip': '10.20.43.9', 'nodo': 'Torre Leo', 'equipo': '24:A4:3C:01:02:AB', 'usuario': 'cejas', 'comodato': ant}),
                       ('cDos', {'nombre': 'Ya Tiene Fibra', 'codigo': '78', 'tec': 'fibra', 'ip': '192.168.100.4'}),
                       ('cTres', {'nombre': 'Sin Tecnología', 'codigo': '79'}),
                       ('cCuatro', {'nombre': 'Se Muda', 'codigo': '80', 'tec': 'fibra', 'ip': '192.168.100.30', 'usuario': 'semuda', 'equipo': '2C:3A:E8:99:88:77', 'lat': -28.4601, 'lng': -62.8301, 'ref': 'Casa celeste', 'comodato': fib})]:
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: dict(base, **extra)}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await nuevo(br, 390, 844)
        pt = await login(ctx, 'tec', 'fernando1')
        await pt.wait_for_function('S.clientes.size === 4', timeout=10000)

        # 1) la ficha de un cliente por antena o sin la tecnología cargada ofrece migrar; la de uno que ya figura en fibra, no
        await pt.evaluate("openClient('cUno')"); await pt.wait_for_selector('.cm-block')
        ft = await pt.inner_text('.sheet')
        check('la ficha del cliente por antena muestra su tecnología y su IP, y el botón «Migrar a fibra óptica»', 'Antena wireless' in ft and '10.20.43.9' in ft and await pt.query_selector('[data-act=migrar]') is not None and await pt.query_selector('[data-act=migrar-ant]') is None, ft[:400])
        await pt.evaluate("closeModal()"); await pt.evaluate("openClient('cDos')")
        await pt.wait_for_selector('.sheet')
        check('uno que ya está en fibra no ofrece migrar a fibra, pero sí pasarlo a antena (si se muda a un lugar sin fibra)', await pt.query_selector('[data-act=migrar]') is None and await pt.query_selector('[data-act=migrar-ant]') is not None)
        await pt.evaluate("closeModal()"); await pt.evaluate("openClient('cTres')")
        await pt.wait_for_selector('.sheet')
        check('uno que todavía no tiene la tecnología cargada ofrece las dos cosas (hoy es la mayoría de los clientes)', await pt.query_selector('[data-act=migrar]') is not None and await pt.query_selector('[data-act=migrar-ant]') is not None)
        await pt.evaluate("closeModal()"); await pt.evaluate("openClient('cUno')"); await pt.wait_for_selector('[data-act=migrar]')

        # 2) el formulario trae lo que ya se sabe
        await pt.click('[data-act=migrar]'); await pt.wait_for_selector('#mgform')
        check('la IP de la antena viene cargada (se puede corregir) y la de la fibra está vacía', await pt.input_value('#mg-ipa') == '10.20.43.9' and await pt.input_value('#mg-ip') == '')
        check('la ONU viene con el modelo de la lista y solo falta la MAC', await pt.input_value('#mg-m') == 'Huawei HG8145V5' and await pt.input_value('#mg-s') == '')
        chk = await pt.evaluate("[...document.querySelectorAll('[data-ret]')].map(i=>i.checked)")
        check('de los equipos que tiene, ya vienen tildados para retirar la antena y el inyector PoE (no el router del cliente)', chk == [True, True, False], chk)
        check('el usuario viene como estaba y el nodo de la antena no se arrastra', await pt.input_value('#mg-usu') == 'cejas' and await pt.input_value('#mg-nodo') == '')
        await shot(pt, 'migrar-form.png')

        # 3) no deja guardar con datos mal
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Falta la IP que va a tener con la fibra')
        await pt.fill('#mg-ip', '192.168.100'); await pt.click('#mgform button[type=submit]'); await toast(pt, 'no es válida')
        check('una IP mal escrita se avisa mientras se escribe', 'no es válida' in await pt.inner_text('#mg-ip-h'))
        await pt.fill('#mg-ip', '192.168.100.4')
        check('una IP que ya tiene otro cliente se avisa (y dice cuál)', 'Ya Tiene Fibra' in await pt.inner_text('#mg-ip-h'), await pt.inner_text('#mg-ip-h'))
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Esa IP ya la tiene Ya Tiene Fibra')
        await pt.fill('#mg-ip', '192.168.100.77')
        check('con una IP libre desaparece el aviso', await pt.inner_text('#mg-ip-h') == '')
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Escribí la MAC de la ONU')
        await pt.fill('#mg-s', '2c:3a:e8:11'); await pt.click('#mgform button[type=submit]'); await toast(pt, 'tiene que tener 12')
        check('nada de esto guardó algo: el cliente sigue por antena', cliente_srv(TA, 'cUno')['tec'] == 'wireless')

        # 4) con todo bien, migra
        await pt.fill('#mg-s', '2c3ae811aabb'); await pt.press('#mg-s', 'Tab')
        check('la MAC queda en mayúsculas y con dos puntos', await pt.input_value('#mg-s') == '2C:3A:E8:11:AA:BB')
        await pt.fill('#mg-usu', 'cejas.fibra'); await pt.fill('#mg-obs', 'se dejó la antena en la torre')
        await pt.click('#mgform button[type=submit]')
        await pt.wait_for_selector('#mgform', state='detached', timeout=8000)
        await pt.wait_for_function("document.querySelector('.cm-block') && document.querySelector('.sheet').innerText.includes('Pasó a fibra')", timeout=8000)
        c = cliente_srv(TA, 'cUno')
        check('el cliente pasa a fibra con la IP, el usuario y la MAC nuevos', c['tec'] == 'fibra' and c['ip'] == '192.168.100.77' and c['usuario'] == 'cejas.fibra' and c['equipo'] == '2C:3A:E8:11:AA:BB' and not c.get('nodo'), c)
        eq = [(e['t'], e['d'], e['s']) for e in c['comodato']]
        check('en comodato se retira la antena y el inyector, queda el router del cliente y entran la ONU (con su MAC) y su fuente', eq == [('Router Wi-Fi', 'TP-Link Archer C6', '50:D4:F7:A1:B2:C3'), ('ONU', 'Huawei HG8145V5', '2C:3A:E8:11:AA:BB'), ('Fuente o adaptador', 'Fuente de corriente de la ONU', '')], eq)
        m = c['migraciones'][0]
        check('queda el historial: fecha, quién, IP de antes y de ahora, el nodo y la antena que se retiró', m['f'] == time.strftime('%Y-%m-%d') and m['por'] == 'Fernando Paz' and m['de'] == 'wireless' and m['a'] == 'fibra' and m['ipAnt'] == '10.20.43.9' and m['ip'] == '192.168.100.77' and m['nodoAnt'] == 'Torre Leo' and m['ret'][0]['s'] == '24:A4:3C:01:02:AB' and m['obs'] == 'se dejó la antena en la torre', m)
        ft = await pt.inner_text('.sheet')
        check('la ficha lo muestra: «Pasó a fibra óptica», las dos IP y lo que se retiró; ya no ofrece migrar', 'Pasó a fibra óptica el' in ft and 'IP 10.20.43.9' in ft and 'IP 192.168.100.77' in ft and 'LiteBeam' in ft and 'Fernando Paz' in ft and await pt.query_selector('[data-act=migrar]') is None, ft[:700])
        check('la ficha muestra ahora la ONU y la fuente en comodato', 'Huawei HG8145V5' in ft and '2C:3A:E8:11:AA:BB' in ft)
        await shot(pt, 'migrar-ficha.png')

        # 4b) un cliente sin la tecnología cargada también se puede migrar (queda anotado que venía de antena)
        await pt.evaluate("closeModal()"); await pt.evaluate("openClient('cTres')"); await pt.wait_for_selector('[data-act=migrar]')
        await pt.click('[data-act=migrar]'); await pt.wait_for_selector('#mgform')
        check('sin IP ni equipos cargados, el formulario viene vacío y la ONU con su modelo', await pt.input_value('#mg-ipa') == '' and await pt.input_value('#mg-ip') == '' and await pt.input_value('#mg-m') == 'Huawei HG8145V5' and await pt.query_selector('[data-ret]') is None)
        await pt.fill('#mg-ip', '192.168.100.90'); await pt.fill('#mg-s', 'hwtc1a2b3c4d')
        await pt.click('#mgform button[type=submit]'); await pt.wait_for_selector('#mgform', state='detached', timeout=8000)
        await pt.wait_for_function("document.querySelector('.sheet').innerText.includes('Pasó a fibra')", timeout=8000)
        c3 = cliente_srv(TA, 'cTres')
        check('pasa a fibra; el historial dice que venía de antena y la MAC/serie queda como se escribió (en mayúsculas)', c3['tec'] == 'fibra' and c3['ip'] == '192.168.100.90' and c3['migraciones'][0]['de'] == 'wireless' and 'ipAnt' not in c3['migraciones'][0] and c3['equipo'] == 'HWTC1A2B3C4D' and [e['t'] for e in c3['comodato']] == ['ONU', 'Fuente o adaptador'], c3)

        # 4c) un cliente de fibra que se muda a un lugar sin fibra: pasa a antena, con el domicilio y la ubicación nuevos
        await pt.evaluate("closeModal()"); await pt.evaluate("openClient('cCuatro')"); await pt.wait_for_selector('[data-act=migrar-ant]')
        check('el cliente de fibra ofrece «Pasar a antena (mudanza)» y no «Migrar a fibra»', await pt.query_selector('[data-act=migrar]') is None and 'Pasar a antena' in await pt.inner_text('[data-act=migrar-ant]'))
        await pt.click('[data-act=migrar-ant]'); await pt.wait_for_selector('#mgform')
        lbl = await pt.inner_text('#mgform')
        check('el formulario habla de la fibra de hoy y la antena de ahora; la IP de hoy viene cargada y la nueva vacía', 'IP de la fibra (hoy)' in lbl and 'IP que va a tener con la antena' in lbl and await pt.input_value('#mg-ipa') == '192.168.100.30' and await pt.input_value('#mg-ip') == '', lbl[:300])
        check('el domicilio nuevo está escondido hasta tildar «Se mudó» y no hay caja NAP (la antena no sale de una)', await pt.is_hidden('#mg-mudw') and await pt.query_selector('#cf-nap') is None)
        check('la antena viene con el modelo de la lista y ya vienen tildados para retirar la ONU y su fuente (no el router del cliente)', await pt.input_value('#mg-m') == 'CPE Ubiquiti LiteBeam Gen2' and [await i.is_checked() for i in await pt.query_selector_all('[data-ret]')] == [True, True, False])
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Falta la IP que va a tener con la antena')
        await pt.fill('#mg-ip', '10.20.43.77'); await pt.check('#mg-mud')
        check('al tildar «Se mudó» aparecen el domicilio, la referencia y la ubicación (vacía, no la de la casa vieja)', await pt.is_visible('#mg-dir') and await pt.input_value('#mg-dir') == '' and await pt.input_value('#cf-geo') == '' and await pt.input_value('#mg-loc') == 'Añatuya')
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Falta la calle y el número del domicilio nuevo')
        await pt.fill('#mg-dir', 'Calle 12 N° 450'); await pt.fill('#mg-loc', 'Colonia Dora'); await pt.fill('#mg-ref', 'Portón verde'); await pt.fill('#cf-geo', '-28.5001, -62.9002')
        await shot(pt, 'mudanza-form.png')
        await pt.click('#mgform button[type=submit]'); await toast(pt, 'Escribí la MAC de la antena')
        check('nada de esto guardó algo: el cliente sigue en fibra', cliente_srv(TA, 'cCuatro')['tec'] == 'fibra')
        await pt.fill('#mg-s', '24a43c0a0b0c'); await pt.fill('#mg-obs', 'la fibra no llega a la casa nueva')
        await pt.click('#mgform button[type=submit]'); await pt.wait_for_selector('#mgform', state='detached', timeout=8000)
        await pt.wait_for_function("document.querySelector('.sheet').innerText.includes('Se mudó y pasó')", timeout=8000)
        c4 = cliente_srv(TA, 'cCuatro')
        check('pasa a antena con la IP nueva y el domicilio, la referencia y la ubicación nuevos', c4['tec'] == 'wireless' and c4['ip'] == '10.20.43.77' and c4['dir'] == 'Calle 12 N° 450' and c4['loc'] == 'Colonia Dora' and c4['ref'] == 'Portón verde' and abs(c4['lat'] + 28.5001) < 1e-6 and abs(c4['lng'] + 62.9002) < 1e-6 and c4['equipo'] == '24:A4:3C:0A:0B:0C' and not c4.get('nap'), c4)
        check('en comodato se retira la ONU y su fuente, queda el router del cliente y entran la antena (con su MAC) y su inyector', [(e['t'], e['d'], e['s']) for e in c4['comodato']] == [('Router Wi-Fi', 'TP-Link Archer C6', '50:D4:F7:11:22:33'), ('Antena', 'CPE Ubiquiti LiteBeam Gen2', '24:A4:3C:0A:0B:0C'), ('Fuente o adaptador', 'Inyector de corriente PoE', '')], c4['comodato'])
        m4 = c4['migraciones'][0]
        check('el historial dice de qué a qué pasó, las dos IP, el domicilio de antes y de ahora y lo que se retiró', m4['de'] == 'fibra' and m4['a'] == 'wireless' and m4['ipAnt'] == '192.168.100.30' and m4['ip'] == '10.20.43.77' and m4['domAnt'] == 'Calle 9 N° 123, Añatuya' and m4['dom'] == 'Calle 12 N° 450, Colonia Dora' and m4['por'] == 'Fernando Paz' and [e['t'] for e in m4['ret']] == ['ONU', 'Fuente o adaptador'] and m4['obs'] == 'la fibra no llega a la casa nueva', m4)
        f4 = await pt.inner_text('.sheet')
        check('la ficha muestra la mudanza y ya no ofrece pasar a antena (sí volver a fibra)', 'Se mudó y pasó a antena wireless el' in f4 and 'Calle 9 N° 123, Añatuya' in f4 and 'Calle 12 N° 450, Colonia Dora' in f4 and await pt.query_selector('[data-act=migrar-ant]') is None and await pt.query_selector('[data-act=migrar]') is not None, f4[:800])
        await shot(pt, 'mudanza-ficha.png')
        await ctx.close()

        # 5) un técnico sin permiso de datos técnicos no ve el botón
        api('POST', '/api/users', {'usuario': 'tec2', 'nombre': 'Marcos', 'role': 'tecnico', 'clave': 'marcos123', 'permisos': {'clientesTodos': True, 'ubicacion': False}}, TA)
        api('PATCH', '/api/doc/clientes/' + shard('cDos'), {'data': {'items': {'cDos': dict(base, nombre='Ya Tiene Fibra', codigo='78', tec='wireless', ip='10.20.43.50')}}}, TA)
        ctx2 = await nuevo(br, 390, 844)
        p2 = await login(ctx2, 'tec2', 'marcos123')
        await p2.wait_for_function('S.clientes.size === 4', timeout=10000)
        await p2.evaluate("openClient('cDos')"); await p2.wait_for_selector('.sheet')
        check('sin el permiso de ubicación y datos técnicos no se ofrece migrar ni pasar a antena', await p2.query_selector('[data-act=migrar]') is None and await p2.query_selector('[data-act=migrar-ant]') is None and await p2.query_selector('.mg-block') is None)
        await ctx2.close()
        await br.close()
    check('sin errores de consola', not ERR, ERR[:3])
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
