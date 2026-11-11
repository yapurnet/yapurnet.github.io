# Factura ARCA desde la pantalla: configurar el certificado, emitir desde el recibo, ver la factura con su QR y anularla con nota de crédito.
# - «Clientes: altas y bajas»: una barra verde (altas, por c.alta) y una roja (bajas, por c.bajaFecha) por cada uno de los
#   últimos 6 meses, con el neto en el pie.
# - «Órdenes cerradas por técnico»: una barra horizontal por técnico con lo que cerró ESTE mes (incluye a los que cerraron 0,
#   para que se note quién no hizo nada); no cuenta lo abierto ni lo cerrado en otro mes.
# Chromium real contra workerd.
import subprocess, tempfile, asyncio, datetime, json, os, sys, urllib.request, urllib.error
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
def addmonths(ym, n):
    y, m = map(int, ym.split('-')); m += n; y += (m - 1) // 12; m = (m - 1) % 12 + 1
    return '%04d-%02d' % (y, m)
ERR = []
async def sin_aviso(pg):
    if await pg.evaluate("S.realRole") != 'tecnico': return
    try:
        await pg.wait_for_selector('[role=dialog] [data-act=no]', timeout=4000)
        await pg.click('[role=dialog] [data-act=no]')
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
    hoy = datetime.date.today(); mes = hoy.strftime('%Y-%m'); hs = hoy.isoformat()
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('PUT', '/api/doc/ajustes/general', {'data': {'recibo': {'leyenda': 'YAPUR.NET', 'razon': 'YAPUR Miguel Matias', 'cuit': '20325478307', 'iibb': '20325478307', 'dom': 'Lavalle 157'}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Ana Alonso', 'estado': 'activo', 'dir': 'Calle A', 'loc': 'Añatuya', 'dni': '30123456', 'alta': mes + '-01'}}}}, TA)
    api('PATCH', '/api/doc/pagos/%s-s%02d' % (hs[:4], fnv('a') % 32), {'data': {'items': {'pg1': {'c': 'a', 'concepto': 'mensualidad', 'per': mes, 'monto': 12100, 'fecha': hs, 'hora': '10:00', 'recibo': 'R-00001', 'metodo': 'efectivo'}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 1100, 'height': 900})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.loaded.pagos && S.loaded.clientes && S.payByClient.size >= 1", timeout=10000)
        # Ajustes: certificado
        await pg.click('#tabs [data-tab=ajustes]'); await pg.wait_for_selector('#arca-gen:not([disabled])', timeout=8000)
        await pg.click('#arca-gen'); await pg.wait_for_selector('#arca-csr-t', state='visible', timeout=8000)
        csr = await pg.input_value('#arca-csr-t')
        check('la pantalla muestra el pedido de certificado', 'BEGIN CERTIFICATE REQUEST' in csr)
        d = tempfile.mkdtemp()
        open(d + '/r.csr', 'w').write(csr)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', d + '/ca.key', '-out', d + '/ca.pem', '-subj', '/CN=AC', '-days', '30'], check=True, capture_output=True)
        subprocess.run(['openssl', 'x509', '-req', '-in', d + '/r.csr', '-CA', d + '/ca.pem', '-CAkey', d + '/ca.key', '-CAcreateserial', '-out', d + '/c.pem', '-days', '700'], check=True, capture_output=True)
        await pg.fill('#arca-cert', open(d + '/c.pem').read()); await pg.click('#arca-cert-g')
        await pg.wait_for_selector('#arca-probar:not([disabled])', timeout=8000)
        await pg.fill('#arca-pv', '3'); await pg.click('#arca-pv-g')
        await pg.wait_for_function("document.querySelector('#arca-st').innerText.includes('Listo para probar')", timeout=8000)
        await pg.click('#arca-probar')
        await pg.wait_for_function("document.querySelector('#arca-res').innerText.includes('correcta')", timeout=10000)
        check('la prueba de conexión sale bien', True)
        await pg.wait_for_function("S.ajustes.arcaListo === true", timeout=8000)
        # Recibo → factura
        await pg.evaluate("openReceipt('R-00001')")
        await pg.wait_for_selector('#fe-emitir', timeout=8000)
        check('el recibo ofrece «Emitir factura ARCA» y sigue teniendo Imprimir', await pg.locator('#rc-print').count() == 1)
        await pg.click('#fe-emitir'); await pg.wait_for_selector('#fe-go')
        check('con DNI no ofrece Factura A', not await pg.locator('#fe-tipo').is_visible())
        await pg.click('#fe-go')
        await pg.wait_for_selector('#fe-print', timeout=10000)
        txt = await pg.evaluate("document.querySelector('.fe').innerText")
        check('la factura muestra letra B, número, total, CAE y razón social', 'B' in txt and 'Punto de Venta: 00003' in txt and 'Comp. Nro: 00000001' in txt and '12.100' in txt and 'CAE' in txt and 'YAPUR Miguel Matias' in txt, txt[:300])
        check('es de prueba y lo dice', 'SIN VALIDEZ' in txt)
        check('lleva el código QR', await pg.locator('.fe svg path').count() == 1)
        check('B: muestra el IVA contenido (2.100)', '2.100' in txt, txt)
        await pg.screenshot(path='/tmp/factura.png')
        await pg.click('.actions [data-close]')
        await pg.evaluate("openReceipt('R-00001')")
        await pg.wait_for_selector('#fe-ver', timeout=8000)
        check('después el recibo muestra la factura y ya no deja emitir otra', await pg.locator('#fe-emitir').count() == 0 and await pg.locator('#fe-nc').count() == 1)
        await pg.click('#fe-nc'); await pg.click('[data-act=yes]')
        await pg.wait_for_selector('#fe-ver-nc', timeout=10000)
        check('queda anulada con su nota de crédito', 'nota de crédito' in (await pg.evaluate("document.querySelector('#rc-fe').innerText")).lower())
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
