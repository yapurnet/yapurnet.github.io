# Orden de instalación para alguien que todavía no es cliente: se carga en el mismo formulario de la orden. Chromium real contra workerd.
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
src = open(os.path.join(os.path.dirname(__file__), 'e2e_caidas.py'), encoding='utf-8').read().split('async def main')[0]
exec(src)
async def main():
    api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}); await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.evaluate("openOrderForm({})")
        await pg.wait_for_selector('#of-nw')
        await pg.click('#of-nw')
        await pg.fill('#of-nw-n', 'Persona Nueva Prueba'); await pg.fill('#of-nw-t', '3855123456'); await pg.fill('#of-nw-d', 'Belgrano 123')
        await pg.click('#of-nw-ok')
        await pg.wait_for_selector('#of-chg')
        d = await pg.inner_text('[role=dialog]')
        check('queda elegida la persona nueva y el tipo pasa a instalación', 'Persona Nueva Prueba' in d and await pg.input_value('#of-tipo') == 'instalacion', d)
        await pg.click('#oform button[type=submit]')
        await pg.wait_for_selector('[role=dialog]', state='detached', timeout=6000)
        await pg.wait_for_function("[...S.ordenes.values()].some(x=>x.tipo==='instalacion')", timeout=8000)
        r = await pg.evaluate("(()=>{const c=[...S.clientes.values()].find(x=>x.nombre==='Persona Nueva Prueba');const o=c&&[...S.ordenes.values()].find(x=>x.clientId===(c.id));return c?{e:c.estado,tel:c.tel,o:o&&o.tipo}:null})()")
        check('el cliente quedó pendiente con su orden de instalación', r and r['e'] == 'pendiente' and r['tel'] == '3855123456' and r['o'] == 'instalacion', r)
        await br.close()
    check('sin errores de la página', not ERR, ERR[:3])
    print('%d ok, %d con fallas' % (sum(res), len(res) - sum(res))); sys.exit(0 if all(res) else 1)
asyncio.run(main())
