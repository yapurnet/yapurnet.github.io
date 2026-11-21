# ONU sugerida: al abrir la señal de un cliente sin ONU vinculada, el técnico ve la ONU que parece ser (nombre parecido) y la vincula con un toque.
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
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('g'), {'data': {'items': {'g': {'nombre': 'Aveldaño Hector', 'estado': 'activo', 'dir': 'Calle g', 'tel': '3844000001'}}}}, TA)
    tk = api('POST', '/api/olt/token', {}, TA)[1]['token']
    api('POST', '/api/olt/ingest', {'lect': [{'sn': 'TPLGB09491A0', 'rx': -21.43, 'port': '3/102', 'name': 'Avendano Hector'}, {'sn': 'TPLGOTRA0001', 'rx': -20, 'port': '1/1', 'name': 'Perez Juan'}], 'mapa': [{'sn': 'TPLGREL%05d' % i, 'port': '1/%d' % (i + 1)} for i in range(60)] + [{'sn': 'TPLGB09491A0', 'port': '3/102'}, {'sn': 'TPLGOTRA0001', 'port': '1/1'}]}, tk)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        c = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, geolocation={'latitude': -28.46, 'longitude': -62.83, 'accuracy': 10}, permissions=['geolocation'])
        await c.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(c, 'pedro', 'pedro123')
        await pg.wait_for_function("S.clientes.has('g')", timeout=8000)
        await pg.evaluate("openSenalCliente('g')")
        await pg.wait_for_selector('#sg-sug button[data-k]', timeout=8000)
        txt = await pg.inner_text('#sg-sug')
        check('aparece «¿Es alguna de estas ONU?» con la ONU de nombre parecido', 'TPLGB09491A0' in txt and 'PON 3/102' in txt and '-21.43' in txt, txt)
        check('y no la de otro nombre', 'TPLGOTRA0001' not in txt, txt)
        await pg.click('#sg-sug button[data-k="TPLGB09491A0"]')
        await pg.wait_for_timeout(1500)
        d = api('GET', '/api/olt/cliente/g', None, api('POST', '/api/login', {'usuario': 'pedro', 'clave': 'pedro123'})[1]['token'])[1]
        check('con un toque queda vinculada', d['sn'] == 'TPLGB09491A0' and d['port'] == '3/102' and d['rx'] == -21.43, d)
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:5])
    print('\n%d ok, %d fallas' % (sum(res), len(res) - sum(res)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
