# Cuenta unificada (Manaos distribuidora + las tres conexiones de la dueña): juntar servicios desde la ficha, cobrar todo junto con un solo recibo,
# domicilio y ubicación de cada sucursal, y DNI / CUIT / CUIL (formato y verificador). Todo contra el servidor de verdad.
import asyncio, json, os, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
SHOTS = os.environ.get('VIS_OUT')
res, ERR = [], []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

SEED = """async () => {
  const cur = curMonth();
  const mk = (id, nombre, o) => putItem('clientes', clientShard(id), id, Object.assign({nombre, estado: 'activo', desde: cur, ciclo: 1, precio: 23000, alta: todayStr(), tel: '', dir: '', creado: Date.now(), mod: Date.now()}, o));
  await mk('man', 'Manaos distribuidora', {dni: '27233738064', tel: '3844 56-2605', dir: 'Belgrano 100', loc: 'Añatuya', codigo: '186'});
  await mk('pc', 'Pachilla Maria Carolina (C. Central)', {dni: '23373806', dir: 'Centro 1'});
  await mk('pe', 'Pachilla Maria Carolina suc. España', {ciclo: 2});
  await mk('pf', 'Pachilla Maria Carolina FM', {ciclo: 2});
  await mk('lo', 'Lopez Eva', {dir: 'Calle 9'});
}"""

