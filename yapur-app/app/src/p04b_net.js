/* ===== conexión con el servidor =====
   Reemplaza la base de datos de Claude: misma interfaz (collection/doc/onSnapshot/update/set),
   pero los datos viven en el servidor (Cloudflare). La app se sirve desde la misma dirección que la API,
   así que no hace falta configurar nada. Las colecciones se sincronizan completas al entrar y después
   llegan los cambios en vivo. Se guarda una copia local (sin pagos) para abrir sin señal. */
const NET=(function(){
  /* dentro del APK, la envoltura de Android expone window.YapurApp (guardar archivos, abrir enlaces, botón atrás) */
  const bridge=window.YapurApp||null;
  const native=!!bridge;
  const base='';
  let token=lsGet('tok')||'';
  let me=null;try{me=JSON.parse(lsGet('me')||'null');}catch(e){}
  if(!token)me=null;
  const data={};                 // coll -> Map(id -> objeto) | null si no tiene acceso
  const docSeq=new Map();
  let baseSeq=0,synced=false,fresh=false,syncing=null,buffer=[],started=false;
  let es=null,esTimer=null,lastMsg=0,online=false,retry=0,retryT=null,persistT=null,dirty=new Set(),flushT=null;
  const watchers=new Set();
  const handlers={status:[],me:[],kick:[]};
  const emit=(k,v)=>handlers[k].forEach(f=>{try{f(v);}catch(e){console.error(e);}});

  const isPlain=o=>o&&typeof o==='object'&&!Array.isArray(o);
  const BAD=new Set(['__proto__','constructor','prototype']);
  function deepMerge(a,b){
    if(!isPlain(a)||!isPlain(b))return b;
    const out=Object.assign({},a);
    for(const k of Object.keys(b)){if(BAD.has(k))continue;out[k]=isPlain(b[k])&&isPlain(out[k])?deepMerge(out[k],b[k]):b[k];}
    return out;
  }

  /* ----- pedidos ----- */
  function netErr(msg){const e=new Error(msg||'Sin conexión con el servidor.');e.code='unavailable';e.network=true;return e;}
  async function api(method,path,body,opt){
    opt=opt||{};
    const ctl=typeof AbortController!=='undefined'?new AbortController():null;
    const tm=ctl?setTimeout(()=>ctl.abort(),opt.timeout||25000):null;
    let r;
    try{
      r=await fetch(base+path,{method,signal:ctl?ctl.signal:undefined,headers:Object.assign({'Content-Type':'application/json'},token&&!opt.anon?{Authorization:'Bearer '+token}:{}),body:body===undefined?undefined:JSON.stringify(body)});
    }catch(e){throw netErr();}
    finally{if(tm)clearTimeout(tm);}
    let j=null;try{j=await r.json();}catch(e){}
    if(!r.ok){
      const e=new Error((j&&j.error)||'No se pudo completar la operación.');
      e.status=r.status;e.code=(j&&j.code)||'invalid_argument';
      if(r.status===401&&token&&!opt.noKick)lost('Tu sesión terminó. Entrá de nuevo.');
      throw e;
    }
    return j;
  }
  function lost(msg){
    if(!token)return;
    try{sessionStorage.setItem('yg_msg',msg||'');}catch(e){}
    clearSession();
    emit('kick',msg);
  }

  /* ----- sesión ----- */
  function setSession(t,m){token=t;me=m;lsSet('tok',t);lsSet('me',JSON.stringify(m));}
  function clearSession(){
    try{const b=window.YapurApp;if(b&&typeof b.stopLocation==='function')b.stopLocation();}catch(e){}   /* el APK deja de compartir la ubicación al terminar la sesión */
    token='';me=null;lsSet('tok','');lsSet('me','');['viewAsP','tab','tecId','sess'].forEach(k=>lsSet(k,''));
    closeStream();synced=false;fresh=false;started=false;for(const k of Object.keys(data))delete data[k];
    kvClear();
  }
  async function login(usuario,clave){const j=await api('POST','/api/login',{usuario,clave},{anon:true,noKick:true});setSession(j.token,j.me);return j.me;}
  async function setup(b){const j=await api('POST','/api/setup',b,{anon:true,noKick:true});setSession(j.token,j.me);return j.me;}
  async function logout(){try{if(token)await api('POST','/api/logout',{},{noKick:true,timeout:5000});}catch(e){}clearSession();}
  async function status(){return api('GET','/api/status',undefined,{anon:true,noKick:true,timeout:9000});}
  /* ----- copia local para abrir sin señal (los pagos no se guardan en el equipo) ----- */
  function idb(){return new Promise((res,rej)=>{try{const r=indexedDB.open('yapur-gestion',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}catch(e){rej(e);}});}
  async function kvGet(k){try{const d=await idb();return await new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}catch(e){return null;}}
  async function kvSet(k,v){try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error);});}catch(e){}}
  async function kvClear(){try{const d=await idb();await new Promise(res=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').clear();t.oncomplete=res;t.onerror=res;});}catch(e){}}
  const cacheKey=()=>'cache:'+location.origin+':'+(me?me.id:'');
  function persistSoon(){
    if(!me||!synced||persistT)return;
    persistT=setTimeout(()=>{
      persistT=null;if(!me||!synced)return;
      const cols={};
      for(const c of ['clientes','ordenes','planes','ajustes','red'])if(data[c])cols[c]=[...data[c]];
      kvSet(cacheKey(),{ts:Date.now(),cols});
    },4000);
  }
  async function loadCache(){
    const c=await kvGet(cacheKey());
    if(!c||!c.cols||!c.cols.ajustes)return false;
    for(const k of Object.keys(c.cols))data[k]=new Map(c.cols[k]);
    for(const k of ['clientes','ordenes','planes','ajustes','red'])if(!data[k])data[k]=new Map();
    synced=true;baseSeq=0;docSeq.clear();
    return true;
  }

  /* ----- sincronización ----- */
  function markAll(){['clientes','pagos','ordenes','planes','ajustes','red'].forEach(c=>dirty.add(c));kick();}
  function kick(){if(flushT)return;flushT=setTimeout(()=>{flushT=null;flush();},20);}
  function flush(){
    const d=dirty;dirty=new Set();
    for(const w of [...watchers])if(d.has(w.coll))fire(w);
    persistSoon();
  }
  function fullSync(){
    if(syncing)return syncing;
    syncing=(async()=>{
      buffer=[];
      const j=await api('GET','/api/sync',undefined,{timeout:90000});
      for(const k of Object.keys(data))delete data[k];
      for(const c of ['clientes','pagos','ordenes','planes','ajustes','red'])data[c]=null;
      for(const c of Object.keys(j.cols))data[c]=new Map(j.cols[c].map(d=>[d.id,d.data]));
      baseSeq=j.seq;docSeq.clear();synced=true;fresh=true;
      const pend=buffer;buffer=[];
      pend.forEach(m=>applyDoc(m.coll,m.id,m.op,m.data,m.seq,true));
      markAll();
    })().finally(()=>{syncing=null;});
    return syncing;
  }
  function applyDoc(coll,id,op,d,seq,quiet){
    const k=coll+'/'+id;
    if(seq<=(docSeq.has(k)?docSeq.get(k):baseSeq))return;
    docSeq.set(k,seq);
    const m=data[coll]||(data[coll]=new Map());
    m.set(id,op==='set'||!m.has(id)?d:deepMerge(m.get(id),d));
    if(!quiet){dirty.add(coll);kick();}
    else dirty.add(coll);
  }

  /* ----- tiempo real ----- */
  function setOnline(v){if(online===v)return;online=v;emit('status',v);}
  function closeStream(){if(es){try{es.close();}catch(e){}es=null;}if(esTimer){clearInterval(esTimer);esTimer=null;}}
  function scheduleReconnect(){
    if(retryT||!token)return;
    const wait=Math.min(20000,1500*Math.pow(1.6,retry++));
    retryT=setTimeout(()=>{retryT=null;connectStream();},wait);
  }
  async function connectStream(){
    if(es||!token)return;
    let t;
    try{t=(await api('POST','/api/ticket',{},{timeout:10000})).t;}
    catch(e){setOnline(false);if(token)scheduleReconnect();return;}
    if(es||!token)return;
    const s=new EventSource(base+'/api/stream?t='+encodeURIComponent(t));
    es=s;lastMsg=Date.now();
    const seen=()=>{lastMsg=Date.now();};
    s.addEventListener('hello',()=>{seen();retry=0;setOnline(true);if(started)fullSync().catch(()=>{});});
    s.addEventListener('ping',seen);
    s.addEventListener('doc',ev=>{seen();let m;try{m=JSON.parse(ev.data);}catch(e){return;}if(syncing)buffer.push(m);else applyDoc(m.coll,m.id,m.op,m.data,m.seq);});
    s.addEventListener('me',ev=>{seen();try{const m=JSON.parse(ev.data);me=m;lsSet('me',JSON.stringify(m));emit('me',m);}catch(e){}});
    s.addEventListener('kick',()=>{lost('Tu acceso fue desactivado o cambiado. Entrá de nuevo.');});
    s.onerror=()=>{if(es!==s)return;closeStream();setOnline(false);scheduleReconnect();};
    esTimer=setInterval(()=>{if(es===s&&Date.now()-lastMsg>70000){closeStream();setOnline(false);connectStream();}},15000);
  }
  /* al volver a la app o recuperar la red: se asegura de estar al día */
  function wake(){
    if(!token||!synced)return;
    if(!es){retry=0;if(retryT){clearTimeout(retryT);retryT=null;}connectStream();}
    else if(Date.now()-lastMsg>45000){closeStream();setOnline(false);retry=0;connectStream();}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
  window.addEventListener('online',wake);
  setInterval(()=>{if(token&&synced&&!es&&!document.hidden)wake();},30000);

  /* ----- arranque: devuelve en qué pantalla hay que estar ----- */
  async function bring(){
    /* conecta el stream primero y recién ahí sincroniza: no se pierde ningún cambio en el medio */
    await connectStream();
    await fullSync();
    started=true;
  }
  async function init(){
    if(token&&me){
      const cached=await loadCache();
      if(cached){
        (async()=>{
          try{
            const j=await api('GET','/api/me',undefined,{timeout:15000});
            if(!token)return;
            const changed=JSON.stringify(j.me)!==JSON.stringify(me);
            me=j.me;lsSet('me',JSON.stringify(me));if(changed)emit('me',me);
            await bring();setOnline(true);
          }catch(e){if(e.network){setOnline(false);started=true;scheduleReconnect();}else if(e.status!==401)console.error(e);}
        })();
        return {state:'ready',stale:true};
      }
      try{
        const j=await api('GET','/api/me',undefined,{timeout:15000});
        me=j.me;lsSet('me',JSON.stringify(me));
        await bring();setOnline(true);
        return {state:'ready'};
      }catch(e){
        if(e.network)return {state:'offline'};
        if(e.status===401||!token){return await loginState();}
        throw e;
      }
    }
    return await loginState();
  }
  async function loginState(){
    try{const st=await status();return {state:st.needsSetup?'setup':'login'};}
    catch(e){return {state:'noserver',error:e};}
  }

  /* ----- vigilantes de datos con la interfaz de la base anterior ----- */
  function snapOf(w){
    if(w.id==null){
      const m=data[w.coll];
      return {docs:m?[...m].map(([id,d])=>({id,data:()=>d})):[],size:m?m.size:0};
    }
    const m=data[w.coll],d=m&&m.get(w.id);
    return {exists:!!d,id:w.id,data:()=>d||undefined};
  }
  function fire(w){
    if(!synced)return;
    /* abierta con la copia del celular, los pagos todavía no están: se espera a la primera sincronización antes de decir «sin permiso» */
    if(data[w.coll]==null){if(fresh&&w.err)w.err({code:'permission_denied'});return;}
    try{w.cb(snapOf(w));}catch(e){console.error(e);}
  }
  function watch(coll,id,cb,err){
    const w={coll,id,cb,err};watchers.add(w);
    if(synced)setTimeout(()=>{if(watchers.has(w))fire(w);},0);
    return ()=>watchers.delete(w);
  }
  async function write(coll,id,method,obj){
    const j=await api(method,'/api/doc/'+coll+'/'+encodeURIComponent(id),{data:obj});
    if(j.data!=null)applyDoc(coll,id,j.op,j.data,j.seq);
    return j;
  }
  const docRef=(coll,id)=>({
    update:obj=>write(coll,id,'PATCH',obj),
    set:obj=>write(coll,id,'PUT',obj),
    onSnapshot:(cb,err)=>watch(coll,id,cb,err)
  });
  const dbApi={
    collection:coll=>({doc:id=>docRef(coll,id),onSnapshot:(cb,err)=>watch(coll,null,cb,err)}),
    doc:path=>{const [c,i]=String(path).split('/');return docRef(c,i);}
  };

  /* ----- archivos y enlaces (en el celular se guarda en Descargas; en el navegador se descarga) ----- */
  async function saveFile(filename,text){
    const mime=/\.json$/i.test(filename)?'application/json':'text/csv';
    if(bridge&&typeof bridge.saveFile==='function'){
      const r=String(bridge.saveFile(filename,mime,String(text))||'');
      if(r.indexOf('ok:')!==0)throw new Error(r||'No se pudo guardar el archivo.');
      return r.slice(3)||'ok';
    }
    const blob=new Blob([text],{type:mime+(mime==='text/csv'?';charset=utf-8':'')});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
    return 'ok';
  }
  /* en la app de Android los enlaces de WhatsApp, mapas y llamadas se abren afuera, sin sacar a la persona de la app */
  if(native){
    document.addEventListener('click',e=>{
      const a=e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;
      const h=a.getAttribute('href')||'';
      if(/^(https?:|geo:|tel:|whatsapp:|waze:|intent:|mailto:|sms:)/i.test(h)&&(a.target==='_blank'||!h.startsWith(location.origin))&&typeof bridge.openUrl==='function'){
        e.preventDefault();bridge.openUrl(h);
      }
    },true);
  }
  return {
    native,get base(){return base;},get me(){return me;},get token(){return token;},get online(){return online;},get synced(){return synced;},
    api,init,bring,login,setup,logout,status,saveFile,
    get appVersion(){try{return bridge&&typeof bridge.version==='function'?String(bridge.version()||''):'';}catch(e){return '';}},
    openExternal:url=>{if(bridge&&typeof bridge.openUrl==='function')bridge.openUrl(String(url));else window.open(url,'_blank','noopener');},
    db:dbApi,
    on:(k,f)=>{handlers[k].push(f);},
    hasSession:()=>!!token
  };
})();
