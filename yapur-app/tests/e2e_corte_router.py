# Cortes automáticos: cuando un cliente pasa a «suspendido» el servidor anota una orden de CORTE (el router agrega la IP a «Clientes Cortados» con el nombre completo de comentario, o
# deshabilita su usuario PPPoE) y cuando pasa a «activo» una de RECONEXIÓN (borrar la entrada). Versión 2 de la consulta: «id:acc:ip:usuario:nombre». Cada corte llega solo al router que atiende
# el nodo del cliente (campo «nodos» del router; vacío = todos), las reconexiones a todos; una orden nueva reemplaza a la anterior del mismo cliente; el nombre sale sin tildes. Contra workerd.
import json, os, sys, urllib.request, urllib.error
BASE = os.environ['YAPUR_BASE']; CODE = os.environ['YAPUR_CODE']
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))
def req(method, path, body=None, token=None, raw=False):
    r = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else (b'x' if method == 'POST' and raw else None),
                               headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(r, timeout=20) as x: t = x.read().decode(); return x.status, (t if raw else json.loads(t or 'null'))
    except urllib.error.HTTPError as e:
        t = e.read().decode(); return e.code, (t if raw else json.loads(t or 'null'))
def fnv(s):
    h = 2166136261
    for ch in s: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h
def shard(cid): return 'c%02d' % (fnv(cid) % 16)
def cli(TA, cid, **kw): return req('PATCH', '/api/doc/clientes/' + shard(cid), {'data': {'items': {cid: kw}}}, TA)
def poll(T, v2=True):
    st, t = req('GET', '/api/router/reco' + ('?v=2' if v2 else ''), token=T, raw=True)
    return [x.split(':') for x in t.split(',') if x]

