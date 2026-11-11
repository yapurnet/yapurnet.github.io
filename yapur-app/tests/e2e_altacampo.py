# Técnico dando de alta un cliente de instalación ocasional en la calle, con el navegador y el servidor de verdad.
import asyncio, json, os, urllib.request, urllib.error
from playwright.async_api import async_playwright
BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res, ERR = [], []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None, tok=None):
    h = {'Content-Type': 'application/json'}
    if tok: h['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
async def main():
    s, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    A = j['token']
    api('POST', '/api/users', {'usuario': 'tec1', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro1'}, A)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
        await pg.goto(BASE, wait_until='domcontentloaded'); await pg.wait_for_selector('#lg-form', timeout=8000)
        await pg.fill('#lg-user', 'tec1'); await pg.fill('#lg-pass', 'pedro1'); await pg.click('#lg-form button[type=submit]')
        await pg.wait_for_selector('#tabs .tab', timeout=10000)
        await pg.wait_for_function('S.loaded.clientes && S.loaded.ordenes', timeout=15000)
        b = pg.get_by_text('Entendido, aceptar')
        if await b.count(): await b.click(); await pg.wait_for_timeout(500)
        await pg.evaluate("openClientForm(null)")
        await pg.wait_for_selector('#cform', timeout=5000)
        txt = await pg.inner_text('#cform')
        tl = txt.lower()
        check('el técnico ve el formulario corto de abonado nuevo, sin facturación', 'datos del abonado' in tl and 'ciclo de cobro' not in tl and 'por instalar' in tl, txt[:200])
        await pg.fill('#cf-nombre', 'Rosa Paz'); await pg.fill('#cf-dir', 'Calle 9 N° 123'); await pg.fill('#cf-loc', 'Añatuya'); await pg.fill('#cf-tel', '3844123456')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("[...S.clientes.values()].some(c=>c.nombre==='Rosa Paz')", timeout=8000)
        await pg.wait_for_function("(()=>{const c=[...S.clientes.values()].find(c=>c.nombre==='Rosa Paz');return c&&[...S.ordenes.values()].some(o=>o.clientId===c.id)})()", timeout=8000)
        c = await pg.evaluate("(()=>{const c=[...S.clientes.values()].find(c=>c.nombre==='Rosa Paz');return {estado:c.estado,ord:[...S.ordenes.values()].filter(o=>o.clientId===c.id).map(o=>[o.tipo,o.estado])}})()")
        check('queda «por instalar» con una orden de instalación pendiente', c['estado'] == 'pendiente' and c['ord'] == [['instalacion', 'pendiente']], c)
        check('el cliente nuevo se ve en su lista (por la orden)', await pg.evaluate("[...S.clientes.values()].filter(clientVisible).some(c=>c.nombre==='Rosa Paz')"))
        await pg.evaluate("openClientForm(null)")
        await pg.wait_for_selector('#cform', timeout=5000)
        await pg.fill('#cf-nombre', 'Paz Rosa'); await pg.fill('#cf-dir', 'Calle 9 N° 123'); await pg.focus('#cf-loc')
        await pg.wait_for_selector('#cf-dup:not([hidden])', timeout=8000)
        check('al escribir un nombre ya cargado avisa que hay una ficha parecida', 'Rosa Paz' in await pg.inner_text('#cf-dup'))
        await pg.click('[data-dup="0"]')
        check('«Es otra conexión de esta persona» lo deja anotado', 'Otra conexión de Rosa Paz' in await pg.inner_text('#cf-dup'))
        check('sin errores de página', not ERR, ERR)
        await br.close()
asyncio.run(main())
print(f"\n{sum(res)} ok, {len(res)-sum(res)} con fallas")
