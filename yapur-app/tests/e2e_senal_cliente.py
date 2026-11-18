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
    hoy = time.strftime('%Y-%m-%d')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro Tecnico', 'role': 'oficina', 'clave': 'pedro123'}, TA)
    api('PUT', '/api/olt/mapa', {'lista': [{'sn': 'TPLGB087D6D9', 'port': '1/56'}]}, TA)
    for cid, nombre, extra in (('a', 'Fabio Sosa', {'equipo': 'TPLGB087D6D9', 'nodo': 'PON_1_OLT_1'}), ('b', 'Rosa Sin Serie', {'nodo': 'PON_2_OLT_1'}), ('c', 'Wifi Antena', {'nodo': 'FM'})):
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: dict({'nombre': nombre, 'estado': 'activo', 'dir': 'Calle ' + cid, 'alta': hoy}, **extra)}}}, TA)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'pedro', 'pedro123')
        await pg.evaluate("openClient('a')"); await pg.wait_for_selector('[data-act=senal]')
        check('el técnico ve «Potencia de la ONU» en un cliente de fibra', 'Potencia de la ONU' in await pg.inner_text('[data-act=senal]'))
        await pg.evaluate("openClient('c')"); await pg.wait_for_timeout(400)
        check('en un cliente de antena (sin serie ni PON) no aparece', await pg.locator('[data-act=senal]').count() == 0)
        await pg.evaluate("openClient('a')"); await pg.wait_for_selector('[data-act=senal]'); await pg.click('[data-act=senal]')
        await pg.wait_for_selector('#sg-rx')
        tx = await pg.inner_text('[role=dialog]')
        check('muestra la serie y el puerto/ID de la ONU y que todavía no hay lectura', 'TPLGB087D6D9' in tx and '1/56' in tx and 'Todavía no hay ninguna lectura' in tx, tx)
        await pg.fill('#sg-rx', '-29,5'); await pg.click('#sg-go')
        await pg.wait_for_selector('#sg-rx', state='detached', timeout=5000); await pg.wait_for_selector('[data-act=senal]')
        check('al guardar queda en la ficha del cliente (no lo saca a otra pantalla)', await pg.locator('[data-act=senal]').count() == 1)
        await pg.click('[data-act=senal]'); await pg.wait_for_selector('#sg-rx')
        tx = await pg.inner_text('[role=dialog]')
        check('al volver a abrir muestra -29.5 dBm, cargada a mano por Pedro, y la marca como mala señal', '-29.5 dBm' in tx and 'a mano por Pedro Tecnico' in tx and 'mala señal' in tx, tx)
        await pg.fill('#sg-rx', '22'); await pg.click('#sg-go'); await pg.wait_for_timeout(500)
        check('una potencia positiva no se guarda y el cuadro sigue abierto', await pg.locator('#sg-rx').count() == 1)
        d = await pg.evaluate("NET.api('GET','/api/olt')")
        check('la medida a mano entra en las alertas de señal con su cliente', any(o['cn'] == 'Fabio Sosa' and o['rx'] == -29.5 for o in d['lista']), d)
        await br.close()
    check('sin errores de la página', not ERR, ERR[:3])
    print('%d ok, %d con fallas' % (sum(res), len(res) - sum(res))); sys.exit(0 if all(res) else 1)
asyncio.run(main())
