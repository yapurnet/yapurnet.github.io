# Instalación que se cierra sin cobrar (el cliente va a pagar en la oficina): el técnico tiene que decir por qué, la orden queda cerrada,
# la oficina la ve «sin cobrar» y la cobra después desde la misma orden. Chromium real contra el servidor de verdad (workerd).
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
    for cid, nombre in (('g', 'Guillerma Luna'), ('h', 'Hugo Pendiente'), ('i', 'Ines Instalada')):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: {'nombre': nombre, 'estado': 'pendiente', 'planId': 'p1', 'dir': 'Calle ' + cid, 'tel': '38440000' + str(ord(cid))}}}}, TA)
    for oid, cid, tec, est in (('o1', 'g', pedro['id'], 'pendiente'), ('o2', 'h', pedro['id'], 'en_curso'), ('o3', 'i', None, 'pendiente')):
        o = {'tipo': 'instalacion', 'clientId': cid, 'estado': est, 'prioridad': 'normal', 'fecha': hoy, 'creado': hoy}
        if tec: o['tecnico'] = tec
        api('PATCH', '/api/doc/ordenes/' + cur, {'data': {'items': {oid: o}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        async def nuevo():
            c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
            await c.route('**/fonts.g*/**', lambda r: r.abort())
            return c
        # 1) el técnico: la orden quedó «Pendiente» (nunca tocó «Salgo para allá») y la quiere cerrar
        pg = await login(await nuevo(), 'pedro', 'pedro123')
        await pg.click('#tabs [data-tab=ordenes]')
        await pg.wait_for_selector('[data-oid="o1"]')
        check('una orden pendiente ofrece «Salgo para allá» y también «Ya la terminé»', await pg.query_selector('[data-oid="o1"] [data-oact=next]') is not None and 'Ya la terminé' in await pg.inner_text('[data-oid="o1"] [data-oact=fin]'))
        check('una orden en curso solo ofrece «Terminar»', await pg.query_selector('[data-oid="o2"] [data-oact=fin]') is None and 'Terminar' in await pg.inner_text('[data-oid="o2"] [data-oact=next]'))
        await pg.click('[data-oid="o1"] [data-oact=fin]'); await pg.wait_for_selector('#fform')
        check('«Ya la terminé» abre el cierre de la orden', 'Marcar como hecha' in await pg.inner_text('#fform'))
        check('a una instalación sin cobrar se le pide el motivo si no se cobró', await pg.is_visible('#ff-motivo') and 'por qué' in (await pg.inner_text('#ff-nocobro')).lower(), await pg.inner_text('#fform'))
        opts = await pg.evaluate("[...document.querySelectorAll('#ff-motivo option')].map(o=>o.textContent)")
        check('con los motivos: pagar en la oficina, otro día, otro', 'El cliente va a pagar en la oficina' in opts and 'El cliente va a pagar otro día' in opts and 'Otro motivo' in opts, opts)
        await pg.fill('#ff-res', 'Se instaló la ONU, señal -19 dBm.')
        await pg.click('#fform button[type=submit]'); await pg.wait_for_timeout(500)
        check('sin cobrar y sin motivo no se cierra la orden', await pg.query_selector('#fform') is not None and (orden(TA, 'o1', cur) or {}).get('estado') == 'pendiente', orden(TA, 'o1', cur))
        await pg.check('#ff-cobro')
        check('al marcar «Cobré este trabajo» el motivo desaparece', not await pg.is_visible('#ff-motivo'))
        await pg.uncheck('#ff-cobro')
        check('y al desmarcarlo vuelve', await pg.is_visible('#ff-motivo'))
        await pg.select_option('#ff-motivo', 'oficina')
        check('con «pagar en la oficina» no se pide más explicación', not await pg.is_visible('#ff-motivo-nota'))
        await pg.click('#fform button[type=submit]')
        await pg.wait_for_selector('#fform', state='detached', timeout=8000)
        await pg.wait_for_function("(S.ordenes.get('o1')||{}).estado === 'hecha'", timeout=8000)
        o1 = orden(TA, 'o1', cur)
        check('la orden queda hecha, con el motivo y a nombre de quien la cerró', o1['estado'] == 'hecha' and o1['sinCobro'] == 'oficina' and o1['resultado'].startswith('Se instaló') and o1.get('tecnico') == pedro['id'], o1)
        check('no se registró ningún cobro', api('GET', '/api/mis-cobros?dias=1', None, api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token'])[1].get('docs') in ([], None) or not any(d['data']['items'] for d in api('GET', '/api/mis-cobros?dias=1', None, api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token'])[1]['docs']))
        # «Otro motivo» pide contar qué pasó
        await pg.evaluate("openFinishOrder(S.ordenes.get('o2'))"); await pg.wait_for_selector('#fform')
        await pg.select_option('#ff-motivo', 'otro')
        check('«Otro motivo» pide que se cuente qué pasó', await pg.is_visible('#ff-motivo-nota'))
        await pg.click('#fform button[type=submit]'); await pg.wait_for_timeout(500)
        check('sin explicación no se cierra', await pg.query_selector('#fform') is not None and orden(TA, 'o2', cur)['estado'] == 'en_curso')
        await pg.fill('#ff-motivo-nota', 'No estaba el dueño, deja el pago para el lunes')
        await pg.click('#fform button[type=submit]'); await pg.wait_for_selector('#fform', state='detached', timeout=8000)
        await pg.wait_for_function("(S.ordenes.get('o2')||{}).estado === 'hecha'", timeout=8000)
        o2 = orden(TA, 'o2', cur)
        check('queda con el motivo y lo que escribió', o2['sinCobro'] == 'otro' and o2['sinCobroNota'].startswith('No estaba el dueño'), o2)
        # una orden sin técnico, cerrada por quien está logueado, queda a su nombre
        await pg.evaluate("openFinishOrder(S.ordenes.get('o3'))"); await pg.wait_for_selector('#fform')
        await pg.select_option('#ff-motivo', 'otro_dia'); await pg.click('#fform button[type=submit]')
        await pg.wait_for_function("(S.ordenes.get('o3')||{}).estado === 'hecha'", timeout=8000)
        o3 = orden(TA, 'o3', cur)
        check('una orden sin técnico queda a nombre de quien la cierra', o3.get('tecnico') == pedro['id'] and o3['sinCobro'] == 'otro_dia', o3)
        await pg.click('[data-f=hechas]')
        await pg.wait_for_selector('[data-oid="o1"] .chip.warn')
        card = await pg.inner_text('[data-oid="o1"]')
        check('el técnico ve su orden cerrada como «Sin cobrar», con el motivo', 'Sin cobrar' in card and 'Instalación sin cobrar' in card and 'pagar en la oficina' in card, card)
        check('el técnico no tiene el botón de cobrarla desde la orden (la cobra la oficina)', await pg.query_selector('[data-oid="o1"] [data-oact=cobrar]') is None)
        check('ni ve el aviso de la oficina', await pg.query_selector('#or-pend .notice') is None)

        # 2) la oficina: ve el aviso arriba y cobra la instalación desde la orden
        og = await login(await nuevo(), 'laura', 'laura123')
        await og.click('#tabs [data-tab=ordenes]')
        await og.wait_for_selector('#or-pend .notice')
        av = await og.inner_text('#or-pend')
        check('arriba dice cuántas instalaciones están sin cobrar y de quién', '3 instalaciones sin cobrar' in av and 'Guillerma Luna' in av and 'va a pagar en la oficina' in av and 'Hugo Pendiente' in av, av)
        await og.click('[data-f=hechas]')
        await og.wait_for_selector('[data-oid="o1"] [data-oact=cobrar]')
        await og.click('[data-oid="o1"] [data-oact=cobrar]'); await og.wait_for_selector('#cb-go')
        check('«Cobrar la instalación» abre el cobro de ese cliente con «Instalación» elegida', 'Guillerma Luna' in await og.inner_text('.sheet') and await og.evaluate("document.querySelector('#cb-con [aria-pressed=true]').textContent") == 'Instalación', await og.inner_text('.sheet'))
        check('con el precio de la instalación ($ 65.000)', await og.input_value('#cb-monto') == '65000', await og.input_value('#cb-monto'))
        await og.click('#cb-go'); await og.wait_for_selector('.rc', timeout=8000)
        check('el recibo lo dice', 'Instalación' in await og.inner_text('.rc') and '65.000' in await og.inner_text('.rc'), await og.inner_text('.rc'))
        await og.click('.sheet [data-close]')
        await og.wait_for_function("!document.querySelector('[data-oid=\"o1\"] [data-oact=cobrar]')", timeout=8000)
        card = await og.inner_text('[data-oid="o1"]')
        check('la orden deja de figurar «sin cobrar» y avisa que se cobró después', 'Sin cobrar' not in card.replace('Instalación sin cobrar', '') and 'se cobró después' in card and await og.query_selector('[data-oid="o1"] .chip.warn') is None, card)
        av = await og.inner_text('#or-pend')
        check('el aviso baja a 2 instalaciones y ya no nombra a Guillerma', '2 instalaciones sin cobrar' in av and 'Guillerma' not in av, av)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
