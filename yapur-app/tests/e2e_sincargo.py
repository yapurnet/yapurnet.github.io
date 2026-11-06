# «Servicio sin cargo» (la casa del dueño, la de los padres): sigue activo pero no genera deuda, figura «Al día», no aparece entre los morosos ni para cortar.
# Lo marca y lo saca solo el administrador; la oficina y los técnicos no ven el casillero ni el motivo. Chromium real contra el servidor de verdad (workerd).
import asyncio, datetime, json, os, re, sys, time, urllib.request, urllib.error
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
def cliente(tok, cid):
    st, j = api('GET', '/api/doc/clientes/' + shard(cid), None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(cid)
def meses_atras(n):
    d = datetime.date.today().replace(day=1)
    for _ in range(n): d = (d - datetime.timedelta(days=1)).replace(day=1)
    return d.strftime('%Y-%m')

async def main():
    cur = time.strftime('%Y-%m'); m3 = meses_atras(3)
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'bajada': 50, 'subida': 20, 'precio': 20000, 'tecnologia': 'fibra', 'activo': True}}, TA)
    base = {'estado': 'activo', 'planId': 'p1', 'alta': m3 + '-05', 'desde': m3, 'ciclo': 1, 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '3844000111'}
    for cid, nombre, extra in (('m', 'Yapur Mauro', {}), ('p', 'Yapur Padres', {'sinCargo': True, 'sinCargoMotivo': 'Es mi casa'}), ('x', 'Moroso Normal', {})):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: dict(base, nombre=nombre, **extra)}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844})
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el administrador ve que el cliente «sin cargo» no debe nada
        pg = await login(await nuevo(), 'mauro', 'claveSegura1')
        st_ = await pg.evaluate("({p:billing(S.clientes.get('p')), m:billing(S.clientes.get('m')), x:billing(S.clientes.get('x')), cp:cutState(S.clientes.get('p')).k, cx:cutState(S.clientes.get('x')).k})")
        check('«Yapur Padres» (sin cargo) no tiene deuda ni meses vencidos; los otros dos sí', st_['p']['vencidos'] == 0 and st_['p']['deuda'] == 0 and st_['m']['vencidos'] > 0 and st_['x']['vencidos'] > 0, st_)
        check('y el control de cortes lo da por «ok» (no se corta)', st_['cp'] == 'ok' and st_['cx'] != 'ok', st_)
        await pg.click('#tabs [data-tab=resumen]'); await pg.wait_for_selector('#rs .kpi.bad')
        check('el Resumen cuenta 2 morosos (no 3)', '2 clientes' in await pg.inner_text('#rs .kpi.bad .l'), await pg.inner_text('#rs .kpi.bad .l'))
        fact = await pg.evaluate("[...document.querySelectorAll('#rs .kpi')].find(k=>/Facturación mensual/.test(k.innerText)).querySelector('.n').innerText")
        dig = re.sub(r'\D', '', fact)
        check('la facturación mensual esperada deja afuera al «sin cargo» (2 planes, no 3)', int(dig[:5]) == 40000 or int(dig) in (40000, 4000000), fact)
        await pg.click('#tabs [data-tab=cobranzas]'); await pg.wait_for_selector('#cb-sub [data-s=morosos]')
        await pg.click('#cb-sub [data-s=morosos]'); await pg.wait_for_selector('#cb-body .item, #cb-body .hint')
        mor = await pg.inner_text('#cb-body')
        check('en Morosos figuran los que deben y no «Yapur Padres»', 'Moroso Normal' in mor and 'Yapur Mauro' in mor and 'Yapur Padres' not in mor, mor[:300])
        await pg.click('#cb-sub [data-s=cortes]'); await pg.wait_for_timeout(300)
        cor = await pg.inner_text('#cb-body')
        check('en «A cortar» tampoco aparece «Yapur Padres»', 'Yapur Padres' not in cor, cor[:300])
        # filtro de la lista de clientes
        await pg.click('#tabs [data-tab=clientes]'); await pg.wait_for_selector('#cl-seg [data-f=sincargo]')
        await pg.click('#cl-seg [data-f=sincargo]'); await pg.wait_for_timeout(300)
        lst = await pg.inner_text('#view')
        check('el filtro «Sin cargo» muestra solo a «Yapur Padres»', 'Yapur Padres' in lst and 'Yapur Mauro' not in lst and 'Moroso Normal' not in lst, lst[:300])
        check('y su etiqueta dice «Sin cargo · Al día»', 'Sin cargo · Al día' in lst, lst[:300])
        # la ficha
        await pg.evaluate("openClient('p')"); await pg.wait_for_selector('.sheet')
        ficha = await pg.inner_text('.sheet')
        check('la ficha avisa «Servicio sin cargo: Es mi casa» al administrador', 'Servicio sin cargo: Es mi casa' in ficha and 'nunca se corta' in ficha, ficha[:500])
        await pg.click('.sheet [data-close]'); await pg.wait_for_selector('.sheet', state='detached')
        # cobrar a uno sin cargo: el aviso
        await pg.evaluate("openCobro('p')"); await pg.wait_for_selector('.sheet')
        check('al cobrar, avisa que no se le cobra mensualidad', 'No se le cobra mensualidad' in await pg.inner_text('.sheet'), await pg.inner_text('.sheet'))
        await pg.click('.sheet [data-close]'); await pg.wait_for_selector('.sheet', state='detached')
        # 2) el administrador marca a «Yapur Mauro», que hoy debe: avisa que esa deuda deja de contarse
        await pg.evaluate("openClientForm('m')"); await pg.wait_for_selector('#cform')
        check('el casillero «Servicio sin cargo» está, sin marcar y con el motivo oculto', await pg.query_selector('#cf-sc') is not None and not await pg.is_checked('#cf-sc') and not await pg.is_visible('#cf-sc-box'))
        await pg.check('#cf-sc'); await pg.wait_for_selector('#cf-sc-box', state='visible')
        warn = await pg.inner_text('#cf-sc-warn')
        check('al marcarlo avisa cuánto debe hoy y que esa deuda deja de contarse', 'Hoy debe' in warn and 'deja de contarse' in warn, warn)
        await pg.fill('#cf-scm', 'Mi casa')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('m').sinCargo === true", timeout=8000)
        m = cliente(TA, 'm')
        check('en el servidor queda sin cargo y con el motivo', m.get('sinCargo') is True and m.get('sinCargoMotivo') == 'Mi casa', m)
        await pg.click('#tabs [data-tab=resumen]'); await pg.wait_for_selector('#rs .kpi.bad')
        check('el Resumen pasa a 1 moroso', '1 cliente' in await pg.inner_text('#rs .kpi.bad .l') and '2 clientes' not in await pg.inner_text('#rs .kpi.bad .l'), await pg.inner_text('#rs .kpi.bad .l'))
        # 3) la oficina lo ve «sin cargo» pero no puede cambiarlo ni ve el motivo
        po = await login(await nuevo(), 'laura', 'laura123')
        await po.click('#tabs [data-tab=clientes]'); await po.wait_for_selector('#cl-seg')
        check('la oficina tiene el filtro «Sin cargo» (para saber quiénes son)', await po.query_selector('#cl-seg [data-f=sincargo]') is not None)
        await po.evaluate("openClient('m')"); await po.wait_for_selector('.sheet')
        fo = await po.inner_text('.sheet')
        check('la oficina ve el aviso «Servicio sin cargo» pero no el motivo', 'Servicio sin cargo.' in fo and 'Mi casa' not in fo, fo[:400])
        await po.click('.sheet [data-close]'); await po.wait_for_selector('.sheet', state='detached')
        await po.evaluate("openClientForm('m')"); await po.wait_for_selector('#cform')
        check('en el formulario de la oficina no existe el casillero ni el motivo', await po.query_selector('#cf-sc') is None and await po.query_selector('#cf-scm') is None)
        check('y el motivo no le llega a su pantalla', await po.evaluate("S.clientes.get('m').sinCargo === true && S.clientes.get('m').sinCargoMotivo === undefined"))
        await po.fill('#cf-tel', '3844555666'); await po.click('#cform button[type=submit]')
        await po.wait_for_function("S.clientes.get('m').tel === '3844555666'", timeout=8000)
        m = cliente(TA, 'm')
        check('la oficina puede seguir editando la ficha sin perder la marca ni el motivo', m.get('sinCargo') is True and m.get('sinCargoMotivo') == 'Mi casa' and m.get('tel') == '3844555666', m)
        # 4) el técnico no ve nada de esto
        pt = await login(await nuevo(), 'pedro', 'pedro123')
        await pt.wait_for_function("S.loaded && S.loaded.clientes", timeout=8000)
        check('al técnico no le llega la marca ni el motivo de ningún cliente', await pt.evaluate("![...S.clientes.values()].some(c => c.sinCargo || c.sinCargoMotivo)"))
        # 5) el administrador le saca la marca a «Yapur Padres»: se cobra desde este mes, no desde la alta
        await pg.click('#tabs [data-tab=clientes]'); await pg.wait_for_selector('#cl-seg')
        await pg.evaluate("openClientForm('p')"); await pg.wait_for_selector('#cform')
        check('el formulario trae marcado el casillero y el motivo cargado', await pg.is_checked('#cf-sc') and await pg.input_value('#cf-scm') == 'Es mi casa')
        await pg.uncheck('#cf-sc')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("!S.clientes.get('p').sinCargo", timeout=8000)
        pcl = cliente(TA, 'p')
        check('al sacarle la marca se borra el motivo y se cobra desde este mes (no desde la alta)', not pcl.get('sinCargo') and not pcl.get('sinCargoMotivo') and pcl.get('desde') == cur, pcl)
        b = await pg.evaluate("billing(S.clientes.get('p'))")
        check('y no aparecen de golpe meses viejos como deuda', b['vencidos'] == 0 and b['sinCargo'] is False, b)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
