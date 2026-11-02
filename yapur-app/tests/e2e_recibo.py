# Recibo: período (del 1 al 1 del mes siguiente, vence el 10 del mes siguiente), sin el plan, media hoja A4 al imprimir
# y «Enviar por WhatsApp» como imagen igual que el papel (APK, navegador del celular y computadora).
import asyncio, base64, json, os, re, sys, urllib.request, urllib.error
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

FIXTURE = """() => {
  S.ajustes.empresa = 'YAPUR.NET';
  S.ajustes.recibo = {leyenda: 'YAPUR.NET', razon: 'YAPUR Miguel Matias', cuit: '20325478307', iibb: '20325478307', dom: 'Lavalle 157', tel: 'Mauro: 3844-562605 / Brenda: 3844-589351', web: 'https://yapurnet.github.io', pv: '', alias: ['mauroyapur', 'myapur70.mp']};
  S.planes.set('p1', {id: 'p1', nombre: 'Hogar 150', bajada: 150, subida: 50, precio: 18000});
  S.clientes.set('c2', {id: 'c2', nombre: 'Ciclo Dos', codigo: '8', planId: 'p1', ciclo: 2, tel: '3844000002'});
  S.pagos.set('d1', {id: 'd1', c: 'c2', concepto: 'mensualidad', per: '2026-11', monto: 18000, fecha: '2026-11-14', hora: '10:00', recibo: 'R261114-CI2', metodo: 'efectivo'});
  S.pagos.set('d2', {id: 'd2', c: 'c2', concepto: 'mensualidad', per: '2026-12', monto: 18000, fecha: '2026-11-14', hora: '10:01', recibo: 'R261114-CI3', metodo: 'efectivo'});
  S.clientes.set('c1', {id: 'c1', nombre: 'Saslaver Ana Fiorela', codigo: '7', dni: '35843319', dir: 'Alte Brown', planId: 'p1', ciclo: 1, tel: '3844562605', extras: ['multimedia']});
  const pg = (id, per, recibo, hora) => S.pagos.set(id, {id, c: 'c1', concepto: 'mensualidad', per, monto: 18000, fecha: '2026-11-02', hora, recibo, metodo: 'efectivo'});
  pg('r1', '2026-11', 'R261102-J2R', '17:57');
  pg('r2', '2026-12', 'R261102-DIC', '17:58');
  pg('r3', '2026-10', 'R261102-DOS', '17:59'); pg('r4', '2026-11', 'R261102-DOS', '17:59');
  ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((p, i) => pg('m' + i, p, 'R261102-SEIS', '18:0' + i));
  S.pagos.set('x1', {id: 'x1', c: 'c1', concepto: 'instalacion', nota: 'Cable y ficha', monto: 65000, fecha: '2026-11-02', hora: '18:10', recibo: 'R261102-INS', metodo: 'transferencia', anulado: true});
  rebuildDerived();
}"""

async def login(ctx):
    pg = await ctx.new_page()
    await pg.goto(BASE, wait_until='domcontentloaded'); await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1'); await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    await pg.wait_for_function('S.loaded.clientes && S.loaded.pagos && S.loaded.planes && S.loaded.ajustes', timeout=15000)   # si no, la sincronización inicial pisa los datos de la prueba
    await pg.wait_for_timeout(300)
    await pg.evaluate(FIXTURE)
    return pg

