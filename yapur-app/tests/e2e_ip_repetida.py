# Una IP no puede estar en dos clientes. Los cortes y la cola del router trabajan por IP: si dos clientes comparten una, cortar a uno corta también al otro.
#  · La ficha avisa mientras se escribe la IP y NO deja guardar una IP que ya tiene otro cliente (nuevo o editado); una IP que venía repetida de antes no impide guardar otros datos.
#  · Un cliente dado de baja ya no ocupa su IP (la toma quien lo reemplaza). La ficha puede traer varias IP separadas por coma.
#  · Clientes → «IP repetida»: informa cuáles son y filtra la lista (solo para quien edita clientes o ve la red).
#  · No se suspende (no se corta) a un cliente que comparte su IP con otro; la importación deja sin IP a las repetidas y lo informa.
# Chromium real contra workerd.
import asyncio, datetime, json, os, sys, urllib.request, urllib.error
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
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
ERR = []
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
async def toast_texto(pg):
    try:
        await pg.wait_for_selector('#toastRoot .toast', timeout=3000)
        return await pg.inner_text('#toastRoot .toast:last-child')
    except Exception: return ''

async def main():
    st, j = api('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
    cur = datetime.date.today().strftime('%Y-%m'); nxt = (datetime.date.today().replace(day=1) + datetime.timedelta(days=32)).strftime('%Y-%m')
    base = {'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': cur + '-01', 'ciclo': 1, 'precio': 20000, 'desde': nxt, 'estado': 'activo'}
    datos = {
        'ca': dict(base, nombre='Ana Alvarez', codigo='1', ip='10.20.41.10'),
        'cb': dict(base, nombre='Beto Benitez', codigo='2', ip='10.20.41.11'),
        'cx': dict(base, nombre='Viejo De Baja', codigo='3', ip='10.20.41.12', estado='baja'),
        'cy': dict(base, nombre='Cuenta Doble', codigo='4', ip='10.20.41.20, 10.20.41.21'),
        'cp': dict(base, nombre='Pedro Repetido', codigo='5', ip='10.20.41.30'),
        'cq': dict(base, nombre='Quique Repetido', codigo='6', ip='10.20.41.30'),
        'cz': dict(base, nombre='Zulema Sin Ip', codigo='7', ip=''),
    }
    for cid, d in datos.items():
        api('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: d}}}, TA)
    api('POST', '/api/users', {'usuario': 'tec1', 'nombre': 'Pedro', 'role': 'tecnico', 'clave': 'pedro1', 'permisos': {'clientesTodos': True}}, TA)
    st, j = api('POST', '/api/routers', {'nombre': 'ADMIN02', 'kinds': ['q']}, TA); rid = j['router']['id']
    st, j = api('POST', f'/api/routers/{rid}/reco-token', {}, TA); TK = j['token']
    def cola():
        rq = urllib.request.Request(BASE + '/api/router/reco?v=2', headers={'Authorization': 'Bearer ' + TK})
        return urllib.request.urlopen(rq).read().decode()
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1000, 'height': 900}, bypass_csp=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = await login(ctx, 'mauro', 'claveSegura1')
        await pg.wait_for_function("S.clientes.size>=7", timeout=8000)

        # --- las reglas (funciones) ---
        r = await pg.evaluate("""({
          otro: (ipOcupada('10.20.41.10','cb')||{}).c&&ipOcupada('10.20.41.10','cb').c.id,
          propia: ipOcupada('10.20.41.10','ca'),
          baja: ipOcupada('10.20.41.12','ca'),
          lista2: (ipOcupada('10.20.41.21','ca')||{}).c&&ipOcupada('10.20.41.21','ca').c.id,
          barra32: (ipOcupada('10.20.41.10/32','cb')||{}).c&&ipOcupada('10.20.41.10/32','cb').c.id,
          invalida: ipOcupada('999.1.1.1','cb'),
          rep: ipsRepetidas().map(x=>x.ip+':'+x.clientes.map(c=>c.id).sort().join('+')),
          comp: ipCompartida(S.clientes.get('cp')).map(x=>x.c.id),
          compSola: ipCompartida(S.clientes.get('ca')).length,
        })""")
        check('otro cliente con esa IP: la detecta', r['otro'] == 'ca', r)
        check('el mismo cliente no se cuenta contra sí mismo', r['propia'] is None, r)
        check('la IP de un cliente dado de baja queda libre', r['baja'] is None, r)
        check('una ficha con varias IP separadas por coma: se detecta cualquiera', r['lista2'] == 'cy', r)
        check('«10.20.41.10/32» es la misma IP', r['barra32'] == 'ca', r)
        check('una IP mal escrita no se toma como repetida', r['invalida'] is None, r)
        check('IP repetidas: solo el par de activos (la baja y la lista de IP no cuentan)', r['rep'] == ['10.20.41.30:cp+cq'], r['rep'])
        check('cada uno de los dos ve al otro como «comparte IP»; uno sin repetir, a nadie', r['comp'] == ['cq'] and r['compSola'] == 0, r)

        # --- la ficha: editar ---
        await pg.evaluate("openClientForm('cb')"); await pg.wait_for_selector('#cform')
        await pg.fill('#cf-ip', '10.20.41.10')
        h = await pg.inner_text('#cf-ip-h')
        check('al escribir una IP ajena la ficha avisa de quién es', 'ya la tiene' in h and 'Ana Alvarez' in h and 'N° 1' in h, h)
        check('el aviso sale en rojo', await pg.evaluate("document.getElementById('cf-ip-h').className")=='bad')
        await pg.click('#cform button[type=submit]')
        t = await toast_texto(pg)
        await pg.wait_for_timeout(500)
        check('y no se puede guardar: avisa y el cliente queda como estaba', 'no puede estar en dos clientes' in t and await pg.evaluate("S.clientes.get('cb').ip")=='10.20.41.11', t)
        check('la ficha sigue abierta para corregir', await pg.locator('#cform').count() == 1)
        await pg.fill('#cf-ip', '10.20.41.12')
        check('la IP de un cliente dado de baja se puede usar (sin aviso)', (await pg.inner_text('#cf-ip-h')) == '')
        await pg.fill('#cf-ip', '10.20.41.77')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cb').ip==='10.20.41.77'", timeout=6000)
        check('con una IP libre guarda', True)

        # --- la ficha: cliente nuevo ---
        await pg.evaluate("openClientForm(null)"); await pg.wait_for_selector('#cform')
        await pg.fill('#cf-nombre', 'Nuevo Cliente Prueba'); await pg.fill('#cf-dir', 'Calle 9'); await pg.fill('#cf-tel', '03854111111')
        await pg.fill('#cf-ip', '10.20.41.20')
        await pg.click('#cform button[type=submit]')
        t = await toast_texto(pg)
        await pg.wait_for_timeout(500)
        check('un cliente nuevo tampoco puede nacer con una IP repetida (aunque esté en una lista de varias)', 'no puede estar en dos clientes' in t and not await pg.evaluate("[...S.clientes.values()].some(c=>c.nombre==='Nuevo Cliente Prueba')"), t)
        await pg.fill('#cf-ip', '10.20.41.78')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("[...S.clientes.values()].some(c=>c.nombre==='Nuevo Cliente Prueba')", timeout=6000)
        check('con una IP libre se crea', True)

        # --- una IP que ya venía repetida: se informa, pero no impide guardar otros datos ---
        await pg.evaluate("openClientForm('cp')"); await pg.wait_for_selector('#cform')
        h = await pg.inner_text('#cf-ip-h')
        check('en la ficha de un cliente que ya venía repetido, el aviso aparece al abrir', 'Quique Repetido' in h, h)
        await pg.fill('#cf-tel', '03854999999')
        await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cp').tel==='03854999999'", timeout=6000)
        check('pero se puede cambiar el teléfono (la IP no se tocó)', True)

        # --- Clientes → IP repetida ---
        await pg.click('#tabs [data-tab=clientes]'); await pg.wait_for_selector('#cl-seg')
        chip = pg.locator('#cl-seg button[data-f=iprep]')
        check('aparece el filtro «IP repetida (2)»', await chip.count() == 1 and '(2)' in await chip.inner_text(), await chip.count())
        ct = await pg.inner_text('#cl-ct')
        check('un aviso rojo informa que hay una IP repetida', 'Hay 1 IP repetida' in ct and 'se corta también al otro' in ct, ct)
        await chip.click()
        await pg.wait_for_function("document.querySelectorAll('#cl-list [data-open-client]').length===2", timeout=4000)
        ct = await pg.inner_text('#cl-ct')
        check('el filtro lista a los dos y el aviso dice cuál es la IP y quiénes', '10.20.41.30' in ct and 'Pedro Repetido' in ct and 'Quique Repetido' in ct, ct)
        # al corregir uno, desaparece solo
        await pg.evaluate("openClientForm('cq')"); await pg.wait_for_selector('#cform')
        await pg.fill('#cf-ip', '10.20.41.31'); await pg.click('#cform button[type=submit]')
        await pg.wait_for_function("S.clientes.get('cq').ip==='10.20.41.31'", timeout=6000)
        await pg.wait_for_function("!document.querySelector('#cl-seg [data-f=iprep]')", timeout=4000)
        check('al corregir una de las dos, el filtro y el aviso desaparecen', await pg.locator('#cl-seg button[data-f=iprep]').count() == 0 and 'IP repetida' not in await pg.inner_text('#cl-ct'))
        check('y la lista vuelve a mostrar a todos', await pg.evaluate("CL.estado")=='todos')

        # --- no se corta a quien comparte IP ---
        await pg.evaluate("openClientForm('cz')"); await pg.wait_for_selector('#cform')
        await pg.fill('#cf-ip', '10.20.41.10'); await pg.click('#cform button[type=submit]')   # frenado: la IP es de Ana
        await pg.wait_for_timeout(600)
        await pg.evaluate("document.querySelector('[data-close]') && closeModal()")
        # armo el caso por la API (como podía venir de antes): Zulema con la misma IP que Ana
        api('PATCH', '/api/doc/clientes/' + shard('cz'), {'data': {'items': {'cz': dict(datos['cz'], ip='10.20.41.10')}}}, TA)
        await pg.wait_for_function("S.clientes.get('cz').ip==='10.20.41.10'", timeout=8000)
        await pg.evaluate("void suspenderCliente('ca')")
        t = await toast_texto(pg)
        await pg.wait_for_timeout(400)
        check('al suspender a quien comparte IP no se corta y se explica por qué', 'No se corta' in t and 'se cortarían los dos' in t and 'Zulema Sin Ip' in t, t)
        check('sigue activo y no se mandó ninguna orden a los routers', await pg.evaluate("S.clientes.get('ca').estado")=='activo' and cola()=='', cola())
        await pg.evaluate("void suspenderCliente('cb')")
        await pg.wait_for_selector('[role=dialog] [data-act=yes]', timeout=4000)
        txt = await pg.inner_text('[role=dialog]')
        await pg.click('[role=dialog] [data-act=no]')
        check('un cliente con IP propia sí sigue el camino normal (pide confirmación)', 'Suspender' in txt and 'Clientes Cortados' in txt, txt)

        # --- importación ---
        r = await pg.evaluate("""(()=>{
          const rows=[['nombre','ip','direccion','telefono'],['Imp Uno','10.20.41.10','Calle 1','1'],['Imp Dos','10.20.41.99','Calle 2','2'],['Imp Tres','10.20.41.99','Calle 3','3'],['Imp Cuatro','10.20.41.12','Calle 4','4']];
          const a=analyzeImport(rows,{estado:'activo',desde:'2099-01',ciclo:1});
          return {ips:a.recs.map(x=>x.nombre+'='+x.ip), rep:a.ipRep};
        })()""")
        check('importar: la IP que ya tiene otro cliente o repite el archivo se importa vacía', r['ips'] == ['Imp Uno=', 'Imp Dos=10.20.41.99', 'Imp Tres=', 'Imp Cuatro=10.20.41.12'], r)
        check('y se informa cuáles fueron', r['rep'] == ['Imp Uno (10.20.41.10)', 'Imp Tres (10.20.41.99)'], r)

        # --- un técnico (sin permiso para editar clientes) no ve el informe ---
        ctx2 = await br.new_context(viewport={'width': 1000, 'height': 900}, bypass_csp=True)
        await ctx2.route('**/fonts.g*/**', lambda r: r.abort())
        tp = await login(ctx2, 'tec1', 'pedro1')
        try:
            await tp.wait_for_selector('#dialog [data-act=si], [role=dialog] [data-act=si]', timeout=2500); await tp.click('[role=dialog] [data-act=si]')
        except Exception: pass
        await tp.wait_for_function("S.clientes.size>=7", timeout=8000)
        puede = await tp.evaluate("can('editarClientes')||can('red')")
        if not puede:
            await tp.click('#tabs [data-tab=clientes]'); await tp.wait_for_selector('#cl-seg')
            check('el técnico no ve el filtro ni el aviso de IP repetida', await tp.locator('#cl-seg button[data-f=iprep]').count() == 0 and 'IP repetida' not in await tp.inner_text('#cl-ct'))
        await br.close()
    check('sin errores en la consola ni en la página', not ERR, ERR[:3])
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