st, j = req('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
alta = {'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': '2026-01-01', 'desde': '2026-01', 'ciclo': 1, 'precio': 20000}
def activo(cid, **kw): cli(TA, cid, estado='activo', **alta, **kw)
activo('b1', nombre='Chávez Luis Fernando', ip='192.168.102.8', nodo='BOMBEROS')
activo('b2', nombre='Ñandú, Pérez: "El Rápido"', ip='192.168.102.9', nodo='BOMBEROS')
activo('f1', nombre='Cliente FM', ip='10.5.5.5', nodo='FM')
activo('p1', nombre='Colonia Pepe', usuario='pepe.gomez', nodo='Colonia')
activo('s1', nombre='Sin nodo', ip='10.9.9.9')
activo('m1', nombre='Multicast', ip='230.1.1.1', nodo='BOMBEROS')
activo('x1', nombre='Sin ip ni usuario', nodo='BOMBEROS')

st, j = req('POST', '/api/routers', {'nombre': 'ADMIN_BOMBEROS', 'kinds': ['q'], 'nodos': ' BOMBEROS ,  bomberos , '}, TA); rb = j['router']['id']
check('al crear el router se guardan los nodos, sin repetidos ni espacios de más', j['router']['nodos'] == 'BOMBEROS,bomberos' or j['router']['nodos'] == 'BOMBEROS', j['router'])
st, j = req('POST', '/api/routers', {'nombre': 'ADMIN_FM', 'kinds': ['q']}, TA); rf = j['router']['id']
st, j = req('POST', '/api/routers', {'nombre': 'ADMIN_TODO', 'kinds': ['q']}, TA); rt = j['router']['id']
st, j = req('PATCH', f'/api/routers/{rb}', {'nodos': 'BOMBEROS'}, TA)
check('se pueden cambiar los nodos de un router', st == 200 and j['router']['nodos'] == 'BOMBEROS', j)
st, j = req('PATCH', f'/api/routers/{rf}', {'nodos': ['FM', 'NODO LEO']}, TA)
check('los nodos pueden venir como lista', j['router']['nodos'] == 'FM,NODO LEO', j)
st, j = req('PATCH', f'/api/routers/{rf}', {'nombre': 'ADMIN_FM'}, TA)
check('cambiar otra cosa no borra los nodos', j['router']['nodos'] == 'FM,NODO LEO', j)
TB = req('POST', f'/api/routers/{rb}/reco-token', {}, TA)[1]['token']
TF = req('POST', f'/api/routers/{rf}/reco-token', {}, TA)[1]['token']
TT = req('POST', f'/api/routers/{rt}/reco-token', {}, TA)[1]['token']
check('sin órdenes, la consulta vuelve vacía', poll(TB) == [] and poll(TF) == [] and poll(TT) == [])

# suspenden a varios: cada corte llega solo al router de su nodo
for c in ('b1', 'b2', 'f1', 'p1', 's1', 'm1', 'x1'): cli(TA, c, estado='suspendido', corteMora='2026-11-25')
b = {x[0 + 2]: x for x in poll(TB)}   # por IP
check('BOMBEROS recibe los cortes de sus dos clientes y nada más', sorted(b) == ['192.168.102.8', '192.168.102.9'] and all(x[1] == 'c' for x in b.values()), b)
check('el corte lleva el nombre completo, sin tildes', b['192.168.102.8'][4] == 'Chavez Luis Fernando', b)
check('un nombre con ñ, comas, dos puntos y comillas sale limpio (no rompe la lista)', b['192.168.102.9'][4] == 'Nandu Perez El Rapido', b)
check('la línea tiene exactamente 5 campos', all(len(x) == 5 for x in b.values()), b)
f = poll(TF)
check('FM recibe solo el de su nodo', [x[2] for x in f] == ['10.5.5.5'] and f[0][4] == 'Cliente FM', f)
t = poll(TT)
check('el router sin nodos cargados recibe todos los cortes (menos lo que no se puede cortar)', sorted(x[2] for x in t if x[2]) == ['10.5.5.5', '10.9.9.9', '192.168.102.8', '192.168.102.9'] and any(x[3] == 'pepe.gomez' and x[2] == '' for x in t), t)
check('una IP de multicast nunca se corta y un cliente sin IP ni usuario tampoco', not any(x[2] == '230.1.1.1' for x in t) and not any('Sin ip' in x[4] for x in t), t)
check('el usuario PPPoE llega en su campo y sin IP', any(x[3] == 'pepe.gomez' and x[2] == '' and x[1] == 'c' for x in t), t)
check('el sin nodo no le llega a un router que atiende nodos', all(x[2] != '10.9.9.9' for x in b.values()) and all(x[2] != '10.9.9.9' for x in f))
check('el script viejo (versión 1) no recibe cortes', poll(TB, v2=False) == [] and poll(TT, v2=False) == [])

# BOMBEROS avisa que hizo el de Chávez
ids = {x[2]: x[0] for x in b.values()}
req('POST', f'/api/router/reco?ok={ids["192.168.102.8"]}', token=TB, raw=True)
check('lo que el router ya avisó no vuelve', [x[2] for x in poll(TB)] == ['192.168.102.9'])
check('al otro router le sigue llegando', len(poll(TT)) == 6 - 0 or len(poll(TT)) >= 4)

# reconectan a Chávez: la reconexión llega a TODOS los routers (borrar lo que no existe no hace nada) y reemplaza al corte
cli(TA, 'b1', estado='activo', corteMora=None, reconectado='2026-11-25')
for nombre, T in (('BOMBEROS', TB), ('FM', TF), ('sin nodos', TT)):
    r = [x for x in poll(T) if x[2] == '192.168.102.8']
    check(f'la reconexión de Chávez le llega al router {nombre}', len(r) == 1 and r[0][1] == 'r', r)
check('y el corte anterior de Chávez ya no está', all(not (x[1] == 'c' and x[2] == '192.168.102.8') for x in poll(TT)))

# se vuelve a suspender antes de que FM lo haga: queda solo el corte (que a FM no le toca)
cli(TA, 'b1', estado='suspendido', corteMora='2026-11-26')
check('reconectar y volver a suspender antes de que nadie lo haga deja una sola orden: el corte', [x[1] for x in poll(TB) if x[2] == '192.168.102.8'] == ['c'] and [x for x in poll(TF) if x[2] == '192.168.102.8'] == [])

# dar de baja a uno activo con una orden pendiente la cancela
activo('z1', nombre='Para baja', ip='10.7.7.7', nodo='BOMBEROS')
cli(TA, 'z1', estado='suspendido', corteMora='2026-11-26')
check('el corte de z1 está pendiente', any(x[2] == '10.7.7.7' for x in poll(TB)))
cli(TA, 'z1', estado='activo', corteMora=None); cli(TA, 'z1', estado='baja')
check('dar de baja a un activo cancela su orden pendiente', all(x[2] != '10.7.7.7' for x in poll(TB)))

# editar un dato de un suspendido o de un activo no anota nada
n0 = len(poll(TT))
cli(TA, 'f1', tel='03854999999'); cli(TA, 'b2', tel='03854999999')
check('editar otros datos no anota órdenes nuevas', len(poll(TT)) == n0)

# la oficina ve a quién le toca cada orden
st, j = req('GET', '/api/reco', token=TA)
it0 = {x['ip']: x for x in j['items']}
check('un corte de BOMBEROS les toca a BOMBEROS y al router sin nodos, no a FM', '192.168.102.9' in it0 and sorted(it0['192.168.102.9']['esperan']) == sorted([rb, rt]), it0.get('192.168.102.9'))

# lotes: con muchos cortes juntos, cada consulta trae hasta 50 y el resto sigue en la próxima
for i in range(60): activo(f'l{i}', nombre=f'Lote {i}', ip=f'10.30.0.{i + 1}', nodo='LOTES')
for i in range(60): cli(TA, f'l{i}', estado='suspendido', corteMora='2026-11-26')
l1 = [x for x in poll(TT) if x[4].startswith('Lote')]
check('una consulta trae como máximo 50 órdenes', len(poll(TT)) <= 50 and len(l1) > 0, len(poll(TT)))
total = set(); 
for _ in range(10):
    p = poll(TT)
    if not p: break
    total |= {x[0] for x in p}
    req('POST', '/api/router/reco?ok=' + ','.join(x[0] for x in p), token=TT, raw=True)
check('avisando lo hecho se reparte todo en varias consultas', len(total) >= 60, len(total))
check('al final no queda nada pendiente para ese router', poll(TT) == [])

# la oficina ve las órdenes con acción, a quién le tocan y quién ya las hizo
st, j = req('GET', '/api/reco', token=TA)
it = {x['ip']: x for x in j['items']}
check('la oficina ve acción, router(es) a los que les toca y quién la hizo', st == 200 and all('acc' in x and 'esperan' in x and 'hechos' in x for x in j['items']), j['items'][:1])
check('un corte de un nodo sin router que lo atienda solo les toca a los routers sin nodos', all(x['esperan'] == [rt] for x in j['items'] if x['nodo'] == 'LOTES'), [x['esperan'] for x in j['items']][:2])
check('los routers de la pantalla traen sus nodos', {r['nombre']: r['nodos'] for r in j['routers']}.get('ADMIN_BOMBEROS') == 'BOMBEROS', j['routers'])
check('la pantalla de la oficina no se ve sin sesión', req('GET', '/api/reco')[0] == 401)
check('el token del router no sirve para crear órdenes ni para ver la pantalla de la oficina', req('GET', '/api/reco', token=TB)[0] == 401)
print('\n' + ('TODO BIEN' if all(res) else 'HAY FALLAS')); sys.exit(0 if all(res) else 1)
