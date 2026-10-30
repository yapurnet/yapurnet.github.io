# Importar la lista de clientes del Excel (velocidad, precio y «cobrar desde» por cliente, completar los que ya existen)
# y el recibo con el formato del recibo en papel. Chromium real contra el servidor de verdad (workerd).
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
def shard(cid):   # igual que clientShard() de la app
    h = 2166136261
    for ch in cid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return 'c%02d' % (h % 16)

def addm(ym, n):
    y, m = map(int, ym.split('-')); m += n; y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return '%04d-%02d' % (y, m)

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

CSV = ('nombre;dni;telefono;velocidad;nodo;estado;ciclo;precio especial;cobrar desde;notas\r\n'
       'Ana Pérez;30111222;;5;PON_1;activo;1;17000;2026-11;sin novedad\r\n'
       'Beto Díaz;;3844111222;3.5;PON_1;activo;2;28000;2026-10;con tv\r\n'
       'Carla Ruiz;;;40;PON_2;activo;2;18000;2026-10;\r\n'
       'Esteban Luna;;;;;activo;1;;2026-10;sin velocidad\r\n'
       'Dora Gómez;;;;;activo;1;;2026-10;\r\n')

async def main():
    cur = time.strftime('%Y-%m'); hoy = time.strftime('%Y-%m-%d')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    api('PUT', '/api/doc/planes/p5', {'data': {'nombre': 'Plan_5', 'precio': 17000, 'bajada': 5, 'subida': 5}}, TA)
    api('PUT', '/api/doc/planes/p35', {'data': {'nombre': 'Plan_3.5', 'precio': 17000, 'bajada': 3.5, 'subida': 3.5}}, TA)
    # un cliente que ya estaba cargado (por ejemplo, desde el router): el mismo nombre pero en otro orden
    api('PATCH', '/api/doc/clientes/' + shard('ex'), {'data': {'items': {'ex': {'nombre': 'Luna Esteban', 'estado': 'activo', 'ip': '10.0.0.9', 'desde': cur, 'ciclo': 1}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': int(os.environ.get('YAPUR_W', 1100)), 'height': 900}, accept_downloads=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size >= 1 && S.planes.size >= 2', timeout=10000)

        # 1) datos del recibo en Ajustes
        await pg.click('#tabs [data-tab=ajustes]')
        await pg.wait_for_selector('#aj-rec')
        for k, v in {'ley': 'SOLUCIONES INFORMATICAS', 'raz': 'EMISOR DE PRUEBA', 'cuit': '20111111112', 'iibb': '20111111112', 'dom': 'Calle 1 500, Pueblo', 'tel': 'Ana: 3844-000000', 'web': 'www.ejemplo.net', 'pv': '00004'}.items():
            await pg.fill('#aj-r-' + k, v)
        await pg.fill('#aj-r-ali', 'mi.alias\n\n  otro.alias  ')
        await pg.click('#aj-rec button[type=submit]')
        await pg.wait_for_function("S.ajustes.recibo && S.ajustes.recibo.pv === '00004'", timeout=6000)
        rb = await pg.evaluate('S.ajustes.recibo')
        check('guarda los datos del recibo y limpia los alias', rb['razon'] == 'EMISOR DE PRUEBA' and rb['alias'] == ['mi.alias', 'otro.alias'], rb)
        st, aj = api('GET', '/api/doc/ajustes/general', None, TA)
        check('quedan en el servidor y no se pierden otros ajustes', st == 200 and aj['data']['recibo']['cuit'] == '20111111112' and aj['data']['empresa'] and aj['data']['diaVenc'] == 10, aj)

        # 2) importar la lista
        await pg.click('#aj-imp')
        await pg.wait_for_selector('#imp-file')
        check('el importador anuncia las columnas nuevas', 'velocidad' in await pg.inner_text('.sheet') and 'cobrar desde' in await pg.inner_text('.sheet'))
        await pg.fill('#imp-desde', '2026-09')
        await pg.set_input_files('#imp-file', files=[{'name': 'lista.csv', 'mimeType': 'text/csv', 'buffer': CSV.encode('utf-8')}])
        await pg.wait_for_selector('#imp-go')
        txt = await pg.inner_text('#imp-out')
        check('cuenta 4 clientes nuevos y 1 que ya estaba (mismo nombre en otro orden)', '4 clientes listos' in txt and 'Ya cargados' in txt and '1 no se vuelven a crear' in txt, txt)
        check('avisa la velocidad que no tiene plan', 'Velocidades sin plan' in txt and '40 Mbps (1)' in txt, txt)
        check('el botón dice cuántos se importan y cuántos se completan', 'Importar 4 y completar 1' in await pg.inner_text('#imp-go'), await pg.inner_text('#imp-go'))
        await pg.click('#imp-go')
        await pg.wait_for_function("S.clientes.size === 5", timeout=10000)
        await pg.wait_for_function("[...S.clientes.values()].some(c => c.nombre === 'Luna Esteban' && c.notas)", timeout=6000)
        cl = await pg.evaluate("Object.fromEntries([...S.clientes.values()].map(c => [c.nombre, {plan: c.planId || null, precio: c.precio ?? null, desde: c.desde, ciclo: c.ciclo, nodo: c.nodo || '', tel: c.tel || '', dni: c.dni || '', ip: c.ip || '', notas: c.notas || ''}]))")
        check('Ana: la velocidad 5 eligió el plan y el precio igual al del plan no queda como especial', cl['Ana Pérez']['plan'] == 'p5' and cl['Ana Pérez']['precio'] is None and cl['Ana Pérez']['desde'] == '2026-11' and cl['Ana Pérez']['dni'] == '30111222', cl['Ana Pérez'])
        check('Beto: 3.5 → Plan_3.5, ciclo 2, precio especial 28.000 y cobra desde octubre', cl['Beto Díaz']['plan'] == 'p35' and cl['Beto Díaz']['precio'] == 28000 and cl['Beto Díaz']['ciclo'] == 2 and cl['Beto Díaz']['desde'] == '2026-10' and cl['Beto Díaz']['tel'] == '3844111222', cl['Beto Díaz'])
        check('Carla: velocidad sin plan queda sin plan pero con su precio', cl['Carla Ruiz']['plan'] is None and cl['Carla Ruiz']['precio'] == 18000, cl['Carla Ruiz'])
        check('el nodo viene del archivo', cl['Ana Pérez']['nodo'] == 'PON_1' and cl['Carla Ruiz']['nodo'] == 'PON_2', cl)
        ex = cl['Luna Esteban']
        check('el que ya existía se completa (notas) pero no se pisa (conserva su IP) y no se duplica', ex['ip'] == '10.0.0.9' and ex['notas'] == 'sin velocidad' and ex['plan'] is None and 'Esteban Luna' not in cl, cl)
        # sin duplicar: importar de nuevo no crea nada
        await pg.click('#tabs [data-tab=ajustes]'); await pg.click('#aj-imp'); await pg.wait_for_selector('#imp-file')
        await pg.set_input_files('#imp-file', files=[{'name': 'lista.csv', 'mimeType': 'text/csv', 'buffer': CSV.encode('utf-8')}])
        await pg.wait_for_selector('#imp-out h3')
        txt2 = await pg.inner_text('#imp-out')
        check('importar la misma lista otra vez no duplica a nadie', '0 clientes listos' in txt2 and '5 no se vuelven a crear' in txt2, txt2)
        await pg.click('.sheet [data-close]')

        # 3) facturación: «cobrar desde» manda
        b = await pg.evaluate("(() => { const c = [...S.clientes.values()].find(c => c.nombre === 'Ana Pérez'); return {per: billing(c).periods.map(p => p.per), price: priceOf(c)}; })()")
        check('Ana (cobra desde noviembre) no debe nada de octubre', (b['per'] == [] if cur < '2026-11' else b['per'][0] == '2026-11'), b)
        bb = await pg.evaluate("(() => { const c = [...S.clientes.values()].find(c => c.nombre === 'Beto Díaz'); return {price: priceOf(c), first: billing(c).periods[0] && billing(c).periods[0].per}; })()")
        check('Beto paga su precio especial y se le cobra desde octubre', bb['price'] == 28000 and bb['first'] == '2026-10', bb)

        # 3b) subir precios en bloque: los de $17.000 o menos pasan a $18.000 desde el mes que viene
        for cid, c in {'k1': {'nombre': 'Uno Prueba', 'precio': 17000}, 'k2': {'nombre': 'Dos Prueba', 'precio': 15000}, 'k3': {'nombre': 'Tres Prueba', 'precio': 15000, 'notas': 'solo tv'},
                       'k4': {'nombre': 'Cuatro Prueba', 'precio': 2700}, 'k5': {'nombre': 'Cinco Prueba', 'precio': 18000}}.items():
            api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {**c, 'estado': 'activo', 'desde': cur, 'ciclo': 1}}}}, TA)
        await pg.wait_for_function("S.clientes.size === 10", timeout=10000)
        await pg.click('#tabs [data-tab=ajustes]'); await pg.click('#aj-prb')
        await pg.wait_for_selector('#pb-out h3')
        txt = await pg.inner_text('#pb-out')
        check('muestra cuántos pasan, cuántos se dejan por monto bajo y por la nota «solo tv»', '3 clientes pasan a' in txt and '1 no se tocan' in txt.replace('\n', ' ') or ('3 clientes pasan a' in txt and 'solo tv' in txt and 'Por debajo de' in txt), txt)
        nxt = await pg.evaluate('addMonths(curMonth(), 1)')
        check('propone el mes que viene como fecha de vigencia', await pg.input_value('#pb-mes') == nxt)
        if os.environ.get('YAPUR_SHOT_PB'): await pg.screenshot(path=os.environ['YAPUR_SHOT_PB'])
        await pg.click('#pb-go')
        await pg.click('.sheet [data-act=yes]')
        await pg.wait_for_function("['Uno Prueba', 'Dos Prueba', 'Ana Pérez'].every(n => { const c = [...S.clientes.values()].find(c => c.nombre === n); return c && c.precio === 18000; })", timeout=10000)
        pr = await pg.evaluate("""(() => { const f = n => [...S.clientes.values()].find(c => c.nombre === n);
          const r = {}; for (const n of ['Uno Prueba', 'Dos Prueba', 'Tres Prueba', 'Cuatro Prueba', 'Cinco Prueba', 'Ana Pérez']) { const c = f(n); r[n] = [priceAt(c, curMonth()), priceAt(c, addMonths(curMonth(), 1))]; } return r; })()""")
        check('los que pagaban 17.000 o 15.000 siguen igual este mes y pagan 18.000 el mes que viene', pr['Uno Prueba'] == [17000, 18000] and pr['Dos Prueba'] == [15000, 18000] and pr['Ana Pérez'] == [17000, 18000], pr)
        check('«solo tv», el adicional de 2.700 y el que ya pagaba 18.000 no cambian', pr['Tres Prueba'] == [15000, 15000] and pr['Cuatro Prueba'] == [2700, 2700] and pr['Cinco Prueba'] == [18000, 18000], pr)
        st, k1 = api('GET', '/api/doc/clientes/' + shard('k1'), None, TA)
        it = k1['data']['items']['k1']
        check('en el servidor queda el precio viejo como historial y el nuevo vigente', it['precio'] == 18000 and it['hp'][0]['precio'] == 17000 and it['hp'][0]['h'] == addm(cur, 0), it)
        await pg.click('#tabs [data-tab=ajustes]'); await pg.click('#aj-prb'); await pg.wait_for_selector('#pb-out h3')
        check('volver a correrlo no cambia a nadie', '0 clientes pasan' in await pg.inner_text('#pb-out'), await pg.inner_text('#pb-out'))
        await pg.click('.sheet [data-close]')

        # 4) recibo con el formato del papel
        cid = await pg.evaluate("[...S.clientes.values()].find(c => c.nombre === 'Beto Díaz').id")
        await pg.evaluate(f"putItem('pagos', 'p{cur}', 'pg1', {{id:'pg1', c:'{cid}', concepto:'mensualidad', per:'{cur}', monto:28000, fecha:'{hoy}', hora:'10:15', recibo:'R-TEST-1', metodo:'efectivo'}})")
        await pg.wait_for_function("S.pagos.has('pg1')", timeout=6000)
        await pg.evaluate("openReceipt('R-TEST-1')")
        await pg.wait_for_selector('.rc')
        rc = await pg.inner_text('.rc')
        check('el recibo lleva el encabezado de la empresa', 'SOLUCIONES INFORMATICAS' in rc and 'EMISOR DE PRUEBA' in rc and 'CUIT: 20111111112' in rc and 'Calle 1 500, Pueblo' in rc and 'www.ejemplo.net' in rc, rc)
        check('lleva ORIGINAL, no válido como factura, punto de venta y número', 'ORIGINAL' in rc and 'NO VÁLIDO COMO FACTURA' in rc and '00004' in rc and 'R-TEST-1' in rc, rc)
        check('lleva cliente, condiciones, período, vencimiento, tabla, total y alias', 'Beto Díaz' in rc and 'Consumidor Final' in rc and 'Período facturado' in rc and 'Vto. para el pago' in rc and 'Abono Mensual Servicio de Internet' in rc and 'Importe total' in rc and 'Alias: mi.alias' in rc and 'Alias: otro.alias' in rc, rc)
        wa = await pg.get_attribute('.sheet a[href*="wa.me"]', 'href')
        check('WhatsApp manda el recibo completo', wa and 'IMPORTE%20TOTAL' in wa and 'Alias%3A%20mi.alias' in wa, wa)
        check('el recibo se ve como papel claro aunque la app sea oscura (fondo blanco)', await pg.evaluate("getComputedStyle(document.querySelector('.rc')).backgroundColor") == 'rgb(255, 255, 255)')
        if os.environ.get('YAPUR_SHOT'): await pg.screenshot(path=os.environ['YAPUR_SHOT'])
        await pg.click('#rc-print')
        await pg.wait_for_timeout(500)
        check('Imprimir no rompe la pantalla', await pg.locator('.rc').count() >= 1)
        await pg.click('.sheet [data-close]')

        # 5) la oficina ve los mismos datos en el recibo; el técnico no tiene cobranzas
        c2 = await br.new_context(bypass_csp=True, viewport={'width': 1100, 'height': 900})
        await c2.route('**/fonts.g*/**', lambda r: r.abort())
        pg2 = await login(c2, 'laura', 'laura123')
        await pg2.wait_for_function("S.ajustes.recibo && S.ajustes.recibo.cuit", timeout=8000)
        check('la oficina recibe los datos del recibo', await pg2.evaluate('S.ajustes.recibo.razon') == 'EMISOR DE PRUEBA')
        await ctx.close(); await c2.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
