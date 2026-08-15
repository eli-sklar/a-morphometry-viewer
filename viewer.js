/* A-morphometry — iPad version. Slices 4-6: the FULL marking engine, ported from
   viewer3d_template3.html (the desktop/legacy-file editor) and wired to the GLB
   work package. One engine, one measurement — the numbers must match the desktop
   on every device. PWA shell + op-log + sheet export are this file's own layer. */
'use strict';

/* ================= GLB container (mirror of app/build_workpkg.py) ============= */
function parseGLB(buf){
  const dv=new DataView(buf);
  if(dv.getUint32(0,true)!==0x46546C67||dv.getUint32(4,true)!==2)
    throw new Error('הקובץ אינו קובץ עבודה של התוכנה (GLB).');
  const jlen=dv.getUint32(12,true);
  if(dv.getUint32(16,true)!==0x4E4F534A) throw new Error('מבנה הקובץ פגום (JSON).');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,20,jlen)));
  const boff=20+jlen;
  if(dv.getUint32(boff+4,true)!==0x004E4942) throw new Error('מבנה הקובץ פגום (BIN).');
  const bin=new Uint8Array(buf,boff+8,dv.getUint32(boff,true));
  return {json,bin};
}
function bview(g,bin,i,Arr){
  const v=g.json.bufferViews[i];
  const raw=bin.subarray(v.byteOffset,v.byteOffset+v.byteLength);
  if(!Arr) return raw;
  const c=raw.slice();
  return new Arr(c.buffer,0,c.byteLength/Arr.BYTES_PER_ELEMENT);
}
function b64u8(u8){
  let s='';
  for(let i=0;i<u8.length;i+=0x8000)
    s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));
  return btoa(s);
}

/* ================= op-log (decision 19): every manual-mark mutation lands in
   IndexedDB immediately; a crash loses at most the last stroke ================= */
let db=null;
const dbReady=new Promise(res=>{
  const r=indexedDB.open('am-ipad',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('ops',{autoIncrement:true});
  r.onsuccess=()=>{db=r.result;res();};
  r.onerror=()=>res();
});
let AM=null;
const jobKey=()=>AM?(AM.jobId+':'+AM.Fo+':'+AM.Nsub):'';
function logOps(pairs){
  if(!db||!AM||!pairs.length)return;
  try{
    const st=db.transaction('ops','readwrite').objectStore('ops');
    for(const [s,v] of pairs) st.put({j:jobKey(),s:s,v:v});
  }catch(_){}
}
function readOps(){
  return new Promise(res=>{
    if(!db||!AM)return res([]);
    const out=[],c=db.transaction('ops').objectStore('ops').openCursor();
    c.onsuccess=()=>{const cur=c.result;
      if(cur){if(cur.value.j===jobKey())out.push(cur.value);cur.continue();}else res(out);};
    c.onerror=()=>res([]);
  });
}

/* ================= boot: renderer first, engine wires up per loaded file ====== */
const $=id=>document.getElementById(id);
const cv=$('cv');
const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x15171a);   // dark working background, as on the
// desktop: the light background belongs to the report stills, not to the marking view
const camera=new THREE.PerspectiveCamera(50,innerWidth/Math.max(1,innerHeight),0.01,1000);
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/Math.max(1,innerHeight);camera.updateProjectionMatrix();}
addEventListener('resize',resize); resize();
(function tick(){requestAnimationFrame(tick);renderer.render(scene,camera);})();

