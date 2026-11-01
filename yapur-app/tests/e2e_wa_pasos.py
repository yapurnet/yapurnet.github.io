# Recibo por WhatsApp sin conectar todavía: Ajustes explica qué hay que hacer y los técnicos siguen mandando el recibo a mano.
import asyncio, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []; ERR = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
async def login(ctx, user, clave):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    await pg.wait_for_selector('#lg-form', timeout=8000)
    await pg.fill('#lg-user', user); await pg.fill('#lg-pass', clave)
    await pg.click('#lg-form button[type=submit]')
    await pg.wait_for_selector('#tabs .tab', timeout=10000)
    return pg

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        A = await login(ctx, 'mauro', 'claveSegura1')
        await A.click('#tabs [data-tab=ajustes]'); await A.wait_for_selector('#aj-wa-body')
        await A.wait_for_function("document.querySelector('#aj-wa-body').textContent.includes('Todavía no está conectado')", timeout=8000)
        check('sin conectar, Ajustes lo dice y no ofrece ni el interruptor ni la prueba', await A.query_selector('#aj-wa-auto') is None and await A.query_selector('#aj-wa-test') is None)
        check('el técnico y la oficina saben que no está activo (el recibo se manda a mano)', await A.evaluate('S.ajustes.waActivo') is False)
        await A.evaluate("document.querySelector('#aj-wa-body details').open = true")
        t = await A.inner_text('#aj-wa-body')
        check('explica los pasos con los nombres exactos de los secretos de Cloudflare', 'WA_TOKEN' in t and 'WA_PHONE_ID' in t and 'recibo_cobro' in t and 'Utilidad' in t and 'Español (Argentina)' in t, t[:400])
        check('trae el texto de la plantilla con sus 5 datos', all('{{%d}}' % i in t for i in range(1, 6)))
        check('avisa que Meta cobra por mensaje', 'Meta cobra' in t)
        await A.evaluate("document.querySelector('#aj-wa-body').closest('.card').scrollIntoView()")
        if os.environ.get('VIS_OUT'): await A.screenshot(path=os.path.join(os.environ['VIS_OUT'], 'wa_pasos.png'))
        await A.click('#aj-wa-body [data-copy]')
        check('«Copiar el texto» no rompe nada', True)
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
