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
  if(am.schemaVersion>2) throw new Error('הקובץ נוצר בגרסה חדשה מדי — עדכנו את גרסת האייפד.');
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
  let globalThr=0.50, brushR=0.10, mode='nav';
  const manual=new Int8Array(N);
  const faceThr=new Float32Array(N).fill(NaN);
  const roi=new Uint8Array(N); let roiCount=0;
  if(roi0) for(let f=0;f<N;f++){ if(roi0[FACEOF[f]]){roi[f]=1;roiCount++;} }
  let hasProb=false;
  const effThr=f=>{const t=faceThr[f];return isNaN(t)?globalThr:t;};
  function isRepair(f){const m=manual[f]; if(m===1)return true; if(m===-1)return false;
    if(roiCount>0&&!roi[f])return false;
    return hasProb&&prob[f]>effThr(f);}
  const NON=[1,1,1], REP=[0.30,1.0,0.30], ROIC=[1.0,0.80,0.45];
  function recolorFace(f){
    const r=isRepair(f)?REP:(roi[f]?ROIC:NON);
    const o=f*9; for(let c=0;c<3;c++){colors[o+c*3]=r[0];colors[o+c*3+1]=r[1];colors[o+c*3+2]=r[2];}
  }
  function recolorAll(){for(let f=0;f<N;f++)recolorFace(f);colAttr.needsUpdate=true;updateArea();}
  function updateArea(){let a=0;for(let f=0;f<N;f++)if(isRepair(f))a+=area[f];
    $('area').textContent=a.toFixed(2)+' מ"ר';}

  /* ---- undo/redo + op-log hookup ---- */
  const undoStack=[],redoStack=[]; let curDiff=null,curT=null;
  const beginH=()=>{curDiff=[];curT=new Set();};
  // null-safe: a paint outside an open stroke still mutates, just without history
  const recH=f=>{if(curT&&!curT.has(f)){curT.add(f);curDiff.push([f,manual[f]]);}};
  function commitH(){
    if(curDiff&&curDiff.length){
      undoStack.push(curDiff);redoStack.length=0;
      logOps(curDiff.map(([f])=>[f,manual[f]]));      // final values of this stroke
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
    for(const [f,o] of diff){inv.push([f,manual[f]]);manual[f]=o;recolorFace(f);}
    logOps(diff.map(([f])=>[f,manual[f]]));
    colAttr.needsUpdate=true;updateArea();return inv;
  }
  const undo=()=>{if(undoStack.length){redoStack.push(applyDiff(undoStack.pop()));updateHB();}};
  const redo=()=>{if(redoStack.length){undoStack.push(applyDiff(redoStack.pop()));updateHB();}};
  function updateHB(){$('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;}

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
      startPinch();dragging='pinch';return;}
    // a finger ALWAYS navigates — marking/erasing/growing is pencil-only
    // (user decision 08/08/2026; also the original editor's behaviour)
    if(e.pointerType==='touch'){dragging='rot';}
    else if(mode==='nav'){dragging='rot';}
    else if(mode==='grow'){growAt(e);dragging=null;}
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
    else if(dragging==='paint'){paintAt(e);}
  });
  function endDrag(e){
    if(e){ptrs.delete(e.pointerId);if(e.pointerId===dragId)dragId=null;}
    if(dragging==='pinch'){if(touchList().length>=2)startPinch();else{pinch=null;dragging=null;}return;}
    if(dragging==='paint'&&paintManual)commitH();
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
    beginH();
    while(head<q.length&&added<CAP){const s=q[head++];
      if(manual[s]!==1){recH(s);manual[s]=1;recolorFace(s);} added++;
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
          if(manual[f]!==val){recH(f);manual[f]=val;recolorFace(f);ch=true;}
        }}}
    if(ch){colAttr.needsUpdate=true;updateArea();}
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
    const cnt=new Int32Array(FO);
    for(let s=0;s<N;s++){const m=manual[s];if(m!==0)cnt[FACEOF[s]]+=m;}
    const Xi=[],yi=[]; const labeled=new Uint8Array(FO);
    for(let fo=0;fo<FO;fo++){if(cnt[fo]>0){Xi.push(fo);yi.push(1);labeled[fo]=1;}
      else if(cnt[fo]<0){Xi.push(fo);yi.push(0);labeled[fo]=1;}}
    let npos=0;for(const y of yi)npos+=y;let nneg=yi.length-npos;
    if(roiCount>0){
      const rf=new Uint8Array(FO);for(let s=0;s<N;s++)if(roi[s])rf[FACEOF[s]]=1;
      const out=[];for(let fo=0;fo<FO;fo++)if(!rf[fo]&&!labeled[fo])out.push(fo);
      const cap=Math.min(out.length,Math.max(300,npos*3));
      for(let i=0;i<cap;i++){const fo=out[(Math.random()*out.length)|0];
        if(labeled[fo])continue;labeled[fo]=1;Xi.push(fo);yi.push(0);nneg++;}
    }
    if(npos<15||nneg<15){alert('צריך עוד דוגמאות: לפחות ~15 פאות תיקון (＋) ו-15 לא-תיקון (−).\nכרגע: '+npos+' תיקון, '+nneg+' לא-תיקון.');return;}
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
    for(let fo=0;fo<FO;fo++){const o=fo*NE;let z=bw;for(let k=0;k<NE;k++)z+=w[k]*EX[o+k];
      const p=1/(1+Math.exp(-z));for(let t=OFF[fo];t<OFF[fo+1];t++)prob[t]=p;}
    hasProb=true;recolorAll();
    const ab=$('auto');const old=ab.textContent;ab.textContent='✓ הושלם ('+npos+'+/'+nneg+'−)';
    setTimeout(()=>{ab.textContent=old;},2500);
  }

  /* ---- sheet export: field-for-field the desktop getSheet(withDerived=true) --- */
  function getSheet(){
    const m=[],ov=[];
    for(let f=0;f<N;f++){
      if(manual[f]!==0)m.push([f,manual[f]]);
      if(!isNaN(faceThr[f]))ov.push([f,Math.round(faceThr[f]*1000)/1000]);
    }
    const rf=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]])rf.push(fo);
    const o={_sheet:1,Fo:FO,Nsub:N,subdiv:SUBK,cnt:CNT?b64u8(CNT):null,
      globalThreshold:globalThr,faceThr:ov,manual:m,roiFaces:rf,
      hasProb:hasProb,
      prob:hasProb?(()=>{const p=new Array(FO);
        for(let fo=0;fo<FO;fo++)p[fo]=Math.round(prob[OFF[fo]]*1000)/1000;return p;})():null,
      saved:new Date().toISOString(),
      jobId:AM.jobId,exportedBy:'A-morphometry iPad'};
    const rep=[];let ar=0;
    for(let f=0;f<N;f++)if(isRepair(f)){rep.push(f);ar+=area[f];}
    o.repairFaces=rep;o.areaM2=ar;
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
  $('undo').onclick=undo; $('redo').onclick=redo;
  $('auto').onclick=autoComplete;
  $('brush').oninput=e=>{brushR=e.target.value/100;$('brushV').textContent=brushR.toFixed(2);};
  $('grtol').oninput=e=>{growTol=+e.target.value;$('grtolV').textContent=e.target.value;};
  $('thr').oninput=e=>{const v=e.target.value/1000;$('thrV').textContent=v.toFixed(3);
    globalThr=v;recolorAll();};

  fit(); recolorAll(); updateHB();

  /* ---- sheet application (decision 42): one function, two callers — the sheet
     embedded in the file at boot, and a sheet the user loads from Files (slice 2).
     Field-for-field mirror of the desktop loadSheet — one engine, one meaning.
     Throws on mismatch, reporting the measured numbers (decision 35). ---- */
  function applySheet(sh){
    if(!sh||!(sh._sheet||sh._work)) throw new Error('הקובץ אינו גיליון של התוכנה.');
    if(sh.Nsub!==N||sh.Fo!==FO)
      throw new Error('הגיליון אינו תואם לעבודה הפתוחה — בגיליון '+sh.Fo
                      +' פאות, כאן '+FO+'.');
    manual.fill(0);faceThr.fill(NaN);roi.fill(0);roiCount=0;
    for(const [f,v] of (sh.manual||[])) if(f<N) manual[f]=v;
    for(const [f,v] of (sh.faceThr||[])) if(f<N) faceThr[f]=v;
    for(const fo of (sh.roiFaces||[])) if(fo<FO)
      for(let t=OFF[fo];t<OFF[fo+1];t++){ if(!roi[t]){roi[t]=1;roiCount++;} }
    if(typeof sh.globalThreshold==='number'){
      globalThr=sh.globalThreshold;
      $('thr').value=Math.round(globalThr*1000);
      $('thrV').textContent=globalThr.toFixed(3);
    }
    if(sh.hasProb&&sh.prob&&sh.prob.length===FO){
      for(let fo=0;fo<FO;fo++) for(let t=OFF[fo];t<OFF[fo+1];t++) prob[t]=sh.prob[fo];
      hasProb=true;
    }
    undoStack.length=0;redoStack.length=0;updateHB();  // loaded state is the new baseline
    recolorAll();
  }
  if(sheet){
    try{applySheet(sheet);}
    catch(ex){alert('הגיליון שבקובץ העבודה לא נטען:\n'+ex.message+'\nהמודל נפתח בלי סימונים.');}
  }

  /* ---- restore unexported marks of THIS work from the op-log ---- */
  dbReady.then(readOps).then(ops=>{
    if(!ops.length)return;
    const lastV={};ops.forEach(o=>{lastV[o.s]=o.v;});
    const subs=Object.keys(lastV).filter(k=>lastV[k]!==0);
    if(!subs.length)return;
    if(confirm('נמצאו '+subs.length+' סימונים שלא יוצאו מהביקור הקודם בעבודה הזאת — לשחזר?')){
      for(const k of subs){manual[+k]=lastV[k];recolorFace(+k);}
      colAttr.needsUpdate=true;updateArea();markUnexported(true);
    }
  });

  /* exposed for the sheet-import path and the smoke harness — not a public API */
  window.__am={N,FO,manual,roi,prob,area,getSheet,applySheet,paintAt,growAt,
    autoComplete,beginH,commitH,undo,redo,setMode:setMode,isRepair,fit};
}