$('openBtn').onclick=()=>$('file').click();
$('mImport').onclick=()=>$('file').click();     // slice 2 (decision 42): the reverse button
$('file').addEventListener('change',e=>{
  const f=e.target.files[0]; e.target.value='';
  if(!f) return;
  // one picker, recognized by content (decision 37): a .json is a SHEET — it loads
  // into the open work; a .glb is a work package — it boots the engine
  if(/\.json$/i.test(f.name||'')){
    if(!window.__am){
      $('err').textContent='זהו גיליון, לא קובץ עבודה. פתחו קודם את קובץ העבודה (.glb) — ואז טענו את הגיליון.';
      return;
    }
    f.text().then(t=>{window.__am.applySheet(JSON.parse(t));})
      .catch(ex=>alert('טעינת הגיליון נכשלה:\n'+((ex&&ex.message)||ex)));
    return;
  }
  f.arrayBuffer().then(load).catch(ex=>{$('err').textContent='שגיאה: '+ex.message;});
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
const STANDALONE=matchMedia('(display-mode: standalone)').matches||!!navigator.standalone;
// installed (home-screen) mode is always fullscreen — the button only serves browser tabs
if(STANDALONE) $('mFull').style.display='none';

/* ---- field anchors (decision 19): refuse to work from a Safari TAB on iPad —
   there the 7-day storage eviction applies and work silently dies; and show a
   visible ready-for-field badge once every shell asset is provably cached ---- */
const IOS=/iPad|iPhone/.test(navigator.userAgent)||
          (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(IOS&&!STANDALONE){
  $('openBtn').style.display='none';
  $('install').style.display='block';
}
const SHELL=['index.html','viewer.js','three.min.js','manifest.webmanifest',
             'icon-180.png','icon-512.png'];   // must mirror sw.js ASSETS (S13 guards)
function checkReady(tries){
  if(!('caches' in window)){$('ready').textContent='';return;}
  Promise.all(SHELL.map(a=>caches.match(a,{ignoreSearch:true})))
    .then(rs=>{
      if(rs.every(Boolean)){
        $('ready').textContent='✓ מוכן לשטח — עובד גם בלי רשת · '+$('ver').textContent;
        $('ready').style.color='#22c55e';
      } else if(tries>0){
        setTimeout(()=>checkReady(tries-1),3000);
      } else {
        $('ready').textContent='טרם נשמר לעבודה ללא רשת — הישארו מחוברים רגע ופתחו שוב';
        $('ready').style.color='#b8934a';
      }
    }).catch(()=>{$('ready').textContent='';});
}
checkReady(5);
$('mFull').onclick=()=>{
  const el=document.documentElement;
  const f=el.requestFullscreen||el.webkitRequestFullscreen;
  if(f) f.call(el);
};

/* ================= load a work package and start the engine ================== */
function load(buf){
  const g=parseGLB(buf);
  const am=g.json.asset&&g.json.asset.extras&&g.json.asset.extras.amWork;
  if(!am) throw new Error('הקובץ אינו נושא נתוני עבודה (amWork).');
  if(am.schemaVersion>3) throw new Error('הקובץ נוצר בגרסה חדשה מדי — עדכנו את גרסת האייפד.');
  AM=am;
  const acc=g.json.accessors, app=am.appData;
  const pos=bview(g,g.bin,acc[0].bufferView,Float32Array);
  const uv=bview(g,g.bin,acc[1].bufferView,Float32Array);
  const area=bview(g,g.bin,app.area,Float32Array);
  const qprob=bview(g,g.bin,app.prob,Uint8Array);
  const qfeat=bview(g,g.bin,app.feat,Int8Array);
  const lum=bview(g,g.bin,app.lum,Uint8Array);
  const CNT=(app.cnt!==undefined)?bview(g,g.bin,app.cnt,Uint8Array):null;
  const roi0=(app.roi0!==undefined)?bview(g,g.bin,app.roi0,Uint8Array):null;
  // schema 2 (decision 42): the file may carry its sheet — the work rides with the file
  let sheet=null;
  if(app.sheet!==undefined){
    try{sheet=JSON.parse(new TextDecoder().decode(bview(g,g.bin,app.sheet)));}
    catch(_){sheet=null;}                        // a bad sheet must not block the model
  }
  const img=bview(g,g.bin,g.json.images[0].bufferView);

  const image=new Image();
  image.onload=()=>{
    const tex=new THREE.Texture(image);
    tex.flipY=false;                            // uv are glTF-style (v down) by export
    if('SRGBColorSpace' in THREE) tex.colorSpace=THREE.SRGBColorSpace;
    tex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
    tex.generateMipmaps=false;                  // max sharpness, same as the desktop editor
    tex.needsUpdate=true;
    engine(am,pos,uv,area,qprob,qfeat,lum,CNT,roi0,tex,sheet);
    $('hello').style.display='none';
    $('bar').style.display='flex';
    $('side').style.display='flex';
    URL.revokeObjectURL(image.src);
  };
  image.onerror=()=>{$('err').textContent='טעינת הטקסטורה נכשלה.';};
  image.src=URL.createObjectURL(new Blob([img],{type:'image/jpeg'}));
}

/* ================= the marking engine (port of the desktop editor IIFE) ======= */
function engine(am,pos,uv,area,qprob,qfeat,lum,CNT,roi0,tex,sheet){
  const N=am.Nsub, SPF=am.spf, SUBK=am.sub, FO=am.Fo, NF=app_nfeat();
  function app_nfeat(){return am.appData.nfeat;}
  const OFF=new Uint32Array(FO+1);
  for(let fo=0;fo<FO;fo++) OFF[fo+1]=OFF[fo]+(CNT?CNT[fo]:SPF);
  const FACEOF=new Uint32Array(N);
  for(let fo=0;fo<FO;fo++) for(let t=OFF[fo];t<OFF[fo+1];t++) FACEOF[t]=fo;
  const prob=new Float32Array(N);
  for(let i=0;i<N;i++) prob[i]=qprob[i]/255;

  // per-sub-face centroid + spatial hash grid for fast brush/grow queries
  const cen=new Float32Array(N*3);
  for(let f=0;f<N;f++)for(let k=0;k<3;k++)
    cen[f*3+k]=(pos[(3*f)*3+k]+pos[(3*f+1)*3+k]+pos[(3*f+2)*3+k])/3;
  const CELL=0.15, grid=new Map();
  const ckey=(ix,iy,iz)=>ix*73856093 ^ iy*19349663 ^ iz*83492791;
  for(let f=0;f<N;f++){
    const k=ckey(Math.floor(cen[f*3]/CELL),Math.floor(cen[f*3+1]/CELL),Math.floor(cen[f*3+2]/CELL));
    let a=grid.get(k); if(!a){a=[];grid.set(k,a);} a.push(f);
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const colors=new Float32Array(N*9); colors.fill(1);
  const colAttr=new THREE.BufferAttribute(colors,3); geo.setAttribute('aCol',colAttr);
  const flats=new Float32Array(N*3);
  const flatAttr=new THREE.BufferAttribute(flats,1); geo.setAttribute('aFlat',flatAttr);
  // the stipple level per sub-face, so every layer carries its own (slice 4)
  const dess=new Float32Array(N*3).fill(0.6);
  const desAttr=new THREE.BufferAttribute(dess,1);
  geo.setAttribute('aDes',desAttr);
  geo.computeBoundingSphere();
  // flat-mix marking (user round 11/08): aFlat=1 paints pure colour OVER the texture
  const mat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide});    // ---- the marking's look (decision 75: the stipple, option 6) --------------------------
    // Ordered Bayer dithering in SCREEN space: the marking is drawn as a lattice of solid
    // colour dots over the untouched wall, the register of the 1968 plates. The layer's own
    // opacity drives dot coverage; the design wheel morphs from the old flat wash (0) to full
    // dots (1), so a clean flat submission stays one wheel-turn away. Screen-space is a
    // property, not a bug: the dots sit like a print screen while the model moves under them.
    const AM_SHADER_FN = `
float amB2(vec2 a){a=floor(a);return fract(a.x*0.5+a.y*a.y*0.75);}
float amBayer(vec2 px){return amB2(px*0.5)*0.25+amB2(px);}
vec3 amStipple(vec3 wall, vec3 col, float a, float lvl){
  vec3 flatC=wall*mix(vec3(1.0),col,min(a*1.25,1.0));
  float f=clamp((a-0.7)/0.3,0.0,1.0);
  flatC=mix(flatC,col,f*f*0.5);
  if(lvl<=0.001||a<=0.001) return flatC;
  float t=amBayer(floor(gl_FragCoord.xy/3.0));
  vec3 dots=(a>t)?col:wall;
  return mix(flatC,dots,lvl);
}
`;

  // Regular dodecahedron, from the marker the user designed (13/08). 20 vertices all at
  // radius exactly 1, 12 pentagons as 36 triangles, un-indexed so each facet corner
  // carries its own UV; every facet maps onto the SAME pentagon in texture space, so one
  // small canvas puts the number on all twelve faces and it reads from any angle.
  const AM_DODE_POS=new Float32Array([0.57735,0.57735,-0.57735,0.35682,0.93417,0,0.57735,0.57735,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.93417,0,0.35682,0.57735,0.57735,-0.57735,0.93417,0,0.35682,0.93417,0,-0.35682,0.57735,-0.57735,0.57735,0.93417,0,0.35682,0.57735,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.57735,0,0.35682,0.93417,0.57735,-0.57735,0.57735,0,0.35682,0.93417,0,-0.35682,0.93417,-0.57735,0.57735,0.57735,0,0.35682,0.93417,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.57735,0.57735,0.35682,0.93417,0,-0.57735,0.57735,0.57735,0.35682,0.93417,0,-0.35682,0.93417,0,0,-0.35682,-0.93417,0,0.35682,-0.93417,0.57735,0.57735,-0.57735,0,-0.35682,-0.93417,0.57735,0.57735,-0.57735,0.93417,0,-0.35682,0,-0.35682,-0.93417,0.93417,0,-0.35682,0.57735,-0.57735,-0.57735,-0.35682,0.93417,0,0.35682,0.93417,0,0.57735,0.57735,-0.57735,-0.35682,0.93417,0,0.57735,0.57735,-0.57735,0,0.35682,-0.93417,-0.35682,0.93417,0,0,0.35682,-0.93417,-0.57735,0.57735,-0.57735,0.93417,0,-0.35682,0.93417,0,0.35682,0.57735,-0.57735,0.57735,0.93417,0,-0.35682,0.57735,-0.57735,0.57735,0.35682,-0.93417,0,0.93417,0,-0.35682,0.35682,-0.93417,0,0.57735,-0.57735,-0.57735,-0.35682,-0.93417,0,0.35682,-0.93417,0,0.57735,-0.57735,0.57735,-0.35682,-0.93417,0,0.57735,-0.57735,0.57735,0,-0.35682,0.93417,-0.35682,-0.93417,0,0,-0.35682,0.93417,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,0,-0.35682,-0.93417,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,0.35682,-0.93417,0,-0.57735,-0.57735,-0.57735,0.35682,-0.93417,0,-0.35682,-0.93417,0,-0.93417,0,-0.35682,-0.93417,0,0.35682,-0.57735,0.57735,0.57735,-0.93417,0,-0.35682,-0.57735,0.57735,0.57735,-0.35682,0.93417,0,-0.93417,0,-0.35682,-0.35682,0.93417,0,-0.57735,0.57735,-0.57735,0,-0.35682,0.93417,0,0.35682,0.93417,-0.57735,0.57735,0.57735,0,-0.35682,0.93417,-0.57735,0.57735,0.57735,-0.93417,0,0.35682,0,-0.35682,0.93417,-0.93417,0,0.35682,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.93417,0,-0.35682,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.57735,0,0.35682,-0.93417,-0.57735,-0.57735,-0.57735,0,0.35682,-0.93417,0,-0.35682,-0.93417,-0.57735,-0.57735,-0.57735,-0.35682,-0.93417,0,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.93417,0,0.35682,-0.57735,-0.57735,-0.57735,-0.93417,0,0.35682,-0.93417,0,-0.35682]);
  const AM_DODE_UV=new Float32Array([0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094]);
  // ---- the counter marker (decision 71) ------------------------------------------------
  // The number lives ON the object, on every one of the twelve facets, so it reads from any
  // angle without the marker ever being rotated. The floating tag is gone: a screen-space
  // tag keeps its size at every zoom, and the user chose the object knowing that cost.
  // One shared canvas carries a facet's shading; the number is stamped onto a copy, so a
  // mark costs one small texture — the same cost the floating sprite already paid.
  const AM_MK = (function(){
    const R = 128;                                   // texture side; a facet is ~40 px on screen
    let shadeCv = null;
    function shade(){
      if(shadeCv) return shadeCv;
      const cv=document.createElement('canvas'); cv.width=cv.height=R;
      const x=cv.getContext('2d');
      x.fillStyle='#000'; x.fillRect(0,0,R,R);
      const cx=R/2, cy=R/2, rad=0.45*R, pts=[];
      for(let k=0;k<5;k++){const a=2*Math.PI*k/5-Math.PI/2; pts.push([cx+rad*Math.cos(a), cy+rad*Math.sin(a)]);}
      // the shade pools at the CORNERS and thins along the middle of an edge (user 13/08):
      // a short reach in from every edge, a long reach out of every vertex
      x.globalCompositeOperation='lighter';
      for(let k=0;k<5;k++){
        const a=pts[k], b=pts[(k+1)%5];
        const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
        const g=x.createLinearGradient(mx,my,cx,cy);
        g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.12,'rgba(255,255,255,0.28)');
        g.addColorStop(0.30,'rgba(255,255,255,0)');
        x.fillStyle=g; x.beginPath(); x.moveTo(a[0],a[1]); x.lineTo(b[0],b[1]); x.lineTo(cx,cy); x.closePath(); x.fill();
      }
      for(let k=0;k<5;k++){
        const px=pts[k][0], py=pts[k][1];
        const g=x.createRadialGradient(px,py,0,px,py,rad*0.60);
        g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.45,'rgba(255,255,255,0.45)');
        g.addColorStop(1,'rgba(255,255,255,0)');
        x.fillStyle=g; x.beginPath(); x.arc(px,py,rad*0.60,0,6.284); x.fill();
      }
      x.globalCompositeOperation='destination-in';    // nothing outside the facet
      x.fillStyle='#fff'; x.beginPath();
      x.moveTo(pts[0][0],pts[0][1]); for(let k=1;k<5;k++)x.lineTo(pts[k][0],pts[k][1]);
      x.closePath(); x.fill();
      shadeCv=cv; return cv;
    }
    const cache=new Map();
    function texture(num){
      const key=String(num);
      if(cache.has(key)) return cache.get(key);
      const cv=document.createElement('canvas'); cv.width=cv.height=R;
      const x=cv.getContext('2d');
      x.drawImage(shade(),0,0);                       // grey = the shade; read from .r
      x.globalCompositeOperation='source-over';
      x.fillStyle='#00ff00';                          // the digit rides in GREEN alone
      x.textAlign='center'; x.textBaseline='middle';
      let fs=Math.round(R*0.42);
      x.font='700 '+fs+'px system-ui, Arial, sans-serif';
      while(x.measureText(key).width>R*0.62&&fs>8){fs-=2;x.font='700 '+fs+'px system-ui, Arial, sans-serif';}
      x.fillText(key,R/2,R/2+R*0.02);
      const t=new THREE.CanvasTexture(cv);
      // flipY OFF: a pentagon is rotationally odd, so the default Y-flip lands the
      // corner shading on the edge midpoints (36deg off) and mirrors the digits.
      // With flipY=false the canvas coordinates equal the UV coordinates exactly.
      t.flipY=false;
      t.anisotropy=4; t.needsUpdate=true;
      cache.set(key,t); return t;
    }
    function geometry(rad){
      const g=new THREE.BufferGeometry();
      const p=new Float32Array(AM_DODE_POS.length);
      for(let i=0;i<p.length;i++) p[i]=AM_DODE_POS[i]*rad;
      g.setAttribute('position',new THREE.BufferAttribute(p,3));
      g.setAttribute('uv',new THREE.BufferAttribute(AM_DODE_UV.slice(),2));
      g.computeVertexNormals();
      return g;
    }
    function material(hex, op, designU, num){
      // The canvas is NOT a colour map: red carries the facet's shade, green the digit. It
      // rides in a uniform of its own, because three.js multiplies `map` into the colour
      // automatically, and undoing that multiply is both ugly and numerically unstable.
      const m=new THREE.MeshBasicMaterial({color:new THREE.Color(hex),
        transparent:(op<1)||false, opacity:(typeof op==='number')?op:1.0});
      m.userData.amTexU={value:texture(num)};
      m.onBeforeCompile=sh=>{
        sh.uniforms.amDesign=designU;
        sh.uniforms.amTex=m.userData.amTexU;
        sh.vertexShader=sh.vertexShader
          .replace('#include <common>','#include <common>\nvarying vec3 vAPosM;varying vec2 vAUvM;')
          .replace('#include <begin_vertex>','#include <begin_vertex>\nvAPosM=transformed;vAUvM=uv;');
        sh.fragmentShader=sh.fragmentShader
          .replace('#include <common>','#include <common>\nvarying vec3 vAPosM;varying vec2 vAUvM;uniform float amDesign;uniform sampler2D amTex;'+AM_SHADER_FN)
          .replace('#include <opaque_fragment>',
            'vec4 amT=texture2D(amTex,vAUvM);'
           +'float amT0=amBayer(floor(gl_FragCoord.xy/3.0));vec3 amC=mix(diffuseColor.rgb,diffuseColor.rgb*0.72,((amT0<0.55)?1.0:0.0)*amDesign);'
           +'amC*= 1.0-0.40*amDesign*amT.r;'
           +'amC=mix(amC,amC*0.20,clamp(amT.g-amT.r,0.0,1.0));'
           +'outgoingLight=amC;\n#include <opaque_fragment>');
      };
      m.userData.amDesign=designU;
      return m;
    }
    return {geometry:geometry, material:material, texture:texture};
  })();
  const amDesignU={value:0.6};
mat.onBeforeCompile=sh=>{
    sh.uniforms.amDesign=amDesignU;
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nattribute vec3 aCol;attribute float aFlat;attribute float aDes;varying vec3 vACol;varying float vAFlat;varying float vADes;varying vec3 vAPos;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvACol=aCol;vAFlat=aFlat;vADes=aDes;vAPos=transformed;');
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>','#include <common>\nvarying vec3 vACol;varying float vAFlat;varying float vADes;varying vec3 vAPos;uniform float amDesign;'+AM_SHADER_FN)
      .replace('#include <opaque_fragment>','outgoingLight=amStipple(outgoingLight,vACol,vAFlat,vADes);\n#include <opaque_fragment>');
  };
  const mesh=new THREE.Mesh(geo,mat); scene.add(mesh);

  /* ---- state ---- */
  let brushR=0.10, mode='nav';
  const roi=new Uint8Array(N); let roiCount=0;
  if(roi0) for(let f=0;f<N;f++){ if(roi0[FACEOF[f]]){roi[f]=1;roiCount++;} }
  /* marking TYPES (decision 58) — field-for-field the desktop model: every colour is
     a category with its own marks, threshold and probability field; overlap allowed,
     areas per type over the FULL marking, stripes are display only. On the iPad the
     baked probability field stays dormant until a training or a loaded sheet arms it
     (hasProb) — same as the single-type version always behaved. */
  const types=[]; let activeT=0, tSeq=0;
  let activeKind='area';               // area layers XOR length layers (user round 11/08)
  const hex2rgb=h=>[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];
  function mkType(name,hex){const T={design:0.6,id:'t'+(tSeq++),name:name,hex:hex,color:hex2rgb(hex),
    manual:new Int8Array(N),faceThr:null,thr:0.50,prob:null,hasProb:false,op:0.75,area:0};
    types.push(T);return T;}
  const T0=mkType('תיקון','#4dff4d'); T0.prob=prob;
  function reservedColor(hex){const [r,g,b]=hex2rgb(hex);const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(mx-mn<0.18)return false;
    let h=0; if(mx===r)h=60*(((g-b)/(mx-mn))%6); else if(mx===g)h=60*((b-r)/(mx-mn)+2); else h=60*((r-g)/(mx-mn)+4);
    if(h<0)h+=360; return (h>=18&&h<48);}         // only ORANGE is reserved
  const effThr=(ti,f)=>{const T=types[ti];const t=T.faceThr?T.faceThr[f]:NaN;return isNaN(t)?T.thr:t;};
  function isType(ti,f){const T=types[ti],m=T.manual[f]; if(m===1)return true; if(m===-1)return false;
    if(!T.hasProb||!T.prob)return false;
    if(roiCount>0&&!roi[f])return false;
    return T.prob[f]>effThr(ti,f);}
  function isRepair(f){for(let ti=0;ti<types.length;ti++)if(isType(ti,f))return true;return false;}
  const ROIC=[1.0,0.80,0.45];
  const _vis=[];
  function recolorFace(f){
    let r=null, a=0, d=0; _vis.length=0;
    for(let ti=0;ti<types.length;ti++) if(types[ti].op>0&&isType(ti,f)) _vis.push(ti);
    if(!_vis.length){ if(roi[f]){r=ROIC;a=0.45;} else {r=[1,1,1];a=0;} }
    else { const T=types[_vis[f%_vis.length]]; r=T.color; a=T.op; d=(typeof T.design==='number')?T.design:0.6; }   // alternating triangles
    const o=f*9;
    for(let c=0;c<3;c++){colors[o+c*3]=r[0];colors[o+c*3+1]=r[1];colors[o+c*3+2]=r[2];flats[f*3+c]=a;dess[f*3+c]=d;}
  }
  function recolorAll(){for(let f=0;f<N;f++)recolorFace(f);colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();}
  function updateArea(){
    for(let ti=0;ti<types.length;ti++){const T=types[ti];let a=0;
      for(let f=0;f<N;f++)if(isType(ti,f))a+=area[f];
      T.area=a;
      const e2=document.getElementById('tA_'+T.id); if(e2)e2.textContent=a.toFixed(2);}
    $('area').textContent='';
    for(const lt of lenTypes){let s2=0;for(const ln of lines)if(ln.t===lt.id)s2+=ln.len;
      const e3=document.getElementById('lA_'+lt.id); if(e3)e3.textContent=s2.toFixed(2);}
    for(const ct of cntTypes){let n2=0;for(const m of xmarks)if(m.t===ct.id)n2++;
      const e4=document.getElementById('cA_'+ct.id); if(e4)e4.textContent=String(n2);}
  }
  /* length pens (decision 58): continuous stroke -> sampled polyline; no learning */
  const lenTypes=[]; let activeL=-1, lSeq=0;
  const lines=[]; let curLine=null; const MIN_SEG=0.002;
  let lineW=0.008;                     // tube radius; brush slider drives it in len kind
  function mkLenType(name,hex){const T={design:0.0,designU:{value:0.0},id:'l'+(lSeq++),name:name,hex:hex,op:1.0};lenTypes.push(T);return T;}
  function applyLenOp(T){for(const L of lines)if(L.t===T.id&&L.obj){L.obj.material.transparent=T.op<1;L.obj.material.opacity=T.op;L.obj.material.needsUpdate=true;}}
  function lineObj(L){
    const _src=(L.fit&&L.fit.stations)||L.pts;
    const v=[];for(let i=0;i<_src.length;i+=3)v.push(new THREE.Vector3(_src[i],_src[i+1],_src[i+2]));
    const lt=lenTypes.find(x=>x.id===L.t);
    let g=(L.fit&&L.fit.normals)?amRibbonGeom(L.fit.stations,L.fit.normals,L.w||0.008):null;
    if(!g) g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v),Math.min(400,Math.max(2,v.length*2)),L.w||0.008,6,false);
    if(lt&&!lt.designU)lt.designU={value:lt.design||0};
    const m=new THREE.Mesh(g,amTapeSkinMat(lt?lt.hex:'#eab308',(lt&&typeof lt.op==='number')?lt.op:1.0,
      (lt&&lt.designU)||{value:0}, (L.fit&&L.fit.length_m)||lineLen(_src)));
    m.renderOrder=2; return m;}
  // ---- counter layers (round 3): an X per tap, the chip counts them ----
  const cntTypes=[]; let activeC=-1, cSeq=0;
  const xmarks=[];
  // per-layer diamond DIAMETER in true metres + per-layer opacity (12/08) — mirror of
  // the desktop editor, and both ride in the sheet so devices render identically
  const cntDefSize=()=>Math.max(0.024,bs.radius*0.018);
  function mkCntType(name,hex){const T={design:0.6,designU:{value:0.6},id:'c'+(cSeq++),name:name,hex:hex,size:cntDefSize(),op:1.0};cntTypes.push(T);return T;}
  function xObj(m){const T=cntTypes.find(x=>x.id===m.t);
    const dm=new THREE.Mesh(AM_MK.geometry(((T&&T.size)||cntDefSize())/2),
      AM_MK.material(T?T.hex:'#ef4444', T?(T.op!==undefined?T.op:1):1, amDesignU, m.n||1));
    dm.position.set(m.p[0],m.p[1],m.p[2]); dm.renderOrder=3; return dm;}
  function resizeCnt(T){for(const m of xmarks)if(m.t===T.id&&m.obj){
    scene.remove(m.obj);m.obj=xObj(m);scene.add(m.obj);}}
  function addX(m){if(!m.obj)m.obj=xObj(m); scene.add(m.obj); if(!xmarks.includes(m))xmarks.push(m);}
  function delX(m){if(m.obj)scene.remove(m.obj); const i=xmarks.indexOf(m); if(i>=0)xmarks.splice(i,1);}
  function placeXAt(e){if(activeC<0)return;
    const hit=castAt(e); if(!hit.length)return;
    const h=hit[0],nrm=h.face?h.face.normal:null;
    const T0=cntTypes[activeC];
    const lift=((T0&&T0.size)||cntDefSize())/2;   // lift tracks the diamond's actual radius
    const m={t:cntTypes[activeC].id,
      p:[h.point.x+(nrm?nrm.x*lift:0),h.point.y+(nrm?nrm.y*lift:0),h.point.z+(nrm?nrm.z*lift:0)],obj:null};
    addX(m); undoStack.push([['X+',m]]); redoStack.length=0; markUnexported(true); updateHB(); updateArea();}
  // Erase what you AIM AT (12/08, mirror of the desktop fix): the ray hits the diamonds
  // themselves. A diamond is lifted half its diameter off the surface, so it blocks the
  // ray and a mesh-based test measured from a point BEHIND it; and the brush slider is
  // the diamond diameter here, not a radius. On a finger-driven device this matters more.
  function eraseXAt(e){
    const r=el.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/Math.max(1,r.width))*2-1,
                                -((e.clientY-r.top)/Math.max(1,r.height))*2+1);
    ray.setFromCamera(ndc,camera);
    const diff=[];
    const objs=xmarks.filter(m=>m.obj).map(m=>m.obj);
    const hits=objs.length?ray.intersectObjects(objs,false):[];
    if(hits.length){
      const target=xmarks.find(m=>m.obj===hits[0].object);
      if(target){diff.push(['X-',target]);delX(target);}
    } else {
      const hitM=ray.intersectObject(mesh,false);
      if(hitM.length){
        const p=hitM[0].point;
        for(const m of [...xmarks]){
          const T=cntTypes.find(x=>x.id===m.t);
          const tol=Math.max(0.03,((T&&T.size)||cntDefSize())*0.9);
          const dx=m.p[0]-p.x,dy=m.p[1]-p.y,dz=m.p[2]-p.z;
          if(dx*dx+dy*dy+dz*dz<=tol*tol){diff.push(['X-',m]);delX(m);}}
      }
    }
    if(diff.length){undoStack.push(diff);redoStack.length=0;markUnexported(true);updateHB();updateArea();}}
  function eraseLineAt(p){
    const r2=Math.max(0.02,lineW*2)**2;
    for(const L of [...lines]){
      const keep=[]; let touched=false;
      for(let i=0;i<L.pts.length;i+=3){
        const dx=L.pts[i]-p.x,dy=L.pts[i+1]-p.y,dz=L.pts[i+2]-p.z;
        if(dx*dx+dy*dy+dz*dz<=r2){touched=true;keep.push(null);}
        else keep.push([L.pts[i],L.pts[i+1],L.pts[i+2]]);
      }
      if(!touched)continue;
      const runs=[]; let cur=[];
      for(const k of keep){ if(k)cur.push(k[0],k[1],k[2]); else {if(cur.length>=6)runs.push(cur);cur=[];} }
      if(cur.length>=6)runs.push(cur);
      const diff=[['L-',L]]; delLine(L);
      for(const run of runs){const NL={t:L.t,pts:run,len:lineLen(run),w:L.w,obj:null};addLine(NL);diff.push(['L+',NL]);}
      undoStack.push(diff);redoStack.length=0;markUnexported(true);updateHB();
    }
    updateArea();
  }
  function addLine(L){if(!L.obj)L.obj=lineObj(L); scene.add(L.obj); if(!lines.includes(L))lines.push(L);}
  function delLine(L){if(L.obj)scene.remove(L.obj); const i=lines.indexOf(L); if(i>=0)lines.splice(i,1);}
  function lineLen(pts){let s2=0;for(let i=3;i<pts.length;i+=3)
    s2+=Math.hypot(pts[i]-pts[i-3],pts[i+1]-pts[i-2],pts[i+2]-pts[i-1]);return s2;}

  /* ---- undo/redo + op-log hookup (type-aware; lines ride the same stack) ---- */
  const undoStack=[],redoStack=[]; let curDiff=null,curT=null;
  const beginH=()=>{curDiff=[];curT=new Set();};
  // null-safe: a paint outside an open stroke still mutates, just without history
  const recH=(ti,f)=>{const k=ti*N+f;
    if(curT&&!curT.has(k)){curT.add(k);curDiff.push([ti,f,types[ti].manual[f]]);}};
  // op-log entries carry the type's colour+name, so a restore can rebuild the palette
  const typedOps=diff=>diff.filter(d=>d[0]!=='L+'&&d[0]!=='L-')
    .map(([ti,f])=>({s:f,v:types[ti].manual[f],c:types[ti].hex,n:types[ti].name}));
  function commitH(){
    if(curDiff&&curDiff.length){
      undoStack.push(curDiff);redoStack.length=0;
      logOps(typedOps(curDiff));                      // final values of this stroke
      markUnexported(true);
    }
    curDiff=null;curT=null;updateHB();
  }
  // export-reminder anchor (decision 19): unexported marks must be VISIBLE —
  // with non-technical users the export is the step that gets forgotten
  function markUnexported(on){
    $('mExport').textContent=on?'⚠ ייצוא גיליון':'ייצוא גיליון';
    $('mExport').style.outline=on?'2px solid #ef4444':'';
  }
  function applyDiff(diff){
    const inv=[];
    for(let i=diff.length-1;i>=0;i--){const d=diff[i];
      if(d[0]==='L+'){inv.push(['L-',d[1]]);delLine(d[1]);}
      else if(d[0]==='L-'){inv.push(['L+',d[1]]);addLine(d[1]);}
      else if(d[0]==='X+'){inv.push(['X-',d[1]]);delX(d[1]);}
      else if(d[0]==='X-'){inv.push(['X+',d[1]]);addX(d[1]);}
      else {const [ti,f,o]=d;inv.push([ti,f,types[ti].manual[f]]);types[ti].manual[f]=o;recolorFace(f);}}
    inv.reverse();
    logOps(typedOps(diff));
    colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();return inv;
  }
  const undo=()=>{if(undoStack.length){redoStack.push(applyDiff(undoStack.pop()));updateHB();}};
  const redo=()=>{if(redoStack.length){undoStack.push(applyDiff(redoStack.pop()));updateHB();}};
  function updateHB(){$('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;}
  function findOrMkType(hex,name){
    let T=types.find(t=>t.hex===hex); if(!T){T=mkType(name||'',hex||'#4dff4d');buildChips();}
    return types.indexOf(T);}

  /* ---- orbit + gestures (verbatim port: this code is what killed the jumps) --- */
  const target=new THREE.Vector3(); let dist=1,az=0,pol=0.55; const bs=geo.boundingSphere;
  function fit(){target.copy(bs.center);dist=bs.radius*2.4;az=0;pol=0.55;apply();}
  function apply(){pol=Math.max(0.05,Math.min(Math.PI-0.05,pol));
    camera.position.set(target.x+dist*Math.sin(pol)*Math.sin(az),
      target.y+dist*Math.cos(pol),target.z+dist*Math.sin(pol)*Math.cos(az));
    camera.lookAt(target);camera.updateMatrixWorld(true);}
  let dragging=null,last=[0,0],paintManual=false;
  const el=cv;
  const ptrs=new Map(); let pinch=null; let dragId=null;
  const pdist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const touchList=()=>[...ptrs.values()].filter(p=>p.type==='touch');
  const hasPen=()=>{for(const p of ptrs.values())if(p.type==='pen')return true;return false;};
  function startPinch(){const t=touchList();if(t.length<2)return;
    pinch={d:pdist(t[0],t[1]),mx:(t[0].x+t[1].x)/2,my:(t[0].y+t[1].y)/2};}
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType==='pen'){
      for(const [id,p] of [...ptrs]) if(p.type==='touch'){try{el.releasePointerCapture(id);}catch(_){}ptrs.delete(id);}
      if(dragging==='pinch'||dragging==='rot'){pinch=null;dragging=null;dragId=null;}
    } else if(e.pointerType==='touch'&&hasPen()) return;
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    last=[e.clientX,e.clientY]; dragId=e.pointerId;
    if(touchList().length>=2&&!hasPen()){
      if(dragging==='paint'&&paintManual)commitH();
      if(dragging==='line')endLine();
      startPinch();dragging='pinch';return;}
    // a finger ALWAYS navigates — marking/erasing/growing is pencil-only
    // (user decision 08/08/2026; also the original editor's behaviour)
    if(e.pointerType==='touch'){dragging='rot';}
    else if(mode==='nav'){dragging='rot';}
    else if(mode==='grow'){growAt(e);dragging=null;}
    else if(activeKind==='len'&&mode==='add'){dragging='line';curLine=null;lineAt(e);}
    else if(activeKind==='len'&&mode==='rem'){dragging='lerase';lineEraseAt(e);}
    else if(activeKind==='cnt'&&mode==='add'){placeXAt(e);dragging=null;}
    else if(activeKind==='cnt'&&mode==='rem'){dragging='xerase';eraseXAt(e);}
    else {dragging='paint';paintManual=true;beginH();paintAt(e);}
  });
  el.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;                    // hovering pencil guard
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    if(dragging==='pinch'){const t=touchList();if(t.length<2||!pinch)return;
      const nd=pdist(t[0],t[1]),nmx=(t[0].x+t[1].x)/2,nmy=(t[0].y+t[1].y)/2;
      if(nd>0){dist*=pinch.d/nd;dist=Math.max(bs.radius*0.04,Math.min(bs.radius*8,dist));
        const k=dist*0.0015;const r=new THREE.Vector3();camera.getWorldDirection(r);
        const right=new THREE.Vector3().crossVectors(r,camera.up).normalize();
        const up=new THREE.Vector3().crossVectors(right,r).normalize();
        target.addScaledVector(right,-(nmx-pinch.mx)*k);target.addScaledVector(up,(nmy-pinch.my)*k);apply();}
      pinch={d:nd,mx:nmx,my:nmy};return;}
    if(dragId!==null&&e.pointerId!==dragId) return;       // palm guard
    const dx=e.clientX-last[0],dy=e.clientY-last[1];last=[e.clientX,e.clientY];
    if(dragging==='rot'){az-=dx*0.006;pol-=dy*0.006;apply();}
    else if(dragging==='line'){lineAt(e);}
    else if(dragging==='lerase'){lineEraseAt(e);}
    else if(dragging==='xerase'){eraseXAt(e);}
    else if(dragging==='paint'){paintAt(e);}
  });
  function endDrag(e){
    if(e){ptrs.delete(e.pointerId);if(e.pointerId===dragId)dragId=null;}
    if(dragging==='pinch'){if(touchList().length>=2)startPinch();else{pinch=null;dragging=null;}return;}
    if(dragging==='paint'&&paintManual)commitH();
    if(dragging==='line')endLine();
    dragging=null;dragId=null;
  }
  el.addEventListener('pointerup',endDrag);el.addEventListener('pointercancel',endDrag);
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.style.touchAction='none';
  el.addEventListener('dblclick',e=>e.preventDefault());
  ['gesturestart','gesturechange','gestureend'].forEach(g=>{
    el.addEventListener(g,e=>e.preventDefault());
    document.addEventListener(g,e=>e.preventDefault(),{passive:false});
  });
  document.addEventListener('touchmove',e=>{
    if(e.touches.length>1){e.preventDefault();return;}
    const t=e.target;
    if(!(t.closest&&t.closest('input,button,select,textarea,label'))) e.preventDefault();
  },{passive:false});
  document.addEventListener('dblclick',e=>e.preventDefault());

  /* ---- region growing (flood by brightness / probability) ---- */
  let growTol=14;
  const RG=0.05, RG2=RG*RG;
  const ray=new THREE.Raycaster();
  function castAt(e){
    const r=el.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/Math.max(1,r.width))*2-1,
                                -((e.clientY-r.top)/Math.max(1,r.height))*2+1);
    ray.setFromCamera(ndc,camera);
    return ray.intersectObject(mesh,false);
  }
  function growAt(e){
    const hit=castAt(e); if(!hit.length)return;
    const seed=hit[0].faceIndex; if(seed==null)return;
    const seedVal=lum[FACEOF[seed]];
    if(roiCount>0&&!roi[seed])return;
    const visited=new Uint8Array(N); const q=[seed]; visited[seed]=1;
    let head=0,added=0; const CAP=80000;
    const M=types[activeT].manual;
    beginH();
    while(head<q.length&&added<CAP){const s=q[head++];
      if(M[s]!==1){recH(activeT,s);M[s]=1;recolorFace(s);} added++;
      const cx=cen[s*3],cy=cen[s*3+1],cz=cen[s*3+2];
      const ix0=Math.floor((cx-RG)/CELL),ix1=Math.floor((cx+RG)/CELL);
      const iy0=Math.floor((cy-RG)/CELL),iy1=Math.floor((cy+RG)/CELL);
      const iz0=Math.floor((cz-RG)/CELL),iz1=Math.floor((cz+RG)/CELL);
      for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
        const a=grid.get(ckey(ix,iy,iz)); if(!a)continue;
        for(let n=0;n<a.length;n++){const g2=a[n]; if(visited[g2])continue;
          const dx=cen[g2*3]-cx,dy=cen[g2*3+1]-cy,dz=cen[g2*3+2]-cz;
          if(dx*dx+dy*dy+dz*dz>RG2)continue;
          if(roiCount>0&&!roi[g2]){visited[g2]=1;continue;}
          const ok=Math.abs(lum[FACEOF[g2]]-seedVal)<=growTol;
          visited[g2]=1; if(ok)q.push(g2);
        }}
    }
    colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();commitH();
  }

  /* ---- brush paint ---- */
  function paintAt(e){
    const hit=castAt(e); if(!hit.length)return;
    const p=hit[0].point,r2=brushR*brushR;let ch=false;
    const val=(mode==='add')?1:-1;
    const ix0=Math.floor((p.x-brushR)/CELL),ix1=Math.floor((p.x+brushR)/CELL);
    const iy0=Math.floor((p.y-brushR)/CELL),iy1=Math.floor((p.y+brushR)/CELL);
    const iz0=Math.floor((p.z-brushR)/CELL),iz1=Math.floor((p.z+brushR)/CELL);
    for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
      const a=grid.get(ckey(ix,iy,iz)); if(!a)continue;
      for(let n=0;n<a.length;n++){const f=a[n];
        const dx=cen[f*3]-p.x,dy=cen[f*3+1]-p.y,dz=cen[f*3+2]-p.z;
        if(dx*dx+dy*dy+dz*dz<=r2){
          if(roiCount>0&&!roi[f])continue;                // locked outside the orange zone
          const M=types[activeT].manual;
          if(M[f]!==val){recH(activeT,f);M[f]=val;recolorFace(f);ch=true;}
        }}}
    if(ch){colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();}
  }

  /* ---- length stroke: sample the pencil path into a surface polyline ---- */
  function lineEraseAt(e){const hit=castAt(e);if(hit.length)eraseLineAt(hit[0].point);}
  function lineAt(e){
    if(activeL<0)return;
    const hit=castAt(e); if(!hit.length)return;
    const h=hit[0]; const nrm=h.face?h.face.normal:null; const lift=Math.max(0.004,lineW*0.8);
    const px=h.point.x+(nrm?nrm.x*lift:0), py=h.point.y+(nrm?nrm.y*lift:0), pz=h.point.z+(nrm?nrm.z*lift:0);
    if(!curLine){curLine={t:lenTypes[activeL].id,pts:[px,py,pz],len:0,w:lineW,obj:null};return;}
    const p=curLine.pts, n2=p.length;
    const d=Math.hypot(px-p[n2-3],py-p[n2-2],pz-p[n2-1]);
    if(d<MIN_SEG)return;
    p.push(px,py,pz); curLine.len+=d;
    if(curLine.obj)scene.remove(curLine.obj);
    curLine.obj=lineObj(curLine); scene.add(curLine.obj);
  }
  // ---- the tape's skin (decision 74, slice 3) --------------------------------------------
  // A flat world-space band from the STORED stations+normals: lifted 4 mm along the smoothed
  // normal, width across it. Display only — the measured geometry is the stations
  // themselves; this offset never enters a number.
  function amRibbonGeom(st, nm, w){
    const n=st.length/3;
    if(n<2||!nm||nm.length!==st.length) return null;
    const half=Math.max(w||0.008,0.004), lift=0.004;
    const pos=new Float32Array(n*6), idx=[];
    const P=new THREE.Vector3(),N=new THREE.Vector3(),T=new THREE.Vector3(),Sd=new THREE.Vector3();
    for(let i=0;i<n;i++){
      P.set(st[i*3],st[i*3+1],st[i*3+2]); N.set(nm[i*3],nm[i*3+1],nm[i*3+2]);
      const a=Math.max(i-1,0), b=Math.min(i+1,n-1);
      T.set(st[b*3]-st[a*3],st[b*3+1]-st[a*3+1],st[b*3+2]-st[a*3+2]);
      if(T.lengthSq()<1e-12)T.set(1,0,0); T.normalize();
      Sd.crossVectors(N,T); if(Sd.lengthSq()<1e-12)Sd.set(0,1,0);
      Sd.normalize().multiplyScalar(half);
      const ox=N.x*lift, oy=N.y*lift, oz=N.z*lift;
      pos[i*6  ]=P.x-Sd.x+ox; pos[i*6+1]=P.y-Sd.y+oy; pos[i*6+2]=P.z-Sd.z+oz;
      pos[i*6+3]=P.x+Sd.x+ox; pos[i*6+4]=P.y+Sd.y+oy; pos[i*6+5]=P.z+Sd.z+oz;
      if(i){const k=(i-1)*2; idx.push(k,k+1,k+2, k+1,k+3,k+2);}
    }
    // u = metres along the band, for the dash pattern (user 14/08)
    const uvs=new Float32Array(n*4); let run=0;
    for(let i=0;i<n;i++){
      if(i) run+=Math.hypot(st[i*3]-st[i*3-3],st[i*3+1]-st[i*3-2],st[i*3+2]-st[i*3-1]);
      uvs[i*4]=run; uvs[i*4+1]=0; uvs[i*4+2]=run; uvs[i*4+3]=1;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    g.setIndex(idx);
    return g;
  }


  // The wheel's meaning on a tape (user 14/08): 0 = a solid band, 100 = dots along it,
  // the whole scale in between. A dash is a DISCARD in metres along the band, so it is
  // true length, identical in the editor and the report.
  function amTapeSkinMat(hex, op, designU, lenM){
    const m=new THREE.MeshBasicMaterial({color:new THREE.Color(hex), side:THREE.DoubleSide,
      transparent:(op<1)||false, opacity:(typeof op==='number')?op:1.0});
    m.onBeforeCompile=sh=>{
      sh.uniforms.amDesign=designU;
      sh.uniforms.amLen={value:Math.max(lenM||1e-6,1e-6)};
      sh.vertexShader=sh.vertexShader
        .replace('#include <common>','#include <common>\nvarying float vAU;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvAU=uv.x;');
      sh.fragmentShader=sh.fragmentShader
        .replace('#include <common>','#include <common>\nvarying float vAU;uniform float amDesign;uniform float amLen;')
        .replace('#include <opaque_fragment>','float amDuty=1.0-0.85*amDesign;float amEnd=min(vAU,amLen-vAU);if(amEnd<0.03) amDuty=1.0;if(amDuty<0.999&&fract(vAU/0.06)>amDuty)discard;\n#include <opaque_fragment>');
    };
    m.userData.amDesign=designU;
    return m;
  }

  // ---- the measurement chain (decision 74, slice 1) -------------------------------------
  // Pen-up: resample at equal arc length -> corridor smoothing (hard clamp delta to the raw
  // stroke; corner cutting structurally bounded) -> iterated closest-point snap on the BVH.
  // The stations are the stroke's ONE truth: measured here, drawn here, saved in the sheet,
  // summed by the server. Calibrated in spike 2: A 0.011%, C/D ~0.57%, E clean bridge.

  // ---- the tape's skin (decision 74, slice 3) --------------------------------------------
  // A flat world-space band from the STORED stations+normals: lifted 4 mm along the smoothed
  // normal, width across it. Display only — the measured geometry is the stations
  // themselves; this offset never enters a number.
  function amRibbonGeom(st, nm, w){
    const n=st.length/3;
    if(n<2||!nm||nm.length!==st.length) return null;
    const half=Math.max(w||0.008,0.004), lift=0.004;
    const pos=new Float32Array(n*6), idx=[];
    const P=new THREE.Vector3(),N=new THREE.Vector3(),T=new THREE.Vector3(),Sd=new THREE.Vector3();
    for(let i=0;i<n;i++){
      P.set(st[i*3],st[i*3+1],st[i*3+2]); N.set(nm[i*3],nm[i*3+1],nm[i*3+2]);
      const a=Math.max(i-1,0), b=Math.min(i+1,n-1);
      T.set(st[b*3]-st[a*3],st[b*3+1]-st[a*3+1],st[b*3+2]-st[a*3+2]);
      if(T.lengthSq()<1e-12)T.set(1,0,0); T.normalize();
      Sd.crossVectors(N,T); if(Sd.lengthSq()<1e-12)Sd.set(0,1,0);
      Sd.normalize().multiplyScalar(half);
      const ox=N.x*lift, oy=N.y*lift, oz=N.z*lift;
      pos[i*6  ]=P.x-Sd.x+ox; pos[i*6+1]=P.y-Sd.y+oy; pos[i*6+2]=P.z-Sd.z+oz;
      pos[i*6+3]=P.x+Sd.x+ox; pos[i*6+4]=P.y+Sd.y+oy; pos[i*6+5]=P.z+Sd.z+oz;
      if(i){const k=(i-1)*2; idx.push(k,k+1,k+2, k+1,k+3,k+2);}
    }
    // u = metres along the band, for the dash pattern (user 14/08)
    const uvs=new Float32Array(n*4); let run=0;
    for(let i=0;i<n;i++){
      if(i) run+=Math.hypot(st[i*3]-st[i*3-3],st[i*3+1]-st[i*3-2],st[i*3+2]-st[i*3-1]);
      uvs[i*4]=run; uvs[i*4+1]=0; uvs[i*4+2]=run; uvs[i*4+3]=1;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    g.setIndex(idx);
    return g;
  }

  // The wheel's meaning on a tape (user 14/08): 0 = a solid band, 100 = dots along it,
  // the whole scale in between. A dash is a DISCARD in metres along the band, so it is
  // true length, identical in the editor and the report.
  function amTapeSkinMat(hex, op, designU, lenM){
    const m=new THREE.MeshBasicMaterial({color:new THREE.Color(hex), side:THREE.DoubleSide,
      transparent:(op<1)||false, opacity:(typeof op==='number')?op:1.0});
    m.onBeforeCompile=sh=>{
      sh.uniforms.amDesign=designU;
      sh.uniforms.amLen={value:Math.max(lenM||1e-6,1e-6)};
      sh.vertexShader=sh.vertexShader
        .replace('#include <common>','#include <common>\nvarying float vAU;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvAU=uv.x;');
      sh.fragmentShader=sh.fragmentShader
        .replace('#include <common>','#include <common>\nvarying float vAU;uniform float amDesign;uniform float amLen;')
        .replace('#include <opaque_fragment>','float amDuty=1.0-0.85*amDesign;float amEnd=min(vAU,amLen-vAU);if(amEnd<0.03) amDuty=1.0;if(amDuty<0.999&&fract(vAU/0.06)>amDuty)discard;\n#include <opaque_fragment>');
    };
    m.userData.amDesign=designU;
    return m;
  }

  const AM_FIT={tol:0.008, station:0.02, fine:0.01, iters:8, ver:1};
  let amBVH=null;
  setTimeout(()=>{                       // built once, off the critical path (spike 1: <1s)
    try{ if(typeof MeshBVHLib!=='undefined'){
      amBVH=new MeshBVHLib.MeshBVH(geo);
      // the same tree accelerates EVERY raycast in the editor (paint, grow, tape)
      geo.boundsTree=amBVH;
      THREE.Mesh.prototype.raycast=MeshBVHLib.acceleratedRaycast;
    } }
    catch(e){ console.warn('am: BVH build failed', e); }
  },50);
  function amResample(P, step){
    const s=[0]; for(let i=1;i<P.length;i++) s.push(s[i-1]+P[i].distanceTo(P[i-1]));
    const total=s[s.length-1]; if(total<1e-6) return P.slice();
    const n=Math.max(4, Math.round(total/step)), out=[];
    let j=0;
    for(let k=0;k<=n;k++){
      const t=total*k/n;
      while(j<s.length-2 && s[j+1]<t) j++;
      const f=(t-s[j])/Math.max(s[j+1]-s[j],1e-9);
      out.push(new THREE.Vector3().lerpVectors(P[j],P[j+1],Math.min(Math.max(f,0),1)));
    }
    return out;
  }
  function amMeasureStroke(flat, w){
    if(!amBVH) return null;              // library missing or not ready: stay raw, honestly
    const raw=[]; for(let i=0;i+2<flat.length;i+=3) raw.push(new THREE.Vector3(flat[i],flat[i+1],flat[i+2]));
    if(raw.length<3) return null;
    const D=AM_FIT.tol;
    let S=amResample(raw, AM_FIT.station);
    // corridor clamped to the raw POLYLINE (segments, not vertices): measuring against
    // vertices alone made sparse fast strokes scallop toward them (user 14/08). Near a
    // sharp raw corner the corridor tightens x2.5, so corners hold (user 14/08).
    const corners=[];
    {
      const v1=new THREE.Vector3(), v2=new THREE.Vector3();
      for(let i=1;i<raw.length-1;i++){
        v1.subVectors(raw[i],raw[i-1]); v2.subVectors(raw[i+1],raw[i]);
        if(v1.lengthSq()>1e-12&&v2.lengthSq()>1e-12&&v1.angleTo(v2)>Math.PI/6) corners.push(raw[i]);
      }
    }
    const _ab=new THREE.Vector3(), _pr=new THREE.Vector3(), _bp=new THREE.Vector3();
    function amClampToRaw(q, lim){
      let bd=1e9;
      for(let k=0;k+1<raw.length;k++){
        _ab.subVectors(raw[k+1],raw[k]);
        const L2=Math.max(_ab.lengthSq(),1e-12);
        let tt=(q.x-raw[k].x)*_ab.x+(q.y-raw[k].y)*_ab.y+(q.z-raw[k].z)*_ab.z;
        tt=Math.min(Math.max(tt/L2,0),1);
        _pr.copy(raw[k]).addScaledVector(_ab,tt);
        const d=q.distanceTo(_pr);
        if(d<bd){bd=d;_bp.copy(_pr);}
      }
      if(bd>lim) q.sub(_bp).multiplyScalar(lim/bd).add(_bp);
    }
    for(let pass=0;pass<20;pass++){
      for(let i=1;i<S.length-1;i++){
        S[i].set((S[i-1].x+2*S[i].x+S[i+1].x)/4,(S[i-1].y+2*S[i].y+S[i+1].y)/4,(S[i-1].z+2*S[i].z+S[i+1].z)/4);
      }
      for(let i=1;i<S.length-1;i++){
        let lim=D;
        for(const c of corners){ if(S[i].distanceTo(c)<0.04){lim=D*0.4;break;} }
        amClampToRaw(S[i],lim);
      }
    }
    // iterated snap: closest point on the mesh, movement clamped to delta; a station with no
    // surface within 5 cm keeps its smoothed place (hole bridged, never torn)
    const tgt={point:new THREE.Vector3(),distance:0,faceIndex:0};
    const snap=A=>{
      for(const q of A){
        amBVH.closestPointToPoint(q,tgt);
        const d=tgt.distance;
        if(d>0.05) continue;
        if(d<=D) q.copy(tgt.point);
        else q.lerp(tgt.point, D/d);
      }
      return A;
    };
    S=snap(S);
    for(let it=1;it<AM_FIT.iters;it++) S=snap(amResample(S, AM_FIT.fine));
    // a stable normal per station (slice 3): every triangle within 4 cm, averaged via the
    // BVH, then smoothed along the curve — never a single face's flip
    const _nrm=[];
    {
      const sph=new THREE.Sphere(), tn=new THREE.Vector3(), acc=new THREE.Vector3();
      const prev=new THREE.Vector3(0,0,1);
      for(const q of S){
        sph.center.copy(q); sph.radius=0.04; acc.set(0,0,0);
        amBVH.shapecast({
          intersectsBounds:b=>b.intersectsSphere(sph),
          intersectsTriangle:tr=>{ if(tr.intersectsSphere(sph)){tr.getNormal(tn);acc.add(tn);} return false; }
        });
        if(acc.lengthSq()<1e-9) acc.copy(prev);
        acc.normalize(); prev.copy(acc); _nrm.push(acc.clone());
      }
      for(let pass=0;pass<3;pass++)
        for(let i=1;i<_nrm.length-1;i++)
          _nrm[i].add(_nrm[i-1]).add(_nrm[i+1]).normalize();
    }
    const nf=new Array(S.length*3);
    for(let i=0;i<S.length;i++){nf[i*3]=Math.round(_nrm[i].x*1000)/1000;nf[i*3+1]=Math.round(_nrm[i].y*1000)/1000;nf[i*3+2]=Math.round(_nrm[i].z*1000)/1000;}
    let len=0; for(let i=1;i<S.length;i++) len+=S[i].distanceTo(S[i-1]);
    const st=new Array(S.length*3);
    for(let i=0;i<S.length;i++){st[i*3]=Math.round(S[i].x*10000)/10000;st[i*3+1]=Math.round(S[i].y*10000)/10000;st[i*3+2]=Math.round(S[i].z*10000)/10000;}
    return {version:AM_FIT.ver,
            params:{tol_mm:Math.round(D*1000), station_mm:Math.round(AM_FIT.station*1000),
                    iters:AM_FIT.iters, lift_mm:4},
            stations:st, normals:nf, length_m:Math.round(len*1000)/1000};
  }

  function endLine(){
    if(!curLine)return;
    if(curLine.pts.length>=6){
      // same chain as the desktop, same characters, same numbers (slice 4)
      const fit=amMeasureStroke(curLine.pts, curLine.w);
      if(fit){ curLine.fit=fit; curLine.len=fit.length_m;
        if(curLine.obj){scene.remove(curLine.obj);curLine.obj=null;} }
      addLine(curLine);
      undoStack.push([['L+',curLine]]);redoStack.length=0;updateHB();updateArea();
      const lt=lenTypes.find(x=>x.id===curLine.t);
      logOps([]);                                          // faces untouched
      try{if(db&&AM)db.transaction('ops','readwrite').objectStore('ops')
        .put({j:jobKey(),ln:{c:lt?lt.hex:'#eab308',n:lt?lt.name:'',pts:curLine.pts.slice()}});}catch(_){}
      markUnexported(true);}
    else if(curLine.obj)scene.remove(curLine.obj);
    curLine=null;
  }

  /* ---- auto-complete (logistic head on quadratic feature expansion) ---- */
  let EX=null,NE=0;
  function buildEX(){
    NE=12+12+66; EX=new Float32Array(FO*NE); const f=new Float32Array(12);
    for(let fo=0;fo<FO;fo++){for(let k=0;k<12;k++)f[k]=qfeat[fo*12+k]/25; let o=fo*NE,c=0;
      for(let k=0;k<12;k++)EX[o+(c++)]=f[k];
      for(let k=0;k<12;k++)EX[o+(c++)]=f[k]*f[k];
      for(let a=0;a<12;a++)for(let b=a+1;b<12;b++)EX[o+(c++)]=f[a]*f[b];}
    const mean=new Float64Array(NE),std=new Float64Array(NE);
    for(let fo=0;fo<FO;fo++){const o=fo*NE;for(let k=0;k<NE;k++)mean[k]+=EX[o+k];}
    for(let k=0;k<NE;k++)mean[k]/=FO;
    for(let fo=0;fo<FO;fo++){const o=fo*NE;for(let k=0;k<NE;k++){const d=EX[o+k]-mean[k];std[k]+=d*d;}}
    for(let k=0;k<NE;k++)std[k]=Math.sqrt(std[k]/FO)+1e-6;
    for(let fo=0;fo<FO;fo++){const o=fo*NE;for(let k=0;k<NE;k++)EX[o+k]=(EX[o+k]-mean[k])/std[k];}
  }
  function autoComplete(){
    if(!EX)buildEX();
    // per-type learning (decision 58): the ACTIVE type's marks are the examples;
    // faces positive in OTHER types are NEUTRAL — overlap is allowed
    const T=types[activeT];
    const cnt=new Int32Array(FO);
    for(let s=0;s<N;s++){const m=T.manual[s];if(m!==0)cnt[FACEOF[s]]+=m;}
    const otherPos=new Uint8Array(FO);
    for(let tj=0;tj<types.length;tj++){if(tj===activeT)continue;const M=types[tj].manual;
      for(let s=0;s<N;s++)if(M[s]===1)otherPos[FACEOF[s]]=1;}
    const Xi=[],yi=[]; const labeled=new Uint8Array(FO);
    for(let fo=0;fo<FO;fo++){if(cnt[fo]>0){Xi.push(fo);yi.push(1);labeled[fo]=1;}
      else if(cnt[fo]<0){Xi.push(fo);yi.push(0);labeled[fo]=1;}}
    let npos=0;for(const y of yi)npos+=y;let nneg=yi.length-npos;
    if(roiCount>0){
      const rf=new Uint8Array(FO);for(let s=0;s<N;s++)if(roi[s])rf[FACEOF[s]]=1;
      const out=[];for(let fo=0;fo<FO;fo++)if(!rf[fo]&&!labeled[fo]&&!otherPos[fo])out.push(fo);
      const cap=Math.min(out.length,Math.max(300,npos*3));
      for(let i=0;i<cap;i++){const fo=out[(Math.random()*out.length)|0];
        if(labeled[fo])continue;labeled[fo]=1;Xi.push(fo);yi.push(0);nneg++;}
    }
    if(npos<15||nneg<15){alert('צריך עוד דוגמאות לסוג "'+(T.name||'ללא שם')+'": לפחות ~15 פאות מסומנות (＋) ו-15 לא (−).\nכרגע: '+npos+' כן, '+nneg+' לא.');return;}
    const w=new Float64Array(NE);let bw=0;
    const wpos=yi.length/(2*npos),wneg=yi.length/(2*nneg),lr=0.3,lam=0.02;
    for(let it=0;it<500;it++){
      const gw=new Float64Array(NE);let gb=0;
      for(let n2=0;n2<Xi.length;n2++){const o=Xi[n2]*NE;let z=bw;
        for(let k=0;k<NE;k++)z+=w[k]*EX[o+k];
        const p=1/(1+Math.exp(-z));const e2=(p-yi[n2])*(yi[n2]?wpos:wneg);
        for(let k=0;k<NE;k++)gw[k]+=e2*EX[o+k];gb+=e2;}
      const m=Xi.length;for(let k=0;k<NE;k++)w[k]-=lr*(gw[k]/m+lam*w[k]);bw-=lr*gb/m;
    }
    if(!T.prob||T.prob===prob&&activeT!==0)T.prob=new Float32Array(N);
    for(let fo=0;fo<FO;fo++){const o=fo*NE;let z=bw;for(let k=0;k<NE;k++)z+=w[k]*EX[o+k];
      const p=1/(1+Math.exp(-z));for(let t=OFF[fo];t<OFF[fo+1];t++)T.prob[t]=p;}
    T.hasProb=true;recolorAll();
    const ab=$('auto');const old=ab.textContent;ab.textContent='✓ הושלם ('+npos+'+/'+nneg+'−)';
    setTimeout(()=>{ab.textContent=old;},2500);
  }

  /* ---- sheet export: field-for-field the desktop getSheet(withDerived=true) --- */
  function typeState(T){
    const m=[],ov=[];
    for(let f=0;f<N;f++){
      if(T.manual[f]!==0)m.push([f,T.manual[f]]);
      if(T.faceThr&&!isNaN(T.faceThr[f]))ov.push([f,Math.round(T.faceThr[f]*1000)/1000]);
    }
    return {id:T.id,name:T.name,color:T.hex,thr:T.thr,op:T.op,manual:m,faceThr:ov,
      hasProb:T.hasProb,
      prob:T.hasProb?(()=>{const p=new Array(FO);
        for(let fo=0;fo<FO;fo++)p[fo]=Math.round(T.prob[OFF[fo]]*1000)/1000;return p;})():null};
  }
  function getSheet(){
    const t0=typeState(types[0]);
    // הזהה לעורך במילה: התחום שנוסע חזרה נגזר — מה שנצבע, בתוספת כל פאה
    // שיש עליה סימון שטח; נסוג עם מחיקת הסימון, ואינו נשמר כצבע (החלטה 84)
    const rp=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]])rp.push(fo);
    const mkf=new Uint8Array(FO);
    for(const T of types){const M=T.manual; for(let s2=0;s2<N;s2++) if(M[s2]===1) mkf[FACEOF[s2]]=1;}
    const rf=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]]||mkf[fo])rf.push(fo);
    const o={_sheet:1,sheetVersion:3,Fo:FO,Nsub:N,subdiv:SUBK,cnt:CNT?b64u8(CNT):null,
      globalThreshold:types[0].thr,faceThr:t0.faceThr,manual:t0.manual,roiFaces:rf,roiPainted:rp,
      hasProb:t0.hasProb,prob:t0.prob,
      types:types.map(typeState),
      lenTypes:lenTypes.map(T=>({id:T.id,name:T.name,color:T.hex,op:(typeof T.op==='number')?T.op:1})),
      cntTypes:cntTypes.map(T=>({id:T.id,name:T.name,color:T.hex,
        size:Math.round((T.size||cntDefSize())*1000)/1000,
        op:(typeof T.op==='number')?T.op:1})),
      counters:cntTypes.map(T=>({t:T.id,
        pts:[].concat(...xmarks.filter(m=>m.t===T.id).map(m=>m.p.map(v=>Math.round(v*1000)/1000)))})),
      lengths:lines.map(L=>({t:L.t,fit:L.fit||undefined,len:Math.round(L.len*1000)/1000,
        w:Math.round((L.w||0.008)*1000)/1000,
        pts:L.pts.map(v=>Math.round(v*1000)/1000)})),
      saved:new Date().toISOString(),
      jobId:AM.jobId,exportedBy:'A-morphometry iPad'};
    const rep=[];let un=0;
    for(let f=0;f<N;f++)if(isRepair(f)){rep.push(f);un+=area[f];}
    let ar=0;
    o.typeAreas=types.map((T,ti)=>{let a=0;const fs=[];
      for(let f=0;f<N;f++)if(isType(ti,f)){a+=area[f];fs.push(f);}
      ar+=a;
      return {id:T.id,name:T.name,color:T.hex,areaM2:Math.round(a*1000)/1000,faces:fs};});
    o.lenTotals=lenTypes.map(T=>{let s2=0;for(const L of lines)if(L.t===T.id)s2+=L.len;
      return {id:T.id,name:T.name,color:T.hex,lenM:Math.round(s2*1000)/1000};});
    o.cntTotals=cntTypes.map(T=>{let n2=0;for(const m of xmarks)if(m.t===T.id)n2++;
      return {id:T.id,name:T.name,color:T.hex,n:n2};});
    o.repairFaces=rep;o.areaM2=ar;o.unionM2=un;
    return o;
  }
  $('mExport').onclick=async()=>{
    const sheet=getSheet();
    const fname=(AM.name||'work')+'_gilayon.json';
    const data=JSON.stringify(sheet);
    const file=new File([data],fname,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file]});markUnexported(false);return;}
      catch(e){if(e&&e.name==='AbortError')return;}
    }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
    a.download=fname;a.click();
    markUnexported(false);
  };

  /* ---- toolbar ---- */
  function setMode(m){mode=m;
    ['mNav','mAdd','mRem','mGrow'].forEach(id=>$(id).classList.remove('on'));
    $({nav:'mNav',add:'mAdd',rem:'mRem',grow:'mGrow'}[m]).classList.add('on');
  }
  $('mNav').onclick=()=>setMode('nav');
  $('mAdd').onclick=()=>setMode('add');
  $('mRem').onclick=()=>setMode('rem');
  $('mGrow').onclick=()=>setMode('grow');
  // The keys stay — a keyboard may be attached, and the same page opens on a computer —
  // but the NOTE about them is gone (user decision 13/08): an iPad normally has no
  // keyboard, so a strip telling the user about Ctrl+Z described something that is not
  // there. On this shell the buttons are the whole story. Gestures for undo/redo were
  // proposed and dropped in the same breath — two fingers are already the pinch.
  $('undo').onclick=()=>{undo();};
  $('redo').onclick=()=>{redo();};
  addEventListener('keydown',ev=>{
    if(!(ev.ctrlKey||ev.metaKey)) return;
    const t=ev.target, n=(t&&t.tagName||'').toUpperCase();
    if(n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||(t&&t.isContentEditable)) return;
    // ev.code names the PHYSICAL key. ev.key carries the layout's character, so with a
    // Hebrew keyboard attached to the iPad Ctrl+Z arrives as 'ז' and matched nothing —
    // the same root as the desktop screens (finding 1, 13/08).
    const k=(ev.key||'').toLowerCase();
    const z=(ev.code==='KeyZ')||k==='z', y=(ev.code==='KeyY')||k==='y';
    if(z&&!ev.shiftKey){ev.preventDefault();undo();}
    else if(y||(z&&ev.shiftKey)){ev.preventDefault();redo();}
  });
  $('auto').onclick=autoComplete;
  function applyBrush(){const v=+$('brush').value;
    if(activeKind==='len'){lineW=0.002+(v-2)/38*0.028;$('brushV').textContent=(lineW*1000).toFixed(0)+' \u05de"\u05de';}
    else if(activeKind==='cnt'){
      // the slider is the diamond DIAMETER in true metres (12/08); resizes live
      const T=cntTypes[activeC];
      $('brushV').textContent=v.toFixed(0)+' ס"מ';
      if(T&&Math.abs((T.size||0)-v/100)>1e-9){T.size=v/100;resizeCnt(T);markUnexported(true);}}
    else {brushR=v/100;$('brushV').textContent=(brushR*100).toFixed(0)+' ס"מ';}}
  $('brush').oninput=applyBrush;
  $('grtol').oninput=e=>{growTol=+e.target.value;$('grtolV').textContent=e.target.value;};
  $('thr').oninput=e=>{const v=e.target.value/1000;$('thrV').textContent=v.toFixed(3);
    types[activeT].thr=v;recolorAll();};

  /* ---- palette chips (mirror of the desktop): a chip per type, tools follow it --- */
  function syncKindUI(){const other=activeKind!=='area';
    $('auto').disabled=other; $('thr').disabled=other;
    // grow floods FACES by similarity — meaningless for lines and counters (12/08)
    $('mGrow').disabled=other; $('grtol').disabled=other;
    applyBrush();}
  function activateC(i){activeKind='cnt';activeC=i;
    const T=cntTypes[i];
    if(T)$('brush').value=Math.round((T.size||cntDefSize())*100);
    syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}
  function activateT(i){activeKind='area';activeT=i;const T=types[i];
    $('thr').value=Math.round(T.thr*1000);$('thrV').textContent=T.thr.toFixed(3);
    syncKindUI();buildChips();}
  function activateL(i){activeKind='len';activeL=i;syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}
  function buildChips(){
    const A=$('chipsA');if(!A)return;A.innerHTML='';
    types.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(activeKind==='area'&&i===activeT?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הסוג';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='tA_'+T.id;b.textContent=(T.area||0).toFixed(2);c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='מ״ר';c.appendChild(u);
      c.onclick=()=>{activateT(i);if(mode==='nav')setMode('add');};
      A.appendChild(c);});
    const C=$('chipsC');if(C){C.innerHTML='';
    cntTypes.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(activeKind==='cnt'&&i===activeC?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם המונה';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='cA_'+T.id;b.textContent='0';c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='יח׳';c.appendChild(u);
      c.onclick=()=>activateC(i);
      C.appendChild(c);});}
    const L=$('chipsL');if(!L)return;L.innerHTML='';
    lenTypes.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(activeKind==='len'&&i===activeL?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הקו';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='lA_'+T.id;b.textContent='0.00';c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='מ״א';c.appendChild(u);
      c.onclick=()=>activateL(i);
      L.appendChild(c);});
    updateArea();}
  $('addType').onclick=()=>$('typeColor').click();
  $('typeColor').onchange=e=>{const hex=e.target.value;
    if(reservedColor(hex)){alert('אדום שמור למברשת המחיקה, וכתום לאזור הכללי.\nנא לבחור צבע אחר.');return;}
    mkType('',hex);activateT(types.length-1);setMode('add');markUnexported(true);
    const inp=document.querySelector('#chipsA .chip.on input');if(inp)inp.focus();};
  $('addCnt').onclick=()=>$('cntColor').click();
  $('cntColor').onchange=e=>{const hex=e.target.value;
    if(reservedColor(hex)){alert('כתום שמור לאזור הכללי.\nנא לבחור צבע אחר.');return;}
    mkCntType('',hex);activateC(cntTypes.length-1);markUnexported(true);
    const inp=document.querySelector('#chipsC .chip.on input');if(inp)inp.focus();};
  $('addLen').onclick=()=>$('lenColor').click();
  $('lenColor').onchange=e=>{const hex=e.target.value;
    if(reservedColor(hex)){alert('אדום שמור למברשת המחיקה, וכתום לאזור הכללי.\nנא לבחור צבע אחר.');return;}
    mkLenType('',hex);activateL(lenTypes.length-1);markUnexported(true);
    const inp=document.querySelector('#chipsL .chip.on input');if(inp)inp.focus();};

  fit(); buildChips(); syncKindUI(); recolorAll(); updateHB();

  /* ---- sheet application (decision 42): one function, two callers — the sheet
     embedded in the file at boot, and a sheet the user loads from Files (slice 2).
     Field-for-field mirror of the desktop loadSheet — one engine, one meaning.
     Throws on mismatch, reporting the measured numbers (decision 35). ---- */
  function applySheet(sh){
    if(!sh||!(sh._sheet||sh._work)) throw new Error('הקובץ אינו גיליון של התוכנה.');
    if(sh.Nsub!==N||sh.Fo!==FO)
      throw new Error('הגיליון אינו תואם לעבודה הפתוחה — בגיליון '+sh.Fo
                      +' פאות, כאן '+FO+'.');
    for(const L of [...lines]) delLine(L);
    for(const m of [...xmarks]) delX(m);
    lenTypes.length=0; activeL=-1;
    cntTypes.length=0; activeC=-1;
    types.length=1; activeT=0;
    const T0=types[0]; T0.manual.fill(0); T0.faceThr=null; T0.prob=prob; T0.hasProb=false;
    T0.name='תיקון'; T0.hex='#4dff4d'; T0.color=hex2rgb(T0.hex);
    roi.fill(0);roiCount=0;
    for(const fo of (sh.roiPainted||sh.roiFaces||[])) if(fo<FO)
      for(let t=OFF[fo];t<OFF[fo+1];t++){ if(!roi[t]){roi[t]=1;roiCount++;} }
    const loadT=(T,src)=>{
      if(src.name!==undefined)T.name=src.name;
      if(src.color){T.hex=src.color;T.color=hex2rgb(src.color);}
      if(typeof src.thr==='number')T.thr=src.thr;
      if(typeof src.op==='number')T.op=src.op;
      for(const [f,v] of (src.manual||[])) if(f<N) T.manual[f]=v;
      if((src.faceThr||[]).length){T.faceThr=new Float32Array(N).fill(NaN);
        for(const [f,v] of src.faceThr) if(f<N) T.faceThr[f]=v;}
      if(src.hasProb&&src.prob&&src.prob.length===FO){
        if(!T.prob||(T.prob===prob&&T!==types[0]))T.prob=new Float32Array(N);
        for(let fo=0;fo<FO;fo++) for(let t=OFF[fo];t<OFF[fo+1];t++) T.prob[t]=src.prob[fo];
        T.hasProb=true;}
    };
    if(Array.isArray(sh.types)&&sh.types.length){          // v3 sheet: full multi-type state
      loadT(T0,sh.types[0]); if(sh.types[0].id)T0.id=sh.types[0].id;
      for(let i=1;i<sh.types.length;i++){const T=mkType('','#3b82f6');loadT(T,sh.types[i]);
        if(sh.types[i].id)T.id=sh.types[i].id;}
    } else {                                               // legacy sheet: single type
      loadT(T0,{name:'תיקון',thr:(typeof sh.globalThreshold==='number')?sh.globalThreshold:T0.thr,
                manual:sh.manual,faceThr:sh.faceThr,hasProb:sh.hasProb,prob:sh.prob});
    }
    for(const src of (sh.lenTypes||[])){const T=mkLenType(src.name||'',src.color||'#eab308');if(src.id)T.id=src.id;
      if(typeof src.op==='number')T.op=src.op;}
    for(const src of (sh.lengths||[])){
      const L={t:src.t,pts:src.pts.slice(),fit:src.fit||null,
        len:(src.fit&&typeof src.fit.length_m==='number')?src.fit.length_m:lineLen(src.pts),
        w:src.w||0.008,obj:null};  // a measured stroke keeps its truth on the iPad too
      addLine(L);}
    for(const src of (sh.cntTypes||[])){const T=mkCntType(src.name||'',src.color||'#ef4444');if(src.id)T.id=src.id;
      if(typeof src.size==='number')T.size=src.size;
      if(typeof src.op==='number')T.op=src.op;}
    for(const src of (sh.counters||[])){const pts=src.pts||[];
      for(let i=0;i+2<pts.length;i+=3) addX({t:src.t,p:[pts[i],pts[i+1],pts[i+2]],obj:null});}
    if(cntTypes.length)activeC=0;
    if(lenTypes.length)activeL=0;
    $('thr').value=Math.round(types[0].thr*1000);
    $('thrV').textContent=types[0].thr.toFixed(3);
    undoStack.length=0;redoStack.length=0;updateHB();  // loaded state is the new baseline
    buildChips();
    recolorAll();
  }
  if(sheet){
    try{applySheet(sheet);}
    catch(ex){alert('הגיליון שבקובץ העבודה לא נטען:\n'+ex.message+'\nהמודל נפתח בלי סימונים.');}
  }

  /* ---- restore unexported marks of THIS work from the op-log ----
     entries carry the type's colour+name, so the palette is rebuilt on the way in;
     legacy entries (no colour) land on the default type. Lines restore whole. */
  dbReady.then(readOps).then(ops=>{
    if(!ops.length)return;
    const lastV={}; const lns=[];
    ops.forEach(o=>{
      if(o.ln){lns.push(o.ln);return;}
      const key=(o.c||'#4dff4d')+' '+(o.n||'')+' '+o.s;
      lastV[key]=o;});
    const marks=Object.values(lastV).filter(o=>o.v!==0);
    if(!marks.length&&!lns.length)return;
    if(confirm('נמצאו '+(marks.length+lns.length)+' סימונים שלא יוצאו מהביקור הקודם בעבודה הזאת — לשחזר?')){
      for(const o of marks){const ti=findOrMkType(o.c||'#4dff4d',o.n||'');
        types[ti].manual[o.s]=o.v;recolorFace(o.s);}
      for(const ln of lns){
        let lt=lenTypes.find(x=>x.hex===ln.c); if(!lt)lt=mkLenType(ln.n||'',ln.c||'#eab308');
        addLine({t:lt.id,pts:ln.pts.slice(),len:lineLen(ln.pts),obj:null});}
      if(lenTypes.length&&activeL<0)activeL=0;
      buildChips();
      colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();markUnexported(true);
    }
  });

  /* exposed for the sheet-import path and the smoke harness — not a public API */
  window.__am={N,FO,types,lenTypes,lines,roi,prob,area,getSheet,applySheet,paintAt,growAt,
    autoComplete,beginH,commitH,undo,redo,setMode:setMode,isRepair,isType,fit,
    mkType,mkLenType,activateT,activateL};
}
