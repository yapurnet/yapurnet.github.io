# Caídas de nodos y de ONU: gráficas en Señal y resumen en la ficha del cliente. Chromium real contra el servidor de verdad (workerd).
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
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro Tecnico', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    st, j = api('POST', '/api/olt/token', {}, TA); TK = j['token']
    mp = [{'sn': 'TPLGMAPA%04d' % (1000 + i), 'port': '2/%d' % i} for i in range(1, 61)]
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Fabio Sosa', 'estado': 'activo', 'dir': 'Calle a', 'alta': hoy, 'equipo': 'TPLGMAPA1005', 'nodo': 'PON_2_OLT_1'}}}}, TA)
    api('POST', '/api/olt/ingest', {'lect': [], 'mapa': mp, 'off': []}, TK)
    for _ in range(2): api('POST', '/api/olt/ingest', {'lect': [], 'mapa': mp, 'off': ['TPLGMAPA1005', 'TPLGMAPA1009']}, TK)
    api('POST', '/api/olt/ingest', {'lect': [], 'mapa': mp, 'off': ['TPLGMAPA1009']}, TK)
    nd = lambda n, rec, ms=10: api('POST', '/api/nodos/ingest', {'nodos': [{'n': n, 'sent': 3, 'rec': rec, 'ms': ms}]}, TK)
    nd('BOMBEROS05', 3); nd('BOMBEROS05', 0); nd('BOMBEROS05', 0); nd('BOMBEROS05', 3, 22); nd('LEO06', 3, 8); nd('FM04', 0)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=senal]')
        await pg.wait_for_selector('#sn-caidas .card', timeout=8000)
        tx = await pg.inner_text('#sn-caidas')
        check('muestra los nodos con su estado y las caídas de 7 días', 'BOMBEROS05' in tx and 'LEO06' in tx and '1 caída en 7 días' in tx, tx)
        check('un nodo que nunca contestó no figura como caído', 'Sin respuesta desde que se empezó a medir' in tx and 'FM04' in tx, tx)
        check('muestra la tira de 24 h de cada nodo y las barras de ONU', await pg.locator('#sn-caidas svg[aria-label^="Estado"]').count() == 3 and await pg.locator('#sn-caidas svg[aria-label="Caídas de ONU por día"]').count() == 1)
        check('lista la ONU que sigue caída y la que más se cayó', 'Caídas ahora' in tx and 'Fabio Sosa' not in tx.split('Caídas ahora')[0] and 'TPLGMAPA1009' in tx and 'Las que más se cayeron' in tx, tx)
        await pg.screenshot(path='/tmp/caidas_senal.png', full_page=True)
        await pg.evaluate("openClient('a')"); await pg.wait_for_selector('[data-act=senal]'); await pg.click('[data-act=senal]')
        await pg.wait_for_selector('#sg-rx')
        d = await pg.inner_text('[role=dialog]')
        check('la ficha del cliente muestra sus caídas de 14 días', 'Caídas en 14 días: 1' in d, d)
        await pg.screenshot(path='/tmp/caidas_cliente.png')
        await pg.evaluate("closeModal()")
        ctx2 = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        pt = await login(ctx2, 'pedro', 'pedro123')
        t2 = await pt.evaluate("(async()=>{const d=document.createElement('div');d.innerHTML=caidasHtml(await NET.api('GET','/api/caidas'));return d.innerText||d.textContent;})()")
        check('el técnico ve las caídas de ONU pero no la tarjeta de nodos', 'Caídas de las ONU' in t2 and 'BOMBEROS05' not in t2 and 'Nodos' not in t2, t2)
        await br.close()
    check('sin errores de la página', not ERR, ERR[:3])
    print('%d ok, %d con fallas' % (sum(res), len(res) - sum(res))); sys.exit(0 if all(res) else 1)
asyncio.run(main())
