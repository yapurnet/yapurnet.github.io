# Cobro repartido entre 2 medios de pago (instalación de 65.000 = 50.000 por transferencia + 15.000 en efectivo): un recibo, un registro por medio.
# El técnico lo hace al cerrar la orden y desde «Cobrar»; la oficina también. Chromium real contra el servidor de verdad (workerd).
import asyncio, base64, json, os, sys, time, urllib.request, urllib.error
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
async def foto(pg):
    d = await pg.evaluate("""(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 1600, 1200); x.fillStyle = '#123'; x.font = '28px sans-serif';
      for (let i = 0; i < 30; i++) x.fillText('Transferencia realizada - comprobante ' + i, 20, 40 + i * 38);
      for (let i = 0; i < 4000; i++) { x.fillStyle = 'rgb(' + (i * 7 % 255) + ',' + (i * 13 % 255) + ',' + (i * 29 % 255) + ')'; x.fillRect((i * 37) % 1600, (i * 91) % 1200, 6, 6); }
      return c.toDataURL('image/jpeg', 0.95); })()""")
    return {'name': 'comprobante.jpg', 'mimeType': 'image/jpeg', 'buffer': base64.b64decode(d.split(',')[1])}
async def adjuntar(pg, px):
    await pg.set_input_files('#%s-comp-f' % px, await foto(pg))
    await pg.wait_for_function("document.querySelector('#%s-comp-st').textContent.includes('Foto lista')" % px, timeout=15000)
def pagos(tok, cid):
    st, j = api('GET', '/api/mis-cobros?dias=1', None, tok)
    return [it for d in (j or {}).get('docs', []) for it in d['data']['items'].values() if it.get('c') == cid]
def pagos_admin(tok, cid):
    out = []
    st, j = api('GET', '/api/sync', None, tok)
    for d in ((j or {}).get('cols') or {}).get('pagos', []):
        for it in (d.get('data') or {}).get('items', {}).values():
            if it.get('c') == cid: out.append(it)
    return out

