# Reconexión automática (formato viejo, versión 1 de la consulta: los scripts que ya están instalados en los routers siguen funcionando): cuando un cliente pasa de suspendido a activo,
# el servidor lo anota y cada router (con su token, que solo sirve para recibir las órdenes y avisar) lo recibe como «id:ip:usuario», lo reactiva y avisa que lo hizo.
# Si se lo vuelve a suspender antes, la orden de reconexión se reemplaza por una de corte, que la versión 1 no recibe (solo sabe reactivar). Contra workerd.
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

st, j = req('POST', '/api/setup', {'codigo': CODE, 'usuario': 'mauro', 'clave': 'claveSegura1', 'nombre': 'Mauro'}); TA = j['token']
base = {'estado': 'suspendido', 'dir': 'Calle 1', 'loc': 'Añatuya', 'tel': '03854123456', 'alta': '2026-01-01', 'desde': '2026-01', 'ciclo': 1, 'precio': 20000}
cli(TA, 'ca', nombre='Cliente A', ip='10.20.41.5', **base)
cli(TA, 'cb', nombre='Cliente B sin datos', **base)
cli(TA, 'cc', nombre='Cliente C ppp', usuario='pepe.gomez', **base)
cli(TA, 'cd', nombre='Cliente D', ip='10.20.41.9/32', **base)

st, j = req('POST', '/api/routers', {'nombre': 'ADMIN02', 'kinds': ['q']}, TA); r1 = j['router']['id']
st, j = req('POST', '/api/routers', {'nombre': 'FM04', 'kinds': ['q']}, TA); r2 = j['router']['id']
st, j = req('POST', f'/api/routers/{r1}/reco-token', {}, TA); T1 = j['token']
st, j = req('POST', f'/api/routers/{r2}/reco-token', {}, TA); T2 = j['token']
check('el token de reconexión tiene la forma id.secreto', T1.startswith(r1 + '.') and T2.startswith(r2 + '.'))

st, t = req('GET', '/api/router/reco', token=T1, raw=True)
check('sin nadie para reconectar, la consulta del router vuelve vacía', st == 200 and t == '', (st, t))
check('un token inventado no entra', req('GET', '/api/router/reco', token=r1 + '.nope', raw=True)[0] == 401)
check('el token de la lista de clientes (otra cosa) tampoco sirve para reconectar', req('GET', '/api/router/reco', token=(req('POST', f'/api/routers/{r1}/token', {}, TA)[1]['token']), raw=True)[0] == 401)
check('sin token no entra', req('GET', '/api/router/reco', raw=True)[0] == 401)

# reconectan A, B (sin ip ni usuario), C (usuario) y D (ip con /32)
for c in ('ca', 'cb', 'cc', 'cd'): cli(TA, c, estado='activo', corteMora=None, reconectado='2026-11-25')
st, t = req('GET', '/api/router/reco', token=T1, raw=True)
items = [x.split(':') for x in t.split(',') if x]
por_ip = {x[1]: x for x in items}
check('A llega con su IP', '10.20.41.5' in por_ip, t)
check('C llega con su usuario PPPoE y sin IP', any(x[1] == '' and x[2] == 'pepe.gomez' for x in items), t)
check('D llega con la IP limpia (sin /32)', '10.20.41.9' in por_ip, t)
check('B, sin IP ni usuario, no se anota (no hay nada que reactivar)', len(items) == 3, t)
ids = [x[0] for x in items]

# el otro router también lo ve (cada uno avisa por su cuenta)
st, t2 = req('GET', '/api/router/reco', token=T2, raw=True)
check('el segundo router ve lo mismo', sorted(x.split(':')[0] for x in t2.split(',') if x) == sorted(ids), t2)

# el primer router avisa que hizo A y C
st, j = req('POST', f'/api/router/reco?ok={ids[0]},{ids[1]}', token=T1, raw=True)
st, t = req('GET', '/api/router/reco', token=T1, raw=True)
check('lo que el router ya avisó no vuelve a llegarle', sorted(x.split(':')[0] for x in t.split(',') if x) == [ids[2]], t)
st, t2 = req('GET', '/api/router/reco', token=T2, raw=True)
check('al otro router le siguen llegando los tres', len([x for x in t2.split(',') if x]) == 3, t2)
check('un id inventado en el aviso no rompe nada', req('POST', '/api/router/reco?ok=zzzz,1234567890', token=T1, raw=True)[0] == 200)

# se vuelve a suspender C antes de que el router 2 lo haga: se cancela
cli(TA, 'cc', estado='suspendido', corteMora='2026-11-25')
st, t2 = req('GET', '/api/router/reco', token=T2, raw=True)
check('si se lo vuelve a suspender antes, ya no se lo manda a reconectar (y el script viejo no recibe el corte)', 'pepe.gomez' not in t2 and len([x for x in t2.split(',') if x]) == 2, t2)

# un cambio que no es suspendido→activo no anota nada
cli(TA, 'ca', nombre='Cliente A renombrado')
st, t = req('GET', '/api/router/reco', token=T2, raw=True)
check('editar otro dato de un cliente activo no lo anota de nuevo', len([x for x in t.split(',') if x]) == 2, t)

# pantalla de la oficina
st, j = req('GET', '/api/reco', token=TA)
check('la oficina ve la cola (la reconexión de C quedó reemplazada por un corte) y qué router ya la hizo', st == 200 and len(j['items']) == 3 and sorted(it['acc'] for it in j['items']) == ['c', 'r', 'r'] and len(j['routers']) == 2 and any(r1 in it['hechos'] for it in j['items']), j)
check('sin sesión no se ve la cola', req('GET', '/api/reco')[0] == 401)
st, j = req('GET', '/api/routers', token=TA)
check('Ajustes → Routers sabe que el router tiene reconexión', all(r['reco'] for r in j['routers']), j)
print('\n' + ('TODO BIEN' if all(res) else 'HAY FALLAS')); sys.exit(0 if all(res) else 1)
