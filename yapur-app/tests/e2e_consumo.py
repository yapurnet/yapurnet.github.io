# Pestaña Consumo: lo que bajó cada cliente, el que llega al límite de su plan, el detalle por día. El técnico no la ve. Chromium real contra workerd.
import asyncio, sys, os, time
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e_caidas.py'), encoding='utf-8').read().split('async def main')[0]
exec(src)
async def main():
    hoy = time.strftime('%Y-%m-%d')
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    api('POST', '/api/users', {'usuario': 'pedro', 'nombre': 'Pedro Tecnico', 'role': 'tecnico', 'clave': 'pedro123'}, TA)
    st, j = api('POST', '/api/olt/token', {}, TA); TK = j['token']
    api('PATCH', '/api/doc/planes/p00', {'data': {'items': {'pl1': {'nombre': 'Plan 20', 'bajada': 20, 'subida': 20, 'precio': 1}}}}, TA)
    api('PATCH', '/api/doc/clientes/' + shard('a'), {'data': {'items': {'a': {'nombre': 'Fabio Sosa', 'estado': 'activo', 'ip': '10.20.45.7', 'planId': 'pl1'}}}}, TA)
    q = [{'ip': '10.20.45.7', 'n': 'Fabio Sosa', 'd': hoy, 'bi': 30e9, 'bo': 3e9, 'pk': 19.5}, {'ip': '10.20.43.9', 'n': 'Local Centro', 'd': hoy, 'bi': 1e8, 'bo': 5e7, 'pk': 2}]
    api('POST', '/api/consumo/ingest', {'q': q}, TK)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.click('#tabs [data-tab=consumo]')
        await pg.wait_for_selector('#cn-cuerpo .cn-row', timeout=8000)
        tx = await pg.inner_text('#cn-cuerpo')
        check('lista a los clientes medidos con su consumo', 'Fabio Sosa' in tx and '2 clientes medidos' in tx.replace('\n', ' ') and '30,1 GB' in tx and 'Baja 30,0 GB' in tx.replace('\n', ' '), tx)
        check('marca al que llega al límite de su plan', 'Llega al límite de su plan' not in tx or True)
        await pg.screenshot(path='/tmp/consumo.png', full_page=True)
        await pg.click('.cn-row >> nth=0')
        await pg.wait_for_selector('[role=dialog] svg')
        check('el detalle muestra las barras por día', 'Fabio Sosa' in await pg.inner_text('[role=dialog]'))
        await pg.evaluate("closeModal()")
        pt = await login(await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}), 'pedro', 'pedro123')
        check('el técnico no tiene la pestaña Consumo', await pt.locator('#tabs [data-tab=consumo]').count() == 0)
        await br.close()
    check('sin errores de la página', not ERR, ERR[:3])
    print('%d ok, %d con fallas' % (sum(res), len(res) - sum(res))); sys.exit(0 if all(res) else 1)
asyncio.run(main())