async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {'cobrarCampo': True}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    for cid, nombre, est in (('g', 'Guillerma Luna', 'pendiente'), ('h', 'Hugo Pendiente', 'pendiente'), ('i', 'Ines Instalar', 'pendiente'), ('k', 'Karina Activa', 'activo')):
        it = {'nombre': nombre, 'estado': est, 'planId': 'p1', 'dir': 'Calle ' + cid, 'tel': '38440000' + str(ord(cid))}
        if est == 'activo': it.update({'desde': cur, 'alta': hoy})
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: it}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'instalacion', 'clientId': 'g', 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': pedro['id']}}}}, TA)
    TP = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token']
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el técnico cierra la orden de instalación y cobra 50.000 por transferencia + 15.000 en efectivo
        pg = await login(await nuevo(), 'pedro', 'pedro123')
        await pg.evaluate("openFinishOrder(S.ordenes.get('o1'))"); await pg.wait_for_selector('#fform')
        await pg.check('#ff-cobro')
        check('el cierre ofrece «Cobrar con 2 medios de pago»', await pg.is_visible('#ff-dv-on') and 'Cobrar con 2 medios de pago' in await pg.inner_text('#ff-dv-box'), await pg.inner_text('#fform'))
        check('mientras no se usa, el reparto está oculto y el monto fijo se ve', not await pg.is_visible('#ff-dv') and await pg.is_visible('#ff-monto') and await pg.input_value('#ff-monto') == '65000')
        await pg.click('#ff-dv-on')
        check('al tocarlo aparecen los dos medios y desaparecen el medio y el monto de siempre', await pg.is_visible('#ff-dv') and not await pg.is_visible('#ff-monto') and not await pg.is_visible('#ff-met') and not await pg.is_visible('#ff-dv-on'))
        check('el segundo medio es distinto del primero y como hay una transferencia pide la foto', await pg.input_value('#ff-dv-m1') != await pg.input_value('#ff-dv-m2') and await pg.is_visible('#ff-comp'))
        await pg.select_option('#ff-dv-m1', 'transferencia'); await pg.select_option('#ff-dv-m2', 'efectivo')
        await pg.fill('#ff-dv-a1', '50.000')
        check('al escribir 50.000 el otro medio se completa solo con 15.000', await pg.input_value('#ff-dv-a2') == '15000', await pg.input_value('#ff-dv-a2'))
        st_ = await pg.inner_text('#ff-dv-st')
        check('muestra cómo queda: Transferencia 50.000 + Efectivo 15.000 = 65.000', 'Transferencia' in st_ and '50.000' in st_ and 'Efectivo' in st_ and '15.000' in st_ and '65.000' in st_, st_)
        await pg.fill('#ff-dv-a2', '5000')
        check('si cambia el segundo, el primero se ajusta para seguir sumando 65.000', await pg.input_value('#ff-dv-a1') == '60000', await pg.input_value('#ff-dv-a1'))
        await pg.fill('#ff-dv-a1', '0')
        check('con un monto en cero avisa que falta escribir cada medio', 'cada medio' in await pg.inner_text('#ff-dv-st') and 'bad' in (await pg.get_attribute('#ff-dv-st', 'class')))
        await pg.select_option('#ff-dv-m2', 'transferencia')
        check('si se repite el medio, el otro cambia solo (nunca dos iguales)', await pg.input_value('#ff-dv-m1') != await pg.input_value('#ff-dv-m2'), [await pg.input_value('#ff-dv-m1'), await pg.input_value('#ff-dv-m2')])
        await pg.select_option('#ff-dv-m1', 'transferencia'); await pg.select_option('#ff-dv-m2', 'efectivo'); await pg.fill('#ff-dv-a1', '50000')
        await pg.fill('#ff-res', 'Se instaló la ONU, señal -19 dBm.')
        if os.environ.get('VIS_OUT'):
            await pg.evaluate("document.querySelector('#ff-cobro').scrollIntoView({block:'start'})"); await pg.wait_for_timeout(200)
            await pg.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'varios-medios-orden.png'))
        await pg.click('#fform button[type=submit]'); await pg.wait_for_timeout(600)
        check('sin la foto de la transferencia no se cierra la orden ni se cobra nada', await pg.query_selector('#fform') is not None and pagos(TP, 'g') == [] and (api('GET', '/api/doc/ordenes/' + cur, None, TA)[1]['data']['items']['o1']['estado'] == 'en_curso'))
        await adjuntar(pg, 'ff')
        await pg.click('#fform button[type=submit]'); await pg.wait_for_selector('.rc', timeout=10000)
        rc = await pg.inner_text('.rc')
        check('el recibo muestra los dos medios (efectivo figura como «Contado») y el total de 65.000', 'Transferencia' in rc and 'Contado' in rc and '50.000' in rc and '15.000' in rc and '65.000' in rc and 'Instalación' in rc, rc)
        pg_ = pagos(TP, 'g')
        check('quedaron dos registros del mismo recibo que suman 65.000', len(pg_) == 2 and len({x['recibo'] for x in pg_}) == 1 and sum(x['monto'] for x in pg_) == 65000 and {x['metodo'] for x in pg_} == {'transferencia', 'efectivo'}, pg_)
        tr = next(x for x in pg_ if x['metodo'] == 'transferencia'); ef = next(x for x in pg_ if x['metodo'] == 'efectivo')
        check('50.000 en transferencia (con la foto) y 15.000 en efectivo (sin foto)', tr['monto'] == 50000 and tr.get('comp') and ef['monto'] == 15000 and 'comp' not in ef, [tr, ef])
        check('la orden quedó hecha', api('GET', '/api/doc/ordenes/' + cur, None, TA)[1]['data']['items']['o1']['estado'] == 'hecha')
        await pg.click('.sheet [data-close]')

        # 2) el técnico desde «Cobrar»: lo mismo con otro cliente
        await pg.evaluate("openCobro('h')"); await pg.wait_for_selector('#cb-go')
        check('«Cobrar» también ofrece repartir en 2 medios', await pg.is_visible('#cb-dv-on'))
        await pg.click('#cb-dv-on')
        await pg.select_option('#cb-dv-m1', 'efectivo'); await pg.select_option('#cb-dv-m2', 'transferencia')
        await pg.fill('#cb-dv-a1', '15000')
        check('completa solo los 50.000 de la transferencia', await pg.input_value('#cb-dv-a2') == '50000', await pg.input_value('#cb-dv-a2'))
        await pg.click('#cb-go'); await pg.wait_for_timeout(600)
        check('sin foto no registra el cobro', await pg.query_selector('#cb-go') is not None and pagos(TP, 'h') == [])
        await adjuntar(pg, 'cb')
        await pg.click('#cb-go'); await pg.wait_for_selector('.rc', timeout=10000)
        ph = pagos(TP, 'h')
        check('queda un recibo con 15.000 en efectivo y 50.000 en transferencia', len(ph) == 2 and len({x['recibo'] for x in ph}) == 1 and sorted((x['metodo'], x['monto']) for x in ph) == [('efectivo', 15000), ('transferencia', 50000)], ph)
        check('la foto va solo en la transferencia', [bool(x.get('comp')) for x in sorted(ph, key=lambda x: x['metodo'])] == [False, True], ph)
        await pg.click('.sheet [data-close]')
        # el servidor sigue sin dejar cobrar la instalación otra vez
        await pg.evaluate("openCobro('h')"); await pg.wait_for_selector('#cb-go')
        check('y la instalación ya no se ofrece de nuevo a ese cliente', 'instalacion' not in await pg.evaluate("[...document.querySelectorAll('#cb-con [data-con]')].map(b=>b.dataset.con)"))
        await pg.click('.sheet [data-close]')

        # 3) la oficina: reparte como quiera; mensualidad no se reparte acá
        og = await login(await nuevo(), 'laura', 'laura123')
        await og.evaluate("openCobro('i','instalacion')"); await og.wait_for_selector('#cb-go')
        check('la oficina también tiene el reparto', await og.is_visible('#cb-dv-on'))
        await og.click('#cb-dv-on')
        await og.select_option('#cb-dv-m1', 'efectivo'); await og.select_option('#cb-dv-m2', 'transferencia')
        await og.fill('#cb-dv-a1', '40000'); await og.fill('#cb-dv-a2', '20000')
        check('la oficina puede cobrar otro importe (por ejemplo con descuento): suma lo que escribe', 'Efectivo' in await og.inner_text('#cb-dv-st') and '60.000' in await og.inner_text('#cb-dv-st'), await og.inner_text('#cb-dv-st'))
        check('sin foto para la oficina (ve el banco)', not await og.is_visible('#cb-comp') and await og.query_selector('#cb-comp') is None)
        await og.click('#cb-go'); await og.wait_for_selector('.rc', timeout=10000)
        pi_ = pagos_admin(TA, 'i')
        check('quedan los dos registros del mismo recibo', len(pi_) == 2 and len({x['recibo'] for x in pi_}) == 1 and sum(x['monto'] for x in pi_) == 60000, pi_)
        await og.click('.sheet [data-close]')
        await og.evaluate("openCobro('k')"); await og.wait_for_selector('#cb-go')
        con0 = await og.evaluate("document.querySelector('#cb-con [aria-pressed=true]').dataset.con")
        check('en una mensualidad no se ofrece el reparto (para eso está «Pagar deuda»)', con0 == 'mensualidad' and not await og.is_visible('#cb-dv-on'), con0)
        await og.click('#cb-con [data-con=otro]')
        check('al pasar a «Otro» sí', await og.is_visible('#cb-dv-on'))
        await og.click('#cb-dv-on'); await og.click('#cb-con [data-con=mensualidad]')
        check('y si se vuelve a mensualidad el reparto se cierra y vuelve el monto de siempre', not await og.is_visible('#cb-dv') and await og.is_visible('#cb-monto') and not await og.is_visible('#cb-dv-on'))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