async def main():
    api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'})
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        async def login():
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: ERR.append('PAGEERROR ' + str(e)))
            await pg.goto(BASE, wait_until='domcontentloaded'); await pg.wait_for_selector('#lg-form, #tabs .tab', timeout=8000)
            if await pg.locator('#lg-form').count():   # al recargar la sesión sigue abierta
                await pg.fill('#lg-user', 'mauro'); await pg.fill('#lg-pass', 'claveSegura1'); await pg.click('#lg-form button[type=submit]')
            await pg.wait_for_selector('#tabs .tab', timeout=10000)
            await pg.wait_for_function('S.loaded.clientes && S.loaded.pagos && S.loaded.planes && S.loaded.ajustes', timeout=15000)
            return pg
        pg = await login()
        await pg.evaluate(SEED)
        await pg.wait_for_function("S.clientes.size >= 5 && S.clientes.has('pf')", timeout=10000)
        sheet = lambda: pg.inner_text('.sheet-body')
        shot = lambda n: pg.screenshot(path=os.path.join(SHOTS, n), full_page=False) if SHOTS else asyncio.sleep(0)

        # 1) DNI / CUIT / CUIL en el formulario: rótulo, verificador y formato
        await pg.evaluate("openClientForm('man')"); await pg.wait_for_selector('#cf-dni')
        lab = await pg.inner_text('label[for=cf-dni]')
        check('el formulario dice «DNI / CUIT / CUIL»', lab.strip() == 'DNI / CUIT / CUIL', lab)
        await pg.fill('#cf-dni', '27- 23373806-5')
        h = await pg.inner_text('#cf-dni-h'); cls = await pg.get_attribute('#cf-dni-h', 'class')
        check('un CUIT con el verificador mal avisa del error', cls == 'bad' and 'verificador' in h, [cls, h])
        await pg.fill('#cf-dni', '27- 23373806-4')
        h = await pg.inner_text('#cf-dni-h'); cls = await pg.get_attribute('#cf-dni-h', 'class')
        check('un CUIT bien escrito dice que es válido y cómo se guarda', cls == 'ok' and '27-23373806-4' in h, [cls, h])
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('man').dni === '27-23373806-4'", timeout=8000)
        check('el CUIT se guarda ordenado: 27-23373806-4', True)

        # 2) buscar: por nombre y por CUIT (con guiones o sin nada)
        await pg.click('#tabs [data-tab=clientes]'); await pg.wait_for_selector('#cl-q')
        rows = lambda q: pg.evaluate("(q) => { const i = document.querySelector('#cl-q'); i.value = q; i.dispatchEvent(new Event('input', {bubbles: true})); return [...document.querySelectorAll('#cl-list [data-open-client]')].map(b => b.dataset.openClient).sort().join(','); }", q)
        check('buscar «pachilla» trae las tres conexiones', await rows('pachilla') == 'pc,pe,pf')
        check('buscar el CUIT con guiones o sin nada trae la empresa', await rows('27-23373806-4') == 'man' and await rows('27233738064') == 'man')

        # 3) juntar los servicios desde la ficha
        await pg.evaluate("openClient('man')"); await pg.wait_for_selector('[data-act=cuenta-add]')
        check('la ficha de un cliente suelto ofrece sumarle servicios', 'Cuenta unificada' in await sheet())
        await pg.click('[data-act=cuenta-add]'); await pg.wait_for_selector('.cp-in')
        await pg.fill('.cp-in', 'pachilla')
        names = await pg.evaluate("[...document.querySelectorAll('.cp-list [data-pick] .t')].map(e => e.textContent)")
        check('el buscador ofrece las tres conexiones (y no a la empresa misma)', len(names) == 3 and not any('Manaos' in n for n in names), names)
        await pg.evaluate("document.querySelector('.cp-list [data-pick=pc]').click()")
        await pg.wait_for_selector('[data-act=yes]')
        msg = await sheet()
        check('pide confirmar y no habla de ciclo si es el mismo', 'pasa a la cuenta de Manaos distribuidora' in msg and 'ciclo' not in msg, msg)
        await pg.click('[data-act=yes]')
        await pg.wait_for_function("S.clientes.get('pc').cuenta === 'man'", timeout=8000)
        await pg.wait_for_selector('.sheet-body h3')
        check('vuelve a la ficha de la empresa con la cuenta armada', 'Cuenta unificada · Manaos distribuidora' in await sheet() and '2 servicios' in await sheet(), (await sheet())[:200])
        # desde el otro lado: un servicio de ciclo 2 se une a la cuenta (cambia su ciclo: lo avisa)
        await pg.evaluate("openClient('pe')"); await pg.wait_for_selector('[data-act=cuenta-unir]')
        await pg.click('[data-act=cuenta-unir]'); await pg.wait_for_selector('.cp-in'); await pg.fill('.cp-in', 'manaos')
        await pg.wait_for_selector('.cp-list [data-pick=man]'); await pg.evaluate("document.querySelector('.cp-list [data-pick=man]').click()")
        await pg.wait_for_selector('[data-act=yes]')
        msg = await sheet()
        check('avisa que el ciclo cambia del 2 al 1 y que cambian vencimiento y corte', 'cambia del 2 al 1' in msg and 'vencimiento' in msg, msg)
        await pg.click('[data-act=yes]'); await pg.wait_for_function("S.clientes.get('pe').cuenta === 'man'", timeout=8000)
        await pg.evaluate("cuentaGuardar(S.clientes.get('pf'), {cuenta: 'man'})")
        await pg.wait_for_function("cuentaMiembros(S.clientes.get('man')).length === 4", timeout=8000)
        check('toda la cuenta sigue el ciclo de la principal', await pg.evaluate("['pc','pe','pf'].every(id => cicloOf(S.clientes.get(id)) === 1)"))

        # 4) la ficha lista los servicios; se carga la ubicación de cada sucursal
        await pg.evaluate("openClient('pf')"); await pg.wait_for_selector('[data-act=cuenta-ubic]')
        t = await sheet()
        check('la ficha lista los 4 servicios con su domicilio, el total por mes y el vencido', t.count('Pachilla Maria Carolina') >= 3 and '4 servicios' in t and 'Belgrano 100' in t and 'Sin domicilio' in t and 'Total por mes' in t, t[:500])
        check('cada servicio sin ubicación ofrece «Cargar ubicación»', await pg.locator('[data-act=cuenta-ubic]').count() == 4 and 'Cargar ubicación' in t)
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'cuenta-ficha.png'))
        await pg.evaluate("document.querySelector('[data-act=cuenta-ubic][data-id=pe]').click()"); await pg.wait_for_selector('#cf-geo')
        await pg.fill('#cf-geo', '-28.4600, -62.8300'); await pg.click('#geo-save')
        await pg.wait_for_function("S.clientes.get('pe').lat === -28.46 && S.clientes.get('pe').lng === -62.83", timeout=8000)
        check('la ubicación de una sucursal se carga desde la cuenta', True)
        # domicilio de la sucursal: formulario (el ciclo sigue el de la cuenta y no se puede cambiar ahí)
        await pg.evaluate("openClientForm('pf')"); await pg.wait_for_selector('#cf-dir')
        check('en un servicio de la cuenta el ciclo está bloqueado y dice de quién sigue', await pg.evaluate("document.querySelector('#cf-ciclo').disabled") is True and 'Sigue el ciclo de la cuenta de Manaos distribuidora' in await sheet())
        await pg.fill('#cf-dir', 'España 450'); await pg.fill('#cf-loc', 'Añatuya'); await pg.fill('#cf-tel', '3844 11-0000')
        await pg.fill('#cf-geo', '-28.4612, -62.8311'); await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('pf').dir === 'España 450' && S.clientes.get('pf').lat === -28.4612", timeout=8000)
        check('el domicilio y la ubicación de la sucursal quedan en su propia ficha', await pg.evaluate("S.clientes.get('pf').cuenta === 'man'"))

        # 5) la lista marca la cuenta
        await pg.click('#tabs [data-tab=clientes]'); await pg.wait_for_selector('#cl-q')
        check('buscar «manaos» trae la empresa y sus 3 servicios', await rows('manaos') == 'man,pc,pe,pf')
        lst = await pg.inner_text('#cl-list')
        check('la lista marca «Cuenta · 4 servicios» y «Cuenta: Manaos distribuidora»', 'Cuenta · 4 servicios' in lst and lst.count('Cuenta: Manaos distribuidora') == 3, lst[:300])
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'cuenta-lista.png'))

        # 6) cobrar la cuenta: todo junto, un solo recibo
        await pg.evaluate("openCobro('pe')"); await pg.wait_for_selector('#cb-go')
        t = await sheet()
        check('«Cobrar» desde un servicio abre la cuenta entera (4 servicios, 92.000 por mes)', 'Manaos distribuidora' in t and 'Cuenta unificada' in t and '4 servicios' in t and '92.000' in t, t[:300])
        marcados = await pg.evaluate("[...document.querySelectorAll('#cb-mens [data-per]')].filter(i => i.checked).map(i => i.dataset.cid).sort().join(',')")
        check('marca el mes de cada uno de los 4 servicios', marcados == 'man,pc,pe,pf', marcados)
        check('el monto sugerido es la suma: 92000', await pg.input_value('#cb-monto') == '92000', await pg.input_value('#cb-monto'))
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'cuenta-cobro.png'))
        await pg.click('#cb-go'); await pg.wait_for_selector('.rc')
        rec = await pg.evaluate("(() => { const r = [...S.pagos.values()].filter(p => p.c && ['man','pc','pe','pf'].includes(p.c)); return {n: r.length, recibos: [...new Set(r.map(p => p.recibo))], docs: [...new Set(r.map(p => p._doc))], clientes: r.map(p => p.c).sort().join(','), total: r.reduce((s, p) => s + p.monto, 0)}; })()")
        check('se registraron 4 cobros con un solo número de recibo y en un solo bloque', rec['n'] == 4 and len(rec['recibos']) == 1 and len(rec['docs']) == 1 and rec['clientes'] == 'man,pc,pe,pf' and rec['total'] == 92000, rec)
        rc = await pg.inner_text('.rc')
        check('el recibo es de la empresa con su CUIT y nombra cada servicio', 'Manaos distribuidora' in rc and 'DNI / CUIT / CUIL: 27-23373806-4' in rc and 'FM' in rc and 'suc. España' in rc and '(C. Central)' in rc and '92.000' in rc, rc)
        href = await pg.get_attribute('#rc-wa', 'href')
        check('«Enviar por WhatsApp» va al número de la empresa', href and '5493844562605' in href, href)
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, 'cuenta-recibo.png'), full_page=True)
        recibo = rec['recibos'][0]
        await pg.click('.sheet [data-close]')
        check('cada servicio quedó al día en su mes', await pg.evaluate("['man','pc','pe','pf'].every(id => billing(S.clientes.get(id)).periods.find(p => p.per === curMonth()).rest === 0)"))

        # 7) pago parcial de la cuenta: se aplica a los primeros servicios y deja pendiente lo que falta
        await pg.evaluate("openCobro('man')"); await pg.wait_for_selector('#cb-go')
        await pg.evaluate("document.querySelectorAll('#cb-mens [data-per]').forEach(i => { if (!i.checked) i.click(); })")
        check('el mes siguiente se puede cobrar por adelantado, los 4 servicios', await pg.evaluate("[...document.querySelectorAll('#cb-mens [data-per]')].filter(i => i.checked).length") == 4)
        await pg.fill('#cb-monto', '50000')
        check('avisa que es un pago parcial y cuánto falta', 'Pago parcial: faltan' in await pg.inner_text('#cb-sum') and '42.000' in await pg.inner_text('#cb-sum'), await pg.inner_text('#cb-sum'))
        await pg.click('#cb-go'); await pg.wait_for_selector('.rc')
        parc = await pg.evaluate("(() => { const m = addMonths(curMonth(), 1); return [...S.pagos.values()].filter(p => p.per === m).map(p => p.c + ':' + p.monto).join(','); })()")
        check('el parcial cubre los dos primeros servicios y parte del tercero', parc == 'man:23000,pc:23000,pf:4000', parc)
        await pg.click('.sheet [data-close]')

        # 8) todo quedó guardado en el servidor: se recarga y el recibo sigue completo
        await pg.close(); pg = await login()
        sheet = lambda: pg.inner_text('.sheet-body')
        d = await pg.evaluate("(r) => { const d = receiptData(r); return {total: d.total, n: d.lineas.length, nombre: d.cliente.nombre, dni: d.cliente.dni}; }", recibo)
        check('tras recargar, el recibo único sigue con los 4 servicios y su total', d == {'total': 92000, 'n': 4, 'nombre': 'Manaos distribuidora', 'dni': '27-23373806-4'}, d)
        check('la cuenta sigue armada y cada servicio con su domicilio', await pg.evaluate("cuentaMiembros(S.clientes.get('pf')).length === 4 && S.clientes.get('pe').lat === -28.46 && S.clientes.get('pf').dir === 'España 450'"))

        # 9) sacar un servicio de la cuenta: sigue cobrándose con el ciclo que tenía
        await pg.evaluate("openClient('pf')"); await pg.wait_for_selector('[data-act=cuenta-quitar]')
        await pg.click('[data-act=cuenta-quitar]'); await pg.wait_for_selector('[data-act=yes]')
        check('pide confirmar y aclara que lo cobrado no cambia', 'vuelve a cobrarse y a recibir recibos por separado' in await sheet() and 'Lo ya cobrado no cambia' in await sheet())
        await pg.click('[data-act=yes]')
        await pg.wait_for_function("!S.clientes.get('pf').cuenta && S.clientes.get('pf').ciclo === 1", timeout=8000)
        check('queda suelto, con el ciclo 1 que venía usando, y la cuenta con 3', await pg.evaluate("cuentaMiembros(S.clientes.get('man')).length === 3 && cicloOf(S.clientes.get('pf')) === 1"))
        await pg.evaluate("openCobro('pf')"); await pg.wait_for_selector('#cb-go')
        check('cobrar un servicio suelto vuelve a ser como siempre (sin «Cuenta unificada»)', 'Cuenta unificada' not in await sheet())
        await ctx.close(); await br.close()
    print('\nERRORES:', 'ninguno' if not ERR else ERR)
    print(f'{sum(res)} ok, {len(res) - sum(res)} con fallas')
    sys.exit(0 if all(res) and not ERR else 1)
asyncio.run(main())
