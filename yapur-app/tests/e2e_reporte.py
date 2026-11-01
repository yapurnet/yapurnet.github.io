# Nuevo cliente desde el reporte del técnico (NOMBRE / DNI / IP / PAGO) y cobro de la instalación ya completado.
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
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
def add_months(ym, n):
    y, m = map(int, ym.split('-')); t = y * 12 + (m - 1) + n
    return '%d-%02d' % (t // 12, t % 12 + 1)
CUR = time.strftime('%Y-%m'); NEXT = add_months(CUR, 1)
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

REPORTE = """🔴NOMBRE: Ana Ester Paz

🔴DNI: 28354900

🛜IP: 10.20.43.9

🔴PAGO: (Efectivo) 65mil pesos que es el costo de instalación y recibieron los tecnicos"""

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/planes/p100', {'data': {'nombre': 'Plan 100', 'bajada': 15, 'subida': 15, 'precio': 18000, 'tecnologia': 'ambas', 'activo': True}}, TA)
    base = {'estado': 'activo', 'dir': 'Calle 1', 'ciclo': 1, 'alta': '2026-01-01', 'desde': '2099-01'}
    api('PATCH', '/api/doc/clientes/' + shard('vieja'), {'data': {'items': {'vieja': {**base, 'nombre': 'Vieja Vera', 'dni': '28.354.900', 'ip': '10.20.43.77'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function('S.clientes.size === 1 && S.planes.size === 1', timeout=10000)
        # --- el lector de texto, solo
        pm = await pg.evaluate("['65mil','65 mil pesos','$65.000','65000','$ 1.250,50','1,5 mil','sin numero',\"(Efectivo) 65mil pesos que es el costo\"].map(parseMonto)")
        check('montos: 65mil, 65 mil, 65.000, 65000, 1.250 (sin centavos), 1,5 mil, sin número', pm == [65000, 65000, 65000, 65000, 1250, 1500, None, 65000], pm)
        pg2 = await pg.evaluate("[parsePago('Transferencia 20.000 reconexión'),parsePago('mercado pago 5000 visita técnica'),parsePago('efectivo'),parsePago('18000')]")
        check('pago: método y concepto según el texto, vacío si no hay monto', pg2[0]['metodo'] == 'transferencia' and pg2[0]['concepto'] == 'otro' and pg2[1]['metodo'] == 'mercadopago' and pg2[1]['concepto'] == 'reclamo' and pg2[2] is None and pg2[3]['metodo'] == 'efectivo' and pg2[3]['concepto'] == 'instalacion', pg2)
        r = await pg.evaluate("(t)=>parseReporte(t)", REPORTE)
        check('reporte: nombre, DNI, IP y pago (con emojis y renglones en blanco)', r['nombre'] == 'Ana Ester Paz' and r['dni'] == '28354900' and r['ip'] == '10.20.43.9' and r['pago']['monto'] == 65000 and r['pago']['metodo'] == 'efectivo' and r['pago']['concepto'] == 'instalacion', r)
        r2 = await pg.evaluate("parseReporte('Nombre y apellido: Juan Gil\\nTeléfono: 3844 55-1111\\nDirección: Calle 5 123\\nLocalidad: Añatuya\\nPlan: plan 100\\nIP: IP fija 10.20.44.3/32\\nDNI: 30.111.222')")
        check('reporte: acepta teléfono, dirección, localidad, plan, IP con texto y DNI con puntos', r2['nombre'] == 'Juan Gil' and r2['tel'] == '3844 55-1111' and r2['dir'] == 'Calle 5 123' and r2['loc'] == 'Añatuya' and r2['plan'] == 'plan 100' and r2['ip'] == '10.20.44.3' and r2['dni'] == '30111222' and r2.get('pago') is None, r2)
        # --- la pantalla
        await pg.click('#tabs [data-tab=clientes]')
        await pg.wait_for_selector('#cl-new')
        await pg.click('#cl-new')
        await pg.wait_for_selector('#cf-rep')
        await pg.click('#cf-rep summary')
        await pg.fill('#cf-rep-txt', 'hola, ya instalé')
        await pg.click('#cf-rep-go')
        out = await pg.inner_text('#cf-rep-out')
        check('texto sin datos: avisa y no toca el formulario', 'No encontré datos' in out and await pg.input_value('#cf-nombre') == '', out)
        await pg.fill('#cf-rep-txt', REPORTE)
        await pg.click('#cf-rep-go')
        out = await pg.inner_text('#cf-rep-out')
        check('completa nombre, DNI, IP', await pg.input_value('#cf-nombre') == 'Ana Ester Paz' and await pg.input_value('#cf-dni') == '28354900' and await pg.input_value('#cf-ip') == '10.20.43.9', out)
        check('queda activo y cobra desde el mes siguiente', await pg.input_value('#cf-estado') == 'activo' and await pg.input_value('#cf-desde') == NEXT, [await pg.input_value('#cf-estado'), await pg.input_value('#cf-desde')])
        check('avisa del pago y de lo que falta completar', 'Pago detectado: efectivo' in out and '65.000' in out.replace('\xa0', ' ') and 'Falta completar: teléfono y calle y número' in out, out)
        check('detecta el DNI repetido aunque el otro cliente lo tenga con puntos', 'Ojo: ya hay un cliente con ese DNI (Vieja Vera)' in out, out)
        await pg.fill('#cf-dni', '28354999')   # para poder seguir: el reporte ya avisó
        await pg.fill('#cf-tel', '3844 56-0000'); await pg.fill('#cf-dir', 'Belgrano 100')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_selector('#cb-go', timeout=8000)
        check('al guardar se abre «Cobrar» con instalación, efectivo y 65000', await pg.evaluate("document.querySelector('#cb-con [aria-pressed=true]').dataset.con") == 'instalacion' and await pg.input_value('#cb-met') == 'efectivo' and (await pg.input_value('#cb-monto')) == '65000', [await pg.input_value('#cb-met'), await pg.input_value('#cb-monto')])
        check('el detalle del cobro lleva lo que escribió el técnico', 'instalación' in await pg.input_value('#cb-nota-o'), await pg.input_value('#cb-nota-o'))
        await pg.click('#cb-go')
        await pg.wait_for_function("[...S.pagos.values()].some(p=>p.monto===65000)", timeout=8000)
        pago = await pg.evaluate("[...S.pagos.values()].find(p=>p.monto===65000)")
        cli = await pg.evaluate("[...S.clientes.values()].find(c=>c.nombre==='Ana Ester Paz')")
        check('el pago quedó a nombre del cliente nuevo, como instalación en efectivo', pago['c'] == cli['id'] and pago['concepto'] == 'instalacion' and pago['metodo'] == 'efectivo' and pago['porNombre'] == 'Mauro', pago)
        check('el cliente nuevo: activo, IP, DNI, plan vacío y cobra desde el mes siguiente', cli['estado'] == 'activo' and cli['ip'] == '10.20.43.9' and cli['desde'] == NEXT and not cli.get('planId'), cli)
        await pg.wait_for_selector('#rc-wa', timeout=8000)
        check('se muestra el recibo', True)
        # --- el plan del reporte
        await pg.evaluate("closeModal()")
        await pg.click('#cl-new'); await pg.wait_for_selector('#cf-rep'); await pg.click('#cf-rep summary')
        await pg.fill('#cf-rep-txt', 'NOMBRE: Juan Gil\nPLAN: plan 100\nTEL: 3844 55-1111\nDIRECCION: Calle 5 123')
        await pg.click('#cf-rep-go')
        out = await pg.inner_text('#cf-rep-out')
        check('el plan del reporte se elige solo y sin pago no abre cobro', await pg.input_value('#cf-plan') == 'p100' and 'Pago detectado' not in out and 'Falta completar' not in out, out)
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("[...S.clientes.values()].some(c=>c.nombre==='Juan Gil')", timeout=8000)
        await pg.wait_for_timeout(600)
        check('sin pago en el reporte no se abre «Cobrar»', await pg.evaluate("!document.querySelector('#cb-go')"))
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
