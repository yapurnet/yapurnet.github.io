/* Código QR (modo bytes, corrección L o M, versiones 1 a 40). Lo usa la factura electrónica: ARCA exige el QR con los datos del comprobante.
   Devuelve una matriz de módulos (true = negro). */
const QR=(()=>{
  const ECC={L:[1,[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25]],
    M:[0,[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49]]};
  const bit=(x,i)=>((x>>>i)&1)!==0;
  const rawModules=v=>{let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36;}return r;};
  const dataCw=(v,e)=>Math.floor(rawModules(v)/8)-ECC[e][1][v]*ECC[e][2][v];
  function rsDiv(deg){const r=new Array(deg).fill(0);r[deg-1]=1;let root=1;for(let i=0;i<deg;i++){for(let j=0;j<r.length;j++){r[j]=mul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}root=mul(root,2);}return r;}
  function mul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x;}return z;}
  function rsRem(data,div){const r=div.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=mul(c,f);});}return r;}
  function alignPos(v){if(v===1)return[];const n=Math.floor(v/7)+2,size=v*4+17,step=v===32?26:Math.ceil((v*4+4)/(n*2-2))*2,r=[6];for(let p=size-7;r.length<n;p-=step)r.splice(1,0,p);return r;}
  function make(text,nivel){
    const e=nivel==='L'?'L':'M',bytes=[...new TextEncoder().encode(text)];
    let ver=1;
    for(;;ver++){
      if(ver>40)throw new Error('El texto es demasiado largo para un QR.');
      const bits=4+(ver<10?8:16)+bytes.length*8;
      if(bits<=dataCw(ver,e)*8)break;
    }
    const bb=[];const put=(v,n)=>{for(let i=n-1;i>=0;i--)bb.push((v>>>i)&1);};
    put(4,4);put(bytes.length,ver<10?8:16);bytes.forEach(b=>put(b,8));
    const cap=dataCw(ver,e)*8;
    put(0,Math.min(4,cap-bb.length));put(0,(8-bb.length%8)%8);
    for(let pad=0xEC;bb.length<cap;pad^=0xEC^0x11)put(pad,8);
    const data=[];for(let i=0;i<bb.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bb[i+j];data.push(b);}
    /* corrección de errores e intercalado */
    const nb=ECC[e][2][ver],el=ECC[e][1][ver],raw=Math.floor(rawModules(ver)/8),ns=nb-raw%nb,sl=Math.floor(raw/nb),div=rsDiv(el),blocks=[];
    for(let i=0,k=0;i<nb;i++){const d=data.slice(k,k+sl-el+(i<ns?0:1));k+=d.length;const ec=rsRem(d,div);if(i<ns)d.push(0);blocks.push(d.concat(ec));}
    const all=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==sl-el||j>=ns)all.push(b[i]);});
    /* dibujo */
    const size=ver*4+17,m=[],fn=[];for(let i=0;i<size;i++){m.push(new Array(size).fill(false));fn.push(new Array(size).fill(false));}
    const set=(x,y,b)=>{m[y][x]=b;fn[y][x]=true;};
    for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
    const finder=(x,y)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)set(xx,yy,d!==2&&d!==4);}};
    finder(3,3);finder(size-4,3);finder(3,size-4);
    const ap=alignPos(ver);
    ap.forEach((cx,i)=>ap.forEach((cy,j)=>{if(!((i===0&&j===0)||(i===0&&j===ap.length-1)||(i===ap.length-1&&j===0)))for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}));
    const formato=mask=>{
      const d=(ECC[e][0]<<3)|mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);
      const bits=((d<<10)|r)^0x5412;
      for(let i=0;i<=5;i++)set(8,i,bit(bits,i));set(8,7,bit(bits,6));set(8,8,bit(bits,7));set(7,8,bit(bits,8));
      for(let i=9;i<15;i++)set(14-i,8,bit(bits,i));
      for(let i=0;i<8;i++)set(size-1-i,8,bit(bits,i));
      for(let i=8;i<15;i++)set(8,size-15+i,bit(bits,i));
      set(8,size-8,true);
    };
    formato(0);
    if(ver>=7){let r=ver;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const bits=(ver<<12)|r;for(let i=0;i<18;i++){const b=bit(bits,i),a=size-11+i%3,c=Math.floor(i/3);set(a,c,b);set(c,a,b);}}
    let i=0;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;if(!fn[y][x]&&i<all.length*8){m[y][x]=bit(all[i>>>3],7-(i&7));i++;}}}
    const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
    const aplicar=k=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fn[y][x]&&masks[k](x,y))m[y][x]=!m[y][x];};
    const castigo=()=>{
      let p=0;
      for(let y=0;y<size;y++){let run=1;for(let x=1;x<=size;x++){if(x<size&&m[y][x]===m[y][x-1])run++;else{if(run>=5)p+=run-2;run=1;}}}
      for(let x=0;x<size;x++){let run=1;for(let y=1;y<=size;y++){if(y<size&&m[y][x]===m[y-1][x])run++;else{if(run>=5)p+=run-2;run=1;}}}
      for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++)if(m[y][x]===m[y][x+1]&&m[y][x]===m[y+1][x]&&m[y][x]===m[y+1][x+1])p+=3;
      let neg=0;for(const f of m)for(const c of f)if(c)neg++;
      p+=Math.floor(Math.abs(neg*20-size*size*10)/(size*size))*10;
      return p;
    };
    let mejor=0,mp=Infinity;
    for(let k=0;k<8;k++){aplicar(k);formato(k);const p=castigo();if(p<mp){mp=p;mejor=k;}aplicar(k);}
    aplicar(mejor);formato(mejor);
    return m;
  }
  /* imagen SVG lista para pegar en la factura (con la zona blanca de 4 módulos que pide el QR) */
  function svg(text,px){
    const m=make(text,'M'),n=m.length,q=4;let d='';
    m.forEach((f,y)=>{let x=0;while(x<n){if(f[x]){let k=x;while(k<n&&f[k])k++;d+='M'+(x+q)+' '+(y+q)+'h'+(k-x)+'v1h-'+(k-x)+'z';x=k;}else x++;}});
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+2*q} ${n+2*q}" width="${px||160}" height="${px||160}" shape-rendering="crispEdges" role="img" aria-label="Código QR de la factura"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return {make,svg};
})();
