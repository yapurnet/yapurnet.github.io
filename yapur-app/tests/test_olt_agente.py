# -*- coding: utf-8 -*-
"""Prueba del lector de la OLT (herramientas-red/olt_agente.py) contra una OLT falsa por UDP, sin red ni secretos.
Caso real del 25/11/2026: el recorrido (GETNEXT) de la columna de potencia se corta después de unas 6 ONU, pero pedidas una por una (GET) contestan."""
import os, sys, socket, threading, json, tempfile, types
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'herramientas-red'))
import olt_agente as A
from olt_walk import tlv, enc_int, enc_oid, dec, dec_oid

B = A.B
ok = fallas = 0
def check(nombre, cond):
    global ok, fallas
    if cond: ok += 1; print('ok   ' + nombre)
    else: fallas += 1; print('FALLA ' + nombre)

N = 60
def idx_de(n): return 0x01000000 | ((7 + n // 31) << 8) | (n % 31 + 1)
IDX = [idx_de(n) for n in range(N)]
SERIE = {i: b'TPLG' + bytes([0xB0, 0x94, (i >> 8) & 255, i & 255]) for i in IDX}
OFFLINE = set(IDX[10:13])                       # 3 ONU apagadas: la OLT no les da potencia
RX = {i: -20 - (k % 7) for k, i in enumerate(IDX) if i not in OFFLINE}

class OltFalsa:
    def __init__(self, recorrido_corta_en):
        self.corta = recorrido_corta_en          # cuántas filas de potencia lista el GETNEXT; None = todas
        self.atrasada = IDX[20]                  # a esta ONU se le adelanta una respuesta de otra (UDP atrasado)
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); self.s.bind(('127.0.0.1', 0)); self.s.settimeout(0.2)
        self.port = self.s.getsockname()[1]; self.stop = False
        filas = {}
        for i in IDX:
            filas[tuple(map(int, (B + '6.1.1.2.%d.0.0' % i).split('.')))] = ('s', SERIE[i])
            filas[tuple(map(int, (B + '1.1.2.%d.0.0' % i).split('.')))] = ('s', b'Cliente %d' % i)
        rows_rx = [i for i in IDX if i not in OFFLINE]
        for k, i in enumerate(rows_rx):
            if self.corta is None or k < self.corta:
                filas[tuple(map(int, (B + '4.1.4.%d.0.0' % i).split('.')))] = ('i', RX[i] * 100)
                filas[tuple(map(int, (B + '4.1.5.%d.0.0' % i).split('.')))] = ('i', 300)
        self.filas = filas; self.claves = sorted(filas)
        self.directo = {}
        for i in IDX:
            if i in OFFLINE: continue
            self.directo[B + '4.1.4.%d.0.0' % i] = ('i', RX[i] * 100); self.directo[B + '4.1.5.%d.0.0' % i] = ('i', 300)
        threading.Thread(target=self.correr, daemon=True).start()
    def val(self, v):
        if v is None: return tlv(0x81, b'')
        return enc_int(v[1]) if v[0] == 'i' else tlv(4, v[1])
    def resp(self, com, rid, oid, v):
        vb = tlv(0x30, enc_oid(oid) + self.val(v))
        return tlv(0x30, enc_int(1) + tlv(4, com) + tlv(0xA2, enc_int(rid) + enc_int(0) + enc_int(0) + tlv(0x30, vb)))
    def correr(self):
        while not self.stop:
            try: data, dir_ = self.s.recvfrom(65535)
            except socket.timeout: continue
            _, v, _ = dec(data); _, _, i = dec(v); _, com, i = dec(v, i); tipo, p, _ = dec(v, i)
            _, rid, i = dec(p); _, _, i = dec(p, i); _, _, i = dec(p, i); _, vbs, _ = dec(p, i); _, vb, _ = dec(vbs); _, o, _ = dec(vb)
            rid = int.from_bytes(rid, 'big', signed=True); oid = dec_oid(o)
            if tipo == 0xA1:                                   # GETNEXT: el siguiente OID que exista
                t = tuple(map(int, oid.split('.')))
                sig = next((k for k in self.claves if k > t), None)
                if sig is None: self.s.sendto(self.resp(com, rid, oid, None).replace(b'\x81\x00', b'\x82\x00'), dir_); continue
                self.s.sendto(self.resp(com, rid, '.'.join(map(str, sig)), self.filas[sig]), dir_)
            else:                                              # GET: solo contesta la potencia de las ONU encendidas
                if oid == B + '4.1.4.%d.0.0' % self.atrasada:  # antes manda la respuesta de otra ONU, como un paquete atrasado
                    otra = B + '4.1.4.%d.0.0' % IDX[0]; self.s.sendto(self.resp(com, rid, otra, ('i', -9999)), dir_)
                self.s.sendto(self.resp(com, rid, oid, self.directo.get(oid)), dir_)

def correr(corta):
    olt = OltFalsa(corta); enviados = []
    A.HOST = '127.0.0.1'; A.PORT = olt.port; A.AQUI = tempfile.mkdtemp(); A.leer = lambda n: 'prueba'
    class R:
        def read(self): return b'{}'
    def urlopen(rq, timeout=0): enviados.append(json.loads(rq.data.decode())); return R()
    A.urllib.request.urlopen = urlopen
    res = A.ciclo(); olt.stop = True
    lect = [x for e in enviados for x in e['lect']]
    return res, lect, enviados[0]

# 1) el recorrido se corta después de 6 filas (el caso real): igual salen todas las ONU encendidas
res, lect, primer = correr(6)
check('recorrido cortado: se mandan las %d ONU encendidas, no solo 6' % (N - len(OFFLINE)), len(lect) == N - len(OFFLINE))
check('recorrido cortado: %d completadas una por una' % (N - len(OFFLINE) - 6), res[2] == N - len(OFFLINE) - 6)
check('la lista completa de ONU (mapa) trae las %d' % N, len(primer['mapa']) == N)
check('solo las apagadas figuran en «off»', len(primer['off']) == len(OFFLINE))
check('la potencia coincide con la de cada ONU', all(abs(x['rx'] - RX[i]) < 0.01 for x in lect for i in IDX if x['sn'] == (SERIE[i][:4].decode() + SERIE[i][4:].hex()).upper()))
check('la respuesta atrasada de otra ONU no se toma como propia', not any(x['rx'] < -50 for x in lect))
check('también llega la potencia de transmisión', all(x['tx'] == 3.0 for x in lect))

# 2) el recorrido anda bien: no hace falta pedir una por una (salvo las apagadas, que siguen apagadas)
res, lect, primer = correr(None)
check('recorrido sano: salen las mismas ONU', len(lect) == N - len(OFFLINE))
check('recorrido sano: ninguna se pide una por una', res[2] == 0)
check('recorrido sano: las apagadas siguen en «off»', len(primer['off']) == len(OFFLINE))

# 3) si se acaba el tiempo, las que no se probaron no se dan por caídas
olt = OltFalsa(6); A.HOST = '127.0.0.1'; A.PORT = olt.port
series = {i: 'X' for i in IDX}; rx = {}; tx = {}
hechas, pend = A.completar('prueba', series, rx, tx, limite=-1)
olt.stop = True
check('sin tiempo: no se prueba ninguna y quedan todas pendientes', hechas == 0 and len(pend) == N)

print('\n%d ok, %d con fallas' % (ok, fallas))
sys.exit(1 if fallas else 0)
