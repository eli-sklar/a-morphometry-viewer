/* A-morphometry installed viewer — minimal slice (decision 19, slice 2).
   Reads the app's own GLB work package (see app/build_workpkg.py — this parser is
   its mirror image): standard mesh+texture, marking dataset in extras.amWork.appData.
   Everything runs on-device; nothing is ever sent anywhere. */
'use strict';

/* ---- GLB container ---- */
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
function view(g,bin,i,Arr){
  const v=g.json.bufferViews[i];
  const raw=bin.subarray(v.byteOffset,v.byteOffset+v.byteLength);
  if(!Arr) return raw;
  // typed views need alignment — copy via a fresh buffer (cheap next to the mesh itself)
  const c=raw.slice();
  return new Arr(c.buffer,0,c.byteLength/Arr.BYTES_PER_ELEMENT);
}

/* ---- scene ---- */
let renderer,scene,camera,mesh,colors,marked,areaArr,allowed,total=0,name='';
let AM=null,ROI0=null,CNT=null;      // package metadata + raw ROI/cnt, needed for the sheet export
let mode='nav';

/* ---- op-log: every mark mutation lands in IndexedDB immediately (decision 19) —
   a crash or reload loses at most the last finger stroke ---- */
let db=null;
const dbReady=new Promise(res=>{
  const r=indexedDB.open('am-ipad',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('ops',{autoIncrement:true});
  r.onsuccess=()=>{db=r.result;res();};
  r.onerror=()=>res();
});
const jobKey=()=>AM?(AM.jobId+':'+AM.Fo+':'+AM.Nsub):'';
function logOp(sub,v){
  if(!db||!AM)return;
  try{db.transaction('ops','readwrite').objectStore('ops').put({j:jobKey(),s:sub,v:v});}catch(_){}
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
const cv=document.getElementById('cv');
const $=id=>document.getElementById(id);

function setMode(m){
  mode=m;
  ['mNav','mMark','mErase'].forEach(id=>$(id).classList.remove('on'));
  $({nav:'mNav',mark:'mMark',erase:'mErase'}[m]).classList.add('on');
}
$('mNav').onclick=()=>setMode('nav');
$('mMark').onclick=()=>setMode('mark');
$('mErase').onclick=()=>setMode('erase');
$('mFull').onclick=()=>{
  const el=document.documentElement;
  const f=el.requestFullscreen||el.webkitRequestFullscreen;
  if(f) f.call(el);
};
// installed (home-screen) mode is always fullscreen — the button only serves browser tabs
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)
  $('mFull').style.display='none';
$('openBtn').onclick=()=>$('file').click();
$('file').addEventListener('change',e=>{
  const f=e.target.files[0];
  if(f) f.arrayBuffer().then(load).catch(ex=>{$('err').textContent='שגיאה: '+ex.message;});
});

function load(buf){
  const g=parseGLB(buf);
  const am=g.json.asset&&g.json.asset.extras&&g.json.asset.extras.amWork;
  if(!am) throw new Error('הקובץ אינו נושא נתוני עבודה (amWork).');
  if(am.schemaVersion>1) throw new Error('הקובץ נוצר בגרסה חדשה מדי של התוכנה — עדכנו את גרסת האייפד.');
  AM=am; name=am.name||'עבודה';
  const acc=g.json.accessors;
  const pos=view(g,g.bin,acc[0].bufferView,Float32Array);
  const uv=view(g,g.bin,acc[1].bufferView,Float32Array);
  const app=am.appData;
  areaArr=view(g,g.bin,app.area,Float32Array);
  const Nsub=am.Nsub;
  marked=new Uint8Array(Nsub); total=0;

  /* sub-face -> original face, for the orange-zone gate */
  let subToOrig=null;
  if(app.cnt!==undefined){
    const cnt=view(g,g.bin,app.cnt,Uint8Array);
    CNT=cnt;
    subToOrig=new Int32Array(Nsub); let s=0;
    for(let f=0;f<cnt.length;f++) for(let j=0;j<cnt[f];j++) subToOrig[s++]=f;
  }
  allowed=null;
  if(app.roi0!==undefined){
    const roi=view(g,g.bin,app.roi0,Uint8Array);
    ROI0=roi;
    allowed=new Uint8Array(Nsub);
    for(let s=0;s<Nsub;s++){
      const f=subToOrig?subToOrig[s]:Math.floor(s/am.spf);
      allowed[s]=roi[f];
    }
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  colors=new Float32Array(pos.length);
  for(let i=0;i<colors.length;i+=3){
    const sub=Math.floor(i/9);
    const dim=(allowed&&!allowed[sub])?0.55:1.0;   // outside the orange zone: dimmed, locked
    colors[i]=dim;colors[i+1]=dim;colors[i+2]=dim;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));

  const img=view(g,g.bin,g.json.images[0].bufferView);
  const blob=new Blob([img],{type:'image/jpeg'});
  const image=new Image();
  image.onload=()=>{
    const tex=new THREE.Texture(image);
    tex.flipY=false;                                // uv are glTF-style (v down) by export
    tex.needsUpdate=true;
    const mat=new THREE.MeshBasicMaterial({map:tex,vertexColors:true,side:THREE.DoubleSide});
    mesh=new THREE.Mesh(geo,mat);
    scene.add(mesh);
    fit(acc[0].min,acc[0].max);
    $('hello').style.display='none';
    $('bar').style.display='flex';
    URL.revokeObjectURL(image.src);
    // unexported marks from a previous visit of THIS work? offer to restore
    dbReady.then(readOps).then(ops=>{
      if(!ops.length)return;
      const last={};ops.forEach(o=>{last[o.s]=o.v;});
      const subs=Object.keys(last).filter(k=>last[k]);
      if(!subs.length)return;
      if(confirm('נמצאו '+subs.length+' סימונים שלא יוצאו מהביקור הקודם בעבודה הזאת — לשחזר אותם?'))
        subs.forEach(k=>applyMark(+k,1));
    });
  };
  image.onerror=()=>{$('err').textContent='טעינת הטקסטורה נכשלה.';};
  image.src=URL.createObjectURL(blob);
}

/* ---- camera + controls ---- */
let target=new THREE.Vector3(),dist=3,rotX=0,rotY=0;
function fit(mn,mx){
  target.set((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2);
  const span=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]);
  dist=span*1.4; rotX=0; rotY=0;
  camera.near=span/1000; camera.far=span*20; camera.updateProjectionMatrix();
  place();
}
function place(){
  camera.position.set(
    target.x+dist*Math.sin(rotY)*Math.cos(rotX),
    target.y+dist*Math.sin(rotX),
    target.z+dist*Math.cos(rotY)*Math.cos(rotX));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);   // raycasts may run before the first rendered frame
}

