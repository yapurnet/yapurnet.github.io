/* ===== avisos de actualización =====
   1) App nueva en el servidor: /version.json trae el código de la versión publicada. Si no es la que está corriendo,
      aparece «Hay una versión nueva» con el botón Actualizar (recarga y listo; en el APK no hace falta reinstalar nada).
   2) APK nuevo (solo dentro del APK): el flujo que compila el APK publica yapur-version.json en el sitio de GitHub.
      Si el APK instalado es anterior, aparece «Hay un APK nuevo» con el botón Descargar. */
const BUILD='__BUILD__';
const APK_INFO_URL='https://yapurnet.github.io/yapur-version.json';
const UPD={web:'',apk:null,hide:{}};
const verNum=s=>{const m=/^(\d+)\.(\d+)/.exec(String(s||'').trim());return m?Number(m[1])*100000+Number(m[2]):0;};
function drawUpdateBar(){
  const web=UPD.web&&UPD.hide.web!==UPD.web,apk=UPD.apk&&UPD.hide.apk!==UPD.apk.nombre;
  let el=document.getElementById('updBar');
  if(!web&&!apk){if(el)el.remove();return;}
  if(!el){
    el=document.createElement('div');el.id='updBar';el.className='upd';el.setAttribute('role','status');
    document.body.appendChild(el);
    el.addEventListener('click',e=>{
      const b=e.target.closest('[data-upd]');if(!b)return;
      const k=b.dataset.upd;
      if(k==='web-go')reloadForUpdate();
      else if(k==='apk-go'&&UPD.apk)NET.openExternal(UPD.apk.url);
      else if(k==='web-no'){UPD.hide.web=UPD.web;drawUpdateBar();}
      else if(k==='apk-no'&&UPD.apk){UPD.hide.apk=UPD.apk.nombre;drawUpdateBar();}
    });
  }
  el.innerHTML=(web?`<div class="upd-row"><span>Hay una versión nueva de la app.</span><span class="upd-act"><button class="btn small primary" type="button" data-upd="web-go">Actualizar</button><button class="btn small ghost" type="button" data-upd="web-no" aria-label="Avisar más tarde">Después</button></span></div>`:'')
    +(apk?`<div class="upd-row"><span>Hay un APK nuevo (${esc(UPD.apk.nombre)}) con mejoras. Se baja y se instala encima, sin perder nada.</span><span class="upd-act"><button class="btn small primary" type="button" data-upd="apk-go">Descargar</button><button class="btn small ghost" type="button" data-upd="apk-no" aria-label="Avisar más tarde">Después</button></span></div>`:'');
}
async function reloadForUpdate(){
  try{const reg=await navigator.serviceWorker.getRegistration();if(reg)await reg.update();}catch(e){}
  location.reload();
}
let _updLast=0;
async function checkUpdates(force){
  const now=Date.now();if(!force&&now-_updLast<60000)return;_updLast=now;
  try{
    const r=await fetch('/version.json',{cache:'no-store'});
    if(r.ok){const j=await r.json();UPD.web=(j&&typeof j.v==='string'&&/^[0-9a-f]{6,64}$/.test(j.v)&&j.v!==BUILD)?j.v:'';}
  }catch(e){}
  if(NET.native){
    try{
      const r=await fetch(APK_INFO_URL,{cache:'no-store'});
      if(r.ok){
        const j=await r.json(),have=verNum(NET.appVersion),want=verNum(j&&j.nombre);
        UPD.apk=(have>0&&want>have&&/^https:\/\/[^\s'"<>]+\.apk$/.test(String(j.apk||'')))?{nombre:String(j.nombre),url:String(j.apk)}:null;
      }
    }catch(e){}
  }
  drawUpdateBar();
}
function startUpdateWatch(){
  setTimeout(()=>checkUpdates(true),4000);
  setInterval(()=>checkUpdates(false),10*60000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkUpdates(false);});
  window.addEventListener('online',()=>checkUpdates(false));
}
