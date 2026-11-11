# Equipos en comodato y contrato firmado con el dedo, de punta a punta: el técnico carga los equipos y hace firmar, la oficina revisa
# un cambio de titularidad, lo manda a la papelera y lo restaura. Chromium real contra el servidor de verdad (workerd).
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
async def firmar_en_canvas(pg):
    box = await pg.evaluate("(()=>{const r=document.querySelector('#ct-sig').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()")
    await pg.mouse.move(box['x'] + box['w'] * 0.1, box['y'] + box['h'] * 0.6)
    await pg.mouse.down()
    for i in range(1, 30):
        await pg.mouse.move(box['x'] + box['w'] * (0.1 + 0.027 * i), box['y'] + box['h'] * (0.5 + 0.25 * (-1 if i % 2 else 1) * (1 - i / 40)), steps=2)
    await pg.mouse.up()
def cliente_srv(tok, cid):
    st, j = api('GET', '/api/sync', None, tok)
    for d in j['cols']['clientes']:
        if cid in d['data'].get('items', {}): return d['data']['items'][cid]
def contratos(tok, cid=None):
    st, j = api('GET', '/api/contratos' + ('?cid=' + cid if cid else ''), None, tok)
    return j['contratos']

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'ofi', 'nombre': 'Brenda', 'role': 'oficina', 'clave': 'brenda123'}, TA)
    api('POST', '/api/users', {'usuario': 'tec', 'nombre': 'Fernando Paz', 'role': 'tecnico', 'clave': 'fernando1', 'permisos': {'clientesTodos': True}}, TA)
    for cid, nom, cod in [('cUno', 'Cejas Rosa', '77'), ('cDos', 'Otro Cliente', '78')]:
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nom, 'codigo': cod, 'estado': 'activo', 'dir': 'Calle 9 N° 123', 'loc': 'Añatuya', 'tel': '3844123456', 'dni': '20111222', 'alta': '2026-01-10', 'desde': time.strftime('%Y-%m')}}}}, TA)
    # el texto que viene de arranque ya es el definitivo; el administrador lo deja como borrador a propósito para probar la pantalla de Ajustes
    st, pl = api('GET', '/api/contrato/plantilla', None, TA)
    check('el contrato viene de arranque como texto definitivo (sin «BORRADOR»)', pl['final'] is True and 'BORRADOR' not in pl['texto'] and pl['ver'] == 1, pl['texto'][:80])
    api('PUT', '/api/contrato/plantilla', {'texto': 'BORRADOR PARA REVISAR: prueba.\n\n' + pl['texto'], 'final': False}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])

        # 1) el administrador deja el texto como borrador y lo hace definitivo desde Ajustes
        pa = await login(await nuevo(br), 'mauro', 'claveSegura1')
        await pa.wait_for_function('S.clientes.size === 2', timeout=10000)
        await pa.click('#tabs [data-tab=ajustes]')
        await pa.wait_for_selector('#ct-aj-edit')
        await pa.wait_for_function("document.querySelector('#ct-aj-st').textContent.includes('Borrador')", timeout=5000)
        check('Ajustes avisa que el contrato todavía es un borrador', True)
        await pa.click('#ct-aj-edit'); await pa.wait_for_selector('#ctpl')
        await shot(pa, 'comodato-plantilla.png')
        await pa.check('#ctpl-fin'); await pa.click('#ctpl button[type=submit]')
        await pa.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>/BORRADOR|COMPLETAR/.test(t.textContent))", timeout=5000)
        check('no deja marcarlo como definitivo mientras diga «BORRADOR»', True)
        txt = await pa.input_value('#ctpl-txt')
        import re
        txt = re.sub(r'^BORRADOR[^\n]*\n\n', '', txt); txt = re.sub(r'\[COMPLETAR[^\]]*\]', 'treinta (30) días', txt)
        await pa.fill('#ctpl-txt', txt)
        await pa.click('#ctpl-vars [data-v=numero]')
        check('tocar un dato lo inserta en el texto', '{{numero}}' in await pa.input_value('#ctpl-txt'))
        await pa.fill('#ctpl-raz', 'YAPUR.NET'); await pa.fill('#ctpl-cuit', '20-12345678-9'); await pa.fill('#ctpl-dom', 'Calle 1 de Añatuya'); await pa.fill('#ctpl-rep', 'Mauro Yapur')
        await pa.click('#ctpl button[type=submit]')
        await pa.wait_for_selector('#ctpl', state='detached', timeout=5000)
        await pa.wait_for_function("document.querySelector('#ct-aj-st').textContent.includes('definitivo')", timeout=5000)
        check('el administrador lo deja como texto definitivo desde Ajustes', True)
        # si ya había guardado otro texto, puede volver a cargar el sugerido (sin guardarlo hasta tocar «Guardar»)
        await pa.click('#ct-aj-edit'); await pa.wait_for_selector('#ctpl-sug')
        check('con otro texto guardado aparece «Cargar el texto sugerido (fibra y antena)»', 'texto sugerido' in await pa.inner_text('#ctpl-sug'))
        await pa.click('#ctpl-sug')
        check('un solo toque no pisa el texto: pide tocar otra vez', 'BORRADOR' not in await pa.input_value('#ctpl-txt') and 'otra vez' in await pa.inner_text('#ctpl-sug'))
        await pa.click('#ctpl-sug')
        nuevo_txt = await pa.input_value('#ctpl-txt')
        check('con el segundo toque carga el texto sugerido (la cláusula de ingreso, sin «BORRADOR») y deja marcado «definitivo»', nuevo_txt.startswith('CONTRATO DE COMODATO') and 'BORRADOR' not in nuevo_txt and 'INGRESO AL DOMICILIO' in nuevo_txt and '{{tecnologia}}' in nuevo_txt and await pa.is_checked('#ctpl-fin'))
        await pa.click('#ctpl [data-close]') if await pa.query_selector('#ctpl [data-close]') else await pa.keyboard.press('Escape')
        await pa.wait_for_selector('#ctpl', state='detached', timeout=5000)
        check('sin tocar «Guardar» el contrato definitivo sigue como estaba', 'definitivo' in await pa.inner_text('#ct-aj-st'))

        # 1b) el administrador mira y completa los modelos de equipos que van a elegir los técnicos
        await pa.click('#ct-aj-mod'); await pa.wait_for_selector('#cmmform')
        mods = await pa.evaluate("[...document.querySelectorAll('#cmm-rows .cm-modelo')].map(r=>r.querySelector('select').value+'|'+r.querySelector('input').value)")
        check('en Ajustes ya están los modelos de la empresa: ONU Huawei, antena LiteBeam, inyector PoE y fuente de la ONU', mods == ['ONU|Huawei HG8145V5', 'Antena|CPE Ubiquiti LiteBeam Gen2', 'Fuente o adaptador|Inyector de corriente PoE', 'Fuente o adaptador|Fuente de corriente de la ONU'], mods)
        await shot(pa, 'comodato-modelos.png')
        await pa.click('#cmm-add'); await pa.fill('#cmm-d4', 'ZTE F670L')
        await pa.click('#cmmform button[type=submit]'); await pa.wait_for_selector('#cmmform', state='detached', timeout=5000)
        st, mj = api('GET', '/api/comodato/modelos', None, TA)
        check('suma otra ONU (ZTE F670L) y queda guardada en el servidor', [m['d'] for m in mj['modelos'] if m['t'] == 'ONU'] == ['Huawei HG8145V5', 'ZTE F670L'], mj)

        # 2) el técnico carga los equipos del cliente
        ctxT = await nuevo(br, 390, 844)
        pt = await login(ctxT, 'tec', 'fernando1')
        await pt.wait_for_function('S.clientes.size === 2 && S.contratosOk', timeout=10000)
        await pt.click('#tabs [data-tab=clientes]')
        await pt.wait_for_selector('[data-open-client]')
        chips = await pt.evaluate("[...document.querySelectorAll('#cl-seg button')].map(b=>b.textContent)")
        check('el técnico ve el filtro «Sin contrato firmado», pero no el de revisión ni el panel de contratos', 'Sin contrato firmado' in chips and 'Contrato en revisión' not in chips and await pt.query_selector('#cl-ct-go') is None, chips)
        await pt.evaluate("openClient('cUno')"); await pt.wait_for_selector('.cm-block')
        check('la ficha tiene «Equipos en comodato» y todavía no hay contrato', 'No hay equipos cargados' in await pt.inner_text('.cm-block'))
        await pt.click('[data-cm=editar]'); await pt.wait_for_selector('#cmform')
        check('la lista de un cliente de fibra arranca con la ONU ya con el modelo de la lista (solo falta la MAC) y su fuente', await pt.input_value('#cm-t0') == 'ONU' and await pt.input_value('#cm-m0') == 'Huawei HG8145V5' and await pt.input_value('#cm-s0') == '' and await pt.input_value('#cm-t1') == 'Fuente o adaptador' and await pt.input_value('#cm-m1') == 'Fuente de corriente de la ONU')
        opts = await pt.evaluate("[...document.querySelectorAll('#cm-m0 option')].map(o=>o.value)")
        check('el modelo se elige de la lista (con la ONU que sumó el administrador) y siempre se puede escribir otro', opts == ['Huawei HG8145V5', 'ZTE F670L', '__otro'], opts)
        check('mientras hay un modelo elegido, el cuadro para escribirlo está escondido', await pt.is_hidden('#cm-d0'))
        await pt.select_option('#cm-m0', '__otro')
        check('«Otro modelo» muestra el cuadro para escribirlo', await pt.is_visible('#cm-d0'))
        await pt.select_option('#cm-m0', 'Huawei HG8145V5')
        ini = await pt.evaluate("cmInicial({tec:'wireless'}).map(e=>e.t+'|'+e.d)")
        check('la de un cliente de antena arranca con el LiteBeam Gen2 y el inyector PoE ya puestos (siempre es el mismo modelo)', ini == ['Antena|CPE Ubiquiti LiteBeam Gen2', 'Fuente o adaptador|Inyector de corriente PoE'], ini)
        pre = await pt.evaluate("cmInicial({tec:'fibra',equipo:'hwtc12345678'}).map(e=>e.s)")
        check('si la ficha del cliente ya tiene el equipo (serie o MAC), se usa en la ONU para no escribirlo dos veces', pre == ['HWTC12345678', ''], pre)
        fm = await pt.evaluate("[cmMacFmt('2c-3a-e8-11-aa-bb'), cmMacFmt('2c3ae811aabb'), cmMacFmt('hwtc1234abcd'), cmMacMal('2c:3a:e8:11'), cmMacMal('2C:3A:E8:11:AA:BB'), cmMacMal('HWTC1234ABCD')]")
        check('la MAC se ordena (mayúsculas y dos puntos), un N° de serie queda tal cual y una MAC incompleta se detecta', fm == ['2C:3A:E8:11:AA:BB', '2C:3A:E8:11:AA:BB', 'HWTC1234ABCD', 'La MAC tiene que tener 12 letras y números y la que escribiste tiene 8.', '', ''], fm)
        await pt.click('#cmform button[type=submit]')
        await pt.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('escribí la MAC'))", timeout=5000)
        check('no guarda una ONU sin MAC (y avisa cuál falta)', await pt.query_selector('#cmform') is not None)
        await pt.fill('#cm-s0', '2c:3a:e8:11'); await pt.click('#cmform button[type=submit]')
        await pt.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('tiene que tener 12'))", timeout=5000)
        check('ni con una MAC a medio escribir', await pt.query_selector('#cmform') is not None)
        await pt.fill('#cm-s0', '2c3ae811aabb'); await pt.press('#cm-s0', 'Tab')
        check('al terminar de escribir la MAC queda en mayúsculas y con dos puntos', await pt.input_value('#cm-s0') == '2C:3A:E8:11:AA:BB', await pt.input_value('#cm-s0'))
        await pt.select_option('#cm-t1', 'Router Wi-Fi')
        check('un tipo sin modelos en la lista deja escribir el modelo directamente', await pt.query_selector('#cm-m1') is None and await pt.is_visible('#cm-d1'))
        await pt.fill('#cm-d1', 'TP-Link Archer C6'); await pt.fill('#cm-s1', '50d4f7a1b2c3')
        await pt.click('#cm-rows .cm-row:nth-child(2) summary')
        await pt.select_option('#cm-e1', 'usado'); await pt.fill('#cm-o1', 'con caja')
        await shot(pt, 'comodato-equipos.png')
        await pt.click('#cmform button[type=submit]')
        await pt.wait_for_selector('#cmform', state='detached', timeout=8000)
        try:
            await pt.wait_for_function("document.querySelector('.cm-block') && document.querySelector('.cm-block').innerText.includes('Huawei')", timeout=8000)
        except Exception:
            print('DEBUG', await pt.evaluate("JSON.stringify({c:S.clientes.get('cUno'),perms:S.perms,blk:document.querySelector('.cm-block')&&document.querySelector('.cm-block').outerHTML,mods:document.querySelectorAll('.sheet,.modal').length})"))
            raise
        c = cliente_srv(TA, 'cUno')
        check('los equipos quedan guardados en el cliente (servidor)', len(c.get('comodato', [])) == 2 and c['comodato'][0]['s'] == '2C:3A:E8:11:AA:BB' and c['comodato'][0]['d'] == 'Huawei HG8145V5' and c['comodato'][1]['d'] == 'TP-Link Archer C6' and c['comodato'][1]['s'] == '50:D4:F7:A1:B2:C3' and c['comodato'][1]['o'] == 'con caja', c.get('comodato'))
        ft = await pt.inner_text('.cm-block')
        check('la ficha lista los equipos y avisa que falta el contrato', 'Huawei HG8145V5' in ft and 'TP-Link Archer C6' in ft and 'Falta el contrato de comodato firmado' in ft, ft)
        await shot(pt, 'comodato-ficha.png')

        # 3) el cliente firma con el dedo
        await pt.click('[data-cm=firmar][data-motivo=alta]'); await pt.wait_for_selector('#ctf1')
        check('el formulario trae los datos del cliente (sin DNI: el técnico no lo ve)', await pt.input_value('#ct-nom') == 'Cejas Rosa' and await pt.input_value('#ct-dni') == '' and await pt.input_value('#ct-dir') == 'Calle 9 N° 123')
        await pt.click('#ctf1 button[type=submit]')
        check('pide el DNI antes de seguir', await pt.query_selector('#ctf1') is not None)
        await pt.fill('#ct-nom', 'Rosa Graciela Cejas'); await pt.fill('#ct-dni', '20111222')
        await pt.click('#ctf1 button[type=submit]'); await pt.wait_for_selector('#ct-doc')
        doc = await pt.inner_text('#ct-doc')
        check('muestra el contrato armado con el titular, el DNI, los equipos y la empresa', 'Rosa Graciela Cejas' in doc and '20.111.222' in doc and '1. ONU Huawei HG8145V5' in doc and 'con domicilio en Calle 1 de Añatuya' in doc and 'Fibra óptica «INTERNET CABLEADO»' in doc and '{{' not in doc, doc[:300])
        check('no se puede firmar sin firma ni tilde', await pt.is_disabled('#ct-go'))
        await pt.check('#ct-ok')
        check('con el tilde pero sin firma sigue sin poder firmar', await pt.is_disabled('#ct-go'))
        await pt.mouse.move(100, 400); await firmar_en_canvas(pt)
        await pt.wait_for_function("!document.querySelector('#ct-go').disabled", timeout=3000)
        check('al firmar con el dedo se habilita «Firmar y guardar»', True)
        await shot(pt, 'comodato-firma.png')
        await pt.click('#ct-clr')
        check('«Borrar y firmar de nuevo» limpia la firma', await pt.is_disabled('#ct-go'))
        await firmar_en_canvas(pt)
        await pt.wait_for_function("!document.querySelector('#ct-go').disabled", timeout=3000)
        await pt.click('#ct-go'); await pt.wait_for_selector('#ct-ver', timeout=8000)
        check('confirma «Contrato N° 0001 firmado y guardado»', 'Contrato N° 0001 firmado y guardado' in await pt.inner_text('#ctw'))
        ks = contratos(TA, 'cUno')
        check('en el servidor queda vigente, con firma PNG y código de verificación', len(ks) == 1 and ks[0]['estado'] == 'vigente' and ks[0]['motivo'] == 'alta' and ks[0]['por'] == 'Fernando Paz', ks)
        st, d = api('GET', '/api/contrato/' + ks[0]['id'], None, TA)
        k = d['contrato']
        check('guarda la firma dibujada (imagen PNG), el texto y la huella', k['firma'].startswith('data:image/png;base64,') and len(k['firma']) > 800 and len(k['hash']) == 64 and 'Rosa Graciela Cejas' in k['texto'] and k['aclar'] == 'Rosa Graciela Cejas', len(k['firma']))
        await pt.click('#ct-ver'); await pt.wait_for_selector('.sig-img')
        vt = await pt.inner_text('.sheet')
        check('el técnico ve el contrato firmado, sin el DNI y sin poder borrarlo ni aprobarlo', '20.111.222' not in vt and '••••••••' in vt and await pt.query_selector('[data-ct=borrar]') is None and await pt.query_selector('[data-ct=aprobar]') is None and await pt.query_selector('[data-ct=imprimir]') is not None, vt[:200])
        await shot(pt, 'comodato-contrato.png')
        await pt.click('#ct-cerrar'); await pt.wait_for_selector('.cm-block')
        ft = await pt.inner_text('.cm-block')
        check('la ficha muestra «Contrato N° 0001 firmado» y las opciones de cambio', 'Contrato N° 0001 firmado el' in ft and await pt.query_selector('[data-cm=firmar][data-motivo=titularidad]') is not None and await pt.query_selector('[data-cm=firmar][data-motivo=alta]') is None, ft)
        await pt.evaluate("closeModal()")
        await pt.click('#cl-seg [data-f=sincontrato]')
        l = await pt.evaluate("[...document.querySelectorAll('[data-open-client]')].map(b=>b.innerText)")
        check('«Sin contrato firmado» lista solo al cliente que no firmó', len(l) == 1 and 'Otro Cliente' in l[0], l)

        # 4) cambio de titularidad: firma el nuevo titular y queda en revisión
        await pt.evaluate("openClient('cUno')"); await pt.wait_for_selector('[data-cm=firmar][data-motivo=titularidad]')
        await pt.click('[data-cm=firmar][data-motivo=titularidad]'); await pt.wait_for_selector('#ctf1')
        check('el cambio de titularidad pide los datos de la persona nueva (no trae los del anterior)', await pt.input_value('#ct-nom') == '' and await pt.input_value('#ct-dir') == 'Calle 9 N° 123')
        await pt.fill('#ct-nom', 'Juan Carlos Díaz'); await pt.fill('#ct-dni', '30111222'); await pt.fill('#ct-tel', '3844999999')
        await pt.click('#ctf1 button[type=submit]'); await pt.wait_for_selector('#ct-doc')
        await pt.check('#ct-ok'); await firmar_en_canvas(pt)
        await pt.wait_for_function("!document.querySelector('#ct-go').disabled", timeout=3000)
        await pt.click('#ct-go'); await pt.wait_for_selector('#ct-ver', timeout=8000)
        check('el nuevo contrato queda «en revisión» y lo avisa', 'esperando' in (await pt.inner_text('#ctw')).lower() or 'revisión' in await pt.inner_text('#ctw'))
        await pt.click('#ct-fin'); await pt.wait_for_selector('.cm-block')
        ft = await pt.inner_text('.cm-block')
        check('mientras tanto, la ficha dice que espera la revisión y que el anterior sigue vigente', 'esperando la revisión de la oficina' in ft and 'sigue vigente el contrato N° 0001' in ft and await pt.query_selector('[data-cm=firmar]') is None, ft)
        ks = contratos(TA, 'cUno')
        check('en el servidor: uno vigente y uno en revisión', sorted(k['estado'] for k in ks) == ['revision', 'vigente'], ks)
        await pt.evaluate("closeModal()")

        # 5) la oficina lo revisa y lo aprueba
        po = await login(await nuevo(br), 'ofi', 'brenda123')
        await po.wait_for_function('S.clientes.size === 2 && S.contratosOk', timeout=10000)
        await po.click('#tabs [data-tab=clientes]'); await po.wait_for_selector('#cl-ct-go')
        check('la oficina ve el aviso «Hay 1 contrato esperando tu revisión»', 'Hay 1 contrato esperando' in await po.inner_text('#cl-ct'), await po.inner_text('#cl-ct'))
        l = await po.evaluate("[...document.querySelectorAll('[data-open-client]')].map(b=>b.innerText.replace(/\\s+/g,' '))")
        check('y el cliente figura con «Contrato en revisión»', any('Cejas Rosa' in x and 'Contrato en revisión' in x for x in l), l)
        await po.click('#cl-ct-go'); await po.wait_for_selector('#ctp-list [data-open]')
        await shot(po, 'comodato-panel.png')
        rows = await po.evaluate("[...document.querySelectorAll('#ctp-list .item')].map(b=>b.innerText.replace(/\\s+/g,' '))")
        check('el panel lista el contrato en revisión con el nuevo titular', len(rows) == 1 and 'Juan Carlos Díaz' in rows[0] and 'Cambio de titularidad' in rows[0], rows)
        await po.click('#ctp-list [data-open]'); await po.wait_for_selector('[data-ct=aprobar]')
        vt = await po.inner_text('.sheet')
        check('la oficina ve el DNI, el registro y el contrato que reemplaza', '30.111.222' in vt and 'Reemplaza al' in vt and 'Registro' in vt and 'Firmado' in vt, vt[:300])
        await shot(po, 'comodato-revision.png')
        await po.click('[data-ct=aprobar]'); await po.wait_for_selector('#ap-cli')
        await po.fill('#ap-nota', 'Vi el DNI del nuevo titular')
        await po.click('.sheet [data-act=yes]')
        await po.wait_for_function("((document.querySelector('.sheet')||{innerText:''}).innerText.includes('Vigente'))", timeout=8000)
        ks = contratos(TA, 'cUno')
        check('al aprobar: el nuevo es el vigente y el anterior queda archivado', sorted(k['estado'] for k in ks) == ['archivado', 'vigente'] and [k for k in ks if k['estado'] == 'vigente'][0]['num'] == 2, ks)
        c = cliente_srv(TA, 'cUno')
        check('y la ficha del cliente se actualiza con el nuevo titular', c['nombre'] == 'Juan Carlos Díaz' and c['dni'] == '30111222' and c['tel'] == '3844999999', c)
        await pt.wait_for_function("[...S.contratos.values()].some(r=>r.cid==='cUno'&&r.estado==='archivado')", timeout=6000)
        check('el celular del técnico se enteró en vivo del archivo', True)

        # 6) borrar: solo la oficina; va a la papelera y se restaura
        await po.evaluate("closeModal()")
        await po.evaluate("openContratos()"); await po.wait_for_selector('#ctp-seg')
        await po.click('#ctp-seg [data-t=vigente]')
        await po.click('#ctp-list [data-open]'); await po.wait_for_selector('[data-ct=borrar]')
        await po.click('[data-ct=borrar]'); await po.wait_for_selector('#cm-mot')
        await po.click('.sheet [data-act=yes]')
        check('borrar pide el motivo', await po.query_selector('#cm-mot') is not None)
        await po.fill('#cm-mot', 'Lo firmó la persona equivocada'); await po.click('.sheet [data-act=yes]')
        await po.wait_for_selector('[data-ct=restaurar]', timeout=8000)
        ks = contratos(TA, 'cUno')
        check('queda en la papelera (no se borra de verdad) y sale de la lista normal', len(ks) == 1 and ks[0]['estado'] == 'archivado', ks)
        st, j = api('GET', '/api/contratos?papelera=1', None, TA)
        check('la papelera lo conserva', len(j['contratos']) == 1 and j['contratos'][0]['num'] == 2)
        await pt.wait_for_function("![...S.contratos.values()].some(r=>r.num===2)", timeout=6000)
        check('el técnico ya no lo ve', True)
        await po.click('[data-ct=restaurar]')
        await po.wait_for_function("((document.querySelector('.sheet')||{innerText:''}).innerText.includes('Vigente'))", timeout=8000)
        ks = contratos(TA, 'cUno')
        check('restaurar lo deja como estaba (vigente)', sorted(k['estado'] for k in ks) == ['archivado', 'vigente'], ks)
        await po.click('[data-ct=verificar]')
        await po.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('Íntegro'))", timeout=5000)
        check('«Verificar integridad» confirma que el contrato no se tocó', True)

        # 7) si cambian los equipos, la ficha avisa que el contrato ya no coincide
        await pt.evaluate("closeModal()")
        await pt.evaluate("openComodatoEditor('cUno')"); await pt.wait_for_selector('#cmform')
        await pt.click('#cm-add'); await pt.select_option('#cm-t2', 'Antena')
        check('al cambiar el equipo a Antena, el modelo viene de la lista (LiteBeam Gen2)', await pt.input_value('#cm-m2') == 'CPE Ubiquiti LiteBeam Gen2')
        await pt.fill('#cm-s2', '24a43c0102ab')
        await pt.click('#cmform button[type=submit]'); await pt.wait_for_selector('.cm-block')
        ft = await pt.inner_text('.cm-block')
        check('al agregar un equipo avisa que cambiaron desde la firma y ofrece firmar el cambio', 'cambiaron desde que se firmó' in ft and await pt.query_selector('[data-cm=firmar][data-motivo=equipos]') is not None, ft)
        await ctxT.close()
        await br.close()
    # el único error de consola esperado es el rechazo a propósito del texto con «BORRADOR» (se prueba arriba)
    ERR[:] = [e for e in ERR if 'Todavía dice «BORRADOR»' not in e]
    check('sin errores de consola en ninguna de las tres sesiones', not ERR, ERR[:3])
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