const ptrs=new Map(); let pinch=0;
cv.addEventListener('pointerdown',e=>{
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){
    const p=[...ptrs.values()];
    pinch=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  }
  if(mode!=='nav'&&ptrs.size===1) paint(e);
});
cv.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId); if(!p) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y;
  if(ptrs.size===1){
    if(mode==='nav'){
      rotY-=dx*0.005; rotX+=dy*0.005;
      rotX=Math.max(-1.5,Math.min(1.5,rotX)); place();
    } else paint(e);
  } else if(ptrs.size===2){
    p.x=e.clientX; p.y=e.clientY;
    const q=[...ptrs.values()];
    const d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y);
    if(pinch>0){ dist*=pinch/d; pinch=d; place(); }
    return;
  }
  p.x=e.clientX; p.y=e.clientY;
});
const lift=e=>{ptrs.delete(e.pointerId); pinch=0;};
cv.addEventListener('pointerup',lift); cv.addEventListener('pointercancel',lift);

/* ---- marking ---- */
const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
function applyMark(sub,want){
  if(marked[sub]===want) return false;
  marked[sub]=want;
  total+=(want?1:-1)*areaArr[sub];
  const b=sub*9;
  const c=want?[1,0.25,0.2]:[1,1,1];
  for(let k=0;k<3;k++){colors[b+k*3]=c[0];colors[b+k*3+1]=c[1];colors[b+k*3+2]=c[2];}
  mesh.geometry.attributes.color.needsUpdate=true;
  $('area').textContent=Math.max(0,total).toFixed(2)+' מ"ר';
  return true;
}
function paint(e){
  if(!mesh) return;
  ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObject(mesh,false)[0];
  if(!hit||hit.faceIndex===undefined) return;
  const sub=hit.faceIndex;
  if(allowed&&!allowed[sub]) return;               // locked outside the orange zone
  const want=(mode==='mark')?1:0;
  if(applyMark(sub,want)) logOp(sub,want);
}

/* ---- sheet export: EXACTLY the desktop sheet format (viewer3d_template getSheet) —
   the file drops straight into the desktop app and feeds the report ---- */
function b64u8(u8){
  let s='';
  for(let i=0;i<u8.length;i+=0x8000)
    s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));
  return btoa(s);
}
$('mExport').onclick=async()=>{
  if(!mesh||!AM) return;
  const m=[],rep=[]; let ar=0;
  for(let i=0;i<marked.length;i++)
    if(marked[i]){ m.push([i,1]); rep.push(i); ar+=areaArr[i]; }
  const rf=[];
  if(ROI0) for(let f=0;f<ROI0.length;f++) if(ROI0[f]) rf.push(f);
  const sheet={_sheet:1, Fo:AM.Fo, Nsub:AM.Nsub, subdiv:AM.sub,
    cnt:CNT?b64u8(CNT):null, faceThr:[], manual:m, roiFaces:rf,
    hasProb:false, prob:null, saved:new Date().toISOString(),
    repairFaces:rep, areaM2:ar,
    jobId:AM.jobId, exportedBy:'A-morphometry iPad'};
  const fname=(name||'work')+'_gilayon.json';
  const data=JSON.stringify(sheet);
  const file=new File([data],fname,{type:'application/json'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file]}); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download=fname; a.click();
};

/* ---- boot ---- */
renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
scene=new THREE.Scene(); scene.background=new THREE.Color(0xf5f4f0);  // light bg — print/field requirement
camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.01,100);
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize); resize();
(function tick(){requestAnimationFrame(tick);renderer.render(scene,camera);})();

if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
