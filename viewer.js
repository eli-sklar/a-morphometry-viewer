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
  const colAttr=new THREE.BufferAttribute(colors,3); geo.setAttribute('color',colAttr);
  geo.computeBoundingSphere();
  const mat=new THREE.MeshBasicMaterial({map:tex,vertexColors:true,side:THREE.DoubleSide});
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
  const hex2rgb=h=>[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];
  function mkType(name,hex){const T={id:'t'+(tSeq++),name:name,hex:hex,color:hex2rgb(hex),
    manual:new Int8Array(N),faceThr:null,thr:0.50,prob:null,hasProb:false,area:0};
    types.push(T);return T;}
  const T0=mkType('תיקון','#4dff4d'); T0.prob=prob;
  function reservedColor(hex){const [r,g,b]=hex2rgb(hex);const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(mx-mn<0.18)return false;
    let h=0; if(mx===r)h=60*(((g-b)/(mx-mn))%6); else if(mx===g)h=60*((b-r)/(mx-mn)+2); else h=60*((r-g)/(mx-mn)+4);
    if(h<0)h+=360; return (h<48||h>345);}
  const effThr=(ti,f)=>{const T=types[ti];const t=T.faceThr?T.faceThr[f]:NaN;return isNaN(t)?T.thr:t;};
  function isType(ti,f){const T=types[ti],m=T.manual[f]; if(m===1)return true; if(m===-1)return false;
    if(!T.hasProb||!T.prob)return false;
    if(roiCount>0&&!roi[f])return false;
    return T.prob[f]>effThr(ti,f);}
  function isRepair(f){for(let ti=0;ti<types.length;ti++)if(isType(ti,f))return true;return false;}
  const NON=[1,1,1], ROIC=[1.0,0.80,0.45];
  const _vis=[];
  function recolorFace(f){
    let r=null; _vis.length=0;
    for(let ti=0;ti<types.length;ti++) if(isType(ti,f)) _vis.push(ti);
    if(!_vis.length) r=roi[f]?ROIC:NON;
    else if(_vis.length===1) r=types[_vis[0]].color;
    else { const s=cen[f*3]+cen[f*3+1]+cen[f*3+2];
           r=types[_vis[((Math.floor(s/0.06)%_vis.length)+_vis.length)%_vis.length]].color; }
    const o=f*9; for(let c=0;c<3;c++){colors[o+c*3]=r[0];colors[o+c*3+1]=r[1];colors[o+c*3+2]=r[2];}
  }
  function recolorAll(){for(let f=0;f<N;f++)recolorFace(f);colAttr.needsUpdate=true;updateArea();}
  function updateArea(){let tot=0;
    for(let ti=0;ti<types.length;ti++){const T=types[ti];let a=0;
      for(let f=0;f<N;f++)if(isType(ti,f))a+=area[f];
      T.area=a; tot+=a;
      const e2=document.getElementById('tA_'+T.id); if(e2)e2.textContent=a.toFixed(2);}
    $('area').textContent=tot.toFixed(2)+' מ"ר';
    for(const lt of lenTypes){let s2=0;for(const ln of lines)if(ln.t===lt.id)s2+=ln.len;
      const e3=document.getElementById('lA_'+lt.id); if(e3)e3.textContent=s2.toFixed(2);}
  }
  /* length pens (decision 58): continuous stroke -> sampled polyline; no learning */
  const lenTypes=[]; let activeL=-1, lSeq=0;
  const lines=[]; let curLine=null; const MIN_SEG=0.002;
  function mkLenType(name,hex){const T={id:'l'+(lSeq++),name:name,hex:hex};lenTypes.push(T);return T;}
  function lineObj(L){const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(L.pts),3));
    const lt=lenTypes.find(x=>x.id===L.t);
    return new THREE.Line(g,new THREE.LineBasicMaterial({color:new THREE.Color(lt?lt.hex:'#eab308')}));}
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
      else {const [ti,f,o]=d;inv.push([ti,f,types[ti].manual[f]]);types[ti].manual[f]=o;recolorFace(f);}}
    inv.reverse();
    logOps(typedOps(diff));
    colAttr.needsUpdate=true;updateArea();return inv;
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
    else if(mode==='len'){dragging='line';curLine=null;lineAt(e);}
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
    colAttr.needsUpdate=true;updateArea();commitH();
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
    if(ch){colAttr.needsUpdate=true;updateArea();}
  }

  /* ---- length stroke: sample the pencil path into a surface polyline ---- */
  function lineAt(e){
    if(activeL<0)return;
    const hit=castAt(e); if(!hit.length)return;
    const h=hit[0]; const nrm=h.face?h.face.normal:null;
    const px=h.point.x+(nrm?nrm.x*0.004:0), py=h.point.y+(nrm?nrm.y*0.004:0), pz=h.point.z+(nrm?nrm.z*0.004:0);
    if(!curLine){curLine={t:lenTypes[activeL].id,pts:[px,py,pz],len:0,obj:null};return;}
    const p=curLine.pts, n2=p.length;
    const d=Math.hypot(px-p[n2-3],py-p[n2-2],pz-p[n2-1]);
    if(d<MIN_SEG)return;
    p.push(px,py,pz); curLine.len+=d;
    if(curLine.obj)scene.remove(curLine.obj);
    curLine.obj=lineObj(curLine); scene.add(curLine.obj);
  }
  function endLine(){
    if(!curLine)return;
    if(curLine.pts.length>=6){addLine(curLine);
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
    return {id:T.id,name:T.name,color:T.hex,thr:T.thr,manual:m,faceThr:ov,
      hasProb:T.hasProb,
      prob:T.hasProb?(()=>{const p=new Array(FO);
        for(let fo=0;fo<FO;fo++)p[fo]=Math.round(T.prob[OFF[fo]]*1000)/1000;return p;})():null};
  }
  function getSheet(){
    const t0=typeState(types[0]);
    const rf=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]])rf.push(fo);
    const o={_sheet:1,sheetVersion:3,Fo:FO,Nsub:N,subdiv:SUBK,cnt:CNT?b64u8(CNT):null,
      globalThreshold:types[0].thr,faceThr:t0.faceThr,manual:t0.manual,roiFaces:rf,
      hasProb:t0.hasProb,prob:t0.prob,
      types:types.map(typeState),
      lenTypes:lenTypes.map(T=>({id:T.id,name:T.name,color:T.hex})),
      lengths:lines.map(L=>({t:L.t,len:Math.round(L.len*1000)/1000,
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
    ['mNav','mAdd','mRem','mGrow','mLen'].forEach(id=>$(id).classList.remove('on'));
    $({nav:'mNav',add:'mAdd',rem:'mRem',grow:'mGrow',len:'mLen'}[m]).classList.add('on');
  }
  $('mNav').onclick=()=>setMode('nav');
  $('mAdd').onclick=()=>setMode('add');
  $('mRem').onclick=()=>setMode('rem');
  $('mGrow').onclick=()=>setMode('grow');
  $('mLen').onclick=()=>{
    if(activeL<0){$('lenColor').click();return;}          // first use: create a pen
    setMode('len');};
  $('undo').onclick=undo; $('redo').onclick=redo;
  $('auto').onclick=autoComplete;
  $('brush').oninput=e=>{brushR=e.target.value/100;$('brushV').textContent=brushR.toFixed(2);};
  $('grtol').oninput=e=>{growTol=+e.target.value;$('grtolV').textContent=e.target.value;};
  $('thr').oninput=e=>{const v=e.target.value/1000;$('thrV').textContent=v.toFixed(3);
    types[activeT].thr=v;recolorAll();};

  /* ---- palette chips (mirror of the desktop): a chip per type, tools follow it --- */
  function activateT(i){activeT=i;const T=types[i];
    $('thr').value=Math.round(T.thr*1000);$('thrV').textContent=T.thr.toFixed(3);
    buildChips();}
  function activateL(i){activeL=i;buildChips();setMode('len');}
  function buildChips(){
    const A=$('chipsA');if(!A)return;A.innerHTML='';
    types.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(i===activeT?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הסוג';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='tA_'+T.id;b.textContent=(T.area||0).toFixed(2);c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='מ״ר';c.appendChild(u);
      c.onclick=()=>{activateT(i);if(mode==='len'||mode==='nav')setMode('add');};
      A.appendChild(c);});
    const L=$('chipsL');if(!L)return;L.innerHTML='';
    lenTypes.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(i===activeL&&mode==='len'?' on':'');c.style.setProperty('--c',T.hex);
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
  $('addLen').onclick=()=>$('lenColor').click();
  $('lenColor').onchange=e=>{const hex=e.target.value;
    if(reservedColor(hex)){alert('אדום שמור למברשת המחיקה, וכתום לאזור הכללי.\nנא לבחור צבע אחר.');return;}
    mkLenType('',hex);activateL(lenTypes.length-1);markUnexported(true);
    const inp=document.querySelector('#chipsL .chip.on input');if(inp)inp.focus();};

  fit(); buildChips(); recolorAll(); updateHB();

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
    lenTypes.length=0; activeL=-1;
    types.length=1; activeT=0;
    const T0=types[0]; T0.manual.fill(0); T0.faceThr=null; T0.prob=prob; T0.hasProb=false;
    T0.name='תיקון'; T0.hex='#4dff4d'; T0.color=hex2rgb(T0.hex);
    roi.fill(0);roiCount=0;
    for(const fo of (sh.roiFaces||[])) if(fo<FO)
      for(let t=OFF[fo];t<OFF[fo+1];t++){ if(!roi[t]){roi[t]=1;roiCount++;} }
    const loadT=(T,src)=>{
      if(src.name!==undefined)T.name=src.name;
      if(src.color){T.hex=src.color;T.color=hex2rgb(src.color);}
      if(typeof src.thr==='number')T.thr=src.thr;
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
    for(const src of (sh.lenTypes||[])){const T=mkLenType(src.name||'',src.color||'#eab308');if(src.id)T.id=src.id;}
    for(const src of (sh.lengths||[])){
      const L={t:src.t,pts:src.pts.slice(),len:lineLen(src.pts),obj:null};  // len recomputed
      addLine(L);}
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
      colAttr.needsUpdate=true;updateArea();markUnexported(true);
    }
  });

  /* exposed for the sheet-import path and the smoke harness — not a public API */
  window.__am={N,FO,types,lenTypes,lines,roi,prob,area,getSheet,applySheet,paintAt,growAt,
    autoComplete,beginH,commitH,undo,redo,setMode:setMode,isRepair,isType,fit,
    mkType,mkLenType,activateT,activateL};
}
