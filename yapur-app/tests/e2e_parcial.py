# Instalación cobrada en parte (el cliente dio solo $35.000 de $65.000): el técnico carga lo que le dieron, queda el saldo y la oficina lo cobra.
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
ERR = []
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
def orden(tok, oid, cur):
    st, j = api('GET', '/api/doc/ordenes/' + cur, None, tok); return ((j or {}).get('data') or {}).get('items', {}).get(oid)

async def main():
    hoy = time.strftime('%Y-%m-%d'); cur = time.strftime('%Y-%m')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123', 'permisos': {'cobrarCampo': True}}, TA)
    api('POST', '/api/users', {'usuario': 'laura', 'nombre': 'Laura', 'role': 'oficina', 'clave': 'laura123'}, TA)
    st, ul = api('GET', '/api/users', token=TA)
    pedro = next(u for u in ul['users'] if u['usuario'] == 'pedro')
    api('PUT', '/api/doc/planes/p1', {'data': {'nombre': 'Hogar 50', 'precio': 20000}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('g'), {'data': {'items': {'g': {'nombre': 'Isabel Landriel', 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle g', 'tel': '3844000001'}}}}, TA)
    api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {'o1': {'tipo': 'instalacion', 'clientId': 'g', 'estado': 'en_curso', 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy, 'tecnico': pedro['id']}}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        pg = await login(await nuevo(), 'pedro', 'pedro123')
        await pg.click('#tabs [data-tab=ordenes]'); await pg.wait_for_selector('[data-oid="o1"]')
        await pg.click('[data-oid="o1"] [data-oact=next]'); await pg.wait_for_selector('#fform')
        await pg.fill('#ff-res', 'Instalada.')
        await pg.check('#ff-cobro')
        check('el monto es el precio fijo y no se puede tocar', await pg.input_value('#ff-monto') == '65000' and await pg.get_attribute('#ff-monto', 'readonly') is not None)
        check('aparece «El cliente pagó solo una parte»', await pg.is_visible('#ff-parc'))
        await pg.check('#ff-parc')
        check('al marcarlo el monto se puede escribir y queda vacío', await pg.get_attribute('#ff-monto', 'readonly') is None and await pg.input_value('#ff-monto') == '')
        await pg.fill('#ff-monto', '35000')
        check('dice cuánto queda de saldo', '30.000' in await pg.inner_text('#ff-fijo'), await pg.inner_text('#ff-fijo'))
        await pg.fill('#ff-monto', '65000'); await pg.click('#fform button[type=submit]'); await pg.wait_for_timeout(500)
        check('si pone el total no deja: pide destildar', await pg.query_selector('#fform') is not None and (orden(TA, 'o1', cur) or {}).get('estado') == 'en_curso')
        await pg.fill('#ff-monto', '35000'); await pg.click('#fform button[type=submit]')
        await pg.wait_for_selector('.rc', timeout=8000)
        rc = await pg.inner_text('.rc')
        check('el recibo es de $35.000 de Instalación y dice que es parcial', '35.000' in rc and 'Instalación' in rc and 'parcial' in rc.lower(), rc)
        tok = api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token']
        docs = api('GET', '/api/mis-cobros?dias=1', None, tok)[1]['docs']
        pagos = [x for d in docs for x in d['data']['items'].values()]
        check('se guardó un solo cobro de 35.000 con el precio de lista 65.000', len(pagos) == 1 and pagos[0]['monto'] == 35000 and pagos[0]['lista'] == 65000, pagos)
        check('la orden queda hecha', (orden(TA, 'o1', cur) or {}).get('estado') == 'hecha')
        await pg.click('.sheet [data-close]')
        og = await login(await nuevo(), 'laura', 'laura123')
        await og.click('#tabs [data-tab=ordenes]'); await og.wait_for_selector('#or-pend .notice')
        av = await og.inner_text('#or-pend')
        check('la oficina ve el aviso de instalación sin cobrar del todo', 'Isabel Landriel' in av, av)
        await og.click('[data-f=hechas]'); await og.wait_for_selector('[data-oid="o1"] [data-oact=cobrar]')
        card = await og.inner_text('[data-oid="o1"]')
        check('la orden dice que faltan $30.000', 'cobrada en parte' in card.lower() and '30.000' in card, card)
        await og.click('[data-oid="o1"] [data-oact=cobrar]'); await og.wait_for_selector('#cb-go')
        check('«Cobrar el saldo» propone los $30.000', await og.input_value('#cb-monto') == '30000', await og.input_value('#cb-monto'))
        # cobro junto: saldo de la instalación + mensualidad en un solo recibo
        await og.click('.sheet [data-close]')
        api('PATCH', '/api/doc/clientes/' + shard('g'), {'data': {'items': {'g': {'estado': 'activo', 'alta': hoy, 'desde': hoy[:7]}}}}, TA)
        await og.wait_for_function("S.clientes.get('g').estado==='activo'", timeout=8000)
        await og.evaluate("openCobro('g')"); await og.wait_for_selector('#cb-go')
        hay = await og.query_selector('#cb-sinst') is not None
        check('con meses pendientes aparece «cobrar también el saldo»', hay)
        if hay:
            if not await og.evaluate("!![...document.querySelectorAll('[data-per]')].some(i=>i.checked)"): await og.click('[data-per]')
            await og.click('#cb-sinst')
            per = await og.evaluate("[...document.querySelectorAll('[data-per]')].filter(i=>i.checked).reduce((t,i)=>t+Number(i.dataset.rest),0)")
            check('al tildar el saldo el monto suma meses + $30.000', float((await og.input_value('#cb-monto')).replace(',', '.')) == per + 30000, (per, await og.input_value('#cb-monto')))
            await og.click('#cb-go')
            try: await og.wait_for_selector('.rc', timeout=8000)
            except Exception: print('DEBUG', await og.evaluate("[...document.querySelectorAll('.toast,[role=status],[role=alert]')].map(x=>x.innerText).join('|')"), await og.input_value('#cb-monto'), ERR); raise
            rc2 = await og.inner_text('.rc')
            cs = await og.evaluate("(()=>{const l=[...S.pagos.values()].filter(p=>p.c==='g'&&!p.anulado);return JSON.stringify({r:[...new Set(l.map(p=>p.recibo))].length,c:l.map(p=>p.concepto+':'+p.monto)})})()")
            check('el saldo y la mensualidad se grabaron juntos', 'instalacion:30000' in cs and 'mensualidad' in cs, cs)
            check('el saldo queda en cero', await og.evaluate("instSaldo(S.clientes.get('g'))") == 0)
            await og.click('.sheet [data-close]')
        else:
            await og.click('.sheet [data-close]')
            await og.evaluate("openCobro('g','instalacion')"); await og.wait_for_selector('#cb-go')
            await og.click('#cb-go'); await og.wait_for_selector('.rc', timeout=8000)
            await og.click('.sheet [data-close]')
        await og.wait_for_function("!document.querySelector('[data-oid=\"o1\"] [data-oact=cobrar]')", timeout=8000)
        check('con el saldo cobrado el aviso desaparece', await og.query_selector('#or-pend .notice') is None and await og.evaluate("instSaldo(S.clientes.get('g'))") == 0)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
