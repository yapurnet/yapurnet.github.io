# -*- coding: utf-8 -*-
"""Recorre el SNMP (solo lectura) de la OLT y guarda todo en olt_walk.txt.
Sin dependencias: solo necesita Python 3. La comunidad se lee del archivo olt_comunidad.txt
(una sola línea) que ponés vos al lado de este programa; el programa no la muestra ni la guarda en otro lado."""
import socket, os, sys, time, struct

def enc_len(n):
    if n < 128: return bytes([n])
    b = n.to_bytes((n.bit_length()+7)//8, 'big'); return bytes([0x80|len(b)]) + b
def tlv(t, v): return bytes([t]) + enc_len(len(v)) + v
def enc_int(n):
    if n == 0: return tlv(2, b'\x00')
    l = (n.bit_length()+8)//8
    return tlv(2, n.to_bytes(l, 'big', signed=True))
def enc_oid(s):
    p = [int(x) for x in s.strip('.').split('.')]
    out = bytes([40*p[0]+p[1]])
    for x in p[2:]:
        if x < 128: out += bytes([x])
        else:
            b = []
            while x: b.append(x & 0x7f); x >>= 7
            b.reverse(); out += bytes([(c|0x80) if i < len(b)-1 else c for i, c in enumerate(b)])
    return tlv(6, out)
def dec_len(d, i):
    n = d[i]; i += 1
    if n < 128: return n, i
    k = n & 0x7f; return int.from_bytes(d[i:i+k], 'big'), i+k
def dec(d, i=0):
    t = d[i]; n, j = dec_len(d, i+1); return t, d[j:j+n], j+n
def dec_oid(v):
    out = [v[0]//40, v[0] % 40]; x = 0
    for c in v[1:]:
        x = (x << 7) | (c & 0x7f)
        if not c & 0x80: out.append(x); x = 0
    return '.'.join(map(str, out))
def dec_val(t, v):
    if t == 2: return int.from_bytes(v, 'big', signed=True) if v else 0
    if t in (0x41, 0x42, 0x43, 0x46, 0x47): return int.from_bytes(v, 'big')
    if t == 4:
        try: s = v.decode('utf-8')
        except Exception: s = None
        if s is not None and all(ch.isprintable() for ch in s): return s
        return '0x' + v.hex()
    if t == 6: return dec_oid(v)
    if t == 0x40: return '.'.join(str(b) for b in v)
    if t in (0x80, 0x81, 0x82): return None
    return '0x' + v.hex()

def pdu(kind, rid, oid, ver, com, maxrep=0):
    vb = tlv(0x30, enc_oid(oid) + tlv(5, b''))
    body = enc_int(rid) + enc_int(0) + enc_int(maxrep) + tlv(0x30, vb) if kind == 0xA5 else enc_int(rid) + enc_int(0) + enc_int(0) + tlv(0x30, vb)
    return tlv(0x30, enc_int(ver) + tlv(4, com.encode()) + tlv(kind, body))

def parse_resp(data):
    t, v, _ = dec(data); _, v1, i = dec(v)           # version
    _, _, i = dec(v, i)                               # community
    t, p, _ = dec(v, i)                               # pdu
    _, _, i = dec(p); _, es, i = dec(p, i); _, _, i = dec(p, i)
    _, vbs, _ = dec(p, i)
    out = []; i = 0
    while i < len(vbs):
        _, vb, i = dec(vbs, i)
        _, o, j = dec(vb); t2, val, _ = dec(vb, j)
        out.append((dec_oid(o), t2, dec_val(t2, val)))
    return int.from_bytes(es, 'big'), out

def walk(host, com, root, port=161, timeout=5, ver=1, out=None, start=None, maxrep=10):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(timeout)
    cur = start or root; rid = 1; n = 0
    while True:
        rid += 1
        # v2c: GETBULK (A5) pide varios a la vez
        pk = pdu(0xA5, rid, cur, ver, com, maxrep=maxrep)
        for intento in range(6):
            try:
                s.sendto(pk, (host, port)); data, _ = s.recvfrom(65535); break
            except socket.timeout:
                data = None
        if data is None: print('Sin respuesta de', host, 'despues de', cur); return n
        es, vbs = parse_resp(data)
        if es: print('Error SNMP', es); return n
        fin = False
        for oid, t, val in vbs:
            if t in (0x82,) or not (oid + '.').startswith(root + '.'):
                fin = True; break
            out.write('%s|%s\n' % (oid, val)); n += 1; cur = oid
        out.flush()
        if fin or not vbs: return n

if __name__ == '__main__':
    aqui = os.path.dirname(os.path.abspath(__file__))
    host = sys.argv[1] if len(sys.argv) > 1 else '192.168.40.2'
    root = sys.argv[2] if len(sys.argv) > 2 else '1.3.6.1.4.1.17409'
    try: com = open(os.path.join(aqui, 'olt_comunidad.txt')).read().strip()
    except Exception: print('Falta el archivo olt_comunidad.txt con la comunidad de solo lectura (una línea).'); sys.exit(1)
    start = sys.argv[3] if len(sys.argv) > 3 else None
    ruta = os.path.join(aqui, sys.argv[4] if len(sys.argv) > 4 else 'olt_walk.txt'); t0 = time.time()
    with open(ruta, 'w', encoding='utf-8') as f: n = walk(host, com, root, out=f, start=start)
    print('Listo: %d valores en %s (%.0f s)' % (n, ruta, time.time()-t0))