async def main():
    errors = []
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        await ctx.route('https://wa.me/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<h1>WhatsApp</h1>'))
        pg = await login(ctx)
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))

        # 1) período: del 1 del mes pagado al 1 del mes siguiente; vence el 10 del mes siguiente
        per = lambda r: pg.evaluate("(r) => receiptData(r).periodo", r)
        check('noviembre: desde 01/11/2026 hasta 01/12/2026, vence el 10/12/2026', await per('R261102-J2R') == {'desde': '2026-11-01', 'hasta': '2026-12-01', 'vto': '2026-12-10'}, await per('R261102-J2R'))
        check('diciembre: pasa al año siguiente (01/12/2026 al 01/01/2027, vence el 10/01/2027)', await per('R261102-DIC') == {'desde': '2026-12-01', 'hasta': '2027-01-01', 'vto': '2027-01-10'}, await per('R261102-DIC'))
        check('dos meses juntos: desde el primero hasta el 1 del mes siguiente al último', await per('R261102-DOS') == {'desde': '2026-10-01', 'hasta': '2026-12-01', 'vto': '2026-12-10'}, await per('R261102-DOS'))
        check('ciclo 2, noviembre: desde 13/11/2026 hasta 13/12/2026, vence el 20/12/2026', await per('R261114-CI2') == {'desde': '2026-11-13', 'hasta': '2026-12-13', 'vto': '2026-12-20'}, await per('R261114-CI2'))
        check('ciclo 2, diciembre: pasa al año siguiente (13/12/2026 al 13/01/2027, vence el 20/01/2027)', await per('R261114-CI3') == {'desde': '2026-12-13', 'hasta': '2027-01-13', 'vto': '2027-01-20'}, await per('R261114-CI3'))
        await pg.evaluate("openReceipt('R261114-CI2')"); await pg.wait_for_selector('.rc')
        rc2 = re.sub(r'\s+', ' ', await pg.inner_text('.rc'))
        check('el recibo del ciclo 2 dice «desde: 13/11/2026 hasta: 13/12/2026 · Vto. para el pago: 20/12/2026»', 'Período facturado desde: 13/11/2026 hasta: 13/12/2026 · Vto. para el pago: 20/12/2026' in rc2, rc2)
        await pg.click('.sheet [data-close]')
        await pg.evaluate("openReceipt('R261102-J2R')"); await pg.wait_for_selector('.rc')
        rc = re.sub(r'\s+', ' ', await pg.inner_text('.rc'))
        check('el recibo dice «Período facturado desde: 01/11/2026 hasta: 01/12/2026 · Vto. para el pago: 10/12/2026»', 'Período facturado desde: 01/11/2026 hasta: 01/12/2026 · Vto. para el pago: 10/12/2026' in rc, rc)
        check('el plan no sale en el recibo (ni «Servicio:», ni el nombre del plan, ni los adicionales)', 'Servicio:' not in rc and 'Hogar' not in rc and 'ultimedia' not in rc, rc)
        txt = await pg.evaluate("receiptText('R261102-J2R')")
        check('tampoco en el texto del recibo (copiar)', 'Servicio:' not in txt and 'Hogar' not in txt and '01/12/2026' in txt and '10/12/2026' in txt, txt)
        check('siguen los alias de pago', 'Alias: mauroyapur' in rc and 'Alias: myapur70.mp' in rc, rc)
        await pg.click('.sheet [data-close]')

        # 2) el recibo como imagen (lo que se manda por WhatsApp)
        info = await pg.evaluate("""(r) => { const cv = receiptCanvas(receiptData(r)), x = cv.getContext('2d'), im = x.getImageData(0, 0, cv.width, cv.height).data; let oscuros = 0; for (let i = 0; i < im.length; i += 4) if (im[i] < 90) oscuros++;
          return {w: cv.width, h: cv.height, oscuros, png: cv.toDataURL('image/png').slice(0, 40)}; }""", 'R261102-J2R')
        check('la imagen del recibo es un PNG de buen tamaño (1296 px de ancho) y tiene texto dibujado', info['png'].startswith('data:image/png;base64,iVBOR') and info['w'] == 1296 and 500 < info['h'] < 2000 and info['oscuros'] > 3000, info)
        seis = await pg.evaluate("(r) => receiptCanvas(receiptData(r)).height", 'R261102-SEIS')
        check('la imagen crece con la cantidad de renglones (seis meses es más alta que uno)', seis > info['h'] + 150, [seis, info['h']])
        anu = await pg.evaluate("(r) => { const cv = receiptCanvas(receiptData(r)), im = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let rojos = 0; for (let i = 0; i < im.length; i += 4) if (im[i] > 150 && im[i + 1] < 120 && im[i + 2] < 120) rojos++; return rojos; }", 'R261102-INS')
        check('un recibo anulado lleva el sello ANULADO en rojo', anu > 500, anu)

        # 3) media hoja A4: el recibo entra en 148 mm de alto y en una sola hoja
        pr = await ctx.new_page()
        for rid, nombre in (('R261102-J2R', 'un mes'), ('R261102-DOS', 'dos meses'), ('R261102-SEIS', 'seis meses')):
            html = await pg.evaluate("(r) => '<!doctype html><meta charset=\"utf-8\">' + receiptHTML(receiptData(r)) + '<style>' + RC_PRINT_CSS + '</style>'", rid)
            await pr.set_content(html)
            mm = await pr.evaluate("document.querySelector('.rc').getBoundingClientRect().height / 3.7795")
            pdf = await pr.pdf(prefer_css_page_size=True, print_background=True)
            paginas = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
            check(f'impreso ({nombre}): entra en media hoja A4 (alto {mm:.0f} mm, máximo 148) y en una sola hoja', mm <= 148 and paginas == 1, [mm, paginas])
        await pr.close()

        # 4) «Enviar por WhatsApp» como imagen
        # 4a) APK nuevo: el puente nativo recibe la imagen y el número del cliente; no se abre el enlace de texto
        c1 = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await c1.add_init_script("window.__calls = []; window.__res = 'ok'; window.YapurApp = { shareImage: (n, b, t, c) => { window.__calls.push(['shareImage', n, b.slice(0, 12), b.length, t, c]); return window.__res; }, openUrl: (u) => { window.__calls.push(['openUrl', u]); return true; }, saveFile: () => 'ok' };")
        await c1.route('**/fonts.g*/**', lambda r: r.abort())
        n1 = await login(c1)
        await n1.evaluate("openReceipt('R261102-J2R')"); await n1.wait_for_selector('#rc-wa')
        await n1.click('#rc-wa')
        calls = await n1.evaluate('window.__calls')
        check('en el APK, «Enviar por WhatsApp» le da al celular la imagen PNG del recibo con el número del cliente', len(calls) == 1 and calls[0][0] == 'shareImage' and calls[0][1] == 'Recibo-R261102-J2R.png' and calls[0][2].startswith('iVBORw0KGgo') and calls[0][3] > 5000 and calls[0][4] == '5493844562605' and 'R261102-J2R' in calls[0][5] and '$' in calls[0][5], calls)
        check('y no abre el enlace con el texto largo', not any(c[0] == 'openUrl' for c in calls), calls)
        await n1.evaluate("window.__calls.length = 0; window.__res = 'No se pudo abrir WhatsApp.'")
        await n1.click('#rc-wa')
        calls = await n1.evaluate('window.__calls')
        check('si el celular no puede, se abre el enlace de WhatsApp con el texto (no se pierde el envío)', [c[0] for c in calls] == ['shareImage', 'openUrl'] and calls[1][1].startswith('https://wa.me/5493844562605?text='), calls)
        await c1.close()

        # 4b) celular con navegador (sin APK): menú de compartir con el archivo PNG
        c2 = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True, user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
        await c2.add_init_script("window.__share = null; navigator.canShare = () => true; navigator.share = async (o) => { window.__share = {files: o.files.map(f => [f.name, f.type, f.size]), text: o.text}; };")
        await c2.route('**/fonts.g*/**', lambda r: r.abort())
        n2 = await login(c2)
        await n2.evaluate("openReceipt('R261102-J2R')"); await n2.wait_for_selector('#rc-wa')
        await n2.click('#rc-wa')
        await n2.wait_for_function('window.__share', timeout=5000)
        sh = await n2.evaluate('window.__share')
        check('en el navegador del celular abre el menú de compartir con el recibo como imagen PNG', len(sh['files']) == 1 and sh['files'][0][0] == 'Recibo-R261102-J2R.png' and sh['files'][0][1] == 'image/png' and sh['files'][0][2] > 5000 and 'R261102-J2R' in sh['text'], sh)
        await c2.close()

        # 4c) computadora: copia la imagen y abre el chat para pegarla
        c3 = await br.new_context(viewport={'width': 1000, 'height': 800}, bypass_csp=True)
        await c3.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        await c3.route('**/fonts.g*/**', lambda r: r.abort())
        await c3.route('https://wa.me/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<h1>WhatsApp</h1>'))
        n3 = await login(c3)
        await n3.evaluate("openReceipt('R261102-J2R')"); await n3.wait_for_selector('#rc-wa')
        async with c3.expect_page(timeout=8000) as nueva:
            await n3.click('#rc-wa')
        wp = await nueva.value
        check('en la computadora abre el chat del cliente en WhatsApp', wp.url.startswith('https://wa.me/5493844562605'), wp.url)
        tipos = await n3.evaluate("(async () => { const it = await navigator.clipboard.read(); return it.map(i => i.types); })()")
        check('y deja copiada la imagen del recibo para pegarla en el chat', tipos and 'image/png' in tipos[0], tipos)
        check('con aviso de pegar', 'pegalo en el chat' in await n3.inner_text('#toastRoot'))
        await c3.close()

        # 5) desde la ficha del cliente: cada pago abre su recibo (para reenviarlo o imprimirlo cuando se quiera)
        await pg.evaluate("openClient('c1')"); await pg.wait_for_selector('.sheet tr[data-receipt]')
        filas = await pg.evaluate("[...document.querySelectorAll('.sheet tr[data-receipt]')].map(r => r.dataset.receipt)")
        check('en «Últimos pagos» de la ficha, cada pago tiene su recibo', len(filas) >= 8 and 'R261102-J2R' in filas, filas)
        check('y dice cómo usarlo', 'reenvía por WhatsApp' in await pg.inner_text('.sheet') and 'imprime' in await pg.inner_text('.sheet'))
        await pg.click('.sheet tr[data-receipt="R261102-J2R"]')
        await pg.wait_for_selector('.rc')
        check('al tocar un pago se abre el recibo con «Enviar por WhatsApp», «Copiar» e «Imprimir»', await pg.query_selector('#rc-wa') is not None and await pg.query_selector('#rc-print') is not None and 'Copiar' in await pg.inner_text('.sheet'))
        check('el recibo abierto es el de ese pago', 'R261102-J2R' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]')
        await pg.evaluate("openClient('c1')"); await pg.wait_for_selector('.sheet tr[data-receipt]')
        await pg.focus('.sheet tr[data-receipt="R261102-DIC"]'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.rc')
        check('también se abre con el teclado (Enter)', 'R261102-DIC' in await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]')

        # 6) imprimir desde el celular (APK): Android arma la impresión con el recibo en media hoja A4
        c4 = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await c4.add_init_script("window.__calls = []; window.__r = 'ok'; window.YapurApp = { printHtml: (h, t) => { window.__calls.push(['printHtml', h, t]); return window.__r; }, openUrl: () => true, saveFile: () => 'ok' };")
        await c4.route('**/fonts.g*/**', lambda r: r.abort())
        n4 = await login(c4)
        await n4.evaluate("openReceipt('R261102-J2R')"); await n4.wait_for_selector('#rc-print')
        await n4.click('#rc-print')
        calls = await n4.evaluate('window.__calls')
        html = calls[0][1] if calls else ''
        check('en el APK, «Imprimir» le pasa a Android el recibo listo para imprimir', len(calls) == 1 and calls[0][2] == 'Recibo R261102-J2R' and 'Importe total' in html and 'size:A4' in html and 'R261102-J2R' in html and 'Hogar' not in html, [c[0] for c in calls])
        await n4.evaluate("window.__r = 'No se pudo abrir la impresión.'")
        await n4.click('#rc-print')
        check('si Android no puede, avisa', 'No se pudo abrir la impresión' in await n4.inner_text('#toastRoot'))
        await c4.close()
        # con un APK anterior (sin impresión) avisa que hay que actualizar, en vez de no hacer nada
        c5 = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await c5.add_init_script("window.YapurApp = { openUrl: () => true, saveFile: () => 'ok' };")
        await c5.route('**/fonts.g*/**', lambda r: r.abort())
        n5 = await login(c5)
        await n5.evaluate("openReceipt('R261102-J2R')"); await n5.wait_for_selector('#rc-print')
        await n5.click('#rc-print')
        check('con un APK anterior, «Imprimir» avisa que hay que instalar la última versión', 'instalá la última versión' in await n5.inner_text('#toastRoot'))
        await c5.close()
        await br.close()
    check('sin errores de la página', not errors, errors)
    print(f'\n{sum(res)} ok, {len(res) - sum(res)} con fallas'); sys.exit(0 if all(res) else 1)
asyncio.run(main())
