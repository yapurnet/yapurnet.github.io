# Avisos de actualización: la app web avisa cuando el servidor tiene una versión nueva y, dentro del APK, cuando hay un APK nuevo.
# Se prueba sin saltear la política de seguridad (CSP) para comprobar también que la consulta a GitHub está permitida.
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))

FAKE = "window.__calls = []; window.YapurApp = { saveFile: () => 'ok:x', version: () => '%s', openUrl: u => { window.__calls.push(u); return true; } };"
APK = 'https://yapurnet.github.io/YAPUR-Gestion.apk'
INFO = '**/yapur-version.json'
ERR = []

async def new_page(br, bridge_version=None, web_v=None, apk_info=None, web_fail=False):
    ctx = await br.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    if bridge_version: await ctx.add_init_script(FAKE % bridge_version)
    await ctx.route('**/fonts.g*/**', lambda r: r.abort())
    if web_fail: await ctx.route('**/version.json', lambda r: r.abort())
    elif web_v: await ctx.route('**/version.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'v': web_v})))
    if apk_info is not None:
        await ctx.route('https://yapurnet.github.io/yapur-version.json', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(apk_info)))
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: ERR.append('CONSOLE ' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and 'version.json' not in m.text else None)
    await pg.goto(BASE, wait_until='domcontentloaded')
    return ctx, pg

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])

        # el servidor publica un /version.json que coincide con lo que corre y no se guarda en caché
        with urllib.request.urlopen(BASE + '/version.json', timeout=15) as r:
            hdr = r.headers.get('Cache-Control', ''); vj = json.loads(r.read())
        ctx, pg = await new_page(br)
        build = await pg.evaluate('() => BUILD')
        check('el servidor publica /version.json con la versión que corre', vj.get('v') == build and len(build) == 10, [vj, build])
        check('/version.json no se guarda en caché', 'no-store' in hdr, hdr)
        await pg.wait_for_timeout(6500)
        check('misma versión: no hay aviso', await pg.query_selector('#updBar') is None)
        await ctx.close()

        # versión nueva en el servidor
        ctx, pg = await new_page(br, web_v='ffffffffff')
        await pg.wait_for_selector('#updBar', timeout=9000)
        txt = await pg.inner_text('#updBar')
        check('versión nueva en el servidor: avisa y ofrece Actualizar', 'versión nueva de la app' in txt and 'Actualizar' in txt, txt)
        check('en el navegador no aparece el aviso de APK', 'APK' not in txt)
        await pg.click('#updBar [data-upd=web-no]')
        await pg.wait_for_selector('#updBar', state='detached', timeout=3000)
        check('«Después» esconde el aviso', True)
        await ctx.close()
        ctx, pg = await new_page(br, web_v='ffffffffff')
        await pg.wait_for_selector('#updBar [data-upd=web-go]', timeout=9000)
        async with pg.expect_navigation(timeout=8000):
            await pg.click('#updBar [data-upd=web-go]')
        check('«Actualizar» recarga la app', True)
        await ctx.close()

        # sin conexión con el servidor de versiones: no molesta
        ctx, pg = await new_page(br, web_fail=True)
        await pg.wait_for_timeout(6500)
        check('si no se puede consultar la versión, no aparece nada ni hay errores', await pg.query_selector('#updBar') is None)
        await ctx.close()

        # dentro del APK
        info = {'codigo': 105, 'nombre': '2.5', 'apk': APK, 'generado': '2026-10-20T00:00:00Z'}
        ctx, pg = await new_page(br, bridge_version='2.1', apk_info=info)
        await pg.wait_for_selector('#updBar', timeout=9000)
        txt = await pg.inner_text('#updBar')
        check('APK instalado 2.1 y publicado 2.5: avisa y ofrece Descargar', 'APK nuevo (2.5)' in txt and 'Descargar' in txt, txt)
        check('el aviso de la app web no aparece si la app está al día', 'versión nueva de la app' not in txt)
        await pg.click('#updBar [data-upd=apk-go]')
        calls = await pg.evaluate('() => window.__calls')
        check('«Descargar» abre el APK afuera (en el navegador del celular)', calls == [APK], calls)
        await ctx.close()

        for have, pub, name in [('2.5', '2.5', 'misma versión'), ('2.7', '2.5', 'el APK instalado es más nuevo'), ('2.1', '2.1', 'igual')]:
            ctx, pg = await new_page(br, bridge_version=have, apk_info={'codigo': 1, 'nombre': pub, 'apk': APK})
            await pg.wait_for_timeout(6500)
            check('APK ' + have + ' y publicado ' + pub + ' (' + name + '): sin aviso', await pg.query_selector('#updBar') is None)
            await ctx.close()

        ctx, pg = await new_page(br, bridge_version='2.1', apk_info={'codigo': 9, 'nombre': '2.9', 'apk': 'javascript:alert(1)'})
        await pg.wait_for_timeout(6500)
        check('un enlace de descarga raro no se acepta', await pg.query_selector('#updBar') is None)
        await ctx.close()

        ctx, pg = await new_page(br, bridge_version='2.1', web_v='ffffffffff', apk_info=info)
        await pg.wait_for_selector('#updBar [data-upd=apk-go]', timeout=9000)
        n = await pg.eval_on_selector_all('#updBar .upd-row', 'els => els.length')
        check('si hay las dos novedades, se muestran las dos', n == 2, n)
        await ctx.close()
        await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
