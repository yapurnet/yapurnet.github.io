# Extensión de Chrome de la oficina (herramientas-pc/extension-whatsapp): sus dos scripts probados en páginas de mentira, sin WhatsApp ni Chrome con la extensión instalada.
#   app.js (en la app): guarda el recibo que manda la app y avisa que la extensión está instalada.
#   wa.js (en WhatsApp Web): pega el recibo en el cuadro de mensaje del chat abierto (nunca en el buscador) y avisa qué pasó.
# Uso: python3 -I e2e_extension_wa.py   (no necesita servidor)
import asyncio, os, sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(AQUI, '..', 'herramientas-pc', 'extension-whatsapp')
APP_JS = open(os.path.join(EXT, 'app.js'), encoding='utf-8').read()
WA_JS = open(os.path.join(EXT, 'wa.js'), encoding='utf-8').read()
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
res = []
def check(n, c, x=''):
    res.append(bool(c)); print(('ok   ' if c else 'FAIL ') + n + ('' if c else f'  -> {x}'))

# el «chrome» de la extensión, de mentira: guarda en memoria y avisa los cambios
CHROME = """
window.__st = {}; window.__oyentes = [];
window.chrome = { storage: {
  local: {
    get: async (k) => (k in window.__st ? { [k]: window.__st[k] } : {}),
    set: async (o) => { for (const k in o) { const old = window.__st[k]; window.__st[k] = o[k]; window.__oyentes.forEach(f => f({ [k]: { oldValue: old, newValue: o[k] } })); } },
    remove: async (k) => { delete window.__st[k]; }
  },
  onChanged: { addListener: (f) => window.__oyentes.push(f) }
} };
"""
# WhatsApp Web de mentira: buscador a la izquierda (también es un cuadro editable) y, a los 800 ms, el chat con su cuadro de mensaje
def wa_html(handler_pega=True, composer=True, texto='Recibo R1 · Ana · $ 15.000'):
    pega = """box.addEventListener('paste', e => { const f = e.clipboardData && e.clipboardData.files[0]; if (!f) return; window.__pegado = [f.name, f.type, f.size];
        const im = document.createElement('img'); im.src = URL.createObjectURL(f); document.body.appendChild(im); });""" if handler_pega else ''
    return f"""<!doctype html><body><div id="app"><div id="side"><div contenteditable="true" role="textbox" data-tab="3" id="buscador"></div></div><div id="main"></div></div>
<script>
  document.getElementById('buscador').addEventListener('paste', () => {{ window.__enBuscador = true; }});
  if ({'true' if composer else 'false'}) setTimeout(() => {{
    document.getElementById('main').innerHTML = '<footer><div contenteditable="true" role="textbox" data-tab="10" id="caja">{texto}</div></footer>';
    const box = document.getElementById('caja');
    {pega}
  }}, 800);
</script></body>"""

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1000, 'height': 700})
        errores = []

        # ---------- app.js ----------
        await ctx.route('https://yapur.mauroyapur.workers.dev/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<!doctype html><body>app</body>'))
        pa = await ctx.new_page(); pa.on('pageerror', lambda e: errores.append(str(e)))
        await pa.add_init_script("window.__msgs = []; window.addEventListener('message', e => { if (e.data && e.data.yapurWAext) window.__msgs.push(e.data.yapurWAext); });")
        await pa.add_init_script(CHROME)
        await pa.goto('https://yapur.mauroyapur.workers.dev/', wait_until='domcontentloaded')
        await pa.evaluate(APP_JS)
        await pa.wait_for_function('window.__msgs.length >= 1', timeout=3000)
        check('app.js avisa a la app que la extensión está instalada (versión 1.1)', (await pa.evaluate('window.__msgs'))[0] == '1.1')
        await pa.evaluate("window.postMessage({yapurWAping: 1}, '*')")
        await pa.wait_for_function('window.__msgs.length >= 2', timeout=3000)
        check('y vuelve a avisar cuando la app pregunta (la app se abre después que la extensión)', True)
        await pa.evaluate(f"window.postMessage({{yapurWA: {{png: '{PNG}', nombre: 'Recibo-R1.png'}}}}, '*')")
        await pa.wait_for_function("!!window.__st.yapurWA", timeout=3000)
        g = await pa.evaluate('window.__st.yapurWA')
        check('app.js guarda el recibo que manda la app (imagen y nombre)', g['png'] == PNG and g['nombre'] == 'Recibo-R1.png' and g['ts'] > 0, g)
        await pa.evaluate("window.postMessage({yapurWA: {png: 'data:text/html;base64,AAAA', nombre: 'x'}}, '*'); delete window.__st.yapurWA")
        await pa.wait_for_timeout(300)
        check('y no guarda cualquier cosa (solo imágenes PNG)', not await pa.evaluate('!!window.__st.yapurWA'))

        # ---------- wa.js ----------
        async def wa(html, guardado, esperar=4500):
            c = await br.new_context(viewport={'width': 1000, 'height': 700})
            await c.route('https://web.whatsapp.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
            pw = await c.new_page(); pw.on('pageerror', lambda e: errores.append(str(e)))
            await pw.add_init_script(CHROME)
            await pw.add_init_script("window.__st = " + guardado + ";")
            await pw.goto('https://web.whatsapp.com/', wait_until='domcontentloaded')
            await pw.evaluate(WA_JS)
            await pw.wait_for_timeout(esperar)
            return c, pw
        ahora = "Date.now()"
        c, pw = await wa(wa_html(), "{yapurWA: {png: '%s', nombre: 'Recibo-R1.png', ts: Date.now()}}" % PNG)
        pegado = await pw.evaluate('window.__pegado')
        aviso = await pw.evaluate("(document.getElementById('yapur-wa-aviso') || {}).textContent || ''")
        check('wa.js pega el recibo (PNG con su nombre) en el cuadro de mensaje del chat, aunque cargue después', pegado and pegado[0] == 'Recibo-R1.png' and pegado[1] == 'image/png' and pegado[2] > 0, pegado)
        check('y no lo pega en el buscador de la izquierda', not await pw.evaluate('!!window.__enBuscador'))
        check('avisa «recibo pegado» y que hay que apretar Enviar', 'recibo pegado' in aviso and 'Enviar' in aviso, aviso)
        check('el recibo se usa una sola vez (se borra de lo guardado)', not await pw.evaluate('!!window.__st.yapurWA'))
        await c.close()

        c, pw = await wa(wa_html(handler_pega=False), "{yapurWA: {png: '%s', nombre: 'Recibo-R1.png', ts: Date.now()}}" % PNG, esperar=6000)
        aviso = await pw.evaluate("(document.getElementById('yapur-wa-aviso') || {}).textContent || ''")
        check('si WhatsApp no toma la imagen, avisa en rojo que se pegue con Ctrl+V (ya está copiada)', 'Ctrl+V' in aviso and 'recibo pegado' not in aviso, aviso)
        await c.close()

        c, pw = await wa(wa_html(), "{yapurWA: {png: '%s', nombre: 'Recibo-R1.png', ts: Date.now() - 300000}}" % PNG, esperar=3000)
        check('un recibo viejo (más de 2 minutos) no se pega ni avisa', not await pw.evaluate('window.__pegado') and not await pw.evaluate("!!document.getElementById('yapur-wa-aviso')"))
        await c.close()

        c, pw = await wa(wa_html(), "{}", esperar=3000)
        check('sin recibo guardado no hace nada (WhatsApp Web abierto a mano)', not await pw.evaluate('window.__pegado') and not await pw.evaluate("!!document.getElementById('yapur-wa-aviso')"))
        await c.close()

        await br.close()
        check('sin errores de página', not errores, errores)
    print(f"\n{sum(res)} ok, {len(res) - sum(res)} con fallas")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
