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

/* ================= the recovery copy (327; decision 19's promise, kept) =================
   The op-log this replaced wrote nothing: it expected one shape of entry and was handed
   another, and the error was swallowed. Even mended it held area strokes and tape lines only —
   no counters, rulers, polygons, deletions, layers, design or opacity — and it was never
   emptied by an export. Instead the WHOLE SHEET is kept, the one the export writes and the
   import reads: a second and a half after the last change, in IndexedDB, per work. A crash
   loses at most that second and a half; an export deletes the copy; opening a work whose
   copy differs from what loaded asks whether to restore it (Eli, 26/09: approved). */
let db=null;
const dbReady=new Promise(res=>{
  const r=indexedDB.open('am-ipad',3);
  r.onupgradeneeded=()=>{const d=r.result;
    if(!d.objectStoreNames.contains('snap')) d.createObjectStore('snap');
    if(!d.objectStoreNames.contains('img')) d.createObjectStore('img');   // 332: the tags' photos
    if(d.objectStoreNames.contains('ops')) d.deleteObjectStore('ops');};   // the old log goes
  r.onsuccess=()=>{db=r.result;res();};
  r.onerror=()=>res();
});
let AM=null;
const jobKey=()=>AM?(AM.jobId+':'+AM.Fo+':'+AM.Nsub):'';
function snapPut(sheet){
  if(!db||!AM)return;
  try{db.transaction('snap','readwrite').objectStore('snap').put({t:Date.now(),sheet:sheet},jobKey());}catch(_){}
}
function snapDrop(){
  if(!db||!AM)return;
  try{db.transaction('snap','readwrite').objectStore('snap').delete(jobKey());}catch(_){}
}
// 332: a tag's photo, by its name — kept apart from the recovery copy, which is the whole
// sheet rewritten a second and a half after every change
function imgPut(name,data){
  if(!db)return;
  try{db.transaction('img','readwrite').objectStore('img').put(data,name);}catch(_){}
}
function imgGet(name){
  return new Promise(res=>{
    if(!db)return res(null);
    try{const q=db.transaction('img').objectStore('img').get(name);
      q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null);}catch(_){res(null);}
  });
}
function snapRead(){
  return new Promise(res=>{
    if(!db||!AM)return res(null);
    try{const q=db.transaction('snap').objectStore('snap').get(jobKey());
      q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null);}catch(_){res(null);}
  });
}

/* ================= boot: renderer first, engine wires up per loaded file ====== */
const $=id=>document.getElementById(id);
/*AM_TAGCORE_START*/
/* 332 — tags: a title, a text and a photo on a point of the model (Eli, 28/09). The SAME
   text in the measurement screen, the iPad and the viewer (a gate compares the three), so
   the tag looks and asks the same wherever it is placed, edited or read.
   The label is the ruler's tag — dark, ringed in the layer's colour — with the TITLE and,
   when there is a photo, a camera drawn beside it. No number (Eli: "לא מופיע מספר").
   The card is the program's own dialog window (amAsk): the same frame, colours and buttons. */
const AM_TAG_SIDE=2048, AM_TAG_Q=0.85, AM_TAG_TITLE_MAX=20;
function amTagId(){ return 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function amTagShort(t){ t=String(t||'').trim();
  return t.length>AM_TAG_TITLE_MAX ? t.slice(0,AM_TAG_TITLE_MAX-1)+'…' : t; }
function amTagCanvas(title,hex,cam,gold){
  const c=document.createElement('canvas'), H=108, pad=24, camW=cam?72:0;
  const txt='‏'+(amTagShort(title)||'…');
  const t0=c.getContext('2d'); t0.direction='rtl'; t0.font='bold 54px system-ui, Arial, sans-serif';
  const tw=Math.ceil(t0.measureText(txt).width), w=tw+pad*2+camW;
  c.width=w; c.height=H;
  const x=c.getContext('2d'); x.direction='rtl';
  x.fillStyle=gold?'#3a2f16':'rgba(20,18,16,0.92)'; x.strokeStyle=gold?'#ffca3a':(hex||'#b8934a'); x.lineWidth=6;
  const rr=18; x.beginPath(); x.moveTo(rr,3);
  x.arcTo(w-3,3,w-3,H-3,rr); x.arcTo(w-3,H-3,3,H-3,rr); x.arcTo(3,H-3,3,3,rr); x.arcTo(3,3,w-3,3,rr);
  x.closePath(); x.fill(); x.stroke();
  const ink=gold?'#ffca3a':'#f0e6d2';
  x.font='bold 54px system-ui, Arial, sans-serif'; x.fillStyle=ink;
  x.textAlign='center'; x.textBaseline='middle'; x.fillText(txt,camW+pad+tw/2,58);
  if(cam){                      // the camera sits at the END of a Hebrew line: the left
    const cx=pad+24, cy=56; x.strokeStyle=ink; x.lineWidth=5; x.lineJoin='round';
    x.beginPath(); x.moveTo(cx-24,cy-14); x.lineTo(cx-10,cy-14); x.lineTo(cx-5,cy-22); x.lineTo(cx+5,cy-22);
    x.lineTo(cx+10,cy-14); x.lineTo(cx+24,cy-14); x.lineTo(cx+24,cy+20); x.lineTo(cx-24,cy+20); x.closePath(); x.stroke();
    x.beginPath(); x.arc(cx,cy+3,10,0,Math.PI*2); x.stroke();
  }
  return {c:c,w:w,h:H};
}
function amTagTexture(title,hex,cam,gold){
  const k=amTagCanvas(title,hex,cam,gold); const t=new THREE.CanvasTexture(k.c); t.anisotropy=4;
  return {tex:t,aspect:k.w/k.h};
}
function amTagSprite(title,hex,cam){
  const a=amTagTexture(title,hex,cam,false);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:a.tex,transparent:true,depthTest:false,depthWrite:false}));
  sp.userData.aspect=a.aspect; sp.userData.plain=a.tex;
  sp.center.set(0.5,-0.25);               // the label stands ABOVE its point, never on it
  sp.renderOrder=1001; return sp;
}
// A photo is shrunk where it is taken, before it goes anywhere: a phone's 5 MB becomes a
// JPEG of 2048 pixels on its long side, a few hundred KB. The browser turns it upright.
// 378: HEIC by its name, its type, or — when a copy on the way lost both — by its own first
// bytes: an ISO box "ftyp" with one of the HEIF brands
function amTagIsHeic(f){
  if(/[.](heic|heif)$/i.test(f.name||'')||/hei[cf]/i.test(f.type||'')) return Promise.resolve(true);
  if(!f.slice) return Promise.resolve(false);
  return f.slice(0,12).arrayBuffer().then(b=>{ const s=String.fromCharCode.apply(null,new Uint8Array(b));
    return s.slice(4,8)==='ftyp'&&/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(s.slice(8,12)); })
    .catch(()=>false);
}
function amTagShrink(file){
  return new Promise((res,rej)=>{
    const u=URL.createObjectURL(file), im=new Image();
    im.onload=()=>{ try{
      const s=Math.min(1,AM_TAG_SIDE/Math.max(im.naturalWidth,im.naturalHeight));
      const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(im.naturalWidth*s));
      c.height=Math.max(1,Math.round(im.naturalHeight*s));
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
      x.drawImage(im,0,0,c.width,c.height); URL.revokeObjectURL(u);
      res(c.toDataURL('image/jpeg',AM_TAG_Q)); }catch(e){ URL.revokeObjectURL(u); rej(e); } };
    im.onerror=()=>{ URL.revokeObjectURL(u);
      // 376: an iPhone's HEIC, which the browser on the computer cannot read — the screen's
      // server turns it JPEG (by Windows' own decoder) and it is shrunk as any other photo.
      // The iPad's browser reads HEIC itself and never comes here.
      amTagIsHeic(file).then(h=>{
        if(!h){ rej(new Error('הקובץ אינו תמונה שאפשר לקרוא.')); return; }
        if(typeof amHeicJpeg==='function'){ amHeicJpeg(file).then(j=>amTagShrink(j)).then(res,rej); return; }
        rej(new Error('זו תמונת HEIC, והמסך הזה אינו קורא אותה. אפשר לשמור אותה כ-JPEG או PNG.')); }); };
    im.src=u;
  });
}
/* The card. o = {title, text, img (a src or null), view (read only), place (a new tag)}.
   Resolves null on cancel, else {title, text, img}: img undefined = unchanged, null = removed,
   a data URL = a new photo. A title is required — it is what the model shows. */
function amTagCard(o){
  o=o||{};
  return new Promise(res=>{
    const S='background:#232019;color:#d8cdb8;border:1px solid #6b5a33;border-radius:2px;';
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483000;'
      +'display:flex;align-items:center;justify-content:center;direction:rtl';
    const box=document.createElement('div');
    box.style.cssText='background:#141210;border:2px solid #6b5a33;border-radius:2px;'
      +'padding:20px 24px;color:#d8cdb8;font:15px system-ui,Arial,sans-serif;width:min(460px,92vw);'
      +'max-height:90vh;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;overflow-y:auto;'
      +'box-shadow:inset 0 0 0 3px #141210, inset 0 0 0 4px rgba(184,147,74,.45)';
    const lab=t=>{const l=document.createElement('div'); l.textContent=t; l.style.cssText='font-size:13px;color:#b8934a'; return l;};
    let img=o.img||null, changed;
    const pic=document.createElement('img');
    pic.style.cssText='max-width:100%;max-height:38vh;object-fit:contain;display:block;border:1px solid #6b5a33;border-radius:2px';
    // 356 (Eli: "כפתור קטן בפינה של התמונה שפותח אותה על מסך מלא"): the photo on the whole
    // screen, fitted to it; a click on it or Escape returns to the card, which stays open
    const picBox=document.createElement('div'); picBox.style.cssText='position:relative;align-self:center;max-width:100%';
    const full=document.createElement('button'); full.textContent='⛶'; full.title='התמונה במסך מלא';
    full.style.cssText='position:absolute;top:6px;left:6px;width:30px;height:30px;padding:0;font-size:17px;line-height:28px;'
      +'background:rgba(20,18,16,0.85);color:#f0e6d2;border:1px solid #6b5a33;border-radius:2px;cursor:pointer';
    picBox.appendChild(pic); picBox.appendChild(full);
    let big=null;
    const bigClose=()=>{ if(big){ big.remove(); big=null; } };
    full.onclick=e=>{ e.stopPropagation(); if(!img) return;
      big=document.createElement('div');
      big.style.cssText='position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.92);display:flex;'
        +'align-items:center;justify-content:center;cursor:zoom-out';
      const bi=document.createElement('img'); bi.src=img;
      bi.style.cssText='max-width:100vw;max-height:100vh;object-fit:contain';
      big.appendChild(bi); big.onclick=ev=>{ ev.stopPropagation(); bigClose(); };
      document.body.appendChild(big); };
    const showPic=()=>{ picBox.style.display=img?'':'none'; if(img) pic.src=img; };
    // Keys, the dialog window's rule: Escape closes wherever the focus is, and no key
    // reaches the screen underneath — also when the focus stayed on the model after the
    // click that opened the card (found in the run: Escape did nothing, and a Tab there
    // would have switched the tool under the open card). Typing into the card's own fields
    // still reaches them; it stops at the card on its way up.
    const key=e=>{
      if((e.key||'')==='Escape'&&big){e.preventDefault();e.stopImmediatePropagation();bigClose();return;}   // 356
      if((e.key||'')==='Escape'){e.preventDefault();e.stopImmediatePropagation();done(null);return;}
      if(!wrap.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    };
    const done=v=>{window.removeEventListener('keydown',key,true);bigClose();wrap.remove();res(v);};
    window.addEventListener('keydown',key,true);
    wrap.addEventListener('keydown',e=>e.stopPropagation());
    wrap.onclick=e=>{if(e.target===wrap)done(null);};
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
    const btn=(t,primary,fn)=>{const b=document.createElement('button'); b.textContent=t;
      b.style.cssText='background:'+(primary?'#b8934a':'#232019')+';color:'+(primary?'#161310':'#d8cdb8')
        +';border:1px solid #6b5a33;border-radius:2px;padding:8px 14px;font-size:14px;cursor:pointer';
      b.onclick=fn; return b;};
    if(o.view){
      const h=document.createElement('div'); h.textContent=o.title||''; h.style.cssText='font-size:18px;font-weight:700;color:#f0e6d2';
      box.appendChild(h);
      if(o.text){const t=document.createElement('div'); t.textContent=o.text; t.style.cssText='line-height:1.6;white-space:pre-wrap'; box.appendChild(t);}
      box.appendChild(picBox); showPic();
      const close=btn('סגירה',true,()=>done(null)); row.appendChild(close); box.appendChild(row);
      wrap.appendChild(box); document.body.appendChild(wrap); setTimeout(()=>close.focus(),0); return;
    }
    const ti=document.createElement('input'); ti.value=o.title||''; ti.maxLength=80; ti.placeholder='מה יופיע על המודל';
    ti.style.cssText=S+'padding:7px 9px;font:15px system-ui,Arial,sans-serif';
    const tx=document.createElement('textarea'); tx.value=o.text||''; tx.rows=4;
    tx.style.cssText=S+'padding:7px 9px;font:14px system-ui,Arial,sans-serif;resize:vertical';
    const file=document.createElement('input'); file.type='file'; file.accept='image/*,.heic,.heif'; file.style.display='none';
    const imgRow=document.createElement('div'); imgRow.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
    const add=btn('',false,()=>file.click()), del=btn('הסרת התמונה',false,()=>{img=null;changed=null;sync();});
    const warn=document.createElement('div'); warn.style.cssText='font-size:13px;color:#ff595e;display:none';
    const save=btn('שמירה',true,()=>{ const t=ti.value.trim(); if(!t){ti.focus();return;}
      done({title:t,text:tx.value.trim(),img:changed}); });
    const sync=()=>{ add.textContent=img?'החלפת התמונה':'הוספת תמונה'; del.style.display=img?'':'none';
      save.disabled=!ti.value.trim(); save.style.opacity=save.disabled?'.5':'1'; showPic(); };
    file.onchange=async()=>{ const f=file.files&&file.files[0]; file.value=''; if(!f) return;
      warn.style.display='none';
      try{ img=await amTagShrink(f); changed=img; }catch(e){ warn.textContent=e.message; warn.style.display=''; }
      sync(); };
    ti.oninput=sync;
    ti.onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault(); save.click();} };
    box.appendChild(lab('כותרת')); box.appendChild(ti);
    box.appendChild(lab('טקסט')); box.appendChild(tx);
    imgRow.appendChild(add); imgRow.appendChild(del); box.appendChild(imgRow); box.appendChild(file);
    box.appendChild(picBox); box.appendChild(warn);
    row.appendChild(save); row.appendChild(btn('ביטול',false,()=>done(null))); box.appendChild(row);
    wrap.appendChild(box); document.body.appendChild(wrap); sync();
    setTimeout(()=>ti.focus(),0);
  });
}
/*AM_TAGCORE_END*/

/* ---- THE PROGRAM'S OWN QUESTION (24/09) --------------------------------------------
   Two reasons, both Eli's. "Why not write 'close them all' and 'close only the largest' ON
   the buttons, instead of OK/Cancel and a key in the text?" — the browser's own dialog cannot
   name its buttons. And the night it cost a volume: a native dialog STOPS the page while it
   is open, the heartbeat with it, and after a minute the server concluded the window was
   closed, saved and quit (22:18-22:20). This one lives in the page: every button says what
   it does, the page keeps running, Escape or a click outside is always the answer that
   changes nothing, and no key reaches the screen underneath while it is open. */
function amAsk(text,buttons,safe){
  return new Promise(res=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483000;'
      +'display:flex;align-items:center;justify-content:center;direction:rtl';
    const box=document.createElement('div');
    box.style.cssText='background:#141210;border:2px solid #6b5a33;border-radius:2px;'
      +'padding:22px 26px;color:#d8cdb8;font:15px system-ui,Arial,sans-serif;max-width:480px;'
      +'max-height:88vh;display:flex;flex-direction:column;box-sizing:border-box;'
      +'box-shadow:inset 0 0 0 3px #141210, inset 0 0 0 4px rgba(184,147,74,.45)';
    const q=document.createElement('div');
    // 26/09, Eli: a long list (the islands cleanup) pushed the buttons off the screen, and the
    // window had no scroll — the removal could not be confirmed. The text scrolls inside
    // the window now, and the buttons never leave it.
    q.style.cssText='margin-bottom:16px;line-height:1.7;white-space:pre-line;overflow-y:auto;min-height:0;flex:1 1 auto';
    q.textContent=text;
    const row=document.createElement('div');
    row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;flex:0 0 auto';
    let focusEl=null;
    const done=v=>{window.removeEventListener('keydown',key,true);wrap.remove();res(v);};
    function key(e){
      if((e.key||'')==='Escape'){e.preventDefault();done(safe);}
      e.stopImmediatePropagation(); e.stopPropagation();   // nothing reaches the screen underneath
    }
    for(const b of buttons){
      const el=document.createElement('button');
      el.textContent=b.t;
      el.style.cssText='background:'+(b.primary?'#b8934a':'#232019')+';color:'
        +(b.primary?'#161310':'#d8cdb8')+';border:1px solid #6b5a33;border-radius:2px;'
        +'padding:8px 14px;font-size:14px;cursor:pointer';
      el.onclick=()=>done(b.v);
      row.appendChild(el);
      if(b.v===safe) focusEl=el;                 // Enter never does the irreversible thing
    }
    window.addEventListener('keydown',key,true);
    wrap.onclick=e=>{if(e.target===wrap)done(safe);};
    box.appendChild(q); box.appendChild(row); wrap.appendChild(box);
    document.body.appendChild(wrap);
    if(focusEl) setTimeout(()=>focusEl.focus(),0);
  });
}
// a message: one button, and the page runs on underneath it
function amTell(text,label){ return amAsk(text,[{t:label||'הבנתי',v:true,primary:true}],true); }
// the text selected, ready to copy — what the last-resort prompt() did, without stopping
function amCopyBox(text,str){
  return new Promise(res=>{
    const p=amAsk(text,[{t:'סגור',v:true,primary:true}],true);
    setTimeout(()=>{
      const boxes=document.querySelectorAll('div[style*="2147483000"] > div');
      const box=boxes[boxes.length-1]; if(!box){return;}
      const ta=document.createElement('textarea');
      ta.readOnly=true; ta.value=str;
      ta.style.cssText='width:100%;height:120px;margin-bottom:12px;direction:ltr;font:12px monospace;'
        +'background:#0d0c0a;color:#d8cdb8;border:1px solid #6b5a33';
      box.insertBefore(ta,box.lastChild); ta.focus(); ta.select();
    },0);
    p.then(res);
  });
}
// 496: the start screen's title is the About button — the polar planimeter explained, the viewing core's one text;
// the version line is the one on the start screen. Wired before the renderer, so it opens whatever the device does
function amAboutHtml(){
  // the version line is FETCHED or read from the file's stamp, never typed: it used to be a hand-typed "1.0" while
  // APP_VERSION said 1.1 — two claims, both unverifiable (01/09). Until it is filled it reads "A-morphometry".
  return '\n  <div class="box">'
    +'\n    <button class="x" id="infoClose" title="סגור">✕</button>'
    +'\n    <p>הפלנימטר הקוטבי הומצא ב־1854 בידי המתמטיקאי השוויצרי יאקוב אמסלר (אך הרעיון קדם לו: הפלנימטר הראשון תוכנן כבר ב־1814 בידי המודד הבווארי יוהאן מרטין הרמן, במנגנון של גלגל המתגלגל על חרוט, ואמסלר הוא שפישט אותו לצורה הקוטבית המעשית בת שתי הזרועות).</p>'
    +'\n    <p>זהו מכשיר מכני קטן שמודד את שטחה של כל צורה — סדירה או אמורפית — פשוט על ידי הובלת חוד המעקב לאורך קו המתאר שלה. הקסם הוא גלגל מדידה יחיד: הוא מתגלגל רק כשהוא נע בניצב לצירו, ומחליק כשהוא נע במקביל אליו — וכך הוא מבצע אינטגרציה מכנית: סיבובו המצטבר פרופורציוני לאינטגרל <span class="math">∮<sub>C</sub> (x&thinsp;dy − y&thinsp;dx)</span> על היקף הצורה.</p>'
    +'\n    <p>בתום הקפה מלאה (נגד כיוון השעון), על פי משפט גרין, <span class="math">∮<sub>C</sub> (x&thinsp;dy − y&thinsp;dx) = ∬<sub>S</sub> 2&thinsp;dx&thinsp;dy = 2S</span> — האינטגרל לאורך גבולה של הצורה נותן פעמיים את שטחה. כיול המכשיר מגלם את קבוע הפרופורציה, כך שהקריאה מוסרת את השטח עצמו.</p>'
    +'\n    <p>תוכנה זו פועלת באופן שונה מהפלנימטר אך מטרתה זהה.</p>'
    +'\n    <p id="verLine" style="color:var(--dim,#8a8272);font-size:12px;margin-top:10px">A-morphometry</p>'
    +'\n  </div>\n';
}
function amAboutCss(){
  // the main screen's rules, as they were there (the page keeps its own .modalWrap rules that shared them)
  return '#infoModal{position:fixed;inset:0;background:rgba(0,0,0,.74);z-index:60;display:none;align-items:center;justify-content:center;padding:24px}'
    +'#infoModal .box{background:var(--panel,#141210);border:2px solid #6b5a33;border-radius:2px;max-width:660px;max-height:82vh;overflow-y:auto;padding:28px 32px;line-height:1.8;color:var(--txt,#d8cdb8);font-size:15px;direction:rtl;text-align:right;'
    +'box-shadow:inset 0 0 0 3px var(--panel,#141210), inset 0 0 0 4px rgba(184,147,74,.45), 0 24px 70px #000c}'
    +'#infoModal .box p{margin:0 0 14px}'
    +'#infoModal .box p:last-child{margin:0}'
    +'#infoModal .x{position:sticky;top:-4px;float:left;background:none;border:0;color:var(--dim,#8a8272);font-size:20px;cursor:pointer;line-height:1;margin:-6px -6px 0 0}'
    +'#infoModal .x:hover{color:var(--txt,#d8cdb8)}'
    +'#infoModal .math{color:var(--amber,#b8934a);font-style:italic;white-space:nowrap;font-size:14.5px;'
    +'direction:ltr;unicode-bidi:isolate;display:inline-block;vertical-align:middle}'
    +'#infoModal .box p b{font-family:var(--serif,"Frank Ruehl CLM","FrankRuehl","David","Narkisim","Times New Roman",serif)}';
}
function amAboutVer(v){
  // the main screen's line, word for word; `what` names a screen that is not the desktop app (the iPad), and a stamp
  // without a commit (the iPad's, a delivered file's — amAboutStamp) says none
  return 'A-morphometry'+(v.what?' · '+v.what:'')+' · גרסה '+(v.version||'?')
    +('sha' in v?' · commit '+(v.sha||'?'):'')+(v.dirty?' (עץ מלוכלך)':'')
    +(v.build_time?(' · נבנה '+v.build_time):'')
    +(v.source==='source'?' · מהמקור':'');
}
function amAboutStamp(){
  // a delivered file carries the stamp of the build that wrote it; a page whose slot was never filled has none. Its line
  // is the version and the build date ONLY — no commit, no tree state, no "from source" (Eli, 07/10: "מאושר"; the app
  // itself, through /api/version, keeps the full line): only those two are taken, whatever the stamp holds
  try{
    const s=JSON.parse(document.getElementById('amStamp').textContent);
    return s&&typeof s==='object'?{version:s.version,build_time:s.build_time}:null;
  }
  catch(e){ return null; }
}
function amAboutMount(btn,ver){
  // ver: a function returning a promise of the stamp (a served page asks /api/version on the first opening, and asks
  // again next time if that failed), the stamp itself, or null (the line stays "A-morphometry")
  if(!btn) return null;
  if(!document.getElementById('amAboutCss')){
    const st=document.createElement('style'); st.id='amAboutCss'; st.textContent=amAboutCss(); document.head.appendChild(st);
  }
  let M=document.getElementById('infoModal');
  if(!M){ M=document.createElement('div'); M.id='infoModal'; document.body.appendChild(M); }
  if(!M.firstElementChild) M.innerHTML=amAboutHtml();
  const close=()=>{M.style.display='none';};
  btn.onclick=()=>{
    M.style.display='flex';
    const el=document.getElementById('verLine'); if(!el||el.dataset.done||!ver) return;
    const put=v=>{ el.dataset.done='1'; el.textContent=amAboutVer(v); };
    if(typeof ver!=='function'){ put(ver); return; }
    try{ ver().then(put).catch(()=>{}); }catch(e){}
  };
  // a title that is not a button (the iPad's) opens it from the keyboard too
  if(btn.tagName!=='BUTTON') btn.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); btn.onclick(); } });
  document.getElementById('infoClose').onclick=close;
  M.onclick=e=>{if(e.target===M)close();};
  // while the box is open Esc is SWALLOWED: it closes the box and reaches none of the page's other Esc handlers (the cut
  // screen's polygon and frame, …) — caught first, on the window in the capture phase (Eli, 07/10: "מאושר"). Closed, the
  // key passes untouched
  window.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||M.style.display!=='flex') return;
    e.preventDefault(); e.stopImmediatePropagation(); close();
  },true);
  return M;
}
// 536 (14/10): viewer.js carries its own version — the page's number (#ver) is index.html's, and the two could part in a
// cache; the About line shows both ("גרסה 47 · קוד 47"), so a gap shows at once
const VIEWER_JS_VER=51;
amAboutMount($('logoBtn'),{what:'צפיין האייפד',version:((($('ver')||{}).textContent||'').replace(/[^0-9.]+/g,'')||'?')+' · קוד '+VIEWER_JS_VER});
/* 520 (Eli, 13/10: "המקלדת חזרה להיות הקטנה (ומעצבנת)" — the notes app's is the large one, a reverse pinch does not help, no
   keyboard is paired, a fresh start keeps it small): a TEMPORARY keyboard check, opened from the About box only (453's
   rule: never on its own at start). Six fields — ours (locked until a finger, 453), the same outside our lock, a textarea,
   a clean document, outside the lock with the page's own lock released, contenteditable — and for each the pointer, the
   lock, the focus and whether the keyboard docked (a docked keyboard shortens visualViewport, a floating one does not).
   "העתק" copies the log for the chat. The version after it takes this out, with the fix. */
(function amKbDiag(){
  const M=document.getElementById('infoModal'); if(!M) return;
  const box=M.querySelector('.box')||M.firstElementChild; if(!box) return;
  const btnCss='background:#232019;color:#d8cdb8;border:1px solid #6b5a33;border-radius:2px;padding:8px 14px;font-size:14px';
  const b=document.createElement('button'); b.id='amKbBtn'; b.textContent='בדיקת מקלדת'; b.style.cssText='margin-top:12px;'+btnCss;
  box.appendChild(b); b.onclick=()=>{ M.style.display='none'; openCheck(); };
  function openCheck(){
    const L=[], vv=window.visualViewport;
    const mm=q=>{ try{ return matchMedia(q).matches?1:0; }catch(_){ return '?'; } };
    L.push('v='+((($('ver')||{}).textContent)||'?')+' code='+VIEWER_JS_VER+' | ua='+navigator.userAgent+' | standalone='+(navigator.standalone?1:0)
      +' display='+(mm('(display-mode: standalone)')?'standalone':'browser')+' | touch='+(navigator.maxTouchPoints||0)
      +' anyFine='+mm('(any-pointer: fine)')+' anyHover='+mm('(any-hover: hover)')
      +' | vv='+(vv?Math.round(vv.height)+'/'+Math.round(vv.offsetTop):'-')+' inner='+innerHeight);
    const W=document.createElement('div'); W.id='amKbCheck';   // 536: the page's touch guard lets it scroll
    W.style.cssText='position:fixed;inset:0;z-index:2147483500;background:#141210;color:#d8cdb8;direction:rtl;overflow:auto;'
      +'padding:14px;font:14px system-ui,Arial,sans-serif;-webkit-user-select:text;user-select:text';
    const head=document.createElement('div'); head.style.cssText='font-weight:600;margin-bottom:6px';
    head.textContent='בדיקת מקלדת — נגיעה באצבע בכל שדה בתורו, לחכות שנייה, לסגור את המקלדת, ובסוף "העתק"';
    W.appendChild(head);
    const log=document.createElement('pre');
    log.style.cssText='white-space:pre-wrap;direction:ltr;text-align:left;font:11px ui-monospace,Menlo,monospace;background:#1c1915;padding:8px;max-height:30vh;overflow:auto';
    const say=t=>{ L.push(t); log.textContent=L.join('\n'); };
    const row=(label,el)=>{ const d=document.createElement('div'); d.style.cssText='margin:8px 0;display:flex;gap:10px;align-items:center';
      const s=document.createElement('span'); s.textContent=label; s.style.minWidth='10em'; d.appendChild(s); d.appendChild(el); W.appendChild(d); };
    const field=(tag,ph)=>{ const i=document.createElement(tag); if(tag==='input') i.type='text'; else i.rows=2;
      i.placeholder=ph; i.style.cssText='font-size:16px;padding:6px;width:12em'; return i; };
    const shadowed=ph=>{ const h=document.createElement('span'), i=field('input',ph); h.attachShadow({mode:'open'}).appendChild(i); return [h,i]; };
    const watch=(tag,t,before,after)=>{
      let h0=0;
      t.addEventListener('pointerdown',e=>say(tag+': pointerdown type='+e.pointerType+' pressure='+(+e.pressure||0).toFixed(2)+' ro='+(t.readOnly?1:0)),true);
      t.addEventListener('focus',()=>{ if(before) before(); h0=vv?vv.height:innerHeight;
        say(tag+': focus ro='+(t.readOnly?1:0)+' active='+((t.ownerDocument.activeElement===t)?1:0)+' type='+(t.type||t.tagName)
          +' im='+(t.inputMode||'-')+' vv0='+Math.round(h0));
        for(const ms of [300,800]) setTimeout(()=>{ const h=vv?vv.height:innerHeight;
          say(tag+': +'+ms+'ms vv='+Math.round(h)+' off='+(vv?Math.round(vv.offsetTop):'-')+' inner='+innerHeight
            +' -> '+((h0-h>150)?'DOCKED':'floating or none')); },ms); });
      t.addEventListener('blur',()=>{ if(after) after(); say(tag+': blur'); });
      t.addEventListener('keydown',e=>say(tag+': keydown '+e.key),true);
    };
    const a=field('input','א'); row('א · כמו שלנו (נעול עד אצבע)',a); watch('A-ours',a);
    const [hb,bI]=shadowed('ב'); row('ב · בלי הנעילה',hb); watch('B-unlocked',bI);
    const c=field('textarea','ג'); row('ג · תיבת טקסט',c); watch('C-textarea',c);
    const fr=document.createElement('iframe'); fr.style.cssText='width:15em;height:46px;border:1px solid #6b5a33;background:#fff';
    fr.srcdoc='<!doctype html><meta name="viewport" content="width=device-width"><input id="x" type="text" placeholder="ד" style="font-size:16px;padding:6px;width:90%">';
    row('ד · מסמך נקי',fr);
    fr.onload=()=>{ try{ watch('D-clean',fr.contentDocument.getElementById('x')); }catch(e){ say('D-clean: '+e.message); } };
    const [he,eI]=shadowed('ה'); row('ה · בלי נעילת הדף',he);
    const H=document.documentElement, B=document.body, kept=new Map();
    watch('E-pageFree',eI,
      ()=>{ for(const el of [H,B]){ kept.set(el,[el.style.position,el.style.userSelect,el.style.webkitUserSelect]);
              el.style.position='static'; el.style.userSelect='text'; el.style.webkitUserSelect='text'; } },
      ()=>{ for(const [el,k] of kept){ el.style.position=k[0]; el.style.userSelect=k[1]; el.style.webkitUserSelect=k[2]; } kept.clear(); });
    const f=document.createElement('div'); f.contentEditable='true';
    f.style.cssText='min-width:12em;min-height:30px;border:1px solid #6b5a33;padding:6px;font-size:16px;background:#1c1915';
    row('ו · contenteditable',f); watch('F-editable',f);
    W.appendChild(log);
    const bar=document.createElement('div'); bar.style.cssText='display:flex;gap:8px;margin-top:10px';
    const cp=document.createElement('button'), cl=document.createElement('button');
    cp.textContent='העתק'; cl.textContent='סגור'; cp.style.cssText=btnCss; cl.style.cssText=btnCss;
    cp.onclick=()=>{ const t=L.join('\n');
      const p=(navigator.clipboard&&navigator.clipboard.writeText)?navigator.clipboard.writeText(t):Promise.reject(new Error('no clipboard'));
      p.then(()=>{ cp.textContent='הועתק ✓'; },()=>{ amCopyBox('להעתקה — לסמן ולהעתיק:',t); }); };
    cl.onclick=()=>W.remove();
    bar.appendChild(cp); bar.appendChild(cl); W.appendChild(bar);
    document.body.appendChild(W); log.textContent=L.join('\n');
  }
})();
const cv=$('cv');
const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
  // a lost GL context is HEARD, not a silent white canvas (field report 25/08);
  // boot restores the embedded sheet and the op-log, so a reload loses nothing
  renderer.domElement.addEventListener('webglcontextlost',ev=>{
    ev.preventDefault();
    amTell('התצוגה הגרפית אופסה על ידי מערכת ההפעלה (עומס על כרטיס המסך).\n'
         +'העבודה שמורה. העמוד ייטען מחדש וישחזר אותה.','לטעון מחדש').then(()=>location.reload());
  });
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x15171a);   // dark working background, as on the
// desktop: the light background belongs to the report stills, not to the marking view
const camera=new THREE.PerspectiveCamera(50,innerWidth/Math.max(1,innerHeight),0.01,1000);
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/Math.max(1,innerHeight);camera.updateProjectionMatrix();}
addEventListener('resize',resize); resize();
// 523 (Eli, 13/10: the iPad warms up with many marks, whatever the model's size): the frame is drawn only when something
// changed, as the measurement screen does (renderUntil) — a finger down, the camera moved since the last frame, or a change
// that asked for it (invalidate) in the last 320 ms. It was drawn every frame, and every frame every fixed-size label was
// scaled again, however still the screen
let amRenderUntil=performance.now()+3500, amDown=0; const amCamLast=new Float64Array(32);
window.amInvalidate=ms=>{ amRenderUntil=Math.max(amRenderUntil,performance.now()+(ms||320)); };
for(const t of ['pointerdown','pointerup','pointercancel'])
  addEventListener(t,()=>{ if(t==='pointerdown') amDown++; else amDown=Math.max(0,amDown-1); window.amInvalidate(); },true);
for(const t of ['wheel','keydown','keyup','input','change','click','resize','orientationchange'])
  addEventListener(t,()=>window.amInvalidate(),{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{ amDown=0; window.amInvalidate(); });
function amCamMoved(){ camera.updateMatrixWorld(); const a=camera.matrixWorld.elements, b=camera.projectionMatrix.elements; let ch=false;
  for(let i=0;i<16;i++){ if(amCamLast[i]!==a[i]){ amCamLast[i]=a[i]; ch=true; } if(amCamLast[16+i]!==b[i]){ amCamLast[16+i]=b[i]; ch=true; } }
  return ch; }
(function tick(){requestAnimationFrame(tick);if(window.amMarkTick)window.amMarkTick();
  const now=performance.now(); if(amCamMoved()) amRenderUntil=Math.max(amRenderUntil,now+120);
  if(amDown>0||now<amRenderUntil){ if(window.amRescaleFixed)window.amRescaleFixed();
    if(window.amColFlush)window.amColFlush();renderer.render(scene,camera); } })();   // 494: the recoloured sub-faces by their ranges

$('openBtn').onclick=()=>$('file').click();
/* ---- 453 (Eli, 05/10: "the keyboard that opens on the iPad should be the big comfortable one, not the small
   annoying one"). The diagnosis of 42 found it: every field of the test docked its keyboard; in the app all was
   well "until making a tag and touching a text box in it — after that every keyboard comes out small, even where it
   came out right before". A tag is placed with the pencil and its title was focused at once — to iPadOS the typing
   began with the pencil, so it opened the pencil's writing mode and its small floating keyboard, and kept it for
   every field of the app until it was closed; nothing a page does takes it out again. So the iPad never lets it
   begin: no field is focused by the program, every text field is locked for writing until a FINGER touches it, and
   the pencil on a text field leaves it closed and says how to write (Eli: "I do want a message") */
const AM_TXT='input:not([type]),input[type=text],input[type=search],textarea';
function amTxt(t){ return !!(t&&t.matches&&t.matches(AM_TXT)); }
function amTxtLock(root){
  const all=(root.matches&&root.matches(AM_TXT))?[root]:[];
  if(root.querySelectorAll) all.push(...root.querySelectorAll(AM_TXT));
  for(const t of all) if(!t.dataset.amRo&&!t.readOnly){ t.dataset.amRo='1'; t.readOnly=true; }   // a field read-only by design stays so
}
new MutationObserver(ms=>{ for(const m of ms) for(const n of m.addedNodes) if(n.nodeType===1) amTxtLock(n); })
  .observe(document.documentElement,{childList:true,subtree:true});
amTxtLock(document.documentElement);
let amPenTipT=0;
function amPenTip(t){
  let d=document.getElementById('amPenTip');
  if(!d){ d=document.createElement('div'); d.id='amPenTip'; d.textContent='לכתיבה — נגיעה באצבע';
    d.style.cssText='position:fixed;z-index:2147483600;pointer-events:none;background:#232019;color:#f0e6d2;'
      +'border:1px solid #b8934a;border-radius:2px;padding:6px 10px;font:14px system-ui,Arial,sans-serif;direction:rtl;'
      +'box-shadow:0 2px 8px #0009;transition:opacity .25s'; document.body.appendChild(d); }
  const r=t.getBoundingClientRect();
  d.style.left=Math.max(6,Math.min(innerWidth-190,r.left))+'px';
  d.style.top=((r.bottom+44<innerHeight)?r.bottom+6:Math.max(6,r.top-40))+'px';
  d.style.opacity='1'; clearTimeout(amPenTipT); amPenTipT=setTimeout(()=>{d.style.opacity='0';},1600);
}
document.addEventListener('pointerdown',e=>{
  const t=e.target; if(!amTxt(t)||!t.dataset.amRo) return;
  if(e.pointerType==='pen'){                       // the pencil: the field stays closed
    e.preventDefault(); t.readOnly=true; if(document.activeElement===t) t.blur(); amPenTip(t); return; }
  t.readOnly=false;                                // a finger (or a mouse) opens it
},true);
document.addEventListener('focusout',e=>{ const t=e.target; if(amTxt(t)&&t.dataset.amRo) t.readOnly=true; },true);
// where the program used to put the caret, it now shows where to write — the finger's touch opens it
function amInvite(t){ if(!t) return; t.style.outline='2px solid #b8934a'; t.style.outlineOffset='1px';
  setTimeout(()=>{ t.style.outline=''; t.style.outlineOffset=''; },2600); }
// the tag card is the three screens' shared core, word for word (332) — its own focus() stays in the text, and on the
// iPad a locked field asked for the caret by the program is shown instead (the measurement screen keeps its caret)
for(const P of [HTMLInputElement.prototype,HTMLTextAreaElement.prototype]){ const f=P.focus;
  P.focus=function(o){ if(this.dataset&&this.dataset.amRo&&this.readOnly){ amInvite(this); return; } return f.call(this,o); }; }
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
      .catch(ex=>amTell('טעינת הגיליון נכשלה:\n'+((ex&&ex.message)||ex)));
    return;
  }
  // 484: the planimeter while the file is read and the work built — the build itself holds the page, so the
  // drawing may stand still for its length; it is on the screen from the moment the file is chosen
  const veil=$('amLoad'), hide=()=>{ veil.style.display='none'; };
  $('amLoadMsg').textContent='פותח את העבודה…'; veil.style.display='flex';
  if(window.__pmStart) window.__pmStart('פותח את העבודה',{size:f.size/1048576});
  f.arrayBuffer().then(buf=>new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>res(buf)))))
    .then(buf=>{ load(buf); if(window.amInvalidate) window.amInvalidate(6000);   // 523: the textures decode after it
      if(window.__pmFinish) window.__pmFinish(hide); else hide(); })
    .catch(ex=>{ if(window.__pmStop) window.__pmStop(); hide(); $('err').textContent='שגיאה: '+ex.message;});
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
function amPlanimeterMarkup(){
  // the logo's A, written counter-clockwise (decision 350): a polar planimeter reads a
  // positive area only when the outline is traced in the positive sense. The outline is
  // written here once and drawn twice — the faint shape and the tracer's line (S2 reads it here)
  const OUTLINE='M118,60 C112,60 110,64 106,74 C90,108 72,162 58,206 C50,230 38,254 44,266 C50,276 76,272 82,258 C90,238 92,212 100,190 C108,174 134,176 140,190 C148,212 150,238 156,260 C162,274 186,278 194,270 C200,262 186,250 178,232 C164,200 154,166 146,134 C138,104 132,74 118,60 Z';
  return '<style>'
    +'#planim{margin-bottom:-6px;max-height:42vh}'   // 358: in a short window the centred column pushed the drawing off the top
    +'#pmCount{font:500 22px/1 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;color:var(--amber);letter-spacing:.06em;text-align:center;direction:rtl}'
    +'#pmCount .u{font:400 14px var(--sans);color:var(--dim);letter-spacing:0}'
    +'#pmNum{display:inline-block;min-width:5ch}'
    +'</style>'
    +'<svg id="planim" viewBox="0 0 330 300" width="286" height="260">'
    +'<path id="pmBlob" fill="#d8cdb8" fill-opacity=".13" stroke="#6b5f4c" stroke-width="2.4" stroke-linejoin="round" d="'+OUTLINE+'"/>'
    +'<path id="pmTrace" fill="none" stroke="var(--amber)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="'+OUTLINE+'"/>'
    +'<line id="pmA1" stroke="var(--amber)" stroke-width="3" stroke-linecap="round"/>'
    +'<line id="pmA2" stroke="var(--amber)" stroke-width="3" stroke-linecap="round"/>'
    +'<g id="pmCar">'
    +'<rect x="-20" y="-6" width="40" height="12" rx="1.5" fill="var(--bg)" stroke="var(--amber)" stroke-width="2.4"/>'
    +'<g id="pmG1"></g><g id="pmG2"></g>'
    +'</g>'
    +'<circle cx="300" cy="220" r="13" fill="var(--amber)"/>'
    +'<circle cx="300" cy="220" r="7" fill="none" stroke="var(--bg)" stroke-width="2"/>'
    +'<circle id="pmEl" r="9" fill="var(--bg)" stroke="var(--amber)" stroke-width="3"/>'
    +'<circle id="pmTp" r="5.5" fill="#e9e0cd"/>'
    +'</svg>'
    +'<div id="pmCount"><span id="pmNum" dir="ltr">0.0</span> <span class="u">מילימטר רבוע</span></div>';
}
// The polar planimeter (decisions 350–351). The logo's A is traced once, counter-clockwise,
// so the instrument reads a positive area. The elbow is solved by real inverse kinematics on
// one fixed branch; the measuring wheel sits on the tracer arm with its axle along the arm,
// so it turns only by the component of its own motion perpendicular to the arm, and the
// counting gear is meshed to it by the tooth ratio. Around the closed outline the wheel's net
// roll s gives the area as L2·s (Amsler: pole outside, neither arm makes a full turn), and the
// counter shows exactly that — midway it is an instrument reading, not a partial area.
// Pole, arm lengths and branch were searched so every point of the A is reachable with a wide
// margin from the straight-arm singularities and the elbow never leaves the canvas; S2 re-runs
// the linkage from these constants and checks the reading against the shoelace area.
function amPlanimeterMount(host){
  if(!host){console.warn('planimeter: no host element');return;}
  if(!document.getElementById('planim')) host.innerHTML=amPlanimeterMarkup();
  host.style.display='contents';                        // the drawing and the counter stay items of the veil's own column
  const path=document.getElementById('pmBlob');
  if(!path){console.warn('planimeter: #pmBlob missing');return;}
  const $$=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
  const trace=$$('pmTrace'), a1=$$('pmA1'), a2=$$('pmA2'), el=$$('pmEl'), tp=$$('pmTp'),
        car=$$('pmCar'), g1=$$('pmG1'), g2=$$('pmG2'), cnt=$$('pmNum'), svg=$$('planim');
  const P={x:300,y:220}, L1=184, L2=186, BR=1;          // pole, pole arm, tracer arm, elbow branch
  const CAR=44;                                         // carriage centre: distance from the elbow along the tracer arm
  const MOD=1.4, TOOTH=3, NW=7, NC=14;                  // module, tooth length, teeth: measuring wheel, counting gear
  const RW=MOD*NW/2, RC=MOD*NC/2, XW=(RW+RC)/2, GY=-15; // pitch radii; gear centres in the carriage frame
  const CW=CAR-XW;                                      // the wheel's contact point on the arm, from the elbow
  function gear(g,N,R,x){                               // the logo's gear: a ring, radial teeth, a hub
    g.innerHTML='';
    const w=document.createElementNS(NS,'g'); w.setAttribute('transform','translate('+x+' '+GY+')'); g.appendChild(w);
    const r=document.createElementNS(NS,'g'); w.appendChild(r);
    const add=(t,at)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);r.appendChild(e);};
    const r0=R-TOOTH/2;
    add('circle',{r:r0,fill:'var(--bg)',stroke:'var(--amber)','stroke-width':2.2});
    add('circle',{r:Math.max(0.9,r0*0.22),fill:'var(--amber)'});
    for(let k=0;k<N;k++){const a=2*Math.PI*k/N, c=Math.cos(a), s=Math.sin(a);
      add('line',{x1:r0*c,y1:r0*s,x2:(r0+TOOTH)*c,y2:(r0+TOOTH)*s,stroke:'var(--amber)','stroke-width':2.2,'stroke-linecap':'round'});}
    return r;
  }
  const rotW=gear(g1,NW,RW,XW), rotC=gear(g2,NC,RC,-XW);   // wheel on the elbow side, counter on the tracer side (as in the logo)
  const L=path.getTotalLength();
  function pose(T){                                     // tracer point -> elbow, unit tracer arm (elbow->tracer)
    const dx=T.x-P.x, dy=T.y-P.y, d=Math.hypot(dx,dy)||1e-6;
    const a=(L1*L1-L2*L2+d*d)/(2*d), h=Math.sqrt(Math.max(L1*L1-a*a,0));
    const E={x:P.x+a*dx/d-BR*h*dy/d, y:P.y+a*dy/d+BR*h*dx/d};
    return {E, u:{x:(T.x-E.x)/L2, y:(T.y-E.y)/L2}};
  }
  // the wheel's roll along the whole loop, once: ds = dW·n, with n the arm's normal in the
  // mathematical frame (y up). Per frame the roll is read from this table by arc length.
  const K=2400, S=new Float64Array(K+1);
  { let prev=null;
    for(let i=0;i<=K;i++){
      const T=path.getPointAtLength(Math.min(L*i/K,L)), q=pose(T), W={x:q.E.x+CW*q.u.x, y:q.E.y+CW*q.u.y};
      S[i]= i? S[i-1] + ((W.x-prev.W.x)*prev.n.x - (W.y-prev.W.y)*prev.n.y + (W.x-prev.W.x)*q.u.y - (W.y-prev.W.y)*q.u.x)/2 : 0;
      prev={W, n:{x:q.u.y, y:q.u.x}};
    }
  }
  const roll=f=>{const x=Math.max(0,Math.min(1,f))*K, i=Math.min(K-1,Math.floor(x)); return S[i]+(S[i+1]-S[i])*(x-i);};
  trace.style.strokeDasharray=L; trace.style.strokeDashoffset=L;
  // the reading in square millimetres of the A as drawn: drawing units -> CSS px -> CSS mm
  // (a CSS mm is 96/25.4 px by definition; on a screen scaled other than 100% the ruler differs)
  const MM=svg.width.baseVal.value/svg.viewBox.baseVal.width*25.4/96;
  const set=(e,at)=>{for(const k in at)e.setAttribute(k,at[k]);};
  function draw(f){
    const T=path.getPointAtLength(f*L), q=pose(T), E=q.E, u=q.u, s=roll(f);
    set(a1,{x1:P.x,y1:P.y,x2:E.x,y2:E.y});
    set(a2,{x1:E.x-16*u.x,y1:E.y-16*u.y,x2:T.x,y2:T.y});            // the arm runs a little past the elbow, as in the logo
    set(el,{cx:E.x,cy:E.y}); set(tp,{cx:T.x,cy:T.y});
    const C={x:E.x+CAR*u.x, y:E.y+CAR*u.y}, psi=Math.atan2(-u.y,-u.x)*180/Math.PI;
    car.setAttribute('transform','translate('+C.x+' '+C.y+') rotate('+psi+')');
    const tw=s/RW, tc=Math.PI/NC-(NW/NC)*(tw-Math.PI);           // rolling contact at the pitch circles, teeth in mesh
    rotW.setAttribute('transform','rotate('+(tw*180/Math.PI)+')');
    rotC.setAttribute('transform','rotate('+(tc*180/Math.PI)+')');
    trace.style.strokeDashoffset=L*(1-f);
    cnt.textContent=(L2*s*MM*MM).toFixed(1);
  }
  // progress (351): the server reports none. The pace (352): one loop per operation at an even
  // speed, reaching 95% at the expected time. That time is the server's own estimate where
  // there is one; otherwise this machine's last runs of the same kind — the median time per
  // face (per MB while a scan is taken in) times the size now. With neither, the old curve:
  // quick at first and never past 92%. A run longer than expected keeps creeping, never
  // stopping and never closing the loop; when the work ends the rest is traced at the same
  // pace, within 2 s, and the final reading holds for a moment. Only successes are recorded.
  const TAU=8000, CAP=0.92, LEAD=0.95, HOLD=300, STORE='amPmTimes', KEEP=8;
  const kindOf=m=>String(m||'').replace(/[:(].*$/,'').replace(/[\d.,]+/g,'').replace(/…/g,'').trim();
  const sizeNow=o=>{ if(o&&o.size>0) return o.size; try{ return NSCAN>0?NSCAN:0; }catch(_){ return 0; } };
  const past=()=>{ try{ return JSON.parse(localStorage.getItem(STORE)||'{}')||{}; }catch(_){ return {}; } };
  function expect(kind,size){
    const h=past()[kind]; if(!Array.isArray(h)||!h.length) return 0;
    const r=h.map(x=>size>0&&x.z>0? x.ms*size/x.z : x.ms).filter(v=>v>0).sort((a,b)=>a-b);
    return r.length? r[r.length>>1] : 0;
  }
  function record(run,ms){
    if(!run.kind) return;
    try{ const all=past(); all[run.kind]=(Array.isArray(all[run.kind])?all[run.kind]:[]).concat([{ms:Math.round(ms),z:run.size}]).slice(-KEEP);
         localStorage.setItem(STORE,JSON.stringify(all)); }catch(_){}
  }
  let raf=null, run={t0:0,T:0,kind:'',size:0}, fin=null, fall=null, prog=null;
  const runF=t=>!run.T? CAP*t/(t+TAU)
                : t<=run.T? LEAD*t/run.T : LEAD+(1-LEAD)*0.8*(1-Math.exp(-(t-run.T)/run.T));
  // 468: a REAL fraction (the map's cut reports its stages and tiles). The tracer catches up
  // with the reported fraction quickly, then creeps toward the next expected value — at most
  // most of the way to it, never past it, and never back. The time pace above is not used then.
  const CATCH=350, CREEP=9000, REACH=0.9;
  function progF(ms){
    const dt=prog.t? Math.max(0,Math.min(250,ms-prog.t)) : 0; prog.t=ms;
    const behind=prog.shown<prog.f-1e-4, goal=behind? prog.f : prog.f+REACH*(prog.next-prog.f);
    if(goal>prog.shown) prog.shown+=(goal-prog.shown)*(1-Math.exp(-dt/(behind?CATCH:CREEP)));
    return prog.shown;
  }
  function frame(ms){
    let f;
    if(!fin) f=prog? progF(ms) : runF(ms-run.t0);
    else{ const x=Math.min(1,(ms-fin.t)/fin.dur); f=fin.f0+(1-fin.f0)*(run.T? x : 1-Math.pow(1-x,3));
      if(ms-fin.t>=fin.dur+HOLD){ draw(1); const cb=fin.cb; stop(); cb(); return; } }
    draw(f); raf=requestAnimationFrame(frame);
  }
  function stop(){ if(raf){cancelAnimationFrame(raf); raf=null;} clearTimeout(fall); fin=null; prog=null; }
  draw(0);
  window.__pmStart=(msg,opt)=>{
    if(raf&&!fin) return;
    stop();
    const kind=kindOf(msg), size=sizeNow(opt), est=opt&&opt.est>0? opt.est*1000 : 0;
    run={t0:performance.now(), T:est||expect(kind,size), kind, size};
    if(opt&&opt.progress){ run.T=0; prog={f:0,next:0,shown:0,t:0}; }   // 468: driven by __pmProgress, not by the clock
    draw(0); raf=requestAnimationFrame(frame);
  };
  // 468: the work's own fraction (0..1), and where its next report is expected to land
  window.__pmProgress=(frac,next)=>{
    if(!raf||fin) return;
    const f=Math.max(0,Math.min(1,+frac||0)), nx=Math.max(f,Math.min(1,+next||0));
    if(!prog) prog={f:0,next:0,shown:runF(performance.now()-run.t0),t:0};
    prog.f=Math.max(prog.f,f); prog.next=Math.max(prog.next,nx,prog.f);
  };
  window.__pmStop=stop;                                           // don't burn CPU when hidden
  window.__pmFinish=cb=>{
    if(!raf||fin){ stop(); cb(); return; }
    const now=performance.now(), f0=prog? prog.shown : runF(now-run.t0);
    if(!prog) record(run, now-run.t0);                             // a run driven by real progress teaches the pace nothing
    const dur=run.T? Math.max(250,Math.min(1700,(1-f0)*run.T/LEAD)) : 400+1300*(1-f0);
    fin={t:now, f0, dur, cb};
    fall=setTimeout(()=>{ if(fin&&fin.cb===cb){ stop(); cb(); } }, dur+HOLD+400);   // a throttled frame loop must not keep the screen shut
  };
  window.__pmModel={P,L1,L2,BR,CW,MM,len:L,roll:()=>roll(1),run:()=>run,pace:t=>runF(t),expect,kindOf,prog:()=>prog};         // for the QA layer and for inspection
}
amPlanimeterMount($('pmHost'));   // 484
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
        $('ready').style.color='#38b000';
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
// 449: the model on the mean of its points, in place — the measurement screen's centre
function amCentre(pos){
  const n=pos.length/3; if(!n) return [0,0,0];
  let cx=0,cy=0,cz=0; for(let i=0;i<pos.length;i+=3){ cx+=pos[i]; cy+=pos[i+1]; cz+=pos[i+2]; }
  cx/=n; cy/=n; cz/=n;
  for(let i=0;i<pos.length;i+=3){ pos[i]-=cx; pos[i+1]-=cy; pos[i+2]-=cz; }
  return [cx,cy,cz];
}
function load(buf){
  const g=parseGLB(buf);
  const am=g.json.asset&&g.json.asset.extras&&g.json.asset.extras.amWork;
  if(!am) throw new Error('הקובץ אינו נושא נתוני עבודה (amWork).');
  if(am.schemaVersion>3) throw new Error('הקובץ נוצר בגרסה חדשה מדי — עדכנו את גרסת האייפד.');
  AM=am;
  const acc=g.json.accessors, app=am.appData;
  const pos=bview(g,g.bin,acc[0].bufferView,Float32Array);
  // 449 (Eli, 05/10: "the polygons, the ruler and the tape are off the model"): the measurement screen centres
  // the model on the mean of its points (core.quantize_positions) and the sheet's points — rings, rulers, tapes,
  // counters, tags — are written in that frame; the package carries the model where it was scanned. Centred
  // here the same way, the iPad and the computer share one frame (on Eli's work the shift was 3 m)
  amCentre(pos);
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
    $('bar').style.display='block';           // 322: rows of zones, not one flex row
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
  let amCF=null;   // 494: the sub-faces recoloured since the last frame (amColMark/amColFlush)
  const desAttr=new THREE.BufferAttribute(dess,1);
  geo.setAttribute('aDes',desAttr);
  // ---- which sub-faces are reconstructed surface (decision 166) ------------------
  // Membrane faces are appended LAST by membrane_union and sub-faces are counted in
  // face order, so the patch is a contiguous tail: one index describes all of it,
  // and no sub-face-to-face map is needed (the read-only viewer has none). Absent
  // the field there is no patch, the flag stays 0 everywhere, and every pixel is
  // what it was.
  const PATCH0=(typeof am.patch0==='number')?am.patch0:N;
  const patchf=new Float32Array(N*3);
  for(let i=PATCH0*3;i<N*3;i++) patchf[i]=1;
  geo.setAttribute('aPatch',new THREE.BufferAttribute(patchf,1));
  /* ---- 374: THE SHAPE OF A BUILT SURFACE ------------------------------------------------
     Eli, 30/09: "add to the built surfaces (holes + continuation + volumes) a texture that helps
     to understand their shape, and a thin dark line at sharp corners — from some angles they
     look completely flat". His choice: smooth shading with a corner line, and the contour
     lines (246/247: 2 cm, from each surface's own mean plane). One routine, the same in every
     screen: from a triangle soup (9 numbers a face) it gives, per corner, a SMOOTH normal
     (averaged only over the faces round a point that turn less than AM_SMOOTH_DEG from this
     one, so a corner stays a corner), the signed distance from its surface's mean plane (the
     contour's height), and the segments of every edge that is sharp or on the border. */
  const AM_SMOOTH_DEG=40, AM_EDGE_DEG=28;
  function amSynthDecor(P, nf){
    const q=v=>Math.round(v*1e5);
    const vid=new Int32Array(nf*3), map=new Map(); let nv=0;
    for(let k=0;k<nf*3;k++){
      const key=q(P[k*3])+','+q(P[k*3+1])+','+q(P[k*3+2]);
      let id=map.get(key); if(id===undefined){ id=nv++; map.set(key,id); }
      vid[k]=id;
    }
    const fn=new Float32Array(nf*3), fa=new Float32Array(nf);
    for(let f=0;f<nf;f++){
      const o=f*9;
      const ux=P[o+3]-P[o],uy=P[o+4]-P[o+1],uz=P[o+5]-P[o+2], vx=P[o+6]-P[o],vy=P[o+7]-P[o+1],vz=P[o+8]-P[o+2];
      let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz);
      fa[f]=0.5*l; if(l>1e-15){ nx/=l; ny/=l; nz/=l; }
      fn[f*3]=nx; fn[f*3+1]=ny; fn[f*3+2]=nz;
    }
    // the faces round each point
    const cnt=new Int32Array(nv+1);
    for(let k=0;k<nf*3;k++) cnt[vid[k]+1]++;
    for(let i=0;i<nv;i++) cnt[i+1]+=cnt[i];
    const fill=cnt.slice(0,nv), inc=new Int32Array(nf*3);
    for(let k=0;k<nf*3;k++) inc[fill[vid[k]]++]=(k/3)|0;
    const cs=Math.cos(AM_SMOOTH_DEG*Math.PI/180);
    const pn=new Float32Array(nf*9);
    for(let k=0;k<nf*3;k++){
      const f=(k/3)|0, v=vid[k], ax=fn[f*3],ay=fn[f*3+1],az=fn[f*3+2];
      let sx=0,sy=0,sz=0;
      for(let t=cnt[v];t<cnt[v+1];t++){
        const g=inc[t], bx=fn[g*3],by=fn[g*3+1],bz=fn[g*3+2];
        // a patch's winding may run either way on a double-sided surface: the turn is measured unsigned
        const d=ax*bx+ay*by+az*bz, s=d<0?-1:1;
        if(Math.abs(d)>=cs){ sx+=s*bx*fa[g]; sy+=s*by*fa[g]; sz+=s*bz*fa[g]; }
      }
      const l=Math.hypot(sx,sy,sz)||1;
      pn[k*3]=sx/l; pn[k*3+1]=sy/l; pn[k*3+2]=sz/l;
    }
    // the pieces, and each one's mean plane: the contours' height is the distance from it
    const par=new Int32Array(nv); for(let i=0;i<nv;i++) par[i]=i;
    const root=a=>{ while(par[a]!==a){ par[a]=par[par[a]]; a=par[a]; } return a; };
    for(let f=0;f<nf;f++){ const a=root(vid[f*3]), b=root(vid[f*3+1]), c=root(vid[f*3+2]); par[b]=a; par[root(c)]=a; }
    const acc=new Map();
    for(let k=0;k<nf*3;k++){
      const r=root(vid[k]); let A=acc.get(r); if(!A){ A=[0,0,0,0, 0,0,0,0,0,0]; acc.set(r,A); }
      A[0]+=P[k*3]; A[1]+=P[k*3+1]; A[2]+=P[k*3+2]; A[3]++;
    }
    for(const A of acc.values()){ A[0]/=A[3]; A[1]/=A[3]; A[2]/=A[3]; }
    for(let k=0;k<nf*3;k++){
      const A=acc.get(root(vid[k])), dx=P[k*3]-A[0], dy=P[k*3+1]-A[1], dz=P[k*3+2]-A[2];
      A[4]+=dx*dx; A[5]+=dx*dy; A[6]+=dx*dz; A[7]+=dy*dy; A[8]+=dy*dz; A[9]+=dz*dz;
    }
    const plane=new Map();
    for(const [r,A] of acc){
      // the direction of least spread (power iteration on trace*I - C, as patchBandPlane)
      const tr=A[4]+A[7]+A[9], m=[tr-A[4],-A[5],-A[6], -A[5],tr-A[7],-A[8], -A[6],-A[8],tr-A[9]];
      let x=0.5773,y=0.5774,z=0.5775;
      for(let it=0;it<48;it++){
        const X=m[0]*x+m[1]*y+m[2]*z, Y=m[3]*x+m[4]*y+m[5]*z, Z=m[6]*x+m[7]*y+m[8]*z;
        const l=Math.hypot(X,Y,Z); if(l<1e-20) break; x=X/l; y=Y/l; z=Z/l;
      }
      plane.set(r,[A[0],A[1],A[2],x,y,z]);
    }
    const band=new Float32Array(nf*3);
    for(let k=0;k<nf*3;k++){
      const L=plane.get(root(vid[k]));
      band[k]=(P[k*3]-L[0])*L[3]+(P[k*3+1]-L[1])*L[4]+(P[k*3+2]-L[2])*L[5];
    }
    // the edges: on the border (one face) or sharp (two faces turned more than AM_EDGE_DEG)
    const ce=Math.cos(AM_EDGE_DEG*Math.PI/180), E=new Map(), seg=[];
    for(let f=0;f<nf;f++) for(let c=0;c<3;c++){
      const a=vid[f*3+c], b=vid[f*3+(c+1)%3]; if(a===b) continue;
      const key=a<b?a*nv+b:b*nv+a, e=E.get(key);
      if(e===undefined) E.set(key,[f,c,-1]); else if(e[2]<0) e[2]=f; else e[2]=-2;   // -2: more than two faces
    }
    for(const [key,e] of E){
      let on=false;
      if(e[2]===-1) on=true;
      else if(e[2]>=0){ const f=e[0], g=e[2];
        on=Math.abs(fn[f*3]*fn[g*3]+fn[f*3+1]*fn[g*3+1]+fn[f*3+2]*fn[g*3+2])<ce; }
      if(!on) continue;
      const f=e[0], c=e[1], i=f*3+c, j=f*3+(c+1)%3;
      seg.push(P[i*3],P[i*3+1],P[i*3+2],P[j*3],P[j*3+1],P[j*3+2]);
    }
    return {pn, band, edges:new Float32Array(seg)};
  }
  // the line: dark and thin, with the surface's own fading (its opacity follows the model's)
  const AM_EDGE_RGB=0x140806, AM_EDGE_ALPHA=0.75;
  function amSynthEdges(seg){
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(seg,3));
    const m=new THREE.LineBasicMaterial({color:AM_EDGE_RGB,transparent:true,opacity:AM_EDGE_ALPHA,depthWrite:false});
    // drawn a hair toward the eye: a line exactly in the surface is hidden by it half the time. A share of
  // its own distance (0.15%), not a fixed depth: a fixed one carried it in front of a wall (411)
    m.onBeforeCompile=sh=>{ sh.vertexShader=sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  mvPosition.xyz*=0.9985;gl_Position=projectionMatrix*mvPosition;'); };
    const L=new THREE.LineSegments(g,m);
    L.renderOrder=2; L.userData.amEdge=true;
    return L;
  }

  // the built surfaces' own normals and contour heights, and their corner lines (374)
  const AM_SYN=(N>PATCH0)?amSynthDecor(geo.attributes.position.array.subarray(PATCH0*9,N*9),N-PATCH0):null;
  { const pnA=new Float32Array(N*9), bdA=new Float32Array(N*3);
    if(AM_SYN){ pnA.set(AM_SYN.pn,PATCH0*9); bdA.set(AM_SYN.band,PATCH0*3); }
    geo.setAttribute('aPN',new THREE.BufferAttribute(pnA,3)); geo.setAttribute('aBand',new THREE.BufferAttribute(bdA,1)); }
  if(!self.AM_SPK_CELL) self.AM_SPK_CELL={value:0};   // 413: the blot cell, set with the model (1/400 of its diagonal)
  const AM_SYNTH_GLSL=`
  // 374: the built surface's own shade — a SMOOTH normal (from amSynthDecor) at the training's
  // measured contrast, and the contours of 246/247 (2 cm from each surface's mean plane)
  // 413 (Eli, 03/10, sample 9 of nine): fine blots of random shape, half a tone above the colour and
// half below, scattered at random over every built surface. In the model's own space, so they stay on
// it; the cell is a share of the model's diagonal (a cave and a sherd alike); a blot may lie across its
// cell's edge, so the cells round a point are asked too; gone where a blot would be under a pixel.
uniform float amSpkCell;
float amH3(vec3 c){ return fract(sin(dot(c,vec3(127.1,311.7,74.7)))*43758.5453); }
vec3 amSpeckle(vec3 c, vec3 p){
  if(amSpkCell<=0.0) return c;
  vec3 n=abs(cross(dFdx(p),dFdy(p)));
  float ax=(n.x>=n.y&&n.x>=n.z)?1.0:((n.y>=n.z)?2.0:3.0);
  vec2 q=((ax<1.5)?p.yz:((ax<2.5)?p.xz:p.xy))/amSpkCell;
  float w=length(fwidth(q));
  float fade=smoothstep(0.6,1.4,0.30/max(w,1e-6));
  if(fade<=0.0) return c;
  float t=0.0;
  for(int g=0;g<3;g++){
    vec2 qq=q+float(g)*vec2(0.5,0.37)+float(g/2)*vec2(-0.21,0.29);
    vec2 c0=floor(qq);
    for(int i=0;i<9;i++){
      vec2 ce=c0+vec2(float(i-3*(i/3))-1.0,float(i/3)-1.0);
      vec3 k=vec3(ce,ax+4.0*float(g));
      if(amH3(k)>0.9) continue;
      float r=0.30*(0.85+0.15*amH3(k+7.1));
      vec2 d=qq-ce-vec2(amH3(k+1.3),amH3(k+2.9));
      float th=6.2832*amH3(k+9.7); float cs=cos(th); float sn=sin(th);
      d=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y); d.y/=0.75+0.25*amH3(k+8.8);
      float dl=length(d);
      if(dl>1.7*r+w) continue;
      float a=atan(d.y,d.x);
      dl*=1.0+(0.15+0.1*amH3(k+5.1))*sin(2.0*a+6.2832*amH3(k+3.3))+0.08*amH3(k+6.2)*sin(3.0*a+6.2832*amH3(k+4.7))
            +0.05*amH3(k+8.4)*sin(5.0*a+6.2832*amH3(k+5.9));
      t+=((amH3(k+11.3)<0.5)?1.0:-1.0)*(1.0-smoothstep(r-w,r+w,dl));
    }
  }
  return c*(1.0+0.11*clamp(t,-1.0,1.0)*fade);
}
vec3 amSynthShade(vec3 wall, float isPatch, vec3 p, vec3 pn, float band){
    if(isPatch<0.5) return wall;
    vec3 n=(dot(pn,pn)>0.25)?pn:cross(dFdx(p),dFdy(p));
    float l=length(n);
    if(l<1e-12) return wall;
    n/=l;
    float d=abs(dot(n,vec3(0.426790,0.853580,0.298753)));
    vec3 c=wall*(0.5234+0.4766*d);
    float u=band/0.02; float w=fwidth(u); float fade=1.0-smoothstep(0.30,0.75,w);
    if(fade>0.0){ float tri=abs(fract(u)-0.5)*2.0; float lw=clamp(w*2.2,0.06,0.45);
      float ln=1.0-smoothstep(0.0,lw,tri); c*=1.0-0.28*ln*fade; }
    return amSpeckle(c,p);
  }
  `;

  // 374: a volume body's shell drawn as a built surface — its own shade, contours and corner lines.
  // The colour stays the material's (the layer's, or 391's gold when the volume is selected)
  function amSynthShell(o, P, nf, D0){
    const D=D0||amSynthDecor(P, nf);
    o.geometry.setAttribute('aPN',new THREE.BufferAttribute(D.pn,3));
    o.geometry.setAttribute('aBand',new THREE.BufferAttribute(D.band,1));
    const shM=o.material;
    shM.onBeforeCompile=sh=>{if(typeof AM_SPK_CELL!=='undefined') sh.uniforms.amSpkCell=AM_SPK_CELL;   // 413
      sh.vertexShader=sh.vertexShader
        .replace('#include <common>','#include <common>\nattribute vec3 aPN;attribute float aBand;varying vec3 vAPN;varying float vABand;varying vec3 vAPos;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvAPN=aPN;vABand=aBand;vAPos=transformed;');
      sh.fragmentShader=sh.fragmentShader
        .replace('#include <common>','#include <common>\nvarying vec3 vAPN;varying float vABand;varying vec3 vAPos;'+AM_SYNTH_GLSL)
        .replace('#include <opaque_fragment>','outgoingLight=amSynthShade(outgoingLight,1.0,vAPos,vAPN,vABand);\n#include <opaque_fragment>');
    };
    if(D.edges.length) o.add(amSynthEdges(D.edges));
    return o;
  }

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
// 335ב (Eli, 29/09 — option ג of the comparison): the mark colour is a CHOSEN hex, and the
// texture is decoded to linear before this runs; the colour went in undecoded, and came out
// paler than chosen. Decoded as the texture is, the law is unchanged and the tone is exact.
vec3 amLin(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 amStipple(vec3 wall, vec3 col, float a, float lvl){
  col=amLin(col);
  vec3 flatC=wall*mix(vec3(1.0),col,min(a*1.25,1.0));
  float f=clamp((a-0.7)/0.3,0.0,1.0);
  flatC=mix(flatC,col,f*f*0.5);
  if(lvl<=0.001||a<=0.001) return flatC;
  float t=amBayer(floor(gl_FragCoord.xy/3.0));
  vec3 dots=(a>t)?col:wall;
  return mix(flatC,dots,lvl);
}
// 257: a painted area has the wall under it in the SAME pixel, so its stipple can mix
// two colours. A polygon has nothing under it in its own draw call -- it is an overlay
// -- so its stipple works on COVERAGE: at the wheel's end the dot is the layer's own
// colour at full strength and the gap is the model itself, showing through. Same
// lattice, same law, and the mean alpha is unchanged, so the wheel does not add weight.
float amStippleA(float a, float lvl){
  if(lvl<=0.001) return a;
  float t=amBayer(floor(gl_FragCoord.xy/3.0));
  return mix(a,(a>t)?1.0:0.0,lvl);
}
// ---- the closure patch is shaded; the photograph is not (decision 166) ----
// No lights: the scan carries a PHOTOGRAPH that already holds the real lighting
// of the place, and lighting it would multiply that. Only the reconstructed
// patch is shaded, and its flat normal comes from screen derivatives of the
// position — the mechanism this viewer already uses in its no-texture mode.
// The coefficients are MEASURED against the training screen's real
// MeshLambertMaterial (Amb 0.60 + Dir 0.55), fitted in linear space, and
// normalised so the brightest face is exactly 1.0: a patch is never brighter
// than its own colour, only shaded away from the light. Ratio 1.91, training's.
vec3 amPatchShade(vec3 wall, float isPatch, vec3 p){
  if(isPatch<0.5) return wall;
  vec3 c=cross(dFdx(p),dFdy(p));
  float l=length(c);
  if(l<1e-12) return wall;          // a degenerate face keeps its colour, not a NaN
  float d=abs(dot(c/l,vec3(0.426790,0.853580,0.298753)));
  return wall*(0.5234+0.4766*d);
}

// 374: the built surface's own shade — a SMOOTH normal (from amSynthDecor) at the training's
// measured contrast, and the contours of 246/247 (2 cm from each surface's mean plane)
// 413 (Eli, 03/10, sample 9 of nine): fine blots of random shape, half a tone above the colour and
// half below, scattered at random over every built surface. In the model's own space, so they stay on
// it; the cell is a share of the model's diagonal (a cave and a sherd alike); a blot may lie across its
// cell's edge, so the cells round a point are asked too; gone where a blot would be under a pixel.
uniform float amSpkCell;
float amH3(vec3 c){ return fract(sin(dot(c,vec3(127.1,311.7,74.7)))*43758.5453); }
vec3 amSpeckle(vec3 c, vec3 p){
  if(amSpkCell<=0.0) return c;
  vec3 n=abs(cross(dFdx(p),dFdy(p)));
  float ax=(n.x>=n.y&&n.x>=n.z)?1.0:((n.y>=n.z)?2.0:3.0);
  vec2 q=((ax<1.5)?p.yz:((ax<2.5)?p.xz:p.xy))/amSpkCell;
  float w=length(fwidth(q));
  float fade=smoothstep(0.6,1.4,0.30/max(w,1e-6));
  if(fade<=0.0) return c;
  float t=0.0;
  for(int g=0;g<3;g++){
    vec2 qq=q+float(g)*vec2(0.5,0.37)+float(g/2)*vec2(-0.21,0.29);
    vec2 c0=floor(qq);
    for(int i=0;i<9;i++){
      vec2 ce=c0+vec2(float(i-3*(i/3))-1.0,float(i/3)-1.0);
      vec3 k=vec3(ce,ax+4.0*float(g));
      if(amH3(k)>0.9) continue;
      float r=0.30*(0.85+0.15*amH3(k+7.1));
      vec2 d=qq-ce-vec2(amH3(k+1.3),amH3(k+2.9));
      float th=6.2832*amH3(k+9.7); float cs=cos(th); float sn=sin(th);
      d=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y); d.y/=0.75+0.25*amH3(k+8.8);
      float dl=length(d);
      if(dl>1.7*r+w) continue;
      float a=atan(d.y,d.x);
      dl*=1.0+(0.15+0.1*amH3(k+5.1))*sin(2.0*a+6.2832*amH3(k+3.3))+0.08*amH3(k+6.2)*sin(3.0*a+6.2832*amH3(k+4.7))
            +0.05*amH3(k+8.4)*sin(5.0*a+6.2832*amH3(k+5.9));
      t+=((amH3(k+11.3)<0.5)?1.0:-1.0)*(1.0-smoothstep(r-w,r+w,dl));
    }
  }
  return c*(1.0+0.11*clamp(t,-1.0,1.0)*fade);
}
vec3 amSynthShade(vec3 wall, float isPatch, vec3 p, vec3 pn, float band){
  if(isPatch<0.5) return wall;
  vec3 n=(dot(pn,pn)>0.25)?pn:cross(dFdx(p),dFdy(p));
  float l=length(n);
  if(l<1e-12) return wall;
  n/=l;
  float d=abs(dot(n,vec3(0.426790,0.853580,0.298753)));
  vec3 c=wall*(0.5234+0.4766*d);
  float u=band/0.02; float w=fwidth(u); float fade=1.0-smoothstep(0.30,0.75,w);
  if(fade>0.0){ float tri=abs(fract(u)-0.5)*2.0; float lw=clamp(w*2.2,0.06,0.45);
    float ln=1.0-smoothstep(0.0,lw,tri); c*=1.0-0.28*ln*fade; }
  return amSpeckle(c,p);
}
`;

  // Regular dodecahedron, from the marker the user designed (13/08). 20 vertices all at
  // radius exactly 1, 12 pentagons as 36 triangles, un-indexed so each facet corner
  // carries its own UV; every facet maps onto the SAME pentagon in texture space, so one
  // small canvas puts the number on all twelve faces and it reads from any angle.
  const AM_DODE_POS=new Float32Array([0.57735,0.57735,-0.57735,0.35682,0.93417,0,0.57735,0.57735,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.93417,0,0.35682,0.57735,0.57735,-0.57735,0.93417,0,0.35682,0.93417,0,-0.35682,0.57735,-0.57735,0.57735,0.93417,0,0.35682,0.57735,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.57735,0,0.35682,0.93417,0.57735,-0.57735,0.57735,0,0.35682,0.93417,0,-0.35682,0.93417,-0.57735,0.57735,0.57735,0,0.35682,0.93417,0.57735,0.57735,0.57735,-0.57735,0.57735,0.57735,0.57735,0.57735,0.57735,0.35682,0.93417,0,-0.57735,0.57735,0.57735,0.35682,0.93417,0,-0.35682,0.93417,0,0,-0.35682,-0.93417,0,0.35682,-0.93417,0.57735,0.57735,-0.57735,0,-0.35682,-0.93417,0.57735,0.57735,-0.57735,0.93417,0,-0.35682,0,-0.35682,-0.93417,0.93417,0,-0.35682,0.57735,-0.57735,-0.57735,-0.35682,0.93417,0,0.35682,0.93417,0,0.57735,0.57735,-0.57735,-0.35682,0.93417,0,0.57735,0.57735,-0.57735,0,0.35682,-0.93417,-0.35682,0.93417,0,0,0.35682,-0.93417,-0.57735,0.57735,-0.57735,0.93417,0,-0.35682,0.93417,0,0.35682,0.57735,-0.57735,0.57735,0.93417,0,-0.35682,0.57735,-0.57735,0.57735,0.35682,-0.93417,0,0.93417,0,-0.35682,0.35682,-0.93417,0,0.57735,-0.57735,-0.57735,-0.35682,-0.93417,0,0.35682,-0.93417,0,0.57735,-0.57735,0.57735,-0.35682,-0.93417,0,0.57735,-0.57735,0.57735,0,-0.35682,0.93417,-0.35682,-0.93417,0,0,-0.35682,0.93417,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,0,-0.35682,-0.93417,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,0.35682,-0.93417,0,-0.57735,-0.57735,-0.57735,0.35682,-0.93417,0,-0.35682,-0.93417,0,-0.93417,0,-0.35682,-0.93417,0,0.35682,-0.57735,0.57735,0.57735,-0.93417,0,-0.35682,-0.57735,0.57735,0.57735,-0.35682,0.93417,0,-0.93417,0,-0.35682,-0.35682,0.93417,0,-0.57735,0.57735,-0.57735,0,-0.35682,0.93417,0,0.35682,0.93417,-0.57735,0.57735,0.57735,0,-0.35682,0.93417,-0.57735,0.57735,0.57735,-0.93417,0,0.35682,0,-0.35682,0.93417,-0.93417,0,0.35682,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.93417,0,-0.35682,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.57735,0,0.35682,-0.93417,-0.57735,-0.57735,-0.57735,0,0.35682,-0.93417,0,-0.35682,-0.93417,-0.57735,-0.57735,-0.57735,-0.35682,-0.93417,0,-0.57735,-0.57735,0.57735,-0.57735,-0.57735,-0.57735,-0.57735,-0.57735,0.57735,-0.93417,0,0.35682,-0.57735,-0.57735,-0.57735,-0.93417,0,0.35682,-0.93417,0,-0.35682]);
  const AM_DODE_UV=new Float32Array([0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094,0.5,0.05,0.92798,0.36094,0.7645,0.86406,0.5,0.05,0.7645,0.86406,0.2355,0.86406,0.5,0.05,0.2355,0.86406,0.07202,0.36094]);
  // 26/09, Eli: "the numbers on the counters come out upside down relative to the model".
  // Every facet mapped the pentagon the same way, so the digit's top pointed wherever that
  // facet's first corner happened to point. Each facet now takes the one of the pentagon's
  // five turns whose top corner points most nearly UP (+Y, the model's up in every screen) —
  // within 36 degrees. A facet facing straight up or down keeps its turn: no side is up there.
  function amDodeUpright(){
    if(amDodeUpright.cache) return amDodeUpright.cache;
    const P=AM_DODE_POS, U=AM_DODE_UV, out=U.slice();
    const key=(u,v)=>Math.round(u*1000)+','+Math.round(v*1000);
    // the pentagon's five corners, in UV order, taken from the first facet's three triangles
    const corners=[]; const seen=new Set();
    for(let k=0;k<9;k++){ const kk=key(U[k*2],U[k*2+1]); if(!seen.has(kk)){seen.add(kk); corners.push([U[k*2],U[k*2+1]]);} }
    // order them around the centre, starting at the top one (smallest v)
    const cu=corners.reduce((a,c)=>a+c[0],0)/corners.length, cv=corners.reduce((a,c)=>a+c[1],0)/corners.length;
    corners.sort((a,b)=>Math.atan2(a[1]-cv,a[0]-cu)-Math.atan2(b[1]-cv,b[0]-cu));
    let top=0; for(let j=1;j<corners.length;j++) if(corners[j][1]<corners[top][1]) top=j;
    const C=[]; for(let j=0;j<corners.length;j++) C.push(corners[(top+j)%corners.length]);
    const idxOf=(u,v)=>{ for(let j=0;j<C.length;j++) if(Math.abs(C[j][0]-u)<1e-4&&Math.abs(C[j][1]-v)<1e-4) return j; return -1; };
    const nF=P.length/27;                     // 12 facets, 3 triangles, 3 corners
    for(let f=0;f<nF;f++){
      const o=f*9;
      // the facet's centre and normal, and each pentagon corner's 3-D position
      let cx=0,cy=0,cz=0; for(let k=0;k<9;k++){cx+=P[(o+k)*3];cy+=P[(o+k)*3+1];cz+=P[(o+k)*3+2];} cx/=9;cy/=9;cz/=9;
      const pos=new Array(C.length);
      for(let k=0;k<9;k++){ const j=idxOf(U[(o+k)*2],U[(o+k)*2+1]); if(j>=0) pos[j]=[P[(o+k)*3],P[(o+k)*3+1],P[(o+k)*3+2]]; }
      const a=[P[o*3],P[o*3+1],P[o*3+2]], b=[P[(o+1)*3],P[(o+1)*3+1],P[(o+1)*3+2]], c=[P[(o+2)*3],P[(o+2)*3+1],P[(o+2)*3+2]];
      let nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]), ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]), nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      const nl=Math.hypot(nx,ny,nz)||1; nx/=nl;ny/=nl;nz/=nl;
      // up, laid into the facet's plane
      let ux=-ny*nx, uy=1-ny*ny, uz=-ny*nz; const ul=Math.hypot(ux,uy,uz);
      if(ul<0.2||pos.some(p=>!p)) continue;
      ux/=ul;uy/=ul;uz/=ul;
      let best=0,bd=-2;
      for(let j=0;j<C.length;j++){ const d=[pos[j][0]-cx,pos[j][1]-cy,pos[j][2]-cz], dl=Math.hypot(d[0],d[1],d[2])||1;
        const s=(d[0]*ux+d[1]*uy+d[2]*uz)/dl; if(s>bd){bd=s;best=j;} }
      // corner `best` takes the top of the pentagon; the others follow round in the same sense
      for(let k=0;k<9;k++){ const j=idxOf(U[(o+k)*2],U[(o+k)*2+1]); if(j<0) continue;
        const t=C[(j-best+C.length)%C.length]; out[(o+k)*2]=t[0]; out[(o+k)*2+1]=t[1]; }
    }
    amDodeUpright.cache=out; return out;
  }
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
      g.setAttribute('uv',new THREE.BufferAttribute(amDodeUpright().slice(),2));
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
  // 265: the model's transparency. The SAME behaviour as the measurement screen's veteran
  // wheel (mdlop, 02/09): the slider IS the opacity, 100% is opaque, and everything the
  // mesh draws fades together — the photograph, the marks and the closure patches alike.
  // Eli, 18/09: "leave the veteran as it is, delete the duplicate, and check that all the
  // transparency wheels behave the same way — I do not want different behaviour in each
  // screen." Below 100 the material turns transparent; at 100 it goes back to opaque,
  // because a transparent material sorts per object and would cost for nothing.
  function amApplyClear(pct){
    const v=Math.max(0,Math.min(1,pct/100));                 // 495: 0–100
    const ms=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    for(const m of ms){ m.transparent=(v<0.999); m.opacity=v;
                        m.depthWrite=(v>=0.999); m.needsUpdate=true; }
    if(amMarkMat){ amMarkMat.transparent=(v<0.999); amMarkMat.opacity=v; amMarkMat.depthWrite=(v>=0.999); amMarkMat.needsUpdate=true; }
    if(amEdges) amEdges.material.opacity=AM_EDGE_ALPHA*v;       // 374
  }
mat.onBeforeCompile=sh=>{
    sh.uniforms.amDesign=amDesignU;
    if(typeof AM_SPK_CELL!=='undefined') sh.uniforms.amSpkCell=AM_SPK_CELL;   // 413
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nattribute vec3 aCol;attribute float aFlat;attribute float aDes;attribute float aPatch;attribute vec3 aPN;attribute float aBand;varying vec3 vACol;varying float vAFlat;varying float vADes;varying float vAPatch;varying vec3 vAPos;varying vec3 vAPN;varying float vABand;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvACol=aCol;vAFlat=aFlat;vADes=aDes;vAPatch=aPatch;vAPos=transformed;vAPN=aPN;vABand=aBand;');
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>','#include <common>\nvarying vec3 vACol;varying float vAFlat;varying float vADes;varying float vAPatch;varying vec3 vAPos;varying vec3 vAPN;varying float vABand;uniform float amDesign;'+AM_SHADER_FN)
      .replace('#include <opaque_fragment>','outgoingLight=amStipple(amSynthShade(outgoingLight,vAPatch,vAPos,vAPN,vABand),vACol,vAFlat,vADes);\n#include <opaque_fragment>');
  };
  const mesh=new THREE.Mesh(geo,mat); scene.add(mesh);
  if(!geo.boundingSphere) geo.computeBoundingSphere(); AM_SPK_CELL.value=2*geo.boundingSphere.radius/400;   // 413
  const amEdges=(AM_SYN&&AM_SYN.edges.length)?amSynthEdges(AM_SYN.edges):null;   // 374
  if(amEdges) scene.add(amEdges);

  /* ---- state ---- */
  let brushR=0.10, mode='nav', amKeepMode='nav';   // 421: the mode "ניווט" was pressed over
  const roi=new Uint8Array(N); let roiCount=0;
  const AM_PROB_ARMED_ONLY=true;    // 349: the baked field stays dormant until a training or a loaded sheet arms it (hasProb) — read by the shared isType/amStartOf
  const AM_UNDO_WORD='בכפתור הביטול', AM_TAP_WORD='נגיעה';   // 349: the words the shared layer-bar texts say (amLayerDelete, amDelX, amEye) — a finger and no keyboard here
  if(roi0) for(let f=0;f<N;f++){ if(roi0[FACEOF[f]]){roi[f]=1;roiCount++;} }
  /* marking TYPES (decision 58) — field-for-field the desktop model: every colour is
     a category with its own marks, threshold and probability field; overlap allowed,
     areas per type over the FULL marking, stripes are display only. On the iPad the
     baked probability field stays dormant until a training or a loaded sheet arms it
     (hasProb) — same as the single-type version always behaved. */
  const types=[]; let activeT=0, tSeq=0;
  let activeKind='area';               // area layers XOR length layers (user round 11/08); 'none' (357): no layer open
  const hex2rgb=h=>[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];
  // 10 (24/09): an area layer holds brush marks AND polygons; the side bar picks the tool,
  // as in the measurement screen. `T.am` stays as the tool last used on the layer.
  const AM_BRUSH='brush', AM_POLY='poly';
  let areaTool=AM_BRUSH;
  function mkType(name,hex){const T={id:'t'+(tSeq++),name:name,hex:hex,color:hex2rgb(hex),
    manual:new Int8Array(N),faceThr:null,thr:0.50,prob:null,hasProb:false,op:0.75,design:0.6,
    designU:{value:0.6},area:0,
    am:AM_BRUSH};
    types.push(T);return T;}
  const T0=mkType('שטח 1','#38b000'); T0.prob=prob;
  // 357: opens with no layer open, as the measurement screen does; the first area layer
  // is PARKED while it holds nothing — off the bar and off the sheet's report part, and the
  // first "＋ מדידת שטח" takes it. Layers are named "שטח N" (360).
  function amAreaFilled(ti){const T=types[ti];
    if(polys.some(P=>P.at===T.id)||(typeof SMR!=='undefined'&&SMR.some(r=>r.at===T.id))) return true;
    for(let f=0;f<N;f++) if(T.manual[f]!==0||isType(ti,f)) return true;
    return false;}
  function amParkIdle(){                   // on opening and on every sheet: nothing open
    for(const T of types) T.park=false;
    if(types.length&&!amAreaFilled(0)) types[0].park=true;
    activeKind='none';
  }
  function amKindLeft(){ return types.some(T=>!T.park)?'area':'none'; }
  function amAreaName(){                   // the next free "שטח N"
    let n=0; for(const T of types){const m=/^שטח (\d+)$/.exec(T.name||''); if(m&&!T.park) n=Math.max(n,+m[1]);}
    return 'שטח '+(n+1);}
  const effThr=(ti,f)=>{const T=types[ti];const t=T.faceThr?T.faceThr[f]:NaN;return isNaN(t)?T.thr:t;};
  function isType(ti,f){const T=types[ti],m=T.manual[f]; if(m===1)return true; if(m===-1)return false;
    if(!T.prob) return false;                 // an unlearned extra type is manual-only
    if(AM_PROB_ARMED_ONLY&&!T.hasProb) return false;   // 349: the iPad keeps the baked field dormant until a training or a sheet arms it
    // No orange zone at all used to mean "the whole model is a candidate", and the model
    // came up looking marked everywhere. It now means the opposite — nothing is a candidate
    // and the automatic detection does not run at all (user decision 13/08, finding 2).
    // Manual marks are unaffected: they return above, before this line.
    if(!roi[f]) return false;                 // outside orange zone: assume no repair
    return T.prob[f]>effThr(ti,f);}
  function isRepair(f){for(let ti=0;ti<types.length;ti++)if(isType(ti,f))return true;return false;}
  const ROIC=[1.000,0.667,0.000];
  const _vis=[];
  /* ---- 324: THE SMOOTH MARK ----------------------------------------------------------------
     Eli, 27/09: "now the brush is approved — all the brushes in the program will become like
     this." The area brush now marks as the crop brush cuts since 314-319. The marking by
     sub-faces stays exactly what it was — the automatic detection, the grow, the sub-faces a
     stroke reaches — and each stroke also keeps its BALLS, in its layer. A sub-face the line
     crosses is cut along it, drawn by the part of it that is marked, and COUNTS by that part.
     Every sub-face starts as the automatic detection has it, and the strokes and the grows act
     on it in their order — so the eraser cuts a smooth line into a detected area too, and a
     grow after an erasure fills again what it grows over. The engine below is generated from
     the training screen's (ccPlan and its helpers, with a sub-face's own start and the
     'faces' ops added); the same text runs in the iPad. */
  const CC_SNAP=1e-4, CC_FOLD=0.08, CC_ITERS=24;
  const CC_BIG=1e3;                 // a sub-face wholly inside, or wholly outside, before any stroke
  const CC_GRID=new WeakMap();
  const ccCellKey=(i,j,k)=>(i*73856093)^(j*19349663)^(k*83492791);
  function ccGrid(op){
    let g=CC_GRID.get(op); if(g&&g.n===op.c.length) return g;
    const cs=Math.max(2*op.r,1e-6), m=new Map(), c=op.c;
    const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i+2<c.length;i+=3){
      for(let k=0;k<3;k++){ if(c[i+k]<lo[k])lo[k]=c[i+k]; if(c[i+k]>hi[k])hi[k]=c[i+k]; }
      const k=ccCellKey(Math.floor(c[i]/cs),Math.floor(c[i+1]/cs),Math.floor(c[i+2]/cs));
      let a=m.get(k); if(!a){a=[];m.set(k,a);} a.push(i); }
    const pad=2*op.r;
    g={cs:cs,m:m,n:c.length,lo:[lo[0]-pad,lo[1]-pad,lo[2]-pad],hi:[hi[0]+pad,hi[1]+pad,hi[2]+pad]};
    CC_GRID.set(op,g); return g;
  }
  function ccOpField(op,x,y,z){
    if(op.t==='balls'){ const c=op.c; let m=Infinity;
      if(c.length>60){ const g=ccGrid(op);
        // the key collides now and then: every dab it returns is measured, so a collision
        // only adds a candidate, never loses one
        if(x<g.lo[0]||x>g.hi[0]||y<g.lo[1]||y>g.hi[1]||z<g.lo[2]||z>g.hi[2]) return op.r;
        const ix=Math.floor(x/g.cs), iy=Math.floor(y/g.cs), iz=Math.floor(z/g.cs);
        for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++) for(let d=-1;d<=1;d++){
          const L=g.m.get(ccCellKey(ix+a,iy+b,iz+d)); if(!L) continue;
          for(const i of L){const dx=x-c[i],dy=y-c[i+1],dz=z-c[i+2];const q=dx*dx+dy*dy+dz*dz;if(q<m)m=q;} }
        if(m===Infinity) return op.r;          // farther than 2r: outside, by more than r
        return Math.sqrt(m)-op.r; }
      for(let i=0;i+2<c.length;i+=3){const dx=x-c[i],dy=y-c[i+1],dz=z-c[i+2];const d=dx*dx+dy*dy+dz*dz;if(d<m)m=d;}
      return Math.sqrt(m)-op.r; }
    if(op.t==='box'){ const [qx,qy,qz,qw]=op.q, c=op.c, h=op.h;
      const R=[[1-2*(qy*qy+qz*qz),2*(qx*qy-qz*qw),2*(qx*qz+qy*qw)],
               [2*(qx*qy+qz*qw),1-2*(qx*qx+qz*qz),2*(qy*qz-qx*qw)],
               [2*(qx*qz-qy*qw),2*(qy*qz+qx*qw),1-2*(qx*qx+qy*qy)]];
      const d=[x-c[0],y-c[1],z-c[2]]; let m=-Infinity;
      for(let j=0;j<3;j++){ const v=d[0]*R[0][j]+d[1]*R[1][j]+d[2]*R[2][j]; const e=Math.abs(v)-h[j]; if(e>m)m=e; }
      return m; }
    if(op.t==='poly') return amPolyField(op,x,y,z);       // 470: the crop polygon, flat or deep
    return Infinity;
  }
  function amPolyField(op,x,y,z){
    // the op's field, negative inside: the signed distance to the outline in the frame (u,v) —
    // DEEP, as it is (a prism along n); FLAT, the larger of that and the distance from the plane
    // beyond the band. Every step in crop_clip.op_field's order, so the two agree to the bit.
    // 479: a polygon drawn on the screen of a locked view ('proj') has its own (amPolyProjField)
    if(op.m==='proj') return amPolyProjField(op,x,y,z);
    let Q=op._q;
    if(!Q){ const p=op.p, c=op.c, u=op.u, v=op.v, m=(p.length/3)|0; Q=new Float64Array(2*m);
      for(let i=0;i<m;i++){ const dx=p[i*3]-c[0], dy=p[i*3+1]-c[1], dz=p[i*3+2]-c[2];
        Q[2*i]=dx*u[0]+dy*u[1]+dz*u[2]; Q[2*i+1]=dx*v[0]+dy*v[1]+dz*v[2]; }
      Object.defineProperty(op,'_q',{value:Q}); }              // not enumerable: never sent to the server
    const c=op.c, u=op.u, v=op.v, dx=x-c[0], dy=y-c[1], dz=z-c[2];
    const qx=dx*u[0]+dy*u[1]+dz*u[2], qy=dx*v[0]+dy*v[1]+dz*v[2], m=Q.length>>1;
    let d2=Infinity, ins=false;
    for(let i=0,j=m-1;i<m;j=i++){ const ax=Q[2*j], ay=Q[2*j+1], bx=Q[2*i], by=Q[2*i+1];
      const ex=bx-ax, ey=by-ay, wx=qx-ax, wy=qy-ay, L=ex*ex+ey*ey;
      let t=L>0?(wx*ex+wy*ey)/L:0; t=t<0?0:(t>1?1:t);
      const px=wx-t*ex, py=wy-t*ey, e=px*px+py*py; if(e<d2) d2=e;
      if(((ay>qy)!==(by>qy))&&(qx<ax+(qy-ay)*ex/ey)) ins=!ins; }
    const d=Math.sqrt(d2); let f=ins?-d:d;
    if(op.m!=='deep'){ const n=op.n, w=dx*n[0]+dy*n[1]+dz*n[2]; f=Math.max(f,Math.abs(w)-op.b); }
    return f;
  }
  // 479: the field of a 'proj' op — negative inside the funnel. Its sign is the projection's own (in front of the eye and
  // inside the outline by M, as amPolyInProj); its size the true distance to the funnel's surface — to the nearest of
  // its sides (the plane through the eye and two neighbouring rays, within the wedge between them) or of its edges (a
  // ray from the eye) — so it is a distance in metres like every other shape's field, which the cut's tests of the line's
  // reach read. The twin of crop_clip.proj_field step by step, so the two agree to the bit
  function amPolyProjField(op,x,y,z){
    const M=op.M, Q=op.q, m=Q.length>>1, e=op.e, R=op.r;
    const cw=M[3]*x+M[7]*y+M[11]*z+M[15];
    let ins=false;
    if(cw>0){ const qx=(M[0]*x+M[4]*y+M[8]*z+M[12])/cw, qy=(M[1]*x+M[5]*y+M[9]*z+M[13])/cw;
      for(let i=0,j=m-1;i<m;j=i++){ const ax=Q[2*j], ay=Q[2*j+1], bx=Q[2*i], by=Q[2*i+1], ex=bx-ax, ey=by-ay;
        if(((ay>qy)!==(by>qy))&&(qx<ax+(qy-ay)*ex/ey)) ins=!ins; } }
    const Yx=x-e[0], Yy=y-e[1], Yz=z-e[2]; let d2=Infinity;
    for(let i=0,j=m-1;i<m;j=i++){
      const ax=R[3*j], ay=R[3*j+1], az=R[3*j+2], bx=R[3*i], by=R[3*i+1], bz=R[3*i+2];
      let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx; const nl=Math.sqrt(nx*nx+ny*ny+nz*nz);
      if(nl>1e-12){ nx=nx/nl; ny=ny/nl; nz=nz/nl;
        const s=Yx*nx+Yy*ny+Yz*nz, Px=Yx-s*nx, Py=Yy-s*ny, Pz=Yz-s*nz;
        const c1=(ay*Pz-az*Py)*nx+(az*Px-ax*Pz)*ny+(ax*Py-ay*Px)*nz, c2=(Py*bz-Pz*by)*nx+(Pz*bx-Px*bz)*ny+(Px*by-Py*bx)*nz;
        if(c1>=0&&c2>=0){ const s2=s*s; if(s2<d2) d2=s2; } }
      let t=Yx*bx+Yy*by+Yz*bz; if(t<0) t=0;
      const px=Yx-t*bx, py=Yy-t*by, pz=Yz-t*bz, g=px*px+py*py+pz*pz; if(g<d2) d2=g;
    }
    const d=Math.sqrt(d2);
    return ins?-d:d;
  }
  function ccIndex(ops){
    let rmax=0, farPos=Infinity, n=0;
    for(const op of ops){ if(op.t==='faces') continue; if(op.t!=='balls') return null;
      if(op.c.length){ rmax=Math.max(rmax,op.r); if(op.s>=0) farPos=Math.min(farPos,op.r); } n+=(op.c.length/3)|0; }
    const cs=Math.max(2*rmax,1e-6);
    let size=16; while(size<4*n) size*=2; const mask=size-1;
    const KI=new Int32Array(size), KJ=new Int32Array(size), KK=new Int32Array(size), used=new Uint8Array(size), cnt=new Int32Array(size);
    const slotOf=new Int32Array(n), dOp=new Int32Array(n), dI=new Int32Array(n); let q=0;
    ops.forEach((op,k)=>{ if(op.t!=='balls') return; const c=op.c;
      for(let i=0;i+2<c.length;i+=3){ const a=Math.floor(c[i]/cs), b=Math.floor(c[i+1]/cs), d=Math.floor(c[i+2]/cs);
        let h=(Math.imul(a,73856093)^Math.imul(b,19349663)^Math.imul(d,83492791))&mask;
        while(used[h]&&!(KI[h]===a&&KJ[h]===b&&KK[h]===d)) h=(h+1)&mask;
        if(!used[h]){used[h]=1;KI[h]=a;KJ[h]=b;KK[h]=d;}
        cnt[h]++; slotOf[q]=h; dOp[q]=k; dI[q]=i; q++; } });
    const start=new Int32Array(size+1); for(let h=0;h<size;h++) start[h+1]=start[h]+cnt[h];
    const fill=start.slice(0,size), EO=new Int32Array(n), EI=new Int32Array(n);
    for(let t=0;t<q;t++){ const h=slotOf[t], w=fill[h]++; EO[w]=dOp[t]; EI[w]=dI[t]; }
    const fops=[]; ops.forEach((op,k)=>{ if(op.t==='faces') fops.push(k); });
    return {fops:fops, cs:cs, mask:mask, KI:KI, KJ:KJ, KK:KK, used:used, start:start, EO:EO, EI:EI, farPos:farPos, stamp:0,
            seen:new Int32Array(ops.length), best:new Float64Array(ops.length), touch:new Int32Array(ops.length)};
  }
  function ccFieldIx(ix,ops,x,y,z,en){
    const cs=ix.cs, ix0=Math.floor(x/cs), iy0=Math.floor(y/cs), iz0=Math.floor(z/cs);
    const st=++ix.stamp, S=ix.seen, B=ix.best, T=ix.touch, mask=ix.mask, KI=ix.KI, KJ=ix.KJ, KK=ix.KK,
          U=ix.used, ST=ix.start, EO=ix.EO, EI=ix.EI; let nt=0;
    for(let a=ix0-1;a<=ix0+1;a++){ const ha=Math.imul(a,73856093);
      for(let b=iy0-1;b<=iy0+1;b++){ const hb=ha^Math.imul(b,19349663);
        for(let d=iz0-1;d<=iz0+1;d++){
          let h=(hb^Math.imul(d,83492791))&mask;
          while(U[h]&&!(KI[h]===a&&KJ[h]===b&&KK[h]===d)) h=(h+1)&mask;
          if(!U[h]) continue;
          for(let w=ST[h],we=ST[h+1];w<we;w++){ const k=EO[w], i=EI[w], c=ops[k].c;
            const dx=x-c[i],dy=y-c[i+1],dz=z-c[i+2], d2=dx*dx+dy*dy+dz*dz;
            if(S[k]!==st){S[k]=st;B[k]=d2;T[nt++]=k;} else if(d2<B[k]) B[k]=d2; } } } }
    for(let i=1;i<nt;i++){ const v=T[i]; let j=i-1; while(j>=0&&T[j]>v){T[j+1]=T[j];j--;} T[j+1]=v; }
    // the sub-face's own start, and the face-level acts in their place among the strokes
    let f=(en&&en.st)?(en.st(en.cur)?-CC_BIG:CC_BIG):Infinity;
    const FO=ix.fops; let fi=0;
    for(let q=0;q<=nt;q++){ const kb=(q<nt)?T[q]:Infinity;
      while(fi<FO.length&&FO[fi]<kb){ const v=ops[FO[fi]].m.get(en?en.cur:-1); if(v!==undefined) f=(v>0)?-CC_BIG:CC_BIG; fi++; }
      if(q===nt) break;
      const op=ops[T[q]], r=op.r, d2=B[T[q]];
      const g=(d2>4*r*r)?r:Math.sqrt(d2)-r; f=(op.s>=0)?Math.min(f,g):Math.max(f,-g); }
    return f===Infinity?ix.farPos:f;
  }
  function ccField(en,x,y,z){
    if(en._ix){ const f=ccFieldIx(en._ix,en.ops,x,y,z,en); return en.inv?-f:f; }
    let f=en.st?(en.st(en.cur)?-CC_BIG:CC_BIG):Infinity;
    for(const op of en.ops){ if(op.t==='faces'){ const v=op.m.get(en.cur); if(v!==undefined) f=(v>0)?-CC_BIG:CC_BIG; continue; }
      const g=ccOpField(op,x,y,z); f=(op.s>=0)?Math.min(f,g):Math.max(f,-g); }
    return en.inv?-f:f; }
  function ccBBox(en){ const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    for(const op of en.ops){
      if(op.t==='balls'){ for(let i=0;i+2<op.c.length;i+=3) for(let k=0;k<3;k++){
          lo[k]=Math.min(lo[k],op.c[i+k]-op.r); hi[k]=Math.max(hi[k],op.c[i+k]+op.r);} }
      else if(op.t==='box'){ const rad=Math.hypot(op.h[0],op.h[1],op.h[2]);
        for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],op.c[k]-rad); hi[k]=Math.max(hi[k],op.c[k]+rad);} }
      // 470: a flat polygon reaches its points and twice its band around them (a point of the plane
      // inside the outline is within the band of a point of it); a deep one runs through the model
      // 479: a polygon on the screen of a locked view ('proj') — the funnel from the eye — is as unbounded
      else if(op.t==='poly'){ if(op.m==='deep'||op.m==='proj') return [[-Infinity,-Infinity,-Infinity],[Infinity,Infinity,Infinity]];
        for(let i=0;i+2<op.p.length;i+=3) for(let k=0;k<3;k++){
          lo[k]=Math.min(lo[k],op.p[i+k]-2*op.b); hi[k]=Math.max(hi[k],op.p[i+k]+2*op.b);} } }
    return [lo,hi]; }
  function ccEdgeZero(Pi,Pj,fi,fj,en){
    const less=(a,b)=>a[0]!==b[0]?a[0]<b[0]:(a[1]!==b[1]?a[1]<b[1]:a[2]<b[2]);
    const swap=less(Pj,Pi);
    if(swap){ const t=Pi;Pi=Pj;Pj=t; const u=fi;fi=fj;fj=u; }
    let lo=0,hi=1,flo=fi;
    for(let k=0;k<CC_ITERS;k++){ const mid=0.5*(lo+hi);
      const fm=ccField(en,Pi[0]+mid*(Pj[0]-Pi[0]),Pi[1]+mid*(Pj[1]-Pi[1]),Pi[2]+mid*(Pj[2]-Pi[2]));
      if((fm>0)===(flo>0)){lo=mid;flo=fm;} else hi=mid; }
    const t=0.5*(lo+hi); return swap?1-t:t; }
  const CC_EDGE_MIN=8, CC_EDGE_STEP=0.01, CC_EDGE_MAX=64, CC_ARC_TOL=0.0015, CC_ARC_DEPTH=4;
  function ccLess(a,b){return a[0]!==b[0]?a[0]<b[0]:(a[1]!==b[1]?a[1]<b[1]:a[2]<b[2]);}
  function ccLerp(a,b,t){return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}
  function ccZeroRaw(A,B,fa,en){ let lo=0,hi=1,flo=fa;
    for(let k=0;k<CC_ITERS;k++){ const m=0.5*(lo+hi); const q=ccLerp(A,B,m); const fm=ccField(en,q[0],q[1],q[2]);
      if((fm>0)===(flo>0)){lo=m;flo=fm;} else hi=m; }
    return 0.5*(lo+hi); }
  function ccEdgeCrossings(Pi,Pj,fi,fj,en){
    const swap=ccLess(Pj,Pi); const A=swap?Pj:Pi, B=swap?Pi:Pj, fa=swap?fj:fi, fb=swap?fi:fj;
    const L=Math.hypot(B[0]-A[0],B[1]-A[1],B[2]-A[2]);
    const n=Math.min(CC_EDGE_MAX,Math.max(CC_EDGE_MIN,Math.ceil(L/CC_EDGE_STEP)));
    const ts=[], fs=[]; for(let k=0;k<=n;k++) ts.push(k/n);
    // numpy's linspace: the same probe points to the last bit where it matters
    for(let k=0;k<=n;k++){ if(k===0) fs.push(fa); else if(k===n) fs.push(fb);
      else { const q=[A[0]+ts[k]*(B[0]-A[0]),A[1]+ts[k]*(B[1]-A[1]),A[2]+ts[k]*(B[2]-A[2])]; fs.push(ccField(en,q[0],q[1],q[2])); } }
    const out=[];
    for(let k=0;k<n;k++) if((fs[k]>0)!==(fs[k+1]>0)){
      const a0=[A[0]+ts[k]*(B[0]-A[0]),A[1]+ts[k]*(B[1]-A[1]),A[2]+ts[k]*(B[2]-A[2])];
      const b0=[A[0]+ts[k+1]*(B[0]-A[0]),A[1]+ts[k+1]*(B[1]-A[1]),A[2]+ts[k+1]*(B[2]-A[2])];
      const u=ccZeroRaw(a0,b0,fs[k],en); out.push(ts[k]+u*(ts[k+1]-ts[k])); }
    return (swap?out.map(t=>1-t):out).sort((a,b)=>a-b); }
  function ccBary(P,Q){ const e1=[P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]], e2=[P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]], w=[Q[0]-P[0][0],Q[1]-P[0][1],Q[2]-P[0][2]];
    const a11=e1[0]*e1[0]+e1[1]*e1[1]+e1[2]*e1[2], a12=e1[0]*e2[0]+e1[1]*e2[1]+e1[2]*e2[2], a22=e2[0]*e2[0]+e2[1]*e2[1]+e2[2]*e2[2];
    const b1=w[0]*e1[0]+w[1]*e1[1]+w[2]*e1[2], b2=w[0]*e2[0]+w[1]*e2[1]+w[2]*e2[2], det=a11*a22-a12*a12;
    if(Math.abs(det)<1e-30) return null; const u=(b1*a22-b2*a12)/det, v=(a11*b2-a12*b1)/det; return [1-u-v,u,v]; }
  function ccArc(Qa,Ba,Qb,Bb,P,B,fv,en,depth){
    if(depth<=0) return [];
    const S3=[0.25,0.5,0.75]; let w=0, fm=0, best=-1;
    const Qs=S3.map(t=>ccLerp(Qa,Qb,t));
    for(let k=0;k<3;k++){ const f=ccField(en,Qs[k][0],Qs[k][1],Qs[k][2]); if(Math.abs(f)>best){best=Math.abs(f);w=k;fm=f;} }
    if(Math.abs(fm)<=CC_ARC_TOL) return [];
    const Qm=Qs[w], Bm=ccLerp(Ba,Bb,S3[w]);
    const d=[Qb[0]-Qa[0],Qb[1]-Qa[1],Qb[2]-Qa[2]];
    const e1=[P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]], e2=[P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]];
    const nr=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
    let u=[nr[1]*d[2]-nr[2]*d[1],nr[2]*d[0]-nr[0]*d[2],nr[0]*d[1]-nr[1]*d[0]];
    const ul=Math.hypot(u[0],u[1],u[2]); if(ul<1e-18) return []; u=[u[0]/ul,u[1]/ul,u[2]/ul];
    const lm=ccBary(P,Qm), l1=ccBary(P,[Qm[0]+u[0],Qm[1]+u[1],Qm[2]+u[2]]); if(!lm||!l1) return [];
    const dl=[l1[0]-lm[0],l1[1]-lm[1],l1[2]-lm[2]];
    let bestZ=null, bestS=Infinity;
    for(const sg of [1,-1]){
      let smax=Infinity; for(let i=0;i<3;i++){ const r=sg*dl[i]; if(r<-1e-15) smax=Math.min(smax,-lm[i]/r); }
      if(!(smax>1e-12)||smax===Infinity) continue;
      const E=[Qm[0]+sg*smax*u[0],Qm[1]+sg*smax*u[1],Qm[2]+sg*smax*u[2]];
      const fE=ccField(en,E[0],E[1],E[2]); if((fE>0)===(fm>0)) continue;
      const t=ccEdgeZero(Qm,E,fm,fE,en);
      if(t*smax<bestS){ bestS=t*smax; bestZ=[E,t]; } }
    if(!bestZ) return [];
    const [E,t]=bestZ, lE=ccBary(P,E);
    const BE=[0,1,2].map(c=>lE[0]*B[0][c]+lE[1]*B[1][c]+lE[2]*B[2][c]);
    const Z=ccLerp(Qm,E,t), BZ=ccLerp(Bm,BE,t);
    return ccArc(Qa,Ba,Z,BZ,P,B,fv,en,depth-1).concat([[Z,BZ]],ccArc(Z,BZ,Qb,Bb,P,B,fv,en,depth-1)); }
  function ccArea2(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
  function ccEarclip(pp,bb){
    let idx=pp.map((_,i)=>i); const uv=bb.map(b=>[b[1],b[2]]); const out=[];
    const ang=(p,q,r)=>{const v1=[q[0]-p[0],q[1]-p[1]],v2=[r[0]-p[0],r[1]-p[1]];const n1=Math.hypot(v1[0],v1[1]),n2=Math.hypot(v2[0],v2[1]);
      if(n1<1e-18||n2<1e-18) return 0; return Math.acos(Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2))));};
    while(idx.length>3){ let best=null,bq=-1; const n=idx.length;
      for(let k=0;k<n;k++){ const ia=idx[(k-1+n)%n], ib=idx[k], ic=idx[(k+1)%n];
        const A=uv[ia],Bq=uv[ib],C=uv[ic]; if(ccArea2(A,Bq,C)<=1e-18) continue;
        let inside=false;
        for(const m of idx){ if(m===ia||m===ib||m===ic) continue; const Pm=uv[m];
          if(ccArea2(A,Bq,Pm)>1e-18&&ccArea2(Bq,C,Pm)>1e-18&&ccArea2(C,A,Pm)>1e-18){inside=true;break;} }
        if(inside) continue;
        const q=Math.min(ang(A,Bq,C),ang(Bq,C,A),ang(C,A,Bq)); if(q>bq+1e-12){best=k;bq=q;} }
      if(best===null){ for(let k=1;k<idx.length-1;k++) out.push([[pp[idx[0]],pp[idx[k]],pp[idx[k+1]]],[bb[idx[0]],bb[idx[k]],bb[idx[k+1]]]]); idx=[]; break; }
      const n2=idx.length, ia=idx[(best-1+n2)%n2], ib=idx[best], ic=idx[(best+1)%n2];
      out.push([[pp[ia],pp[ib],pp[ic]],[bb[ia],bb[ib],bb[ic]]]); idx.splice(best,1); }
    if(idx.length===3&&ccArea2(uv[idx[0]],uv[idx[1]],uv[idx[2]])>1e-18) out.push([[pp[idx[0]],pp[idx[1]],pp[idx[2]]],[bb[idx[0]],bb[idx[1]],bb[idx[2]]]]);
    return out; }
  function ccClipPoly(P,B,en,fv,cross){
    let pp=[], bb=[], nw=[];
    for(let i=0;i<3;i++){ const j=(i+1)%3;
      if(fv[i]>0){pp.push(P[i]);bb.push(B[i]);nw.push(false);}
      for(let t of cross[i]){ if(t<CC_SNAP)t=0; else if(t>1-CC_SNAP)t=1;
        pp.push(ccLerp(P[i],P[j],t)); bb.push(ccLerp(B[i],B[j],t)); nw.push(true); } }
    if(pp.length>=2){ const n=pp.length, p2=[], b2=[], n2=[];
      for(let k=0;k<n;k++){ p2.push(pp[k]); b2.push(bb[k]); n2.push(nw[k]);
        if(nw[k]&&nw[(k+1)%n]&&(n>2||k===n-1)) for(const [q,b] of ccArc(pp[k],bb[k],pp[(k+1)%n],bb[(k+1)%n],P,B,fv,en,CC_ARC_DEPTH)){p2.push(q);b2.push(b);n2.push(true);} }
      pp=p2; bb=b2; nw=n2; }
    return {pp:pp, bb:bb, nw:nw};
  }
  const CC_SPLIT=4;
  function ccMid(a,b){ return ccLess(b,a)?ccLerp(b,a,0.5):ccLerp(a,b,0.5); }
  function ccPk(p){ return p[0]+','+p[1]+','+p[2]; }
  function ccLinks(P,fv,X,en,depth,L){
    const cr=[0,1,2].map(i=>{ if(X[i]) return X[i]; const j=(i+1)%3;
      const sw=ccLess(P[j],P[i]), A=sw?P[j]:P[i], Z=sw?P[i]:P[j], fa=sw?fv[j]:fv[i], fz=sw?fv[i]:fv[j];
      return ccEdgeCrossings(A,Z,fa,fz,en).map(t=>{ const q=ccLerp(A,Z,t); return {t:sw?1-t:t, id:ccPk(q), p:q}; })
        .sort((a,b)=>a.t-b.t); });
    const n=cr[0].length+cr[1].length+cr[2].length;
    if(n>2&&depth<CC_SPLIT){
      const M=[ccMid(P[0],P[1]),ccMid(P[1],P[2]),ccMid(P[2],P[0])];
      const fm=M.map(q=>ccField(en,q[0],q[1],q[2]));
      const lo=c=>c.filter(x=>x.t<0.5).map(x=>({t:2*x.t,id:x.id,p:x.p})),
            hi=c=>c.filter(x=>x.t>=0.5).map(x=>({t:2*x.t-1,id:x.id,p:x.p}));
      return ccLinks([P[0],M[0],M[2]],[fv[0],fm[0],fm[2]],[lo(cr[0]),null,hi(cr[2])],en,depth+1,L)
          && ccLinks([M[0],P[1],M[1]],[fm[0],fv[1],fm[1]],[hi(cr[0]),lo(cr[1]),null],en,depth+1,L)
          && ccLinks([M[2],M[1],P[2]],[fm[2],fm[1],fv[2]],[null,hi(cr[1]),lo(cr[2])],en,depth+1,L)
          && ccLinks([M[0],M[1],M[2]],[fm[0],fm[1],fm[2]],[null,null,null],en,depth+1,L); }
    if(n===0) return true;
    if(n!==2) return false;                  // still tangled at the deepest split: the caller falls back
    const xs=cr[0].concat(cr[1],cr[2]);
    L.push({a:xs[0], b:xs[1], P:P, fv:fv}); return true;
  }
  function ccMultiPolys(P,B,en,fv,cross){
    const E=[[],[],[]];
    for(let i=0;i<3;i++){ const j=(i+1)%3;
      cross[i].forEach((t0,k)=>{ let t=t0; if(t<CC_SNAP)t=0; else if(t>1-CC_SNAP)t=1;
        E[i].push({t:t0, id:'e'+i+'_'+k, p:ccLerp(P[i],P[j],t), b:ccLerp(B[i],B[j],t)}); }); }
    const Lk=[]; if(!ccLinks(P,fv,E,en,0,Lk)) return null;
    const adj=new Map(), add=(a,b,seg)=>{ let l=adj.get(a.id); if(!l){l=[];adj.set(a.id,l);} l.push({o:b,seg:seg}); };
    for(const seg of Lk){ add(seg.a,seg.b,seg); add(seg.b,seg.a,seg); }
    const I3=[[1,0,0],[0,1,0],[0,0,1]], Z3=[0,0,0];
    // the line from a crossing on the triangle's edge to where it leaves it, and its points
    const trace=s0=>{ const pts=[]; let cur=s0, prev=null;
      for(let g=0;g<4096;g++){ const nb=(adj.get(cur.id)||[]).filter(q=>q.seg!==prev); if(nb.length!==1) return null;
        const q=nb[0];
        for(const [z] of ccArc(cur.p,Z3,q.o.p,Z3,q.seg.P,I3,q.seg.fv,en,CC_ARC_DEPTH)) pts.push(z);
        if(q.o.id[0]==='e') return {end:q.o, pts:pts};
        pts.push(q.o.p); prev=q.seg; cur=q.o; }
      return null; };
    const Bd=[]; for(let i=0;i<3;i++){ Bd.push({c:i,k:fv[i]>0}); for(const x of E[i]) Bd.push({x:x}); }
    const nB=Bd.length, at=new Map(); Bd.forEach((q,i)=>{ if(q.x) at.set(q.x.id,i); });
    // after a crossing the boundary is kept or not: the corner that follows says, or — the next
    // crossing on the same edge — the middle between them
    const enters=i=>{ const nx=Bd[(i+1)%nB]; if(nx.c!==undefined) return nx.k;
      const m=ccLerp(Bd[i].x.p,nx.x.p,0.5); return ccField(en,m[0],m[1],m[2])>0; };
    const seen=new Set(), polys=[];
    for(let s0=0;s0<nB;s0++){ if(!Bd[s0].x||seen.has(Bd[s0].x.id)||!enters(s0)) continue;
      const pp=[], bb=[]; let i=s0, g=0;
      for(;;){ if(++g>64) return null;
        const x=Bd[i].x; seen.add(x.id); pp.push(x.p); bb.push(x.b);
        let k=(i+1)%nB;
        while(Bd[k].c!==undefined){ if(!Bd[k].k) return null; pp.push(P[Bd[k].c]); bb.push(B[Bd[k].c]); k=(k+1)%nB; }
        if(enters(k)) return null;
        const e=Bd[k].x; seen.add(e.id); pp.push(e.p); bb.push(e.b);
        const tr=trace(e); if(!tr) return null;
        for(const z of tr.pts){ const l=ccBary(P,z); if(!l) return null; pp.push(z);
          bb.push([0,1,2].map(c=>l[0]*B[0][c]+l[1]*B[1][c]+l[2]*B[2][c])); }
        i=at.get(tr.end.id); if(!enters(i)) return null;
        if(i===s0) break; }
      polys.push({pp:pp,bb:bb}); }
    return polys.length?polys:null;
  }
  function ccTriangulate(pp,bb,out){
    const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    if(pp.length===3) out.push([pp,bb]);
    else if(pp.length===4){
      // the shorter diagonal — when it lies inside: a quad the line bends into is not convex,
      // and its other diagonal runs outside it (318: kept and cut overlapped by 1-2%)
      const A=(i,j,k)=>ccArea2([bb[i][1],bb[i][2]],[bb[j][1],bb[j][2]],[bb[k][1],bb[k][2]]);
      const ok02=A(0,1,2)*A(0,2,3)>0, ok13=A(0,1,3)*A(1,2,3)>0;
      if(ok02&&(!ok13||d(pp[0],pp[2])<=d(pp[1],pp[3]))){ out.push([[pp[0],pp[1],pp[2]],[bb[0],bb[1],bb[2]]]); out.push([[pp[0],pp[2],pp[3]],[bb[0],bb[2],bb[3]]]); }
      else if(ok13){ out.push([[pp[0],pp[1],pp[3]],[bb[0],bb[1],bb[3]]]); out.push([[pp[1],pp[2],pp[3]],[bb[1],bb[2],bb[3]]]); }
      else for(const t of ccEarclip(pp,bb)) out.push(t); }
    else if(pp.length>4) for(const t of ccEarclip(pp,bb)) out.push(t);
  }
  function ccClipTri(P,B,en){
    const fv=[ccField(en,...P[0]),ccField(en,...P[1]),ccField(en,...P[2])];
    const cross=[0,1,2].map(i=>ccEdgeCrossings(P[i],P[(i+1)%3],fv[i],fv[(i+1)%3],en));
    const nx=cross[0].length+cross[1].length+cross[2].length;
    if(!nx) return (fv[0]<=0&&fv[1]<=0&&fv[2]<=0)?[]:[[P,B]];
    let polys=nx>2?ccMultiPolys(P,B,en,fv,cross):null;
    if(!polys){ const r=ccClipPoly(P,B,en,fv,cross); polys=[{pp:r.pp,bb:r.bb}]; }
    const out=[]; for(const q of polys) ccTriangulate(q.pp,q.bb,out);
    return out.filter(([p])=>{const ax=p[1][0]-p[0][0],ay=p[1][1]-p[0][1],az=p[1][2]-p[0][2],
      bx=p[2][0]-p[0][0],by=p[2][1]-p[0][1],bz=p[2][2]-p[0][2];
      return Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)>1e-14;});
  }
  function ccCorner(f,c){const o=f*9+c*3;return [pos[o],pos[o+1],pos[o+2]];}
  function ccCutFace(f,idx,entries){
    let tris=[[[ccCorner(f,0),ccCorner(f,1),ccCorner(f,2)],[[1,0,0],[0,1,0],[0,0,1]]]];
    for(const ei of idx){ entries[ei].cur=f; const nx=[]; for(const [p,b] of tris) for(const t of ccClipTri(p,b,entries[ei])) nx.push(t);
      tris=nx; if(!tris.length) break; }
    return tris; }
  function ccPlan(entries,cand,seeds){
    const removed=cand?null:new Uint8Array(N), cuts=new Map();
    const vkey=(f,c)=>{const o=f*9+c*3;return Math.round(pos[o]*1e5)+','+Math.round(pos[o+1]*1e5)+','+Math.round(pos[o+2]*1e5);};
    entries.forEach((en,ei)=>{
      if(!en.ops||!en.ops.length){ for(const f of en.faces) if(f<N) removed[f]=1; return; }
      if(en._ix===undefined) en._ix=en.ops.length>1?ccIndex(en.ops):null;
      const S=en.S||(()=>{const a=new Uint8Array(N); for(const f of en.faces) if(f<N) a[f]=1; return a;})();
      const [lo,hi]=ccBBox(en);
      const fv=new Map(), mixed=new Set(), bitten=new Set();
      // `cand`: only these faces are looked at (26/09: the red while the hand paints)
      const nC=cand?cand.length:N;
      for(let q=0;q<nC;q++){ const f=cand?cand[q]:q; if(f>=N) continue; const o=f*9; let inb=false; en.cur=f;
        for(let c=0;c<3&&!inb;c++){ const x=pos[o+c*3],y=pos[o+c*3+1],z=pos[o+c*3+2];
          if(x>=lo[0]&&x<=hi[0]&&y>=lo[1]&&y<=hi[1]&&z>=lo[2]&&z<=hi[2]) inb=true; }
        if(!inb) continue;
        const v=[0,1,2].map(c=>ccField(en,pos[o+c*3],pos[o+c*3+1],pos[o+c*3+2]));
        const n=(v[0]<=0)+(v[1]<=0)+(v[2]<=0);
        if(n>0&&n<3){ mixed.add(f); fv.set(f,v); continue; }
        // corners that agree may hide an edge the shape enters and leaves (crop_clip.py)
        const P=[ccCorner(f,0),ccCorner(f,1),ccCorner(f,2)];
        const el=Math.max(Math.hypot(P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]),
                          Math.hypot(P[2][0]-P[1][0],P[2][1]-P[1][1],P[2][2]-P[1][2]),
                          Math.hypot(P[0][0]-P[2][0],P[0][1]-P[2][1],P[0][2]-P[2][2]));
        if(Math.min(Math.abs(v[0]),Math.abs(v[1]),Math.abs(v[2]))<el)
          for(let i=0;i<3;i++) if(ccEdgeCrossings(P[i],P[(i+1)%3],v[i],v[(i+1)%3],en).length){
            mixed.add(f); fv.set(f,v); bitten.add(f); break; } }
      if(!cand){ for(const f of en.faces) if(f<N&&!mixed.has(f)) removed[f]=1; }   // whole, as before
      // the crossed edges of the mixed faces, keyed by their welded ends
      const edges=new Map(), nrm=new Map();
      for(const f of mixed){ const v=fv.get(f), k=[vkey(f,0),vkey(f,1),vkey(f,2)];
        const a=ccCorner(f,0),b=ccCorner(f,1),c=ccCorner(f,2);
        const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],wx=c[0]-a[0],wy=c[1]-a[1],wz=c[2]-a[2];
        const nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx,nl=Math.hypot(nx,ny,nz)||1;
        nrm.set(f,[nx/nl,ny/nl,nz/nl]);
        for(let i=0;i<3;i++){ const j=(i+1)%3;
          const ek=k[i]<k[j]?k[i]+'|'+k[j]:k[j]+'|'+k[i];
          (edges.get(ek)||edges.set(ek,[]).get(ek)).push(f); } }
      // an edge is crossed when its ends disagree, or — beside a bitten face — when it has a crossing
      const ekCross=new Map();
      const crossedEdge=(f,i)=>{ const v=fv.get(f), j=(i+1)%3;
        if((v[i]<=0)!==(v[j]<=0)) return true;
        const k=[vkey(f,0),vkey(f,1),vkey(f,2)], ek=k[i]<k[j]?k[i]+'|'+k[j]:k[j]+'|'+k[i];
        const gs=edges.get(ek)||[]; if(!gs.some(g=>bitten.has(g))) return false;
        en.cur=f; if(!ekCross.has(ek)) ekCross.set(ek,ccEdgeCrossings(ccCorner(f,i),ccCorner(f,j),v[i],v[j],en).length>0);
        return ekCross.get(ek); };
      const band=new Set(), q=[];
      // `seeds`: faces already known to be on the line just outside the region asked about —
      // the neighbours a face in it may be reached from (26/09)
      for(const f of mixed) if(S[f]||(seeds&&seeds.has(f))){band.add(f);q.push(f);}
      while(q.length){ const f=q.pop(), v=fv.get(f), k=[vkey(f,0),vkey(f,1),vkey(f,2)], n1=nrm.get(f);
        for(let i=0;i<3;i++){ const j=(i+1)%3; if(!crossedEdge(f,i)) continue;
          const ek=k[i]<k[j]?k[i]+'|'+k[j]:k[j]+'|'+k[i];
          for(const g of (edges.get(ek)||[])){ if(band.has(g)) continue;
            const n2=nrm.get(g); if(Math.abs(n1[0]*n2[0]+n1[1]*n2[1]+n1[2]*n2[2])<=CC_FOLD) continue;
            band.add(g); q.push(g); } } }
      for(const f of band) if(!removed||!removed[f]) (cuts.get(f)||cuts.set(f,[]).get(f)).push(ei);
    });
    if(removed) for(const f of [...cuts.keys()]) if(removed[f]) cuts.delete(f);
    return {removed:removed, cuts:cuts};
  }
  let ccReachFor=null, ccReachV=0.3;
  function ccReach(){
    if(ccReachFor===pos) return ccReachV;
    // the 99th percentile of the edges, sampled: the few longer ones are the stroke end's
    const E=[]; for(let f=0;f<N;f+=7){ const o=f*9;
      for(let c=0;c<3;c++){ const j=(c+1)%3; E.push(Math.hypot(pos[o+c*3]-pos[o+j*3],pos[o+c*3+1]-pos[o+j*3+1],pos[o+c*3+2]-pos[o+j*3+2])); } }
    E.sort((x,y)=>x-y);
    ccReachFor=pos; ccReachV=Math.min(1.0,E.length?E[Math.floor(0.99*(E.length-1))]:0.3); return ccReachV;
  }
  let ccLongFor=null, ccLong=null;
  function ccLongFaces(){
    if(ccLongFor===pos) return ccLong;
    const R=ccReach(), L=[];
    for(let f=0;f<N;f++){ const o=f*9; let e=0;
      for(let c=0;c<3;c++){ const j=(c+1)%3; e=Math.max(e,Math.hypot(pos[o+c*3]-pos[o+j*3],pos[o+c*3+1]-pos[o+j*3+1],pos[o+c*3+2]-pos[o+j*3+2])); }
      if(e>R){ const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
        for(let c=0;c<3;c++) for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],pos[o+c*3+k]); hi[k]=Math.max(hi[k],pos[o+c*3+k]); }
        L.push({f:f,lo:lo,hi:hi}); } }
    ccLongFor=pos; ccLong=L; return L;
  }
  let amMarkDue=false, amMarkHold=0, amMarkTimer=0, amLive=null, amLiveT=-1, amWatch=null;
  const amSeen=new WeakMap();                // a stroke -> how many of its dabs the line has asked
  // where a sub-face starts: inside when the automatic detection marks it (no manual mark)
  function amStartOf(T,ti){ return f=>{ if(!T.prob||(AM_PROB_ARMED_ONLY&&!T.hasProb)||!roi[f]) return false; return T.prob[f]>effThr(ti,f); }; }                  // the iPad's isType, without the manual mark
  function amEnOf(T){ return {faces:null, S:T.S, ops:T.ops, inv:false, cur:-1, st:amStartOf(T,types.indexOf(T))}; }
  function amSOf(T){ const ti=types.indexOf(T); if(!T.S||T.S.length!==N) T.S=new Uint8Array(N);
    for(let f=0;f<N;f++) T.S[f]=isType(ti,f)?1:0; }
  function amHasBalls(T){ return !!(T.ops&&T.ops.some(o=>o.t==='balls'&&o.c.length)); }
  function amTriA(p){ const ax=p[1][0]-p[0][0],ay=p[1][1]-p[0][1],az=p[1][2]-p[0][2],bx=p[2][0]-p[0][0],by=p[2][1]-p[0][1],bz=p[2][2]-p[0][2];
    return 0.5*Math.sqrt((ay*bz-az*by)**2+(az*bx-ax*bz)**2+(ax*by-ay*bx)**2); }
  // the marked part of one sub-face on the line: its triangles, their texture, their barycentrics
  // in the sub-face (what the sheet carries to the report), and the fraction of the sub-face
  function amPiecesOf(f,en){
    const inside={faces:null, S:en.S, ops:en.ops, inv:true, cur:f, st:en.st, _ix:en._ix};
    const P=[], U=[], BB=[]; let a=0;
    for(const [p,b] of ccCutFace(f,[0],[inside])){ a+=amTriA(p);
      for(let i=0;i<3;i++){ P.push(p[i][0],p[i][1],p[i][2]);
        let u=0,v=0; for(let c=0;c<3;c++){u+=b[i][c]*uv[(f*3+c)*2]; v+=b[i][c]*uv[(f*3+c)*2+1];}
        U.push(u,v); BB.push(b[i][1],b[i][2]); } }
    const full=amTriA([ccCorner(f,0),ccCorner(f,1),ccCorner(f,2)]);
    return {pos:P, uvs:U, bb:BB, fr:full>0?Math.min(1,a/full):0};
  }
  function amStash(T,f){ if(amWatch&&amWatch.T===T&&!amWatch.m.has(f)) amWatch.m.set(f,T.band.has(f)?T.pieces.get(f):null); }
  // the line where these points (dabs) are, in one layer: every sub-face near them asked again,
  // the faces already on the line just beyond as the ones they may be reached from (317)
  function amMarkLocal(T,pts,rmax){
    if(!T.band){ T.band=new Set(); T.pieces=new Map(); }
    if(!amHasBalls(T)){ for(const f of T.band) recolorFace(f); T.band.clear(); T.pieces.clear(); return; }
    const reach=rmax+ccReach(), span=Math.ceil(reach/CELL)+1, ring=span+2;
    const region=new Set(), outer=new Set(), cells=new Set();
    for(let i=0;i<pts.length;i+=3){
      const ix=Math.floor(pts[i]/CELL), iy=Math.floor(pts[i+1]/CELL), iz=Math.floor(pts[i+2]/CELL);
      const ck=ccCellKey(ix,iy,iz); if(cells.has(ck)) continue; cells.add(ck);
      for(let a=-ring;a<=ring;a++) for(let b=-ring;b<=ring;b++) for(let c=-ring;c<=ring;c++){
        const L=grid.get(ckey(ix+a,iy+b,iz+c)); if(!L) continue;
        const inner=Math.abs(a)<=span&&Math.abs(b)<=span&&Math.abs(c)<=span;
        for(const f of L){ if(inner) region.add(f); else if(T.band.has(f)) outer.add(f); } } }   // 386: of the ring, only what is on the line (the seeds)
    // 386 (Eli, 30/09: "improve it, safely"): the cells take in a cube around each dab — for a 5 cm
    // brush a 75 cm one. A sub-face whose centre is farther than the reach from every new dab has
    // all of itself farther than the radius (no edge is longer than the reach's edge; the longer
    // ones are taken below by their box), so no new dab can change it: it is not asked, and stays
    // one the line may be reached from, as the ring beyond is.
    { const DG=new Map(), rc=reach, R2=reach*reach;
      for(let i=0;i<pts.length;i+=3){ const k=ckey(Math.floor(pts[i]/rc),Math.floor(pts[i+1]/rc),Math.floor(pts[i+2]/rc));
        let L=DG.get(k); if(!L){ L=[]; DG.set(k,L); } L.push(i); }
      const far=[];
      for(const f of region){ const x=cen[f*3], y=cen[f*3+1], z=cen[f*3+2];
        const ix=Math.floor(x/rc), iy=Math.floor(y/rc), iz=Math.floor(z/rc); let near=false;
        for(let a=-1;a<=1&&!near;a++) for(let b=-1;b<=1&&!near;b++) for(let c=-1;c<=1&&!near;c++){
          const L=DG.get(ckey(ix+a,iy+b,iz+c)); if(!L) continue;
          for(const i of L){ const dx=pts[i]-x, dy=pts[i+1]-y, dz=pts[i+2]-z; if(dx*dx+dy*dy+dz*dz<=R2){ near=true; break; } } }
        if(!near) far.push(f); }
      for(const f of far){ region.delete(f); if(T.band.has(f)) outer.add(f); } }
    const pl=[Infinity,Infinity,Infinity], ph=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<pts.length;i+=3) for(let k=0;k<3;k++){ pl[k]=Math.min(pl[k],pts[i+k]); ph[k]=Math.max(ph[k],pts[i+k]); }
    for(const q of ccLongFaces()){
      if(q.hi[0]<pl[0]-rmax||q.lo[0]>ph[0]+rmax||q.hi[1]<pl[1]-rmax||q.lo[1]>ph[1]+rmax||q.hi[2]<pl[2]-rmax||q.lo[2]>ph[2]+rmax) continue;
      for(let i=0;i<pts.length;i+=3)
        if(pts[i]>=q.lo[0]-rmax&&pts[i]<=q.hi[0]+rmax&&pts[i+1]>=q.lo[1]-rmax&&pts[i+1]<=q.hi[1]+rmax&&pts[i+2]>=q.lo[2]-rmax&&pts[i+2]<=q.hi[2]+rmax){ region.add(q.f); break; } }
    for(const f of region) outer.delete(f);
    const seeds=new Set(); for(const f of outer) if(T.band.has(f)) seeds.add(f);
    const en=amEnOf(T);
    const plan=ccPlan([en],[...region,...seeds],seeds);
    for(const f of region){ if(T.band.has(f)&&!plan.cuts.has(f)){ amStash(T,f); T.band.delete(f); T.pieces.delete(f); recolorFace(f); } }
    for(const f of plan.cuts.keys()){ if(!region.has(f)) continue; amStash(T,f); const was=T.band.has(f); T.band.add(f);
      T.pieces.set(f,amPiecesOf(f,en)); if(!was) recolorFace(f); }
  }
  function amOpPts(op){ if(op.t==='balls') return op.c;
    const p=[]; for(const f of op.m.keys()) p.push(cen[f*3],cen[f*3+1],cen[f*3+2]); return p; }
  function amMarkAt(T,op){ const p=amOpPts(op); if(p.length) amMarkLocal(T,p,op.t==='balls'?op.r:0); }
  // the whole layer: after a threshold, a learning, a load — every stroke's dabs at once
  function amMarkFull(T){
    if(T.band) for(const f of T.band) recolorFace(f);
    T.band=new Set(); T.pieces=new Map();
    if(!amHasBalls(T)) return;
    const pts=[]; let rmax=0;
    for(const op of T.ops){ if(op.t!=='balls') continue; for(let i=0;i+2<op.c.length;i+=3) pts.push(op.c[i],op.c[i+1],op.c[i+2]);
      if(op.c.length) rmax=Math.max(rmax,op.r); amSeen.set(op,op.c.length); }
    amMarkLocal(T,pts,rmax);
  }
  function amMarkAll(){
    amMarkTimer=0;
    for(const T of types){ if(!T.ops) T.ops=[]; amSOf(T); amMarkFull(T); }
    colAttr.needsUpdate=true; flatAttr.needsUpdate=true; desAttr.needsUpdate=true;
    updateArea(); amMarkDraw(); invalidate();
  }
  function amMarkSoon(){ if(amMarkTimer) clearTimeout(amMarkTimer); amMarkTimer=setTimeout(amMarkAll,120); }
  // while the hand paints: the dabs added since the last frame (317)
  function amMarkNear(T){
    const pts=[]; let rmax=0;
    for(const op of T.ops){ if(op.t!=='balls') continue; const k0=amSeen.get(op)||0;
      for(let i=k0;i+2<op.c.length;i+=3) pts.push(op.c[i],op.c[i+1],op.c[i+2]);
      if(op.c.length>k0) rmax=Math.max(rmax,op.r); amSeen.set(op,op.c.length); }
    if(pts.length) amMarkLocal(T,pts,rmax);
  }
  function amMarkTick(){
    const t0=performance.now(); if(t0<amMarkHold) return;
    amMarkDue=false;
    if(amLive&&types[amLiveT]){ amMarkNear(types[amLiveT]); amMarkDraw(); }   // 494: its sub-faces go up by their ranges (amColFlush)
    const dt=performance.now()-t0; amMarkHold=dt>25?performance.now()+16:0;
  }
  // the marked parts, drawn over the sub-faces they cut with the layer's colour, opacity and
  // design, in the model's own texture; one layer kept and rewritten in place (322)
  let amMarkMesh=null, amMarkMat=null, amMarkCap=0;
  function amMarkDraw(){
    let nv=0;
    for(const T of amMarkLayers()) if(T.pieces&&T.op>0&&!T.hid) for(const q of T.pieces.values()) nv+=q.pos.length/3;
    if(amMarkMesh&&amMarkCap<nv){ scene.remove(amMarkMesh); amMarkMesh.geometry.dispose(); amMarkMesh=null; }
    if(!nv){ if(amMarkMesh) amMarkMesh.visible=false; invalidate(); return; }
    if(!amMarkMat){ amMarkMat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide,polygonOffset:true,
        polygonOffsetFactor:-1,polygonOffsetUnits:-4}); amMarkMat.onBeforeCompile=mat.onBeforeCompile; }
    amMarkMat.transparent=mat.transparent; amMarkMat.opacity=mat.opacity; amMarkMat.depthWrite=mat.depthWrite;
    if(!amMarkMesh){ let cap=4096; while(cap<nv) cap*=2;
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(cap*3),3));
      g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(cap*2),2));
      g.setAttribute('aCol',new THREE.BufferAttribute(new Float32Array(cap*3),3));
      g.setAttribute('aFlat',new THREE.BufferAttribute(new Float32Array(cap),1));
      g.setAttribute('aDes',new THREE.BufferAttribute(new Float32Array(cap),1));
      g.setAttribute('aPatch',new THREE.BufferAttribute(new Float32Array(cap),1));
      amMarkMesh=new THREE.Mesh(g,amMarkMat); amMarkMesh.frustumCulled=false; amMarkMesh.renderOrder=1;
      amMarkCap=cap; scene.add(amMarkMesh); }
    const g=amMarkMesh.geometry, A=g.attributes;
    let o=0;
    for(const T of amMarkLayers()){ if(!T.pieces||!(T.op>0)||T.hid) continue;
      const c=T.color, d=(typeof T.design==='number')?T.design:0.6;
      for(const [f,q] of T.pieces){ const n=q.pos.length/3, pf=(f>=PATCH0)?1:0;
        A.position.array.set(q.pos,o*3); A.uv.array.set(q.uvs,o*2);
        for(let k=0;k<n;k++){ const w=o+k; A.aCol.array[w*3]=c[0]; A.aCol.array[w*3+1]=c[1]; A.aCol.array[w*3+2]=c[2];
          A.aFlat.array[w]=T.op; A.aDes.array[w]=d; A.aPatch.array[w]=pf; }
        o+=n; } }
    for(const k of ['position','uv','aCol','aFlat','aDes','aPatch']){ const at=A[k];
      at.clearUpdateRanges(); at.addUpdateRange(0,o*at.itemSize); at.needsUpdate=true; }
    g.setDrawRange(0,o); amMarkMesh.visible=true; invalidate();
  }
  // 545: the pieces of the line take their layers' opacity, alone — amMarkDraw's order and offsets, its aFlat only
  // (a layer's opacity that stays above 0 changes neither which pieces are drawn nor where)
  function amMarkOps(){
    if(!amMarkMesh||!amMarkMesh.visible) return;
    const A=amMarkMesh.geometry.attributes.aFlat; let o=0;
    for(const T of amMarkLayers()){ if(!T.pieces||!(T.op>0)||T.hid) continue;
      for(const q of T.pieces.values()){ const n=q.pos.length/3; A.array.fill(T.op,o,o+n); o+=n; } }
    A.clearUpdateRanges(); A.addUpdateRange(0,o); A.needsUpdate=true; invalidate();
  }
  // a stroke of the area brush: its balls go into the layer the moment it starts
  function amStrokeBegin(){
    if(!(activeKind==='area'&&areaTool===AM_BRUSH&&(mode==='add'||mode==='rem'))) return;
    const T=types[activeT]; if(!T) return;
    if(!T.ops) T.ops=[]; if(!T.S) amSOf(T);
    amLive={t:'balls',c:[],r:brushR,s:(mode==='add')?1:-1}; amLiveT=activeT; T.ops.push(amLive);
    if(curDiff) curDiff.push(['OP',activeT,amLive]);
    amWatch={T:T, m:new Map()};
  }
  function amStrokeDab(p){
    if(!amLive) return;
    const c=amLive.c, n=c.length;
    if(!n||Math.hypot(p.x-c[n-3],p.y-c[n-2],p.z-c[n-1])>0.2*amLive.r){ c.push(p.x,p.y,p.z); amMarkDue=true; }
  }
  // 319's rule: a stroke that chose no new sub-face stays when it moved the line
  function amKeeps(T,op){
    if(!amWatch||!op.c.length) return false;
    const c=op.c, r=op.r-1e-5;
    for(const [f,old] of amWatch.m){
      if(!!old!==T.band.has(f)) return true;
      if(!old) continue;
      const o=f*9, P=old.pos;
      for(let k=0;k<P.length;k+=3){ const x=P[k], y=P[k+1], z=P[k+2];
        let corner=false; for(let q=0;q<3;q++) if(x===pos[o+q*3]&&y===pos[o+q*3+1]&&z===pos[o+q*3+2]) corner=true;
        if(corner) continue;
        for(let i=0;i+2<c.length;i+=3){ const dx=x-c[i],dy=y-c[i+1],dz=z-c[i+2]; if(dx*dx+dy*dy+dz*dz<r*r) return true; } } }
    const rest=T.ops.filter(o=>o!==op);
    const eo={ops:rest, inv:false, cur:-1, st:amStartOf(T,types.indexOf(T))}; eo._ix=rest.length>1?ccIndex(rest):null;
    for(const f of amWatch.m.keys()){ const now=T.pieces.get(f); if(!now) continue;
      const o=f*9, P=now.pos; eo.cur=f;
      for(let k=0;k<P.length;k+=3){ const x=P[k], y=P[k+1], z=P[k+2];
        let corner=false; for(let q=0;q<3;q++) if(x===pos[o+q*3]&&y===pos[o+q*3+1]&&z===pos[o+q*3+2]) corner=true;
        if(!corner&&Math.abs(ccField(eo,x,y,z))>1e-5) return true; } }
    return false;
  }
  function amStrokeEnd(){
    if(!amLive) return;
    const T=types[amLiveT], op=amLive;
    if(T){ amMarkNear(T);
      const chose=!!(curDiff&&curDiff.some(d=>d[0]!=='OP'));
      if(!chose&&!amKeeps(T,op)){ const k=T.ops.lastIndexOf(op); if(k>=0) T.ops.splice(k,1);
        if(curDiff) curDiff=curDiff.filter(d=>d[2]!==op);
        amWatch=null; amMarkAt(T,op); } }
    amLive=null; amWatch=null;
    updateArea(); amMarkDraw();   // 494: the area counted once, at the end; the colours by their ranges
  }
  // undo and redo: an op leaves or comes back, and the line is asked again where it was
  function amOpOut(ti,op){ const T=types[ti]; if(!T||!T.ops) return;
    const k=T.ops.lastIndexOf(op); if(k>=0) T.ops.splice(k,1); amMarkAt(T,op); amMarkDraw(); }
  function amOpIn(ti,op){ const T=types[ti]; if(!T) return; if(!T.ops) T.ops=[];
    T.ops.push(op); if(op.t==='balls') amSeen.set(op,op.c.length); amMarkAt(T,op); amMarkDraw(); }
  function amSUpd(ti,f){ const T=types[ti]; if(T&&T.S) T.S[f]=isType(ti,f)?1:0; }
  // the sheet: the strokes' balls and the grows' sub-faces, in their order
  function amOpsOut(T){ return (T.ops||[]).map(op=>op.t==='balls'
      ? {t:'balls', r:Math.round(op.r*1e5)/1e5, s:op.s, c:op.c.map(v=>Math.round(v*1e5)/1e5)}
      : {t:'faces', f:[...op.m.keys()], v:[...op.m.values()]}).filter(o=>o.t!=='balls'||o.c.length); }
  // the marked parts each layer carries to the report (324): the part of every sub-face on the
  // line, and its triangles in the sub-face's own barycentrics
  function amMarkDerived(T,ti){
    let a=0; const fs=[], frac=[], pcs=[];
    const B=T.band;
    for(let f=0;f<N;f++) if(isType(ti,f)&&!(B&&B.has(f))){ a+=area[f]; fs.push(f); }
    if(T.pieces) for(const [f,q] of T.pieces){ if(!(q.fr>1e-6)) continue;
      a+=q.fr*area[f]; fs.push(f); frac.push([f,Math.round(q.fr*1e4)/1e4]);
      pcs.push([f].concat(q.bb.map(v=>Math.round(v*1e4)/1e4))); }
    return {a:a, faces:fs, frac:frac, pieces:pcs};
  }
  // the iPad draws every frame; the frame asks the line first (317)
  window.amMarkTick=()=>{ if(amMarkDue) amMarkTick(); };
  function recolorFace(f){
    amColMark(f);   // 494: what goes to the graphics card at the frame — this sub-face's colour, cover and design
    let r=null, a=0, d=0; _vis.length=0;
    // 329: the smoothed-surface brush, while it is down — the sub-faces it has taken
    if(typeof smLive!=='undefined'&&smLive&&smLive[f]&&mode!=='rem'&&!(typeof smLiveT!=='undefined'&&smLiveT&&smLiveT.band.has(f))){   // 389: an erasure is drawn by its own red (smRed), not face by face
      const T=types[activeT], c=(mode==='rem')?[0.780,0.122,0.216]:((T&&T.color)||[0.220,0.690,0.000]), o0=f*9;
      for(let k=0;k<3;k++){colors[o0+k*3]=c[0];colors[o0+k*3+1]=c[1];colors[o0+k*3+2]=c[2];flats[f*3+k]=0.8;dess[f*3+k]=0;}
      if(typeof amShowT==='object'&&amShowT) amShowT[f]=254;   // 545: the brush's, not a layer's
      return;
    }
    // Volume paint wins the pixel, SOLID. It was drawn as a dither on every other
    // sub-face, and the holes in it swallowed the edge of the marking — the one
    // thing the user has to see, because that edge becomes the skirt (Eli, 30/08).
    if(typeof volPaint!=='undefined' && volPaint[f] && !(volMarkT&&volMarkT.band&&volMarkT.band.has(f))){
      const o0=f*9;
      for(let c=0;c<3;c++){colors[o0+c*3]=VOLC[0];colors[o0+c*3+1]=VOLC[1];colors[o0+c*3+2]=VOLC[2];
        flats[f*3+c]=volOp; dess[f*3+c]=volDes;}
      if(typeof amShowT==='object'&&amShowT) amShowT[f]=254;   // 545: the volume paint's, not a layer's
      return;
    }
    for(let ti=0;ti<types.length;ti++) if(types[ti].op>0 && !types[ti].hid && isType(ti,f) && !(types[ti].band&&types[ti].band.has(f))) _vis.push(ti);
    if(!_vis.length){ if(roi[f]){r=ROIC;a=0.45*roiOp;} else {r=[1,1,1];a=0;} }
    else { const T=types[_vis[f%_vis.length]]; r=T.color; a=T.op; d=(typeof T.design==='number')?T.design:0.6; }
    if(selMask[f]){ r=[(r[0]+SELC[0])*0.5,(r[1]+SELC[1])*0.5,(r[2]+SELC[2])*0.5]; a=Math.max(a,0.35); }
    const o=f*9;
    for(let c=0;c<3;c++){colors[o+c*3]=r[0];colors[o+c*3+1]=r[1];colors[o+c*3+2]=r[2];flats[f*3+c]=a;dess[f*3+c]=d;}
    if(typeof amShowT==='object'&&amShowT) amShowT[f]=_vis.length?_vis[f%_vis.length]:255;   // 545: the layer it shows
  }
  function amColMark(f){
    if(!amCF||amCF.df.length!==N){ const c={df:new Uint8Array(N), dl:[], all:false, gpu:[-1,-1,-1], mine:[-1,-1,-1], cb:null};
      c.cb=[0,1,2].map(i=>function(){ c.gpu[i]=this.version; }); amCF=c; }   // the version the card holds — three's own call after each upload
    if(f<0||amCF.all||amCF.df[f]) return;
    amCF.df[f]=1; amCF.dl.push(f); if(amCF.dl.length>(N>>3)) amCF.all=true;
  }
  function amColFlush(){
    if(!amCF||amCF.df.length!==N) amColMark(-1);
    const A=[colAttr,flatAttr,desAttr], W=[9,3,3], L=amCF.dl;
    let R=null;
    if(L.length&&!amCF.all){ L.sort((a,b)=>a-b); R=[]; let a=L[0], b=a;
      for(let k=1;k<L.length;k++){ const f=L[k]; if(f-b<=32) b=f; else { R.push(a,b); a=b=f; } }
      R.push(a,b); if(R.length>512) R=null; }
    for(let i=0;i<3;i++){ const at=A[i];
      if(at.onUploadCallback!==amCF.cb[i]){ at.onUploadCallback=amCF.cb[i]; amCF.gpu[i]=-1; }
      // what waits for the card: nothing, or this function's own ranges — the new ones join them. Anything
      // else (a needsUpdate from elsewhere, a new model, the first frame) is a whole upload, which holds them.
      const own=at.version===amCF.gpu[i]||(at.version===amCF.mine[i]&&at.updateRanges.length>0);
      if(!own){ at.clearUpdateRanges(); continue; }
      if(!L.length&&!amCF.all) continue;
      if(R) for(let k=0;k<R.length;k+=2) at.addUpdateRange(R[k]*W[i],(R[k+1]-R[k]+1)*W[i]);
      else at.clearUpdateRanges();
      at.needsUpdate=true; amCF.mine[i]=R?at.version:-1; }
    for(const f of L) amCF.df[f]=0; L.length=0; amCF.all=false;
  }
  function amLenCntShow(){
    for(const lt of lenTypes){let s=0;for(const ln of lines)if(ln.t===lt.id)s+=ln.len;
      const e3=document.getElementById('lA_'+lt.id); if(e3)e3.textContent=s.toFixed(2);}
    for(const ct of cntTypes){let n=0;for(const m of xmarks)if(m.t===ct.id)n++;
      const e4=document.getElementById('cA_'+ct.id); if(e4)e4.textContent=String(n);}
  }
  window.amColFlush=()=>amColFlush();   // 494: the frame sends this model's recoloured sub-faces
  const roiOp=1.0, selMask=new Uint8Array(0);   // 349: the editor's orange-zone opacity wheel and rectangle selection — fixed and empty here; the shared recolorFace reads them
  function amMarkLayers(){ const L=(typeof volMarkT!=='undefined'&&volMarkT)?types.concat([volMarkT]):types;
    return (typeof smLiveT!=='undefined'&&smLiveT)?L.concat([smLiveT]):L; }   // 325: no volume brush · 335: the smooth brush's line while it is down
  function recolorAll(){if(typeof smRecolor==='function') smRecolor();   // 335ב: the copies take the layer's colour too
    if(!amShowT||amShowT.length!==N) amShowT=new Uint8Array(N);   // 545: which layer each sub-face shows (recolorFace)
    for(let f=0;f<N;f++)recolorFace(f);colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();
    if(!amOpShownM) amOpShownM=new WeakMap(); for(const T of types) amOpShownM.set(T,T.op);   // 545: the opacity drawn
    if(typeof amMarkDraw==='function'){ amMarkDraw(); amMarkSoon(); }}   // 324: the line follows whatever changed
  // 545 (Eli, 19/10: "שינוי השקיפות של הסימונים לוקח זמן חריג ותוקע את המחשב"; "בטח שיכנס הלילה"): the area layer's
  // opacity, alone. The wheel ran recolorAll on every step — every sub-face (1.57M on his work), the colour, cover and
  // design arrays whole to the card, the area counted again, every ring rebuilt, and (amMarkSoon) every stroke of the
  // smoothed brush cut again from nothing, 239 of them. The opacity is one number per vertex of the sub-faces that SHOW
  // the layer (recolorFace keeps which: amShowT), the pieces of the line (amMarkOps), the copies and the rings' fills
  // (smRecolor) and the rings' outlines — nothing is cut, counted or rebuilt. A layer that passes through 0 changes
  // WHICH sub-faces show it (a layer at 0 shows nothing; a sub-face of two layers then shows the other): that is
  // recolorAll's, as before. One update a frame (amAreaOpSoon): the last value wins.
  var amShowT=null, amOpShownM=null, amAoPend=null;
  function amAreaOp(ti){
    const T=types[ti]; if(!T) return;
    const v=T.op, was=amOpShownM?amOpShownM.get(T):undefined;
    if(!amShowT||amShowT.length!==N||types.length>=254){
      recolorAll(); if(polys.length||curPoly||(typeof SMR!=='undefined'&&SMR.length)) polyRebuild(); return; }
    if(!(was>0)||!(v>0)){ amAreaVis(ti); return; }   // 547: through 0 — the layer disappears or comes back, alone
    for(let f=0;f<N;f++) if(amShowT[f]===ti){ const a=selMask[f]?Math.max(v,0.35):v, o=f*3; flats[o]=a; flats[o+1]=a; flats[o+2]=a; }
    flatAttr.needsUpdate=true;
    if(typeof amMarkOps==='function') amMarkOps();
    if(typeof smRecolor==='function') smRecolor();
    for(const o of polyGroup.children){ const u=o.userData; if(u&&u.pgAt===T.id&&!u.pgOpen&&o.material) o.material.opacity=v; }
    amOpShownM.set(T,v); invalidate();
  }
  // 547 (Eli, 20/10: "עדיין ניכרת תקיעה ... במיוחד במעבר ל-0% וגם בהסתרה מלאה של שכבת הסימונים דרך העין"): a layer that
  // disappears or comes back — its eye, or its opacity through 0 — changes which layer the sub-faces it is a CANDIDATE on
  // show (it alone, or the other one on a sub-face of two), and nothing else. Those sub-faces are coloured again (494:
  // recolorFace marks each for the frame's ranges — no array goes up whole); the line's pieces are drawn again from what
  // they are (amMarkDraw skips a layer hidden or at 0) — not cut; the copies and the rings' fills take the colour and
  // opacity (smRecolor); the rings' outlines the opacity; the rings and copies of a hidden layer are hidden in place and
  // shown in place — rebuilt only when they were never built (the layer was hidden when they were). Not counted (the
  // area does not depend on it), not cut (amMarkSoon) and not rebuilt. It was recolorAll + polyRebuild: every sub-face,
  // every stroke cut again, every ring and copy rebuilt.
  function amAreaVis(ti){
    const T=types[ti]; if(!T) return;
    if(!amShowT||amShowT.length!==N||types.length>=254){ recolorAll(); polyRebuild(); return; }
    for(let f=0;f<N;f++) if(amShowT[f]===ti||isType(ti,f)) recolorFace(f);
    if(typeof amMarkDraw==='function') amMarkDraw();
    if(typeof smRecolor==='function') smRecolor();
    const own=o=>{ const u=o.userData; return !!u&&(u.pgAt===T.id||u.smAt===T.id||u.smLine===T.id); };
    let built=false;
    for(const o of polyGroup.children) if(own(o)){ o.visible=!T.hid; built=true;
      if(o.userData.pgAt===T.id&&!o.userData.pgOpen&&o.material) o.material.opacity=T.op; }
    if(typeof smGroup!=='undefined'&&smGroup) for(const o of smGroup.children) if(own(o)){ o.visible=!T.hid; built=true; }
    const has=polys.some(P=>P.at===T.id)||(typeof SMR!=='undefined'&&SMR.some(r=>r&&r.at===T.id));
    if(!T.hid&&has&&!built) polyRebuild();
    if(!amOpShownM) amOpShownM=new WeakMap(); amOpShownM.set(T,T.op); invalidate();
  }
  function amAreaOpSoon(ti){
    if(amAoPend!==null&&amAoPend!==ti) amAreaOp(amAoPend);   // another layer's step, still waiting: drawn first
    if(amAoPend===ti) return;
    amAoPend=ti; requestAnimationFrame(()=>{ const t=amAoPend; amAoPend=null; if(t!==null) amAreaOp(t); });
  }
  // Design-only repaint (decision 93) — same words as the editor: the wheel touches
  // only aDes, and a full recolour per drag tick killed the GL context on a 168k-face
  // building. One attribute pass, coalesced to a frame.
  let _desReq=false;
  function amDessOnly(){
    _desReq=false;
    for(let f=0;f<N;f++){
      _vis.length=0;
      for(let ti=0;ti<types.length;ti++) if(types[ti].op>0 && !types[ti].hid && isType(ti,f) && !(types[ti].band&&types[ti].band.has(f))) _vis.push(ti);
      if(!_vis.length) continue;
      const T=types[_vis[f%_vis.length]];
      const d=(typeof T.design==='number')?T.design:0.6;
      dess[f*3]=d;dess[f*3+1]=d;dess[f*3+2]=d;
    }
    desAttr.needsUpdate=true; amMarkDraw(); if(typeof smRecolor==='function') smRecolor(); invalidate();
  }
  function amDessSoon(){ if(_desReq) return; _desReq=true; requestAnimationFrame(amDessOnly); }
  function updateArea(){
    for(let ti=0;ti<types.length;ti++){const T=types[ti];let a=0;
      // 324: a sub-face the line crosses counts by its marked part
      {const B=T.band; if(B&&B.size){ for(let f=0;f<N;f++)if(isType(ti,f)&&!B.has(f))a+=area[f]; for(const [f,q] of T.pieces)a+=q.fr*area[f]; }
       else for(let f=0;f<N;f++)if(isType(ti,f))a+=area[f];}
      // 258: a polygon layer's area lives in its rings, not in painted faces
      for(const P of polys) if(P.at===T.id) a+=P.area;
      if(typeof SMR!=='undefined'&&SMR){ let aS=0, aP=0, has=false; for(const r of SMR) if(r.at===T.id){ aS+=r.area; aP+=(r.painted||0); has=true; }
      if(has&&smLevelOf(T)>0) a-=aP; a+=aS; }   // 329 · 433: a smoothed layer is its regions' copies
      T.area=a;
      const e2=document.getElementById('tA_'+T.id); if(e2)e2.textContent=a.toFixed(2);}
    $('area').textContent='';
    if(typeof smSyncSoon==='function') smSyncSoon();   // 433: the regions follow the brush
    amLenCntShow();
  }
  /* length pens (decision 58): continuous stroke -> sampled polyline; no learning */
  const lenTypes=[]; let activeL=-1, lSeq=0;
  const lines=[]; let curLine=null; const MIN_SEG=0.002;
  let lineW=0.008;                     // tube radius; brush slider drives it in len kind
  function mkLenType(name,hex){const T={design:0.0,designU:{value:0.0},id:'l'+(lSeq++),name:name,hex:hex,op:1.0};lenTypes.push(T);return T;}
  /* ---- the ruler (decision 251), and it is the EDITOR'S code, character for character.
     The two environments already learned this lesson with the shader: three copies of one
     shader must stay one shader, and S21 holds them to it. The ruler is the same kind of
     thing — a measurement whose definition may not differ between the desk and the iPad —
     so the core below is copied verbatim and a gate compares the two texts.
     The environment differences are kept OUT of the shared text, in these two shims. */
  function invalidate(){ if(window.amInvalidate) window.amInvalidate(); }   // 523: the frame is drawn when asked
  // 454: nothing ever defined window.amMarkDirty on the iPad (since 17/09) — a ring closed, a point dragged, a
  // run or a ring erased by its tag, a smoothing change: no ⚠ on the export and no recovery copy. Here it is
  // what every other change of the iPad does
  function markDirty(){ markUnexported(true); }
  /* 25/09 · THE RULER'S LINE, WITH A WIDTH AND A DASH (Eli: "גם עיצוב (שיהפוך למקווקוו) וגם
     גלגלת רוחב קו, כמו לסרט המדידה"). WebGL draws a THREE.Line one pixel wide and ignores any
     other width, so each segment is drawn as a STRIP: four corners, which the vertex shader
     pushes apart across the segment ON THE SCREEN by the layer's width in screen pixels —
     the "fixed on the screen at every zoom" the ruler's stations and tags have kept since 250
     (Eli's choice ב). The width is measured against the canvas as laid out, so a snapshot
     rendered into a larger buffer keeps the line in the same proportion as on the screen.
     The dash is cut by the distance ALONG the segment in model units — the 302 definition,
     unchanged: a dash of 1.2% of the model's radius, a gap of 3·design times that. */
  const AM_RUL_VS=[
    'attribute vec3 aA; attribute vec3 aB;',
    'uniform vec2 uRes; uniform float uWidth;',
    'varying float vDist;',
    'void amTrim(const in vec4 s, inout vec4 e){',
    '  float a=projectionMatrix[2][2], b=projectionMatrix[3][2];',
    '  float nz=-0.5*b/a; float al=(nz-s.z)/(e.z-s.z); e.xyz=mix(s.xyz,e.xyz,al); }',
    'void main(){',
    '  vec4 s=modelViewMatrix*vec4(aA,1.0), e=modelViewMatrix*vec4(aB,1.0);',
    '  if(projectionMatrix[2][3]==-1.0){',          // perspective: an end behind the eye is cut back to it
    '    if(s.z<0.0&&e.z>=0.0) amTrim(s,e); else if(e.z<0.0&&s.z>=0.0) amTrim(e,s); }',
    '  vec4 cs=projectionMatrix*s, ce=projectionMatrix*e;',
    '  float asp=uRes.x/max(uRes.y,1.0);',
    '  vec2 d=ce.xy/ce.w-cs.xy/cs.w; d.x*=asp;',
    '  float L=length(d); d=(L>1e-9)?d/L:vec2(1.0,0.0);',
    '  vec2 off=vec2(-d.y,d.x); off.x/=asp; off*=uWidth/max(uRes.y,1.0);',
    '  vec4 c=(position.x<0.5)?cs:ce;',
    '  c.xy+=off*position.y*c.w;',
    '  gl_Position=c;',
    '  vDist=(position.x<0.5)?0.0:distance(aA,aB);',
    '}'].join('\n');
  const AM_RUL_FS=[
    'uniform vec3 diffuse; uniform float opacity; uniform float uDash; uniform float uGap;',
    'varying float vDist;',
    'void main(){',
    '  if(uGap>0.0&&mod(vDist,uDash+uGap)>uDash) discard;',
    '  gl_FragColor=vec4(diffuse,opacity);',
    '  #include <colorspace_fragment>',
    '}'].join('\n');
  const AM_RUL_W0=2;                        // pixels: a new ruler layer, and a sheet without one
  const AM_RUL_WMAX=10;
  function amRulWOf(T){const w=+((T&&T.w)||AM_RUL_W0); return Math.min(AM_RUL_WMAX,Math.max(1,w));}
  // the side bar's one slider, read as a width in pixels on a ruler layer (1..10)
  function amRulWFromSlider(v,mn,mx){return Math.max(1,Math.min(AM_RUL_WMAX,
    Math.round(1+(v-mn)/Math.max(1,mx-mn)*(AM_RUL_WMAX-1))));}
  function amRulWToSlider(w,mn,mx){return Math.round(mn+(w-1)/(AM_RUL_WMAX-1)*(mx-mn));}
  const _amRulRes=new THREE.Vector2();
  function amRulSeg(A,B,col,op,wPx){
    const g=new THREE.BufferGeometry();
    // x: which end (0 = A, 1 = B), y: which side of the line; the ends themselves ride in aA/aB
    g.setAttribute('position',new THREE.Float32BufferAttribute([0,1,0, 0,-1,0, 1,1,0, 1,-1,0],3));
    const a=[A.x,A.y,A.z], b=[B.x,B.y,B.z];
    g.setAttribute('aA',new THREE.Float32BufferAttribute([].concat(a,a,a,a),3));
    g.setAttribute('aB',new THREE.Float32BufferAttribute([].concat(b,b,b,b),3));
    g.setIndex([0,2,1, 2,3,1]);
    const u={diffuse:{value:new THREE.Color(col)},opacity:{value:(typeof op==='number')?op:1},
             uRes:{value:new THREE.Vector2(1,1)},uWidth:{value:wPx||AM_RUL_W0},
             uDash:{value:1},uGap:{value:0}};
    const mat=new THREE.ShaderMaterial({uniforms:u,vertexShader:AM_RUL_VS,fragmentShader:AM_RUL_FS,
                                        transparent:true,depthTest:false,depthWrite:false,
                                        side:THREE.DoubleSide});
    // the names every other overlay answers to, so the gold highlight and the opacity
    // wheels reach this line exactly as they reached the old one
    mat.color=u.diffuse.value;
    Object.defineProperty(mat,'opacity',{get(){return u.opacity.value;},
                                         set(v){u.opacity.value=v;},configurable:true});
    const m=new THREE.Mesh(g,mat);
    m.frustumCulled=false;                  // its positions are corner codes, not places
    m.raycast=function(){};                 // nor a surface to be hit
    m.userData.amRulLine=true; m.userData.col=new THREE.Color(col);
    m.onBeforeRender=function(r){
      r.getSize(_amRulRes);
      const cw=(r.domElement&&r.domElement.clientWidth)||_amRulRes.x;
      const ch=(r.domElement&&r.domElement.clientHeight)||_amRulRes.y;
      u.uRes.value.set(cw,ch);
    };
    m.renderOrder=999;
    return m;
  }
  // the dash, in model units (302): unit = 1.2% of the model's radius; design 0 = solid
  function amRulSegStyle(m,wPx,design,radius){
    if(!m||!m.material||!m.material.uniforms) return;
    const u=m.material.uniforms, d=(typeof design==='number')?design:0;
    const unit=Math.max(1e-6,(radius||1)*0.012);
    u.uWidth.value=wPx||AM_RUL_W0;
    u.uDash.value=unit; u.uGap.value=(d>0.005)?unit*3*d:0;
  }
  const rulTypes=[]; let activeR=-1, rSeq=0, rpSeq=0;
  const rulPts=[];                 // {id, t, x, y, z}
  const rulSegs=[];                // {t, a, b}  — ids, undirected
  let rulLast=null;
  // `w`: the line's width in pixels (25/09); the design (the dash) is absent = solid
  function mkRulType(name,hex){const T={id:'r'+(rSeq++),name:name,hex:hex,op:1.0,w:AM_RUL_W0};
    rulTypes.push(T);return T;}
  const SCREEN_FIXED=[];
  const RUL_PT_K=0.006, RUL_LAB_K=0.040;
  const rulGroup=new THREE.Group(); scene.add(rulGroup);
  function rulPtById(id){for(const q of rulPts) if(q.id===id) return q; return null;}
  function rulRuns(tid){
    const idx=new Map(), pts=[];
    for(const q of rulPts) if(q.t===tid){ idx.set(q.id,pts.length); pts.push(q); }
    const par=pts.map((_,i)=>i);
    const find=i=>{while(par[i]!==i){par[i]=par[par[i]];i=par[i];}return i;};
    const segs=[];
    for(const g of rulSegs){
      if(g.t!==tid) continue;
      const a=idx.get(g.a), b=idx.get(g.b);
      if(a===undefined||b===undefined) continue;
      segs.push([a,b]); const ra=find(a), rb=find(b); if(ra!==rb) par[ra]=rb;
    }
    const byRoot=new Map();
    for(let i=0;i<pts.length;i++){
      const r=find(i);
      if(!byRoot.has(r)) byRoot.set(r,{pts:[],len:0});
      byRoot.get(r).pts.push(pts[i]);
    }
    for(const [a,b] of segs){
      const g=byRoot.get(find(a)); const A=pts[a], B=pts[b];
      g.len+=Math.hypot(A.x-B.x,A.y-B.y,A.z-B.z);
    }
    // numbered in a stable order — by the lowest point id in each run, so a run keeps its
    // number as others are added or removed. A number that moves is a number in a report.
    const runs=[...byRoot.values()];
    for(const g of runs) g.first=Math.min(...g.pts.map(q=>q.id));
    runs.sort((x,y)=>x.first-y.first);
    runs.forEach((g,i)=>{ g.n=i+1;
      let cx=0,cy=0,cz=0; for(const q of g.pts){cx+=q.x;cy+=q.y;cz+=q.z;}
      g.c={x:cx/g.pts.length,y:cy/g.pts.length,z:cz/g.pts.length}; });
    return runs;
  }
  function rulTag(txt,hex){
    const c=document.createElement('canvas'); const pad=24;
    // 265: the tag is Hebrew and reads from the RIGHT — the number, then the value, then
    // the unit. A canvas lays text out left-to-right unless told otherwise, which put the
    // number on the wrong end. The mark sets the base direction for what follows it, and
    // `direction` does the same where the property is honoured.
    txt='‏'+txt;
    const tmp=c.getContext('2d'); tmp.direction='rtl';
    tmp.font='bold 54px system-ui, Arial, sans-serif';
    const w=Math.ceil(tmp.measureText(txt).width)+pad*2;
    c.width=w; c.height=108;
    const x=c.getContext('2d'); x.direction='rtl';
    x.fillStyle='rgba(20,18,16,0.92)'; x.strokeStyle=hex||'#b8934a'; x.lineWidth=6;
    const rr=18; x.beginPath();
    x.moveTo(rr,3); x.arcTo(w-3,3,w-3,105,rr); x.arcTo(w-3,105,3,105,rr);
    x.arcTo(3,105,3,3,rr); x.arcTo(3,3,w-3,3,rr); x.closePath(); x.fill(); x.stroke();
    x.font='bold 54px system-ui, Arial, sans-serif'; x.fillStyle='#f0e6d2';
    x.textAlign='center'; x.textBaseline='middle'; x.fillText(txt,w/2,58);
    const t=new THREE.CanvasTexture(c); t.anisotropy=4;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,
                                                        depthTest:false,depthWrite:false}));
    sp.userData.aspect=w/108;                 // so the tag never comes out squashed
    sp.renderOrder=1000; return sp;
  }
  function rulRebuild(){
    for(let i=rulGroup.children.length-1;i>=0;i--){
      const o=rulGroup.children[i]; forgetOnScreen(o); rulGroup.remove(o);
      if(o.geometry)o.geometry.dispose();
      if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}
    }
    for(const T of rulTypes){
      if(T.hid) continue;                         // 9: hidden — measured, not drawn
      const col=new THREE.Color(T.hex||'#b8934a');
      // the ruler layer's opacity, as in the viewer and the report screen (302); the tag
      // with the length stays opaque
      const _op=(typeof T.op==='number')?T.op:1;
      // ALWAYS in the transparent pass, even at 100% (24/09): an opaque overlay is drawn in the
      // opaque pass, BEFORE the transparent model and layers, which then paint over it — the
      // ruler vanished at 100% and came back at 99% (Eli).
      const _lm=()=>({color:col,depthTest:false,transparent:true,opacity:_op});
      for(const q of rulPts){
        if(q.t!==T.id) continue;
        const m=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),
          new THREE.MeshBasicMaterial(_lm()));
        m.position.set(q.x,q.y,q.z); m.renderOrder=999;
        rulGroup.add(m); keepOnScreen(m,RUL_PT_K);
      }
      // 25/09: a strip of the layer's width in pixels, dashed by its design (302)
      const _w=amRulWOf(T);
      for(const g of rulSegs){
        if(g.t!==T.id) continue;
        const A=rulPtById(g.a), B=rulPtById(g.b); if(!A||!B) continue;
        const ln=amRulSeg(A,B,col,_op,_w);
        amRulSegStyle(ln,_w,T.design,bs.radius);
        rulGroup.add(ln);
      }
      // one tag per run, at its centroid: "3 : 4.67 מ'" — the number and the sum, which is
      // what the report prints too, so the model and the table cannot disagree
      for(const run of rulRuns(T.id)){
        const sp=rulTag(run.len.toFixed(2)+' מ\u05f3', T.hex);   // 373: the reading, without the report's number
        sp.userData.amTag={kind:'rul', t:T.id, ids:run.pts.map(x=>x.id)};   // 321: the run, by its tag
        sp.position.set(run.c.x,run.c.y,run.c.z);
        rulGroup.add(sp); keepOnScreen(sp,RUL_LAB_K);
      }
    }
    rescaleFixed(); invalidate();
  }
  /* 256 — Ctrl+Z takes back the LAST POINT, in both tools. Until now the only way back
     from a misplaced point was to finish the shape and delete the whole thing. The stack
     is the drawing itself: the ruler drops the point it last placed together with the
     segment that reached it, and steps the chain back to where that segment came from.
     526 (13/10): in the core — the iPad's keyboard called these two, and only the measurement screen had them */
  function rulUndoPoint(){
    if(!rulPts.length) return false;
    const tid=(activeR>=0&&rulTypes[activeR])?rulTypes[activeR].id:null;
    let last=null;
    for(const q of rulPts) if((!tid||q.t===tid)&&(last===null||q.id>last.id)) last=q;
    if(!last) return false;
    let back=null;
    for(const g of rulSegs){
      if(g.a===last.id) back=g.b; else if(g.b===last.id) back=g.a; else continue;
    }
    rulDropPoints([last.id]);
    rulLast=(back!==null&&rulPtById(back))?back:null;   // the chain continues from there
    return true;
  }    // 526
  function rulPointAt(e){
    const r=el.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
    const hw=r.width/2, hh=r.height/2, v=new THREE.Vector3();
    let best=null, bd=14;                       // pixels; the same feel as the hole picking
    for(const q of rulPts){
      if(activeR>=0 && q.t!==rulTypes[activeR].id) continue;
      v.set(q.x,q.y,q.z).project(camera);
      if(v.z<-1||v.z>1) continue;
      const d=Math.hypot((v.x+1)*hw-px,(1-v.y)*hh-py);
      if(d<bd){bd=d;best=q;}
    }
    return best;
  }
  function rulAt(e){
    if(activeR<0) return;
    const tid=rulTypes[activeR].id;
    const hitPt=rulPointAt(e);
    if(hitPt){                                   // continue from a point already placed
      if(rulLast!==null && rulLast!==hitPt.id) rulSegs.push({t:tid,a:rulLast,b:hitPt.id});
      rulLast=hitPt.id; rulRebuild(); return;
    }
    const r=el.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,
                                -((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObject(mesh,false);
    if(!hit.length){ rulEnd(); return; }         // a click in the air closes the chain
    const q={id:++rpSeq,t:tid,x:hit[0].point.x,y:hit[0].point.y,z:hit[0].point.z};
    rulPts.push(q);
    if(rulLast!==null) rulSegs.push({t:tid,a:rulLast,b:q.id});
    rulLast=q.id; rulRebuild();
  }
  function rulEnd(){ if(rulLast!==null){ rulLast=null; invalidate(); } }
  function rulAsk(run,onRun,onPoint){
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:80;'
      +'display:flex;align-items:center;justify-content:center;direction:rtl';
    const box=document.createElement('div');
    box.style.cssText='background:#141210;border:2px solid #6b5a33;border-radius:2px;'
      +'padding:22px 26px;color:#d8cdb8;font:15px system-ui,Arial,sans-serif;max-width:420px;'
      +'box-shadow:inset 0 0 0 3px #141210, inset 0 0 0 4px rgba(184,147,74,.45)';
    const q=document.createElement('div');
    q.style.cssText='margin-bottom:16px;line-height:1.7';
    q.textContent='הנקודה שייכת לרצף '+run.n+' — '+run.pts.length+' נקודות, '
      +run.len.toFixed(2)+' מ\u05f3. מה למחוק?';
    const row=document.createElement('div');
    row.style.cssText='display:flex;gap:8px;justify-content:flex-start';
    const mk=(txt,fn,primary)=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.style.cssText='background:'+(primary?'#b8934a':'#232019')+';color:'
        +(primary?'#161310':'#d8cdb8')+';border:1px solid #6b5a33;border-radius:2px;'
        +'padding:8px 14px;font-size:14px;cursor:pointer';
      b.onclick=()=>{askClose();fn&&fn();};
      return b;};
    function askClose(){window.removeEventListener('keydown',askEsc,true);wrap.remove();}
    function askEsc(e){if((e.key||'')==='Escape'){e.preventDefault();e.stopPropagation();askClose();}}
    window.addEventListener('keydown',askEsc,true);
    wrap.onclick=e=>{if(e.target===wrap)askClose();};      // clicking away backs out too
    row.appendChild(mk('הנקודה בלבד',onPoint,true));
    row.appendChild(mk('הרצף כולו',onRun,false));
    row.appendChild(mk('ביטול',null,false));
    box.appendChild(q);box.appendChild(row);wrap.appendChild(box);
    document.body.appendChild(wrap);
  }
  // 321 (27/09): an erasure is in the history — Ctrl+Z puts the points and their segments
  // back in their places (a run keeps its number: it is numbered by its lowest point id)
  function rulDropPoints(ids){
    const kill=new Set(ids), gone={pts:[],segs:[]};
    for(let k=0;k<rulPts.length;k++) if(kill.has(rulPts[k].id)) gone.pts.push([k,rulPts[k]]);
    for(let k=0;k<rulSegs.length;k++)
      if(kill.has(rulSegs[k].a)||kill.has(rulSegs[k].b)) gone.segs.push([k,rulSegs[k]]);
    if(!gone.pts.length&&!gone.segs.length) return;
    amRulOut(gone);
    undoStack.push([['RD',gone]]); redoStack.length=0; updateHB();
  }
  function amRulOut(g){
    const P=new Set(g.pts.map(x=>x[1])), S=new Set(g.segs.map(x=>x[1]));
    for(let k=rulPts.length-1;k>=0;k--) if(P.has(rulPts[k])) rulPts.splice(k,1);
    for(let k=rulSegs.length-1;k>=0;k--) if(S.has(rulSegs[k])) rulSegs.splice(k,1);
    if(rulLast!==null&&g.pts.some(x=>x[1].id===rulLast)) rulLast=null;
    rulRebuild(); markDirty();
  }
  function amRulIn(g){
    for(const [k,q] of g.pts) rulPts.splice(Math.min(k,rulPts.length),0,q);
    for(const [k,q] of g.segs) rulSegs.splice(Math.min(k,rulSegs.length),0,q);
    rulRebuild(); markDirty();
  }
  // a click on a run's tag, or a ring's, with the eraser: the whole of it, no question —
  // the tag IS the run (Eli: "delete a ruler run or a polygon by clicking its label too")
  const _amTagRay=new THREE.Raycaster();
  function amTagAt(e,kind){
    const r=el.getBoundingClientRect();
    _amTagRay.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1),camera);
    const tags=[];
    for(const g of [rulGroup,polyGroup,smGroup,tagGroup]) for(const o of g.children)
      if(o.isSprite&&o.visible&&o.userData.amTag&&o.userData.amTag.kind===kind) tags.push(o);
    const hit=_amTagRay.intersectObjects(tags,false);
    return hit.length?hit[0].object.userData.amTag:null;
  }
  // 373: the ring under the cursor, by its own fill (a ring has no label here any more)
  function amRingAt(e){
    const r=el.getBoundingClientRect();
    _amTagRay.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1),camera);
    const fills=polyGroup.children.filter(o=>o.isMesh&&o.visible&&o.userData.ring&&(activeT<0||!types[activeT]||o.userData.smAt===types[activeT].id));
    const h=_amTagRay.intersectObjects(fills,false); if(!h.length) return null;
    // a press on one of its points is the point's (the eraser asks: the point or the ring, 252)
    const R=h[0].object.userData.ring, v=new THREE.Vector3();
    for(const q of R.pts){ v.set(q[0],q[1],q[2]).project(camera);
      if(Math.hypot((v.x+1)*r.width/2-(e.clientX-r.left),(1-v.y)*r.height/2-(e.clientY-r.top))<14) return null; }
    return R;
  }
  function amTagErase(e){
    if(activeKind==='rul'){ const t=amTagAt(e,'rul');
      if(!t||(activeR>=0&&t.t!==rulTypes[activeR].id)) return false;
      rulDropPoints(t.ids); return true; }
    if(activeKind==='area'&&areaTool===AM_POLY){ const R=amRingAt(e);      // 373: inside the ring, not on a label
      if(!R) return false; const i=polys.indexOf(R); if(i<0) return false;
      amPolyOut(i); return true; }
    // 373: a smoothed region is erased by parts, as a painted one (Eli) — no whole-region click
    if(activeKind==='tag'){ const t=amTagAt(e,'tag');                             // 332: the tag, whole
      if(!t||(activeG>=0&&t.g.t!==tagTypes[activeG].id)) return false; tagDel(t.g); return true; }
    return false;
  }
  function amPolyOut(i){
    const ring=polys[i]; polys.splice(i,1); polyRebuild(); markDirty();
    undoStack.push([['PD',{i:i,ring:ring}]]); redoStack.length=0; updateHB(); updateArea();
  }
  function rulEraseAt(e){
    const q=rulPointAt(e); if(!q) return;
    const run=rulRuns(q.t).find(g=>g.pts.some(x=>x.id===q.id));
    if(!run){ rulDropPoints([q.id]); return; }
    // a run of one point has nothing to ask about — both answers are the same deletion
    if(run.pts.length<=1){ rulDropPoints([q.id]); return; }
    rulAsk(run,
           ()=>rulDropPoints(run.pts.map(x=>x.id)),
           ()=>rulDropPoints([q.id]));
  }
  function keepOnScreen(obj,k,tag){SCREEN_FIXED.push({obj:obj,k:k,tag:!!tag});return obj;}
  function forgetOnScreen(obj){for(let i=SCREEN_FIXED.length-1;i>=0;i--)
    if(SCREEN_FIXED[i].obj===obj) SCREEN_FIXED.splice(i,1);}
  function rescaleFixed(){
    if(typeof tagRescale==='function') tagRescale();   // 332: the tags keep their own list
    for(const f of SCREEN_FIXED){
      if(!f.obj.parent) continue;            // cleared by clearMeasure
      const d=camera.position.distanceTo(f.obj.position);
      const s=Math.max(1e-6,d*f.k*(f.tag?TAGW.scale:1));
      if(f.obj.isSprite) f.obj.scale.set(f.tag?s*2.37:(s*f.obj.userData.aspect||s*2.37),s,1);   // a tag-wheel label keeps the report's fixed shape; any other label its own
      else f.obj.scale.setScalar(s);
    }
  }
  /* ---- polygon area (decision 253), the EDITOR'S code, character for character.
     Same discipline as the ruler above and for the same reason: an area whose definition
     differs between the desk and the iPad is two areas. S21 compares the two texts. */
  const polys=[]; let curPoly=null, pSeq=0;
  const polyGroup=new THREE.Group(); scene.add(polyGroup);
  function polyPlane(P){                      // P: [[x,y,z],...]
    let cx=0,cy=0,cz=0; for(const q of P){cx+=q[0];cy+=q[1];cz+=q[2];}
    const n=P.length; cx/=n;cy/=n;cz/=n;
    // Newell's normal: stable on a ring that is not flat, unlike a cross product of two edges
    let nx=0,ny=0,nz=0;
    for(let i=0;i<n;i++){
      const a=P[i], b=P[(i+1)%n];
      nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1]);
    }
    let l=Math.hypot(nx,ny,nz);
    if(l<1e-12){nx=0;ny=0;nz=1;l=1;}
    nx/=l;ny/=l;nz/=l;
    // any two axes orthogonal to the normal will do; picked off the smallest component so
    // the cross product never collapses
    let ax=Math.abs(nx)<Math.abs(ny)?(Math.abs(nx)<Math.abs(nz)?[1,0,0]:[0,0,1])
                                    :(Math.abs(ny)<Math.abs(nz)?[0,1,0]:[0,0,1]);
    let ux=ay(ax[1]*nz-ax[2]*ny), uy=ay(ax[2]*nx-ax[0]*nz), uz=ay(ax[0]*ny-ax[1]*nx);
    let ul=Math.hypot(ux,uy,uz); ux/=ul;uy/=ul;uz/=ul;
    const vx=ny*uz-nz*uy, vy=nz*ux-nx*uz, vz=nx*uy-ny*ux;
    return {c:[cx,cy,cz], n:[nx,ny,nz], u:[ux,uy,uz], v:[vx,vy,vz]};
  }
  function ay(x){return x;}
  function polyTriangles(P){
    const n=P.length;
    if(n<3) return [];
    const B=polyPlane(P);
    const uv=P.map(q=>{
      const dx=q[0]-B.c[0], dy=q[1]-B.c[1], dz=q[2]-B.c[2];
      return [dx*B.u[0]+dy*B.u[1]+dz*B.u[2], dx*B.v[0]+dy*B.v[1]+dz*B.v[2]];
    });
    let area2=0;
    for(let i=0;i<n;i++){const a=uv[i], b=uv[(i+1)%n]; area2+=a[0]*b[1]-b[0]*a[1];}
    const ord=[...Array(n).keys()]; if(area2<=0) ord.reverse();
    const Q=ord.map(i=>uv[i]), R=ord.map(i=>P[i]);
    const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    // two segments cross only if each strictly separates the other's ends; touching at a
    // shared vertex is not a crossing, which is why the endpoint cases are excluded above
    const crosses=(p,q,r,s)=>{
      const d1=cr(r,s,p), d2=cr(r,s,q), d3=cr(p,q,r), d4=cr(p,q,s);
      return ((d1>0)!==(d2>0))&&((d3>0)!==(d4>0))&&d1!==0&&d2!==0&&d3!==0&&d4!==0;
    };
    const inside=p=>{
      let c=false;
      for(let i=0,j=n-1;i<n;j=i++){
        const a=Q[i], b=Q[j];
        if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])) c=!c;
      }
      return c;
    };
    // a diagonal may be used only if it stays within the outline: crossing no edge, and with
    // its middle inside. This is what makes the sheet follow the wall into a notch instead of
    // taking the short way across its mouth.
    const okChord=(i,j)=>{
      if(j===i+1||(i===0&&j===n-1)) return true;
      for(let k=0;k<n;k++){
        const k2=(k+1)%n;
        if(k===i||k===j||k2===i||k2===j) continue;
        if(crosses(Q[i],Q[j],Q[k],Q[k2])) return false;
      }
      return inside([(Q[i][0]+Q[j][0])/2,(Q[i][1]+Q[j][1])/2]);
    };
    const ok=[];
    for(let i=0;i<n;i++) ok.push(new Array(n).fill(true));
    for(let i=0;i<n;i++) for(let j=i+2;j<n;j++){const w=okChord(i,j); ok[i][j]=w; ok[j][i]=w;}
    const ar3=(i,j,k)=>{
      const A=R[i], D=R[j], C=R[k];
      const ux=D[0]-A[0], uy=D[1]-A[1], uz=D[2]-A[2];
      const vx=C[0]-A[0], vy=C[1]-A[1], vz=C[2]-A[2];
      return 0.5*Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
    };
    // the classic interval DP: the cheapest triangulation of the piece between i and j,
    // built from the two pieces its last triangle splits it into. O(n^3) on a ring a hand
    // clicked, so a few tens of points at most.
    const solve=strict=>{
      const W=[], M=[];
      for(let i=0;i<n;i++){W.push(new Array(n).fill(0)); M.push(new Array(n).fill(-1));}
      for(let g=2;g<n;g++) for(let i=0;i+g<n;i++){
        const j=i+g;
        if(strict&&!ok[i][j]){W[i][j]=Infinity; continue;}
        let best=Infinity, bm=-1;
        for(let m=i+1;m<j;m++){
          const w=W[i][m]+W[m][j];
          if(!isFinite(w)) continue;
          const t=w+ar3(i,m,j);
          if(t<best){best=t; bm=m;}
        }
        W[i][j]=best; M[i][j]=bm;
      }
      return {W:W,M:M};
    };
    // where the projection folds over itself no diagonal can be validated at all; rather
    // than refuse to measure, the constraint is dropped and the plain minimum is taken
    let S=solve(true);
    if(!isFinite(S.W[0][n-1])) S=solve(false);
    const tris=[], st=[[0,n-1]];
    while(st.length){
      const ij=st.pop(), i=ij[0], j=ij[1];
      if(j<=i+1) continue;
      const m=S.M[i][j];
      if(m<0) continue;
      tris.push([ord[i],ord[m],ord[j]]);
      st.push([i,m]); st.push([m,j]);
    }
    return tris;
  }
  function polyArea(P){
    let s=0;
    for(const [a,b,c] of polyTriangles(P)){
      const A=P[a], B=P[b], C=P[c];
      const ux=B[0]-A[0], uy=B[1]-A[1], uz=B[2]-A[2];
      const vx=C[0]-A[0], vy=C[1]-A[1], vz=C[2]-A[2];
      s+=0.5*Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
    }
    return s;
  }
  function polyRecompute(P){ P.area=polyArea(P.pts); }
  /* ---- 329: THE SMOOTHED SURFACE -----------------------------------------------------------
     Eli, 26/09 (approved): a third tool of an area layer, "מוחלק". The brush marks faces; each
     connected region of them is a free COPY — the layer's colour, no texture, not stitched to
     the model — smoothed by its own level (0-10, ten Taubin passes a level; the rim smoothed
     along itself only, so the copy does not shrink in from its edge). Its area is the painted
     area of its faces, measured as every area here is, times what the smoothing did to the
     copy: at level 0 it IS the painted area. The same text runs in the iPad, and the report
     builder computes it again in Python on the same quantized positions (smooth_surface.py),
     which a gate holds to the digit. 335: a sub-face on the brush's line comes in by its cut
     part (Eli, 29/09: "the same brush as the others"). 381 (Eli, 30/09: one stroke came out as
     many numbered regions): the corners weld at 1e-4 and the pieces join by the brush's rule —
     a shared corner, or 8 cm between their edges. 382 (Eli, 30/09): levels 11-20 go on from
     level 10 to the soap film on its rim, reached at 20. */
  const SM_LAMBDA=0.5, SM_MU=-0.5, SM_PASSES=10, SM_WELD=1e-4, SM_CELL=1e-4, SM_MAXLEVEL=20, SM_SOFT=10, SM_MERGE=0.08;
  const SM_INC_EDGE=0.12;   // 494 (2): the longest edge smPiecesInc's reach is counted in; a longer sub-face is asked apart
  const SM_FILM_ROUNDS=8, SM_CG_MAX=20000, SM_CG_TOL=1e-20, SM_EPS=1e-8, SM_WMIN=1e-3, SM_FILM_STOP=1e-7;   // 434: converged — the server solves it
  // 335: a sub-face on the line comes in by its cut part — triangles given in the sub-face's own
  // barycentrics (b1,b2 per corner, rounded as the sheet carries them); the rest come in whole
  function smCorners(P,f,pc){
    const o=f*9, bb=pc&&pc.get(f);
    if(!bb) return [P[o],P[o+1],P[o+2], P[o+3],P[o+4],P[o+5], P[o+6],P[o+7],P[o+8]];
    const out=[];
    for(let i=0;i+1<bb.length;i+=2){ const b1=bb[i], b2=bb[i+1];
      for(let k=0;k<3;k++) out.push(P[o+k]+b1*(P[o+3+k]-P[o+k])+b2*(P[o+6+k]-P[o+k])); }
    return out;
  }
  // the part of a sub-face its cut triangles cover: their area in barycentric space (whole = 1)
  function smFrac(bb){
    let s=0; for(let i=0;i+5<bb.length;i+=6)
      s+=Math.abs((bb[i+2]-bb[i])*(bb[i+5]-bb[i+1])-(bb[i+3]-bb[i+1])*(bb[i+4]-bb[i]));
    return s;
  }
  // the copy as a mesh: its corners welded where they coincide (the first one met is kept; a
  // triangle the weld collapses is dropped, 381); tf: which of the faces each triangle came from
  function smMesh(P,faces,pc){
    const X=[], T=[], tf=[], tq=[], grid=new Map(), w2=SM_WELD*SM_WELD;   // 385: (i,j) a number, then k — the cells a string named
    for(let a=0;a<faces.length;a++){ const C=smCorners(P,faces[a],pc);
      for(let q=0;q+8<C.length;q+=9){ const tri=[];
        for(let c=0;c<3;c++){ const x=C[q+c*3], y=C[q+c*3+1], z=C[q+c*3+2];
          const i=Math.floor(x/SM_CELL), j=Math.floor(y/SM_CELL), k=Math.floor(z/SM_CELL); let id=-1;
          for(let di=-1;di<=1&&id<0;di++) for(let dj=-1;dj<=1&&id<0;dj++) for(let dk=-1;dk<=1&&id<0;dk++){
            const G2=grid.get((i+di+33554432)*67108864+(j+dj+33554432)); const L=G2&&G2.get(k+dk); if(!L) continue;
            for(const v of L){ const dx=X[v*3]-x, dy=X[v*3+1]-y, dz=X[v*3+2]-z;
              if(dx*dx+dy*dy+dz*dz<=w2){ id=v; break; } } }
          if(id<0){ id=X.length/3; X.push(x,y,z); const kk=(i+33554432)*67108864+(j+33554432);
            let G2=grid.get(kk); if(!G2){ G2=new Map(); grid.set(kk,G2); } let L=G2.get(k); if(!L){ L=[]; G2.set(k,L); } L.push(id); }
          tri.push(id); }
        if(tri[0]!==tri[1]&&tri[1]!==tri[2]&&tri[0]!==tri[2]){ T.push(tri[0],tri[1],tri[2]); tf.push(a); tq.push(q/9); } } }   // 435: and which of its triangles
    return {X:Float64Array.from(X), T:Int32Array.from(T), tf:tf, tq:tq};
  }
  // Taubin, uniform weights: a vertex inside moves toward all its neighbours, a vertex on the
  // rim toward its two neighbours ALONG the rim (a pinch — any other count — stays put)
  function smTaubin(X,T,passes){
    const nV=X.length/3, nF=T.length/3, E=new Map();
    for(let f=0;f<nF;f++) for(let c=0;c<3;c++){ const a=T[f*3+c], b=T[f*3+(c+1)%3];
      const k=a<b?a*nV+b:b*nV+a; E.set(k,(E.get(k)||0)+1); }
    const nb=[], bn=[]; for(let v=0;v<nV;v++){ nb.push([]); bn.push([]); }
    for(const [k,c] of E){ const a=Math.floor(k/nV), b=k-a*nV;
      nb[a].push(b); nb[b].push(a); if(c===1){ bn[a].push(b); bn[b].push(a); } }
    // 385: each vertex's list, in the order it was met, in one flat array (the same sums, faster)
    const O=new Int32Array(nV+1), U=[], FX=new Uint8Array(nV);
    for(let v=0;v<nV;v++){ const L=bn[v].length?bn[v]:nb[v]; if(!L.length||(bn[v].length&&bn[v].length!==2)) FX[v]=1; else for(const u of L) U.push(u); O[v+1]=U.length; }
    const UA=Int32Array.from(U);
    let A=Float64Array.from(X), B=new Float64Array(A.length);
    const step=w=>{
      for(let v=0;v<nV;v++){ const o=v*3;
        if(FX[v]){ B[o]=A[o]; B[o+1]=A[o+1]; B[o+2]=A[o+2]; continue; }
        let sx=0, sy=0, sz=0; for(let q=O[v];q<O[v+1];q++){ const u=UA[q]; sx+=A[u*3]; sy+=A[u*3+1]; sz+=A[u*3+2]; }
        const m=1/(O[v+1]-O[v]);
        B[o]=A[o]+w*(sx*m-A[o]); B[o+1]=A[o+1]+w*(sy*m-A[o+1]); B[o+2]=A[o+2]+w*(sz*m-A[o+2]); }
      const t=A; A=B; B=t; };
    for(let i=0;i<passes;i++){ step(SM_LAMBDA); step(SM_MU); }
    return A;
  }
  // 382: the soap film on the copy's rim — the rim (a pinch, a corner of no edge) held, the rest
  // moved to the surface of least area that spans it: Pinkall-Polthier, a few rounds of the
  // cotangent Laplacian of the surface as it is, each solved by conjugate gradients — until a round
  // no longer lowers the area by a part in ten million (385). Every sum runs in one order, the
  // order smooth_surface.sm_film takes it.
  function smFilm(X,T){
    const nV=X.length/3, nF=T.length/3; if(!nV||!nF) return Float64Array.from(X);
    const E=new Map(), ends=[];
    for(let f=0;f<nF;f++) for(let c=0;c<3;c++){ const a=T[f*3+c], b=T[f*3+(c+1)%3], k=a<b?a*nV+b:b*nV+a;
      const q=E.get(k); if(q) q[1]++; else { E.set(k,[ends.length/2,1]); ends.push(a<b?a:b,a<b?b:a); } }
    const nb=[], fixed=new Uint8Array(nV); for(let v=0;v<nV;v++) nb.push([]);
    for(const [k,q] of E){ const e=q[0], a=ends[e*2], b=ends[e*2+1]; nb[a].push(b,e); nb[b].push(a,e);
      if(q[1]===1){ fixed[a]=1; fixed[b]=1; } }
    let K=1; for(const L of nb) if(L.length/2>K) K=L.length/2;
    const NB=new Int32Array(nV*K), EI=new Int32Array(nV*K).fill(-1);
    for(let v=0;v<nV;v++){ const L=nb[v]; for(let q=0;q<K;q++) NB[v*K+q]=v; if(!L.length) fixed[v]=1;
      for(let q=0;q*2<L.length;q++){ NB[v*K+q]=L[q*2]; EI[v*K+q]=L[q*2+1]; } }
    const Fr=new Float64Array(nV); for(let v=0;v<nV;v++) Fr[v]=fixed[v]?0:1;
    const tri=[], eid=[];
    for(let f=0;f<nF;f++) for(let c=0;c<3;c++){ const a=T[f*3+c], b=T[f*3+(c+1)%3], o=T[f*3+(c+2)%3];
      tri.push(a,b,o); eid.push(E.get(a<b?a*nV+b:b*nV+a)[0]); }
    const nE=ends.length/2, WW=new Float64Array(nV*K), d=new Float64Array(nV);
    const dot=(a,b)=>{ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; };
    const Am=(p,y)=>{ for(let v=0;v<nV;v++){ let s=d[v]*p[v]; for(let q=0;q<K;q++) s=s-WW[v*K+q]*p[NB[v*K+q]]; y[v]=s*Fr[v]; } };
    const yc=new Float64Array(nV), xf=new Float64Array(nV), bv=new Float64Array(nV), x=new Float64Array(nV),
          r=new Float64Array(nV), p=new Float64Array(nV), Ap=new Float64Array(nV), z=new Float64Array(nV);
    let Y=Float64Array.from(X), aY=smArea(Y,T);
    for(let rd=0;rd<SM_FILM_ROUNDS;rd++){
      const w=new Float64Array(nE);
      for(let i=0;i<eid.length;i++){ const a=tri[i*3]*3, b=tri[i*3+1]*3, o=tri[i*3+2]*3;
        const ux=Y[a]-Y[o], uy=Y[a+1]-Y[o+1], uz=Y[a+2]-Y[o+2], vx=Y[b]-Y[o], vy=Y[b+1]-Y[o+1], vz=Y[b+2]-Y[o+2];
        const cx=uy*vz-uz*vy, cy=uz*vx-ux*vz, cz=ux*vy-uy*vx, cl=Math.sqrt(cx*cx+cy*cy+cz*cz);
        if(cl>0) w[eid[i]]+=0.5*((ux*vx+uy*vy+uz*vz)/cl); }
      for(let v=0;v<nV;v++){ let s=0;
        for(let q=0;q<K;q++){ const e=EI[v*K+q]; WW[v*K+q]=e>=0?(w[e]>SM_WMIN?w[e]:SM_WMIN):0; s=s+WW[v*K+q]; }
        d[v]=s+SM_EPS; }
      const Yn=new Float64Array(nV*3);
      for(let c=0;c<3;c++){
        for(let v=0;v<nV;v++){ yc[v]=Y[v*3+c]; xf[v]=yc[v]*(1-Fr[v]); }
        for(let v=0;v<nV;v++){ let s=SM_EPS*yc[v]; for(let q=0;q<K;q++) s=s+WW[v*K+q]*xf[NB[v*K+q]]; bv[v]=s*Fr[v]; x[v]=yc[v]*Fr[v]; }
        Am(x,Ap); for(let v=0;v<nV;v++){ r[v]=bv[v]-Ap[v]; z[v]=r[v]*Fr[v]/d[v]; p[v]=z[v]; }   // 434: Jacobi
        let rr=dot(r,r), rz=dot(r,z); const bb=dot(bv,bv);
        for(let it=0;it<SM_CG_MAX;it++){
          if(rr<=SM_CG_TOL*bb) break;
          Am(p,Ap); const pAp=dot(p,Ap); if(!(pAp>0)) break;
          const al=rz/pAp;
          for(let v=0;v<nV;v++){ x[v]=x[v]+al*p[v]; r[v]=r[v]-al*Ap[v]; z[v]=r[v]*Fr[v]/d[v]; }
          const rzn=dot(r,z), be=rzn/rz;
          for(let v=0;v<nV;v++) p[v]=z[v]+be*p[v];
          rr=dot(r,r); rz=rzn; }
        for(let v=0;v<nV;v++) Yn[v*3+c]=xf[v]+x[v]; }
      Y=Yn; const aN=smArea(Y,T), gain=aY-aN; aY=aN; if(gain<=SM_FILM_STOP*aN) break; }
    return Y;
  }
  function smArea(X,T){
    let s=0; for(let f=0;f<T.length;f+=3){ const a=T[f]*3, b=T[f+1]*3, c=T[f+2]*3;
      const ux=X[b]-X[a], uy=X[b+1]-X[a+1], uz=X[b+2]-X[a+2], vx=X[c]-X[a], vy=X[c+1]-X[a+1], vz=X[c+2]-X[a+2];
      s+=0.5*Math.sqrt((uy*vz-uz*vy)**2+(uz*vx-ux*vz)**2+(ux*vy-uy*vx)**2); }
    return s;
  }
  // one region: its copy smoothed to its level, and its area — the painted area of its sub-faces
  // (a cut one by its part, 335) times what the smoothing did to the copy. memo (the screen's):
  // the mesh, level 10 and the film of the same marking, kept while the wheel turns
  // 433: a layer's level turns every region at once — each level's copy is kept, and the next one
  // goes on from the nearest kept below it (the same passes, in the same order, as from the start)
  function smTaubinTo(M,lv,memo){ if(!memo) return smTaubin(M.X,M.T,SM_PASSES*lv);
    if(!memo.Xl) memo.Xl=[]; if(memo.Xl[lv]) return memo.Xl[lv];
    let k=lv-1; while(k>0&&!memo.Xl[k]) k--;
    const X=smTaubin(k>0?memo.Xl[k]:M.X,M.T,SM_PASSES*(lv-k)); memo.Xl[lv]=X; if(lv===SM_SOFT) memo.X10=X; return X; }
  function smRegion(P,AREA,faces,level,pc,memo){
    const fs=Array.from(faces).sort((a,b)=>a-b), lv=Math.max(0,Math.min(SM_MAXLEVEL,Math.round(level||0)));
    let painted=0; for(const f of fs){ const bb=pc&&pc.get(f); painted+=bb?AREA[f]*Math.min(1,smFrac(bb)):AREA[f]; }
    const M=(memo&&memo.M)||smMesh(P,fs,pc); if(memo) memo.M=M;
    if(!lv||!fs.length) return {X:M.X, T:M.T, area:painted, painted:painted, level:lv};
    const a0=smArea(M.X,M.T); let Xs;
    if(lv<=SM_SOFT){ Xs=smTaubinTo(M,lv,memo); }
    else { const X10=smTaubinTo(M,SM_SOFT,memo), F=(memo&&memo.F)||smFilm(X10,M.T);
      if(memo){ memo.X10=X10; memo.F=F; }
      const t=(lv-SM_SOFT)/SM_SOFT; Xs=new Float64Array(X10.length);
      for(let i=0;i<X10.length;i++) Xs[i]=X10[i]+t*(F[i]-X10[i]); }
    const a1=smArea(Xs,M.T);
    return {X:Xs, T:M.T, area:painted*(a0>0?a1/a0:1), painted:painted, level:lv};
  }
  // the connected pieces of a set of sub-faces, by shared corner position (a stroke that
  // touches a region joins it; an erasure that cuts one through splits it) — and, by the brush's
  // rule (381), two pieces whose edge sub-faces come within 8 cm of each other are one
  function smPieces(P,faces,pc,memo){
    const fs=Array.from(faces).sort((a,b)=>a-b); if(!fs.length) return [];
    const M=(memo&&memo.M)||smMesh(P,fs,pc), n=fs.length, par=new Int32Array(n); for(let i=0;i<n;i++) par[i]=i;
    if(memo) memo.M=M;
    const find=x=>{ while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
    const uni=(a,b)=>{ const r1=find(a), r2=find(b); if(r1!==r2) par[Math.max(r1,r2)]=Math.min(r1,r2); };
    // 436 (Eli, 04/10: "very slow, stuck all the time"): the same pieces, kept in flat arrays — the
    // Maps took a second on a layer of 130,000 sub-faces, after every stroke
    const nV=M.X.length/3, nt=M.tf.length, owner=new Int32Array(nV).fill(-1), K=new Float64Array(nt*3);
    for(let t=0;t<nt;t++){ const a=M.tf[t];
      for(let c=0;c<3;c++){ const v=M.T[t*3+c], u=M.T[t*3+(c+1)%3]; K[t*3+c]=v<u?v*nV+u:u*nV+v;
        const o=owner[v]; if(o>=0) uni(a,o); else owner[v]=a; } }
    const S=Float64Array.from(K).sort(), once=k=>{ let lo=0, hi=S.length; while(lo<hi){ const m=(lo+hi)>>1; if(S[m]<k) lo=m+1; else hi=m; }
      return !(lo+1<S.length&&S[lo+1]===k); };            // an edge only one triangle has
    const bnd=new Uint8Array(n), has=new Uint8Array(n);
    for(let t=0;t<nt;t++){ const a=M.tf[t]; has[a]=1;
      for(let c=0;c<3;c++) if(!bnd[a]&&once(K[t*3+c])) bnd[a]=1; }
    const G=new Map(), C=new Float64Array(n*3), D2=SM_MERGE*SM_MERGE;
    for(let a=0;a<n;a++){ if(has[a]&&!bnd[a]) continue; const o=fs[a]*9;
      const x=(P[o]+P[o+3]+P[o+6])/3, y=(P[o+1]+P[o+4]+P[o+7])/3, z=(P[o+2]+P[o+5]+P[o+8])/3; C[a*3]=x; C[a*3+1]=y; C[a*3+2]=z;
      const i=Math.floor(x/SM_MERGE), j=Math.floor(y/SM_MERGE), k=Math.floor(z/SM_MERGE);
      for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++) for(let dk=-1;dk<=1;dk++){
        const L=G.get(((i+di+33554432)*67108864+(j+dj+33554432))*4096+((k+dk)&4095)); if(!L) continue;
        for(const b of L){ const dx=C[b*3]-x, dy=C[b*3+1]-y, dz=C[b*3+2]-z; if(dx*dx+dy*dy+dz*dz<=D2) uni(a,b); } }
      const kk=((i+33554432)*67108864+(j+33554432))*4096+(k&4095); let L=G.get(kk); if(!L){ L=[]; G.set(kk,L); } L.push(a); }
    const by=new Map(); for(let a=0;a<n;a++){ const r=find(a); if(!by.has(r)) by.set(r,[]); by.get(r).push(fs[a]); }
    return [...by.values()];
  }
  // 494 (2) — Eli: "the brushes that work on the whole layer at every stroke". The layer's pieces (smPieces: a shared
  // corner, or 8 cm between edges) were found again from ALL its marking after every stroke: on «קטע טוב» half a second
  // for 86,000 sub-faces a stroke did not reach. K keeps the last answer (K.smPrev). What changed — a sub-face in one
  // marking and not the other, or its cut part not the same — can join or split only the pieces near it: a sub-face
  // whose corners or rim change shares a corner with a changed one, and what it may then meet shares a corner with it
  // or is within 8 cm. With every edge on that chain no longer than SM_INC_EDGE, all of it lies within four such edges
  // and 8 cm of a changed sub-face — a piece with nothing there is the same piece, and is kept; the rest, with the new
  // sub-faces, go through smPieces itself, and the pieces come back in its order (by their first sub-face). A longer
  // sub-face (a patch's, a large scan face) is asked apart, by its box, as the red's long faces are (ccLongFaces): one
  // near a change, or a change that is one, and it is smPieces on all of it, as before. So too a reach of more than
  // 12 cells, a third of the marking changed, more than 2,000 long sub-faces, or no last answer.
  function smPiecesInc(K,P,faces,pc,memoFor){
    const fs=Array.from(faces).sort((a,b)=>a-b), q=K.smPrev, NFp=(P.length/9)|0, LC=SM_INC_EDGE;
    const edge=f=>{ const o=f*9; return Math.max(Math.hypot(P[o+3]-P[o],P[o+4]-P[o+1],P[o+5]-P[o+2]),
      Math.hypot(P[o+6]-P[o+3],P[o+7]-P[o+4],P[o+8]-P[o+5]),Math.hypot(P[o]-P[o+6],P[o+1]-P[o+7],P[o+2]-P[o+8])); };
    const box=f=>{ const o=f*9, lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
      for(let c=0;c<3;c++) for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],P[o+c*3+k]); hi[k]=Math.max(hi[k],P[o+c*3+k]); } return {f:f,lo:lo,hi:hi}; };
    const store=(out,long,pof,byId,seq)=>{ K.smPrev={P:P, F:Int32Array.from(fs), pc:new Map(pc), out:out, long:long, pof:pof, byId:byId, seq:seq}; return out.map(p=>p.slice()); };
    const full=why=>{ K.smPrevFull=(K.smPrevFull||0)+1; K.smWhy=why||'';
      const out=fs.length?smPieces(P,fs,pc,memoFor?memoFor(fs,pc):null):[];   // as before 494: its mesh kept in the screen's memo (an undo finds it)
      const long=[]; for(const f of fs) if(edge(f)>LC) long.push(box(f));
      const pof=new Int32Array(NFp).fill(-1), byId=new Map(); let seq=0;
      for(const p of out){ const id=seq++; byId.set(id,p); for(const f of p) pof[f]=id; }
      return store(out,long,pof,byId,seq); };
    if(!q||q.P!==P||q.pof.length!==NFp||!fs.length||typeof grid==='undefined'||typeof cen==='undefined') return full('first');
    const same=(a,b)=>{ if(!a||!b) return !a&&!b; if(a.length!==b.length) return false; for(let k=0;k<a.length;k++) if(a[k]!==b[k]) return false; return true; };
    const F0=q.F, D=[]; let i=0, j=0;
    while(i<F0.length||j<fs.length){ const a=i<F0.length?F0[i]:Infinity, b=j<fs.length?fs[j]:Infinity;
      if(a<b){ D.push(a); i++; } else if(b<a){ D.push(b); j++; }
      else { if((q.pc.has(a)||pc.has(a))&&!same(q.pc.get(a),pc.get(a))) D.push(a); i++; j++; } }
    if(!D.length){ K.smPrevKept=(K.smPrevKept||0)+1; return store(q.out,q.long,q.pof,q.byId,q.seq); }
    if(D.length*3>fs.length||q.long.length>2000) return full(D.length*3>fs.length?'third':'long faces');
    for(const f of D) if(edge(f)>LC) return full('long change');     // a long sub-face came, went or changed
    // every changed sub-face must be in the screen's grid, in its own cell — the grid is what finds what is near
    for(const f of D){ const G=grid.get(ckey(Math.floor(cen[f*3]/CELL),Math.floor(cen[f*3+1]/CELL),Math.floor(cen[f*3+2]/CELL))); if(!G||G.indexOf(f)<0) return full('grid'); }
    const R=4*LC+SM_MERGE+1e-3, ns=Math.ceil(R/CELL)+1;
    if(ns>12) return full('reach');
    const inNew=new Uint8Array(NFp); for(const f of fs) inNew[f]=1;
    // a long sub-face whose box is within the reach of a change: smPieces on all of it
    if(q.long.length){ const dl=[Infinity,Infinity,Infinity], dh=[-Infinity,-Infinity,-Infinity];
      for(const f of D) for(let k=0;k<3;k++){ dl[k]=Math.min(dl[k],cen[f*3+k]); dh[k]=Math.max(dh[k],cen[f*3+k]); }
      for(const g of q.long){ if(!inNew[g.f]) continue;
        if(g.hi[0]+R<dl[0]||g.lo[0]-R>dh[0]||g.hi[1]+R<dl[1]||g.lo[1]-R>dh[1]||g.hi[2]+R<dl[2]||g.lo[2]-R>dh[2]) continue;
        for(const f of D){ const x=cen[f*3], y=cen[f*3+1], z=cen[f*3+2];
          if(x>=g.lo[0]-R&&x<=g.hi[0]+R&&y>=g.lo[1]-R&&y<=g.hi[1]+R&&z>=g.lo[2]-R&&z<=g.hi[2]+R) return full('long near'); } } }
    const hit=new Set(), seen=new Set();
    for(const f of D){ const ix=Math.floor(cen[f*3]/CELL), iy=Math.floor(cen[f*3+1]/CELL), iz=Math.floor(cen[f*3+2]/CELL);
      for(let a=-ns;a<=ns;a++) for(let b=-ns;b<=ns;b++) for(let c=-ns;c<=ns;c++){
        const key=ckey(ix+a,iy+b,iz+c); if(seen.has(key)) continue; seen.add(key);
        const G=grid.get(key); if(!G) continue;
        for(const g of G){ const id=q.pof[g]; if(id>=0) hit.add(id); } } }
    // what is asked again: the pieces near a change, as they are now, and the sub-faces that came
    const A=[]; for(const id of hit) for(const f of q.byId.get(id)) if(inNew[f]) A.push(f);
    for(const f of D) if(inNew[f]&&q.pof[f]<0) A.push(f);
    if(A.length*5>fs.length*3) return full('most');
    A.sort((a,b)=>a-b);
    const pcA=new Map(); for(const f of A) if(pc.has(f)) pcA.set(f,pc.get(f));
    const fresh=A.length?smPieces(P,A,pcA,null):[];
    const pof=q.pof, byId=q.byId; let seq=q.seq;
    for(const id of hit){ for(const f of byId.get(id)) pof[f]=-1; byId.delete(id); }
    for(const f of D) pof[f]=-1;
    for(const p of fresh){ const id=seq++; byId.set(id,p); for(const f of p) pof[f]=id; }
    const out=[...byId.values()].sort((a,b)=>a[0]-b[0]);
    K.smPrevLocal=(K.smPrevLocal||0)+1; K.smPrevAsked=A.length;
    return store(out,q.long.filter(g=>inNew[g.f]),pof,byId,seq);
  }   // 494 (2)
  /* ---- end 329 core ---------------------------------------------------------------------- */
  // 329: the regions, their copies on the screen, and the brush that marks them
  const AM_SMOOTH='smooth';
  const smGroup=new THREE.Group(); scene.add(smGroup);
  var SMR=[], smSeq=0, smSel=null, smStroke=null, smLive=new Uint8Array(N), smWheelFrom=null, smWheelT=0;
  /* 335 (Eli, 29/09: the smoothed-surface brush "was not built with the brushes' fixes — it
     paints whole faces and not by the brush's shape"): it draws the SMOOTH LINE, as every brush
     does since 317-325. Each layer keeps, for this tool, the whole sub-faces its strokes took
     (S), the strokes' balls (ops) and what the line crosses, cut (band, pieces) — the 324 engine
     on a state of its own, as the volume brush has one (325). A region is a connected piece of
     what that marks; a sub-face on the line joins it by its cut part, in barycentrics rounded
     as the sheet carries them, so the screen and the report build the copy from the same
     numbers. What a region's deletion took away while the line still cuts there (X) is held
     out until a stroke paints there again. */
  const smTs=new Map();
  var smLiveT=null, smOp=null, smBefore=null, smMarkAt=0;
  const smQ=v=>Math.round(v*1e4)/1e4;
  function smT(at){ let t=smTs.get(at); if(t) return t;
    const L=()=>types.find(q=>q.id===at)||{};
    t={at:at, S:new Uint8Array(N), X:new Uint8Array(N), ops:[], band:new Set(), pieces:new Map(), hid:false,
       get color(){ return L().color||[0.220,0.690,0.000]; }, get op(){ const o=L().op; return (typeof o==='number')?o:0.75; },
       get design(){ return L().design; }};
    smTs.set(at,t); return t; }
  // what the layer's smooth marking holds: whole sub-faces, and the cut ones by their part
  function smMarked(t){ const fs=[], pc=new Map();
    for(let f=0;f<N;f++){ if(t.X[f]) continue;
      if(t.band.has(f)){ const q=t.pieces.get(f); if(q&&q.fr>1e-6){ fs.push(f); pc.set(f,q.bb.map(smQ)); } }
      else if(t.S[f]) fs.push(f); }
    return {faces:fs, pc:pc}; }
  // 382: the copy's mesh, its level 10 and its film, kept per marking — the wheel turns over them
  const smMemoC=new Map();
  function smMemoFor(faces,pc){ const k=smMemoKey(faces,pc);
    let m=smMemoC.get(k.k); if(m&&!smMemoSame(m.key,k)) m=null;
    if(!m){ if(smMemoC.size>=48) smMemoC.clear(); m={key:k}; smMemoC.set(k.k,m); } return m; }
  // 494 (2): the memo's key — the faces in their order and the cut parts in theirs, as the text of them all joined
  // was (a string of every face number, built at every call), hashed; the entry keeps the sequence, so a hit is checked
  function smMemoKey(faces,pc){
    let h=2166136261>>>0; const mix=v=>{ h=Math.imul(h^(v|0),16777619)>>>0; };
    const F=Int32Array.from(faces); for(let i=0;i<F.length;i++) mix(F[i]);
    const C=[]; if(pc&&pc.size) for(const [f,bb] of pc){ mix(f); C.push(f,bb.length); for(const b of bb){ mix(Math.round(b*1e4)); C.push(b); } }
    return {k:h+':'+F.length+':'+C.length, F:F, C:C};
  }
  function smMemoSame(a,b){
    if(!a||a.F.length!==b.F.length||a.C.length!==b.C.length) return false;
    for(let i=0;i<a.F.length;i++) if(a.F[i]!==b.F[i]) return false;
    for(let i=0;i<a.C.length;i++) if(a.C[i]!==b.C[i]) return false;
    return true;
  }
  function smMemoOf(r){ return smMemoFor(r.faces,r.pc); }
  /* 385 (Eli, 30/09, option א): the film of a large region is built in the background — the screen
     does not stop; until it is ready the region shows level 10 and the bar says "בונה משטח מוחלק…".
     The worker runs the same smFilm text, so what it returns is what the screen would have made. */
  const SM_BG_FACES=6000;
  var smW=null, smWSeq=0; const smWJobs=new Map();
  function smWorker(){
    if(smW!==null) return smW;
    if(typeof amFilmServer==='function'){ smW={postMessage:d=>amFilmServer(d)}; return smW; }   // 434: the report's own film
    try{ const src='const SM_FILM_ROUNDS='+SM_FILM_ROUNDS+', SM_CG_MAX='+SM_CG_MAX+', SM_CG_TOL='+SM_CG_TOL+', SM_EPS='+SM_EPS+
          ', SM_WMIN='+SM_WMIN+', SM_FILM_STOP='+SM_FILM_STOP+';\n'+smArea.toString()+'\n'+smFilm.toString()+
          '\nonmessage=e=>{ const F=smFilm(e.data.X,e.data.T); postMessage({id:e.data.id,F:F},[F.buffer]); };';
      smW=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
      smW.onmessage=e=>{ const m=smWJobs.get(e.data.id); smWJobs.delete(e.data.id); if(m){ m.F=e.data.F; m.job=0; } smFilmDone(); };
      smW.onerror=ev=>{ if(ev&&ev.preventDefault) ev.preventDefault(); smW=false; for(const m of smWJobs.values()) m.job=0; smWJobs.clear(); smFilmDone(); };
    }catch(_){ smW=false; }
    return smW;
  }
  function smBusyShow(on){ const e=document.getElementById('smBusy'); if(e) e.style.display=on?'':'none'; }
  // 524 (Eli, 13/10: "כשאני מחזיר את ההחלקה ל-0, עדיין יש הודעה מתחת לגלגלת: 'בונה משטח מוחלק'"): the word under the
  // wheel is the OPEN layer's — its regions still waiting for their film (and, on the measurement screen, the volume
  // layer's copy). It was any region of any layer, so a layer turned to 0 kept the word while another's films queued
  function smBusyNow(){
    if(typeof volSmWait!=='undefined'&&volSmWait&&activeKind==='vol') return true;
    const T=(activeKind==='area')?types[activeT]:null;
    return !!T&&SMR.some(r=>r.pending&&r.at===T.id);
  }
  // 523 (Eli, 13/10: the iPad warms up in the smoothing brush with many marks, whatever the model's size): a film sent
  // to the worker ran to its end even when no region wanted it any more — every stroke changes a region's faces, so
  // every stroke queued another film behind the ones the strokes before it had already made useless. After every change
  // to the regions, a worker running films no region waits for is stopped and started again with only the wanted ones;
  // the films the server makes (the measurement screen) are left to come back and are dropped, as before. Then the word
  function smJobsTidy(){
    if(typeof smWJobs!=='undefined'&&smW&&typeof smW.terminate==='function'&&smWJobs.size){
      const need=new Set(); for(const r of SMR) if(r.pending){ const m=smMemoOf(r); if(m&&m.job) need.add(m.job); }
      let stale=false; for(const id of smWJobs.keys()) if(!need.has(id)){ stale=true; break; }
      if(stale){
        const keep=[]; for(const [id,m] of smWJobs) if(need.has(id)) keep.push(m);
        for(const m of smWJobs.values()) m.job=0;
        smWJobs.clear(); smW.terminate(); smW=null;
        if(keep.length&&smWorker()) for(const m of keep){ m.job=++smWSeq; smWJobs.set(m.job,m); smW.postMessage({id:m.job,X:m.X10,T:m.M.T}); }
      }
    }
    smBusyShow(smBusyNow());
  }
  // a film came back (or the worker is gone): the regions that waited for it take their level
  // 436: films that come back together (a layer's regions, each its own) make ONE redraw — each made its own,
  // half a second of every layer's copies a film, and a level turned on a layer of eleven regions froze for six
  var smFilmT=0;
  function smFilmDone(){ clearTimeout(smFilmT); smFilmT=setTimeout(smFilmApply,40); }
  function smFilmApply(){ let busy=false, ch=false;
    for(const r of SMR) if(r.pending){ const m=smMemoOf(r); if(m.F||!smWorker()){ smCompute(r); ch=true; } else busy=true; }
    smBusyShow(smBusyNow()); if(ch){ smRebuild(); updateArea(); } }   // 524: the open layer's
  function smCompute(r){ const m=smMemoOf(r);
    if(r.level>SM_SOFT&&!m.F&&(r.faces.length>SM_BG_FACES||typeof amFilmServer==='function')&&smWorker()){
      const g=smRegion(pos,area,r.faces,SM_SOFT,r.pc,m); r.X=g.X; r.T=g.T; r.area=g.area; r.pending=true;
      if(!m.job){ m.job=++smWSeq; smWJobs.set(m.job,m); smW.postMessage({id:m.job,X:m.X10,T:m.M.T}); }
      return; }                                       // 524: the word is set by whoever asked, for the open layer
    const g=smRegion(pos,area,r.faces,r.level,r.pc,m); r.X=g.X; r.T=g.T; r.area=g.area; r.level=g.level; r.pending=false; }
  function smSnap(at){ const t=smT(at), S=[], X=[];
    for(let f=0;f<N;f++){ if(t.S[f]) S.push(f); if(t.X[f]) X.push(f); }
    return {S:S, X:X, ops:t.ops.slice(),
            regs:SMR.filter(r=>r.at===at).map(r=>({id:r.id,level:r.level,faces:r.faces.slice(),pc:r.pc||null}))}; }
  // the layer back to a snapshot — its marking (the line asked again unless it already is) and
  // its regions
  // 373 (ב): what makes a region's copy — its faces, its cut parts and its level — as one number
  function smSig(r){
    let h=2166136261>>>0; const mix=v=>{ h=Math.imul(h^(v|0),16777619)>>>0; };
    mix(Math.round(r.level||0)); const fs=Array.from(r.faces).sort((a,b)=>a-b); mix(fs.length);
    for(const f of fs){ mix(f); const bb=r.pc&&r.pc.get?r.pc.get(f):null; if(bb) for(const b of bb) mix(Math.round(b*1e4)); }
    return h+':'+fs.length;
  }
  function smSetLayer(at,snap,fresh){ const t=smT(at);
    if(!fresh){ t.S.fill(0); for(const f of snap.S) t.S[f]=1; t.X.fill(0); for(const f of snap.X) t.X[f]=1;
      t.ops=snap.ops.slice(); amMarkFull(t); }
    // 373 (ב): a region whose faces, cuts and level did not change keeps the copy it has — the
    // smoothing is redone only where the stroke changed something (it was every region of the layer)
    const keep=new Map(); for(const r of SMR) if(r.at===at&&r.X) keep.set(smSig(r),r);
    for(let i=SMR.length-1;i>=0;i--) if(SMR[i].at===at) SMR.splice(i,1);
    for(const q of snap.regs){ const r={id:q.id,at:at,level:q.level,faces:q.faces.slice(),pc:q.pc||null};
      const o=keep.get(smSig(r)); if(o){ r.X=o.X; r.T=o.T; r.area=o.area; r.level=o.level; r.pending=o.pending; } else smCompute(r); SMR.push(r); }
    if(smSel) smSel=SMR.find(r=>r.id===smSel.id)||null;
    smSyncWheel(); smRebuild(); updateArea(); markDirty(); smJobsTidy();   // 523, 524
  }
  function smWheelLevel(){ const e=document.getElementById('smLevel'); return e?Math.max(0,Math.min(SM_MAXLEVEL,Math.round(+e.value||0))):3; }
  function smSyncWheel(){ const e=document.getElementById('smLevel'), v=document.getElementById('smLevelV');
    if(!e) return; if(smSel) e.value=smSel.level; if(v) v.textContent=e.value; }
  const smKey=L=>JSON.stringify(L.map(q=>[q.id,q.level,q.faces,q.pc?[...q.pc]:0]));
  function smCommitLayer(at,before,after,fresh){
    if(smKey(before.regs)===smKey(after.regs)) return false;
    undoStack.push([['SMR',{at:at,before:before,after:after}]]); redoStack.length=0; updateHB();
    smSetLayer(at,after,fresh); return true;
  }
  // the regions of what the layer marks now: its connected pieces, in the order the regions had —
  // a piece keeps the id and level of the region most of it came from (the largest piece of a
  // region that was cut through keeps it), a piece that is all new takes the wheel's level
  function smDerive(at,before){
    const M=smMarked(smT(at)), owner=new Map();
    for(const q of before.regs) for(const f of q.faces) owner.set(f,q);
    const used=new Map(), fresh=[];
    for(const piece of smPieces(pos,M.faces,M.pc,smMemoFor(M.faces,M.pc)).sort((a,b)=>b.length-a.length)){   // 385: its mesh kept for the region
      const cnt=new Map(); for(const f of piece){ const q=owner.get(f); if(q) cnt.set(q,(cnt.get(q)||0)+1); }
      let best=null, bn=0; for(const [q,n] of cnt) if(n>bn&&!used.has(q)){ best=q; bn=n; }
      const pc=new Map(); for(const f of piece) if(M.pc.has(f)) pc.set(f,M.pc.get(f));
      const r={id:best?best.id:null, level:best?best.level:smWheelLevel(), faces:piece, pc:pc.size?pc:null};
      if(best) used.set(best,r); else fresh.push(r); }
    const regs=[]; for(const q of before.regs) if(used.has(q)) regs.push(used.get(q));
    for(const r of fresh){ r.id='s'+(++smSeq); regs.push(r); }
    return regs;
  }
  /* 433 (Eli, 02/10; the plan approved 03/10, and: "the smoothing works at once on all the brush's
     marks in the layer, there is no level per region"): ONE brush. The smoothed tool's own marking
     is gone; a layer has a level (T.sm, 0-20) that smooths every region its brush marks. At 0 it is
     the brush as it always was — no copy, no rim. Above 0 each connected region (the brush's 8 cm
     rule, smPieces) has its copy at the layer's level and is counted by it, as the smoothed tool
     counted (329/335/382). The regions are found again from the brush's marking whenever it changes
     (smSyncSoon, from updateArea), never while a stroke is down. */
  const SM_TINY=0.01;   // m2: the report's MIN — a smaller region is a small patch of the brush
  function smLevelOf(T){ return Math.max(0,Math.min(SM_MAXLEVEL,Math.round((T&&T.sm)||0))); }
  // what the layer's brush measures: whole sub-faces off its line, and those on it by their part
  function smBrushMarked(T,ti){ const fs=[], pc=new Map(), B=T.band;
    for(let f=0;f<N;f++) if(isType(ti,f)&&!(B&&B.has(f))) fs.push(f);
    if(T.pieces) for(const [f,q] of T.pieces){ if(q.fr>1e-6){ fs.push(f); pc.set(f,q.bb.map(smQ)); } }
    fs.sort((a,b)=>a-b); return {faces:fs, pc:pc}; }
  function smLayerSync(ti){ const T=types[ti]; if(!T) return false;
    const lv=smLevelOf(T), M=lv?smBrushMarked(T,ti):{faces:[],pc:new Map()};
    const sig=lv?smSig({level:lv,faces:M.faces,pc:M.pc}):'0';
    if(T._smSig===sig) return false; T._smSig=sig;
    // a region whose faces, cuts and level did not change keeps the copy it has (373 ב)
    const keep=new Map(); for(const r of SMR) if(r.at===T.id&&r.X) keep.set(smSig(r),r);
    for(let i=SMR.length-1;i>=0;i--) if(SMR[i].at===T.id) SMR.splice(i,1);
    if(lv&&M.faces.length) for(const piece of smPiecesInc(T,pos,M.faces,M.pc,smMemoFor)){   // 494 (2): only near what the stroke changed
      const pc=new Map(); for(const f of piece) if(M.pc.has(f)) pc.set(f,M.pc.get(f));
      // a speck under SM_TINY stays the brush's — the report's own threshold puts it with the small patches
      let pa=0; for(const f of piece){ const bb=pc.get(f); pa+=bb?area[f]*Math.min(1,smFrac(bb)):area[f]; } if(pa<SM_TINY) continue;
      const r={id:'s'+piece[0]+'-'+T.id, at:T.id, level:lv, faces:piece, pc:pc.size?pc:null, painted:pa};   // 435: the layer in the id — two layers may start at one sub-face
      const o=keep.get(smSig(r)); if(o){ r.X=o.X; r.T=o.T; r.area=o.area; r.pending=o.pending; } else smCompute(r);
      SMR.push(r); }
    return true; }
  var smSyncT=0;
  function smSyncSoon(){ clearTimeout(smSyncT); smSyncT=setTimeout(smSyncNow,600); }   // 436: once the brush rests, not between strokes
  function smSyncNow(){ clearTimeout(smSyncT);
    if(typeof amLive!=='undefined'&&amLive){ smSyncSoon(); return; }      // not while a stroke is down
    let ch=false; for(let ti=0;ti<types.length;ti++) if(smLayerSync(ti)) ch=true;
    if(ch){ smRebuild(); updateArea(); } smWheelShow();
  // the bar's word follows the open layer's films still being built — none left, no word (524); unwanted films stop (523)
  smJobsTidy(); }
  // 433: what of a layer's marking reaches the report as the brush's: all of it at level 0; at a level,
  // only what no smoothed region took (its specks)
  function smBrushLeft(T,d){ if(!(smLevelOf(T)>0)) return d;
    const In=new Set(); for(const r of SMR) if(r.at===T.id) for(const f of r.faces) In.add(f); if(!In.size) return d;
    const fr=new Map(d.frac), fs=d.faces.filter(f=>!In.has(f)); let a=0; for(const f of fs) a+=(fr.has(f)?fr.get(f):1)*area[f];
    return {a:a, faces:fs, frac:d.frac.filter(q=>!In.has(q[0])), pieces:d.pieces.filter(q=>!In.has(q[0]))}; }
  // the wheel shows the open layer's level
  function smWheelShow(){ smBusyShow(smBusyNow());   // 524: another layer opened — its own word
    const e=document.getElementById('smLevel'), v=document.getElementById('smLevelV'); if(!e) return;
    if(activeKind==='area'&&types[activeT]){ e.value=smLevelOf(types[activeT]); if(v) v.textContent=e.value; } }
  function smRemoveRegion(r){ const at=r.at, before=smSnap(at), t=smT(at);
    for(const f of r.faces){ if(r.pc&&r.pc.has(f)) t.X[f]=1; else t.S[f]=0; }
    const after=smSnap(at); after.regs=before.regs.filter(q=>q.id!==r.id);
    if(!smCommitLayer(at,before,after,true)){ smSetLayer(at,before); return; }
    if(smSel===r) smSel=null; smRebuild(); }
  // the brush: the sub-faces under it, the same ball (or flat cut) every face brush uses, and
  // the stroke's balls, whose line cuts the sub-faces it crosses
  function smBegin(){ const T=types[activeT]; if(!T) return null;
    const t=smT(T.id); smBefore=smSnap(T.id);
    smOp={t:'balls', c:[], r:brushR, s:(mode==='rem')?-1:1}; t.ops.push(smOp); amSeen.set(smOp,0);
    if(mode==='rem'){ smEraseReg=new Map(); for(const q of smBefore.regs) for(const f of q.faces) smEraseReg.set(f,(q.pc&&q.pc.get(f))||null); }
    smLiveT=t; return t; }
  /* 389 (Eli, 30/09: "the red has to show only where it overlaps a smoothed surface and not
     outside its edge, and on the smooth line and not in whole faces"): while the eraser is down,
     the red is where the stroke's balls meet the regions as they were when it began — a sub-face
     of a region by the part of it inside the balls, a cut one (335) by the part of its own part;
     nothing outside a region. Asked again only near the hand, drawn over the model, and gone when
     the hand lifts. */
  var smEraseReg=null, smRed=new Map(), smRedMesh=null;
  function smRedAt(f,op){
    const bb=smEraseReg.get(f), E={faces:null, ops:[{t:'balls',c:op.c,r:op.r,s:1}], inv:true, cur:f};
    E._ix=ccIndex(E.ops);
    let tris;
    if(!bb) tris=ccCutFace(f,[0],[E]);
    else { tris=[]; const P0=ccCorner(f,0), P1=ccCorner(f,1), P2=ccCorner(f,2);
      for(let i=0;i+5<bb.length;i+=6){ const P=[], B=[];
        for(let c=0;c<3;c++){ const b1=bb[i+c*2], b2=bb[i+c*2+1];
          P.push([0,1,2].map(k=>P0[k]+b1*(P1[k]-P0[k])+b2*(P2[k]-P0[k]))); B.push([1-b1-b2,b1,b2]); }
        E.cur=f; for(const t of ccClipTri(P,B,E)) tris.push(t); } }
    const X=[]; for(const [p] of tris) for(let c=0;c<3;c++) X.push(p[c][0],p[c][1],p[c][2]);
    return X;
  }
  function smRedDraw(){
    if(!THREE.Mesh) return;
    let n=0; for(const X of smRed.values()) n+=X.length;
    if(smRedMesh&&(!n||smRedMesh.userData.cap<n)){ scene.remove(smRedMesh); smRedMesh.geometry.dispose(); smRedMesh.material.dispose(); smRedMesh=null; }
    if(!n){ invalidate(); return; }
    if(!smRedMesh){ let cap=9*1024; while(cap<n) cap*=2;
      const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(cap),3));
      smRedMesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xc71f37,transparent:true,opacity:0.8,depthTest:false,side:THREE.DoubleSide}));
      smRedMesh.userData.cap=cap; smRedMesh.frustumCulled=false; smRedMesh.renderOrder=998; scene.add(smRedMesh); }
    const A=smRedMesh.geometry.attributes.position; let o=0;
    for(const X of smRed.values()){ A.array.set(X,o); o+=X.length; }
    A.clearUpdateRanges(); A.addUpdateRange(0,o); A.needsUpdate=true; smRedMesh.geometry.setDrawRange(0,o/3); invalidate();
  }
  function smRedClear(){ smRed.clear(); smEraseReg=null; smRedDraw(); }
  function smPaintAt(e){
    if(!smStroke) return;
    const t=smLiveT||smBegin(); if(!t) return;
    const rc=el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX-rc.left)/rc.width)*2-1,-((e.clientY-rc.top)/rc.height)*2+1),camera);
    const hit=ray.intersectObject(mesh,false); if(!hit.length) return;
    const p=hit[0].point, r2=brushR*brushR, seen=amSeenUnder(e,p), add=(mode!=='rem');
    { const c=smOp.c, n=c.length; if(!n||Math.hypot(p.x-c[n-3],p.y-c[n-2],p.z-c[n-1])>0.2*smOp.r) c.push(p.x,p.y,p.z); }
    const R=brushR+ccReach(), R2=R*R;
    const i0=Math.floor((p.x-R)/CELL), i1=Math.floor((p.x+R)/CELL);
    const j0=Math.floor((p.y-R)/CELL), j1=Math.floor((p.y+R)/CELL);
    const k0=Math.floor((p.z-R)/CELL), k1=Math.floor((p.z+R)/CELL);
    let ch=false, red=false;
    for(let ix=i0;ix<=i1;ix++)for(let iy=j0;iy<=j1;iy++)for(let iz=k0;iz<=k1;iz++){
      const a=grid.get(ckey(ix,iy,iz)); if(!a)continue;
      for(let n=0;n<a.length;n++){ const f=a[n], dx=cen[f*3]-p.x, dy=cen[f*3+1]-p.y, dz=cen[f*3+2]-p.z, d2=dx*dx+dy*dy+dz*dz;
        if(d2>R2) continue;
        if(!add&&smEraseReg&&smEraseReg.has(f)){ const X=smRedAt(f,smOp); if(X.length) smRed.set(f,X); else smRed.delete(f); red=true; }   // 389
        if(add) t.X[f]=0;                                  // painted again: no longer held out
        if(d2<=r2 && (!seen||seen.has(f)) && !smStroke.has(f)){
          t.S[f]=add?1:0; smStroke.add(f); smLive[f]=1; recolorFace(f); ch=true; } } }
    const now=performance.now();
    if(now>=smMarkAt){ amMarkNear(t); amMarkDraw(); smMarkAt=performance.now()+16; ch=true; }
    if(!add&&smLiveHide(t.at,p,brushR)) ch=true;   // 373 (א)
    if(red) smRedDraw();
    if(ch){ colAttr.needsUpdate=true; flatAttr.needsUpdate=true; desAttr.needsUpdate=true; invalidate(); }
  }
  // 373 (א): an erasure shows while the hand moves. The copy was rebuilt only when the hand lifted
  // — up to two seconds on a large region, and nothing moved meanwhile. The copy's triangles under
  // the eraser are folded to a point as it passes (a grid of their centres, made once a stroke);
  // the smoothing itself is redone at the lift, as before.
  function smLiveHide(at,p,rad){
    let any=false;
    for(const mm of smGroup.children){ if(!mm.isMesh||mm.userData.smAt!==at) continue;
      const A=mm.geometry.attributes.position, X=A.array;
      if(!mm.userData.lg){ const G=new Map(), C=Math.max(rad,1e-3);
        for(let k=0;k<A.count/3;k++){ const o=k*9, cx=(X[o]+X[o+3]+X[o+6])/3, cy=(X[o+1]+X[o+4]+X[o+7])/3, cz=(X[o+2]+X[o+5]+X[o+8])/3;
          const key=Math.floor(cx/C)+','+Math.floor(cy/C)+','+Math.floor(cz/C); let L=G.get(key); if(!L){ L=[]; G.set(key,L); } L.push(k,cx,cy,cz); }
        mm.userData.lg={G:G,C:C}; }
      const {G,C}=mm.userData.lg, r2=rad*rad, i0=Math.floor(p.x/C), j0=Math.floor(p.y/C), k0=Math.floor(p.z/C);
      const R=Math.ceil(rad/C); let ch=false;
      for(let di=-R;di<=R;di++) for(let dj=-R;dj<=R;dj++) for(let dk=-R;dk<=R;dk++){
        const L=G.get((i0+di)+','+(j0+dj)+','+(k0+dk)); if(!L) continue;
        for(let q=0;q<L.length;q+=4){ const dx=L[q+1]-p.x, dy=L[q+2]-p.y, dz=L[q+3]-p.z;
          if(dx*dx+dy*dy+dz*dz>r2) continue; const o=L[q]*9;
          if(X[o]===X[o+3]&&X[o]===X[o+6]&&X[o+1]===X[o+4]&&X[o+2]===X[o+5]) continue;
          for(let c=1;c<3;c++){ X[o+c*3]=X[o]; X[o+c*3+1]=X[o+1]; X[o+c*3+2]=X[o+2]; } ch=true; } }
      if(ch){ A.needsUpdate=true; any=true; } }
    return any;
  }
  function smStrokeEnd(){
    const s=smStroke, t=smLiveT, op=smOp, before=smBefore; smStroke=null; smOp=null; smBefore=null;
    if(!s) return;
    if(t) amMarkNear(t);
    smLiveT=null; smRedClear();
    for(const f of s){ smLive[f]=0; recolorFace(f); }
    colAttr.needsUpdate=true; flatAttr.needsUpdate=true; desAttr.needsUpdate=true; amMarkDraw();
    if(!t||!before){ invalidate(); return; }
    if(!op.c.length){ const k=t.ops.lastIndexOf(op); if(k>=0) t.ops.splice(k,1); }
    const after=smSnap(t.at); after.regs=smDerive(t.at,before);
    // 319's rule: a stroke that changed no region is not a step — and leaves no trace
    if(!smCommitLayer(t.at,before,after,true)){
    // 373: a press on a region that changes nothing CHOOSES it for the level wheel — the label
    // that used to be the handle is gone
    const q=SMR.find(r=>r.at===t.at&&r.faces.some(f=>s.has(f)));
    if(q) smSel=q;
    smSetLayer(t.at,before); invalidate(); return; }
    let f0=-1; for(const f of s) f0=f;
    smSel=SMR.find(r=>r.at===t.at&&r.faces.includes(f0))||SMR.filter(r=>r.at===t.at).slice(-1)[0]||null;
    smSyncWheel(); smRebuild(); invalidate();
  }
  /* 437 (Eli, 04/10: "a built surface like the other surfaces that close the volume — I want them
     compatible, to look like one body"; and "if they do not get the blots, add them too, so every
     synthetic surface in the model is alike"): a smoothed copy is drawn as a volume's shell is, by the
     same function — the layer's colour at its opacity, the shade, contours, blots and corner lines of a
     built surface (amSynthShell), and NO pull toward the eye: where the copy sinks under the model the
     model hides it, and the line where the two cross shows. It used to carry the model's own texture,
     pulled in front of it — the model looked bent, though its corners were never moved. At level 0
     there is no copy: the brush paints the model, in the layer's tone. */
  // 448 (Eli, 05/10: "the smoothed surfaces get no design"; "the volume bodies too — their design in the
  // style of the other measurements, not of the synthetic surfaces"): the layer's design on a copy and on a body
  // is the marking's own lattice and law (257, amStippleA): as the wheel rises the shell turns into dots of the
  // layer's flat colour, the model seen between them; at 0 it is the built surface of 437
  const AM_DES_GLSL=`
float amB2(vec2 a){a=floor(a);return fract(a.x*0.5+a.y*a.y*0.75);}
float amBayer(vec2 px){return amB2(px*0.5)*0.25+amB2(px);}
float amStippleA(float a, float lvl){
  if(lvl<=0.001) return a;
  float t=amBayer(floor(gl_FragCoord.xy/3.0));
  return mix(a,(a>t)?1.0:0.0,lvl);
}
`;
  function amShellMesh(P, hex, op, des, D){
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(P,3));
    const o=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:hex, side:THREE.DoubleSide,
      transparent:op<0.999||des>0.001, opacity:op, depthWrite:op>=0.999&&!(des>0.001)}));
    amSynthShell(o, P, P.length/9, D); amShellDes(o, des); amShellLines(o);   // 494 (2): D — its shading, when it is known
    return o;
  }
  function amShellDes(o, des){
    const m=o.material, U={value:(typeof des==='number')?des:0}, base=m.onBeforeCompile;
    m.userData.amDesU=U;
    m.onBeforeCompile=sh=>{ base(sh); sh.uniforms.amDes=U;
      sh.fragmentShader=sh.fragmentShader
        .replace('#include <common>','#include <common>\nuniform float amDes;'+AM_DES_GLSL)
        .replace('#include <opaque_fragment>','outgoingLight=mix(outgoingLight,diffuse,amDes);diffuseColor.a=amStippleA(diffuseColor.a,amDes);\n#include <opaque_fragment>'); };
  }
  // its corner lines fade with its opacity (Eli, 04/10: "when a layer is almost fully transparent, the corner
  // lines stay opaque"): as they are from a volume's own opacity (0.55) up, and below it in proportion, to none
  function amShellLines(o){ const op=o.material.opacity; for(const c of o.children){ c.visible=op>0; if(c.material) c.material.opacity=AM_EDGE_ALPHA*Math.min(1,op/0.55); } }
  function amShellFree(o){ for(const c of o.children){ if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); } }
  // 383: the copy's rim — each edge that only one of its triangles has — as line segments
  function smRim(X,T){
    const nV=X.length/3, E=new Map(), L=[];
    for(let f=0;f<T.length;f+=3) for(let c=0;c<3;c++){ const a=T[f+c], b=T[f+(c+1)%3], k=a<b?a*nV+b:b*nV+a; E.set(k,(E.get(k)||0)+1); }
    for(const [k,n] of E){ if(n!==1) continue; const a=Math.floor(k/nV), b=k-a*nV;
      L.push(X[a*3],X[a*3+1],X[a*3+2],X[b*3],X[b*3+1],X[b*3+2]); }
    return L;
  }
  // the layer's colour, opacity and design on its copies, in place (the design wheel, 93)
  const smDrawC=new WeakMap();   // 494 (2): a copy's drawing, kept with its corners (smDrawOf)
  // 494 (2): a region's copy, as it is drawn — kept with its corners (r.X, the same array while the copy is kept)
  function smDrawOf(r){
    const c=smDrawC.get(r.X); if(c&&c.T===r.T) return {XP:c.XP, L:c.L, D:{pn:c.D.pn.slice(), band:c.D.band.slice(), edges:c.D.edges.slice()}};
    const nt=r.T.length, XP=new Float32Array(nt*3);
    for(let k=0;k<nt;k++){ const v=r.T[k]*3; XP[k*3]=r.X[v]; XP[k*3+1]=r.X[v+1]; XP[k*3+2]=r.X[v+2]; }
    const D=amSynthDecor(XP,nt/3);
    const L=smRim(r.X,r.T);              // 383: the copy's rim
    smDrawC.set(r.X,{T:r.T, XP:XP, L:L, D:{pn:D.pn.slice(), band:D.band.slice(), edges:D.edges.slice()}});
    return {XP:XP, L:L, D:D};
  }
  function smRecolor(){
    for(const o of smGroup.children.concat(polyGroup.children)){ const at=o.userData&&o.userData.smAt; if(!at) continue;   // and the polygons' fills
      const T=types.find(t=>t.id===at); if(!T) continue;
      if(o.userData.smShell){ o.material.color.set(T.hex||'#38b000'); o.material.opacity=(typeof T.op==='number')?T.op:0.75; amShellLines(o);
        if(o.material.userData.amDesU) o.material.userData.amDesU.value=(typeof T.design==='number')?T.design:0.6; continue; }   // 437 · 448: and its design
      const A=o.geometry.attributes, c=T.color||[0.220,0.690,0.000], op=(typeof T.op==='number')?T.op:0.75, d=(typeof T.design==='number')?T.design:0.6;
      for(let k=0;k<A.aFlat.count;k++){ A.aCol.array[k*3]=c[0]; A.aCol.array[k*3+1]=c[1]; A.aCol.array[k*3+2]=c[2]; A.aFlat.array[k]=op; A.aDes.array[k]=d; }
      A.aCol.needsUpdate=true; A.aFlat.needsUpdate=true; A.aDes.needsUpdate=true; }
    for(const o of smGroup.children){ const at=o.userData&&o.userData.smLine; if(!at) continue;   // 383: and the rims
      // 373/383: the region the level wheel works on has its rim in gold (the ◂ on its label went with the label)
      const T=types.find(t=>t.id===at); if(T) o.material.color.set((smSel&&o.userData.smReg===smSel)?0xffca3a:(T.hex||'#38b000')); }
    invalidate();
  }
  // each region's copy: the layer's colour, its opacity and design, over the model, and its tag
  function smRebuild(){
    for(let i=smGroup.children.length-1;i>=0;i--){ const o=smGroup.children[i]; forgetOnScreen(o); smGroup.remove(o);
      if(o.geometry) o.geometry.dispose(); if(o.material&&!(o.userData&&o.userData.amShared)){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); } amShellFree(o); }
    const num={};
    for(const r of SMR){
      const T=types.find(t=>t.id===r.at); if(!T) continue;
      num[r.at]=(num[r.at]||0)+1;
      if(amHidOf(types,r.at)||!r.T||!r.T.length) continue;
      const col=new THREE.Color(T.hex||'#38b000');
      // 494 (2): a copy that did not change keeps what it is drawn from — its triangles, their shading (amSynthDecor) and
      // its rim — and every object is built again, in this order, as before; it was all computed again for every copy
      const W=smDrawOf(r);
      const mm=amShellMesh(W.XP.slice(),col,(typeof T.op==='number')?T.op:0.75,(typeof T.design==='number')?T.design:0.6,W.D); mm.userData.smAt=r.at; mm.userData.smShell=true;   // 437 · 448
      smGroup.add(mm);
      // 383 (Eli, 30/09): the copy's rim, a thin opaque line in the layer's tone — drawn over the
      // model, as a polygon's outline is, so the edge reads where the model shows through
      { const L=W.L;
        if(L.length){ const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(L),3));
          const ln=new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:col,depthTest:false,transparent:true,opacity:1}));
          ln.userData.smLine=r.at; ln.userData.smReg=r; ln.renderOrder=999; smGroup.add(ln); } }
      let cx=0,cy=0,cz=0; const nv=r.X.length/3;
      for(let v=0;v<nv;v++){ cx+=r.X[v*3]; cy+=r.X[v*3+1]; cz+=r.X[v*3+2]; }
      // 373 (Eli, 30/09): "אני לא רוצה בכלל תגיות על הסימונים במשך המדידה; המספור שייך לדוח ולא
      // למדידה עצמה!" — no number and no label on a region here; the report numbers them
      mm.userData.smReg=r;
    }
    smRecolor(); rescaleFixed(); invalidate();
  }
  // 433: the wheel is the open layer's level — every region its brush marks, at once; undone as one step
  { const e=document.getElementById('smLevel');
    if(e){
      e.oninput=()=>{ const v=document.getElementById('smLevelV'); if(v) v.textContent=e.value;
        if(activeKind!=='area') return;
        const T=types[activeT]; if(!T) return;
        if(!smWheelFrom) smWheelFrom={at:T.id, from:smLevelOf(T)};
        T.sm=smWheelLevel();
        clearTimeout(smWheelT); smWheelT=setTimeout(smSyncNow,60); };
      e.onchange=()=>{ clearTimeout(smWheelT); const w=smWheelFrom; smWheelFrom=null;
        const T=w&&types.find(q=>q.id===w.at);
        if(T&&w.from!==smLevelOf(T)){ undoStack.push([['SML',{at:T.id,from:w.from,to:smLevelOf(T)}]]); redoStack.length=0; updateHB(); markDirty(); }
        smSyncNow(); };
    } }
  /* ---- 335ב: THE POLYGON ON THE MODEL -------------------------------------------------------
     Eli, 29/09 (option ג, approved): the three tools of an area layer read in ONE tone — the wall
     law, the colour decoded. A polygon is a plane with no texture of its own, and imitating the
     law over what is already drawn missed by up to 21 of 255 (measured), so its fill is painted
     ON THE MODEL: every sub-face within the polygon's band, seen along the polygon's normal, is
     cut along the outline and painted as a marking is. Where no model lies under it (Eli: "I do
     want the areas with no model under them painted too"), the fill lies on the plane itself, in
     the same law, the wall being the mean of the texture under the rest of the polygon (a neutral
     grey when there is none). Where there is no model is read on a grid of half a model edge; the
     outline stays exact. The area is still measured from the points. The same text runs in the
     measurement screen, the iPad and the report's viewer. */
  const PG_BAND_MIN=0.05, PG_GRID_MAX=120000;
  function pgPlane(pts){
    const n=[0,0,0], c=[0,0,0], m=pts.length;
    for(let i=0;i<m;i++){ const a=pts[i], b=pts[(i+1)%m];
      n[0]+=(a[1]-b[1])*(a[2]+b[2]); n[1]+=(a[2]-b[2])*(a[0]+b[0]); n[2]+=(a[0]-b[0])*(a[1]+b[1]);
      c[0]+=a[0]/m; c[1]+=a[1]/m; c[2]+=a[2]/m; }
    const L=Math.hypot(n[0],n[1],n[2])||1; for(let k=0;k<3;k++) n[k]/=L;
    const t=Math.abs(n[0])<0.9?[1,0,0]:[0,1,0];
    const e1=[n[1]*t[2]-n[2]*t[1], n[2]*t[0]-n[0]*t[2], n[0]*t[1]-n[1]*t[0]], l1=Math.hypot(e1[0],e1[1],e1[2])||1;
    for(let k=0;k<3;k++) e1[k]/=l1;
    const e2=[n[1]*e1[2]-n[2]*e1[1], n[2]*e1[0]-n[0]*e1[2], n[0]*e1[1]-n[1]*e1[0]];
    return {n:n, c:c, e1:e1, e2:e2};
  }
  function pgTo(pl,x,y,z){ const dx=x-pl.c[0], dy=y-pl.c[1], dz=z-pl.c[2];
    return [dx*pl.e1[0]+dy*pl.e1[1]+dz*pl.e1[2], dx*pl.e2[0]+dy*pl.e2[1]+dz*pl.e2[2], dx*pl.n[0]+dy*pl.n[1]+dz*pl.n[2]]; }
  function pgCross(A,B,C){ return (B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]); }
  function pgInTri(p,A,B,C){ return pgCross(A,B,p)>=0&&pgCross(B,C,p)>=0&&pgCross(C,A,p)>=0; }
  // the outline in the plane, as counter-clockwise triangles (ear clipping)
  function pgEars(Q){
    let s=0; for(let i=0;i<Q.length;i++){ const a=Q[i], b=Q[(i+1)%Q.length]; s+=a[0]*b[1]-b[0]*a[1]; }
    const idx=Q.map((_,i)=>i); if(s<0) idx.reverse();
    const out=[]; let guard=0;
    while(idx.length>3&&guard++<4*Q.length+16){ let cut=false;
      for(let k=0;k<idx.length;k++){ const i0=idx[(k+idx.length-1)%idx.length], i1=idx[k], i2=idx[(k+1)%idx.length];
        const A=Q[i0], B=Q[i1], C=Q[i2]; if(pgCross(A,B,C)<=1e-14) continue;
        let hit=false; for(const j of idx){ if(j===i0||j===i1||j===i2) continue; if(pgInTri(Q[j],A,B,C)){ hit=true; break; } }
        if(hit) continue;
        out.push([A,B,C]); idx.splice(k,1); cut=true; break; }
      if(!cut) break; }
    if(idx.length===3){ const A=Q[idx[0]], B=Q[idx[1]], C=Q[idx[2]]; if(pgCross(A,B,C)>0) out.push([A,B,C]); }
    return out;
  }
  // a polygon (points [x,y, ...carried values]) clipped by a counter-clockwise triangle
  function pgClip(poly,T){
    let P=poly;
    for(let e=0;e<3&&P.length;e++){ const A=T[e], B=T[(e+1)%3], out=[];
      for(let i=0;i<P.length;i++){ const p=P[i], q=P[(i+1)%P.length], dp=pgCross(A,B,p), dq=pgCross(A,B,q);
        if(dp>=0) out.push(p);
        if((dp>=0)!==(dq>=0)){ const t=dp/(dp-dq); out.push(p.map((v,k)=>v+t*(q[k]-v))); } }
      P=out; }
    return P;
  }
  // the wall the fill takes where no model is: the texture under the cut parts, averaged by area
  // (linear rgb), or null while the texture has not arrived
  function pgWallOf(surf,POS,UV,texAt){
    const s=[0,0,0]; let n=0;
    for(const q of surf){ const f=q.f, o=f*6, p=f*9, BB=q.bb; let u=0, v=0;
      for(let k=0;k<BB.length;k+=2){ const b1=BB[k], b2=BB[k+1];
        u+=UV[o]+b1*(UV[o+2]-UV[o])+b2*(UV[o+4]-UV[o]); v+=UV[o+1]+b1*(UV[o+3]-UV[o+1])+b2*(UV[o+5]-UV[o+1]); }
      const w=texAt?texAt(u/(BB.length/2),v/(BB.length/2)):null; if(!w) return null;
      const ax=POS[p+3]-POS[p], ay=POS[p+4]-POS[p+1], az=POS[p+5]-POS[p+2], bx=POS[p+6]-POS[p], by=POS[p+7]-POS[p+1], bz=POS[p+8]-POS[p+2];
      const A=0.5*Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx);
      for(let k=0;k<3;k++) s[k]+=w[k]*A; n+=A; }
    return n>0?s.map(x=>x/n):null;
  }
  // the fill of one polygon: the cut parts of the model's sub-faces under it ({f, bb} — b1,b2 per
  // corner), the triangles on its plane where no model is, and the wall those take (linear rgb)
  function pgFill(pts,POS,UV,NF,texAt){
    const out={surf:[], air:[], wall:null};
    if(!pts||pts.length<3) return out;
    const pl=pgPlane(pts), Q=pts.map(p=>pgTo(pl,p[0],p[1],p[2]));
    const ears=pgEars(Q); if(!ears.length) return out;
    let dmax=0, lo=[Infinity,Infinity], hi=[-Infinity,-Infinity];
    for(const q of Q){ dmax=Math.max(dmax,Math.abs(q[2])); lo[0]=Math.min(lo[0],q[0]); lo[1]=Math.min(lo[1],q[1]); hi[0]=Math.max(hi[0],q[0]); hi[1]=Math.max(hi[1],q[1]); }
    const band=Math.max(PG_BAND_MIN,3*dmax);
    const bb3=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(const p of pts) for(let k=0;k<3;k++){ bb3[k]=Math.min(bb3[k],p[k]); bb3[3+k]=Math.max(bb3[3+k],p[k]); }
    const R=band+1e-9, faces=[], F2=[], edges=[];
    for(let f=0;f<NF;f++){ const o=f*9;
      const cx=(POS[o]+POS[o+3]+POS[o+6])/3, cy=(POS[o+1]+POS[o+4]+POS[o+7])/3, cz=(POS[o+2]+POS[o+5]+POS[o+8])/3;
      if(cx<bb3[0]-R||cx>bb3[3]+R||cy<bb3[1]-R||cy>bb3[4]+R||cz<bb3[2]-R||cz>bb3[5]+R) continue;
      const a=pgTo(pl,POS[o],POS[o+1],POS[o+2]), b=pgTo(pl,POS[o+3],POS[o+4],POS[o+5]), c=pgTo(pl,POS[o+6],POS[o+7],POS[o+8]);
      if(Math.abs(a[2])>band||Math.abs(b[2])>band||Math.abs(c[2])>band) continue;
      if(Math.max(a[0],b[0],c[0])<lo[0]||Math.min(a[0],b[0],c[0])>hi[0]||Math.max(a[1],b[1],c[1])<lo[1]||Math.min(a[1],b[1],c[1])>hi[1]) continue;
      faces.push(f); F2.push([a,b,c]);
      if(edges.length<4096) edges.push(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-b[0],c[1]-b[1])); }
    // the model's sub-faces, cut along the outline
    for(let i=0;i<faces.length;i++){ const [a,b,c]=F2[i], sub=[[a[0],a[1],0,0],[b[0],b[1],1,0],[c[0],c[1],0,1]];
      const bbx=[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])], BB=[];
      for(const T of ears){
        if(Math.max(T[0][0],T[1][0],T[2][0])<bbx[0]||Math.min(T[0][0],T[1][0],T[2][0])>bbx[2]||
           Math.max(T[0][1],T[1][1],T[2][1])<bbx[1]||Math.min(T[0][1],T[1][1],T[2][1])>bbx[3]) continue;
        const P=pgClip(sub,T); if(P.length<3) continue;
        for(let k=1;k+1<P.length;k++){ const q=[P[0],P[k],P[k+1]];
          if(Math.abs(pgCross(q[0],q[1],q[2]))<1e-16) continue;
          for(const v of q) BB.push(v[2],v[3]); } }
      if(!BB.length) continue;
      out.surf.push({f:faces[i], bb:BB}); }
    out.wall=pgWallOf(out.surf,POS,UV,texAt);
    // where there is no model: a grid of half a model edge over the plane, what no sub-face covers
    edges.sort((x,y)=>x-y);
    const med=edges.length?edges[edges.length>>1]:0, W=hi[0]-lo[0], H=hi[1]-lo[1];
    let h=med>0?med/2:Math.sqrt(W*H/2000); h=Math.max(h,Math.sqrt(W*H/PG_GRID_MAX),1e-6);
    const nx=Math.max(1,Math.ceil(W/h)), ny=Math.max(1,Math.ceil(H/h)), cov=new Uint8Array(nx*ny);
    for(const [a,b,c] of F2){ const s=pgCross(a,b,c)<0?[a,c,b]:[a,b,c];
      const i0=Math.max(0,Math.floor((Math.min(a[0],b[0],c[0])-lo[0])/h)), i1=Math.min(nx-1,Math.floor((Math.max(a[0],b[0],c[0])-lo[0])/h));
      const j0=Math.max(0,Math.floor((Math.min(a[1],b[1],c[1])-lo[1])/h)), j1=Math.min(ny-1,Math.floor((Math.max(a[1],b[1],c[1])-lo[1])/h));
      for(let j=j0;j<=j1;j++) for(let i=i0;i<=i1;i++){ const p=[lo[0]+(i+0.5)*h, lo[1]+(j+0.5)*h];
        if(pgInTri(p,s[0],s[1],s[2])) cov[j*nx+i]=1; } }
    const P3=(x,y)=>[pl.c[0]+x*pl.e1[0]+y*pl.e2[0], pl.c[1]+x*pl.e1[1]+y*pl.e2[1], pl.c[2]+x*pl.e1[2]+y*pl.e2[2]];
    for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){ if(cov[j*nx+i]) continue;
      const x0=lo[0]+i*h, y0=lo[1]+j*h, sq=[[x0,y0],[x0+h,y0],[x0+h,y0+h],[x0,y0+h]];
      for(const T of ears){
        if(Math.max(T[0][0],T[1][0],T[2][0])<x0||Math.min(T[0][0],T[1][0],T[2][0])>x0+h||
           Math.max(T[0][1],T[1][1],T[2][1])<y0||Math.min(T[0][1],T[1][1],T[2][1])>y0+h) continue;
        const P=pgClip(sq,T); if(P.length<3) continue;
        for(let k=1;k+1<P.length;k++) for(const v of [P[0],P[k],P[k+1]]) out.air.push(...P3(v[0],v[1])); } }
    return out;
  }
  /* ---- end 335ב polygon core ---------------------------------------------------------------- */
  // 335ב: the texture's colour under a point (linear rgb) — read once from a small copy of the image
  let pgPix=null;
  function pgTexAt(u,v){
    if(!pgPix){ const im=tex&&tex.image; if(!im||!im.width) return null;
      try{ const S=256, cv=document.createElement('canvas'); cv.width=S; cv.height=S; const cx=cv.getContext('2d');
        cx.drawImage(im,0,0,S,S); pgPix={S:S, d:cx.getImageData(0,0,S,S).data}; }catch(e){ return null; } }
    const S=pgPix.S, x=Math.min(S-1,Math.max(0,Math.floor(u*S))), y=Math.min(S-1,Math.max(0,Math.floor((1-v)*S))), o=(y*S+x)*4, d=pgPix.d;
    const dc=c=>{ c/=255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
    return [dc(d[o]),dc(d[o+1]),dc(d[o+2])];
  }
  function pgEnc(l){ l=Math.max(0,Math.min(1,l)); return l<=0.0031308?l*12.92:1.055*Math.pow(l,1/2.4)-0.055; }
  var pgMatC=null;
  function pgMat(){
    if(!pgMatC){ pgMatC=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide,polygonOffset:true,
        polygonOffsetFactor:-1,polygonOffsetUnits:-4}); pgMatC.onBeforeCompile=mat.onBeforeCompile; }
    pgMatC.transparent=mat.transparent; pgMatC.opacity=mat.opacity; pgMatC.depthWrite=mat.depthWrite;
    return pgMatC;
  }
  // a polygon's fill as meshes in the wall's law: its cut parts on the model (the model's texture,
  // a shared material), and its triangles on the plane where no model is (a 1x1 texture of the wall)
  function pgMeshes(F,T){
    const col=T.color||[0.220,0.690,0.000], op=(typeof T.op==='number')?T.op:0.75, de=(typeof T.design==='number')?T.design:0.6, out=[];
    const attrs=(g,n,pf)=>{ const C=new Float32Array(n*3);
      for(let k=0;k<n;k++){ C[k*3]=col[0]; C[k*3+1]=col[1]; C[k*3+2]=col[2]; }
      g.setAttribute('aCol',new THREE.BufferAttribute(C,3)); g.setAttribute('aFlat',new THREE.BufferAttribute(new Float32Array(n).fill(op),1));
      g.setAttribute('aDes',new THREE.BufferAttribute(new Float32Array(n).fill(de),1)); g.setAttribute('aPatch',new THREE.BufferAttribute(pf,1)); };
    let nv=0; for(const s of F.surf) nv+=s.bb.length/2;
    if(nv){ const X=new Float32Array(nv*3), U=new Float32Array(nv*2), PF=new Float32Array(nv); let o=0;
      for(const s of F.surf){ const f=s.f, q=f*9, w=f*6, pp=(f>=PATCH0)?1:0;
        for(let k=0;k<s.bb.length;k+=2){ const b1=s.bb[k], b2=s.bb[k+1];
          for(let c=0;c<3;c++) X[o*3+c]=pos[q+c]+b1*(pos[q+3+c]-pos[q+c])+b2*(pos[q+6+c]-pos[q+c]);
          for(let c=0;c<2;c++) U[o*2+c]=uv[w+c]+b1*(uv[w+2+c]-uv[w+c])+b2*(uv[w+4+c]-uv[w+c]);
          PF[o]=pp; o++; } }
      const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(X,3));
      g.setAttribute('uv',new THREE.BufferAttribute(U,2)); attrs(g,nv,PF);
      const m=new THREE.Mesh(g,pgMat()); m.userData.amShared=true; m.userData.amWL=true; m.renderOrder=1; out.push(m); }
    const na=F.air.length/3;
    if(na){ const w=F.wall||[0.2140,0.2140,0.2140];       // no wall known: a neutral grey (sRGB 0.5)
      const t=new THREE.DataTexture(new Uint8Array([Math.round(pgEnc(w[0])*255),Math.round(pgEnc(w[1])*255),Math.round(pgEnc(w[2])*255),255]),1,1);
      if('SRGBColorSpace' in THREE) t.colorSpace=THREE.SRGBColorSpace; t.needsUpdate=true;
      const mt=new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}); mt.onBeforeCompile=mat.onBeforeCompile;
      mt.transparent=mat.transparent; mt.opacity=mat.opacity; mt.depthWrite=mat.depthWrite;
      const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(F.air),3));
      g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(na*2).fill(0.5),2)); attrs(g,na,new Float32Array(na));
      const m=new THREE.Mesh(g,mt); m.userData.amWL=true; m.renderOrder=1; out.push(m); }
    return out;
  }
  /* 336 (Eli, 29/09): ONE running number per layer, whatever the method — "the numbering of
     the measurements in one layer has to be continuous, also when they are by different
     methods". The polygons first, in marking order (a ring still being drawn takes the next
     number, so its identity does not change when it closes); then the smoothed regions, in
     marking order; then — in the report only — the brush's patches, whose count the report's
     tiny-area threshold decides and which this screen therefore cannot know. The number is
     computed, never stored. */
  function amMeasNo(at,kind,i){
    const np=polys.filter(q=>q.at===at).length+((typeof curPoly!=='undefined'&&curPoly&&curPoly.at===at&&curPoly.pts.length)?1:0);   // the ring being drawn counts where there is one
    if(kind==='p') return i+1;
    if(kind==='s') return np+i+1;
    return np+SMR.filter(q=>q.at===at).length+i+1;          // 'b': the i-th patch of the brush (336)
  }
  function amMeasText(at,kind,i){
    if(kind==='s'){ const r=SMR.filter(q=>q.at===at)[i];
      return amMeasNo(at,'s',i)+' : '+(r?r.area:0).toFixed(2)+' מ״ר · מוחלק '+(r?r.level:0); }
    const L=polys.filter(q=>q.at===at), P=(i<L.length)?L[i]:curPoly;
    return amMeasNo(at,'p',i)+' : '+(P?P.area:0).toFixed(2)+' מ״ר';
  }
  let pgWait=setInterval(()=>{ if(!pgTexAt(0.5,0.5)) return; clearInterval(pgWait);
    if(polys.some(P=>P._fill&&!P._fill.wall&&P._fill.surf.length)) polyRebuild(); },500);
  function polyRebuild(){
    for(let i=polyGroup.children.length-1;i>=0;i--){
      const o=polyGroup.children[i]; forgetOnScreen(o); polyGroup.remove(o);
      if(o.geometry)o.geometry.dispose();
      if(o.material&&!(o.userData&&o.userData.amShared)){if(o.material.map)o.material.map.dispose();o.material.dispose();}
    }
    const draw=(P,open)=>{
      const T=types.find(t=>t.id===P.at)||types[0];
      const col=new THREE.Color((T&&T.hex)||'#38b000');
      // The layer's opacity is the WHOLE layer's (Eli, 24/09: "השקיפות צריכה לעבוד על כל
      // השכבה, גם על קווי המתאר") — the outline and its corners fade with the fill. The
      // number tag stays opaque: it is read, not seen through.
      const _op=(T&&typeof T.op==='number')?T.op:0.75;
      // ALWAYS in the transparent pass, even at 100% (24/09): an opaque overlay is drawn in the
      // opaque pass, BEFORE the transparent model and layers, which then paint over it — the
      // ruler vanished at 100% and came back at 99% (Eli).
      // 449 (Eli, 05/10: "the polygon does not draw — no points appear on a tap"): a ring still being drawn
      // shows its points and lines whole — they are the drawing's aid; at the layer's opacity (14% on his
      // work) they were all but invisible. A closed ring fades with its layer, as before (24/09)
      const _lm=()=>({color:col,depthTest:false,transparent:true,opacity:open?1:_op});
      for(const q of P.pts){
        const m=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),
          new THREE.MeshBasicMaterial(_lm()));
        m.position.set(q[0],q[1],q[2]); m.renderOrder=999; m.userData.pgAt=P.at; m.userData.pgOpen=!!open;   // 545
        polyGroup.add(m); keepOnScreen(m,RUL_PT_K);
      }
      const n=P.pts.length;
      for(let i=0;i+1<n||(!open&&i<n);i++){
        const a=P.pts[i], b=P.pts[(i+1)%n];
        const gm=new THREE.BufferGeometry().setFromPoints(
          [new THREE.Vector3(a[0],a[1],a[2]),new THREE.Vector3(b[0],b[1],b[2])]);
        const ln=new THREE.Line(gm,new THREE.LineBasicMaterial(_lm()));
        ln.renderOrder=999; ln.userData.pgAt=P.at; ln.userData.pgOpen=!!open; polyGroup.add(ln);   // 545
      }
      if(open) return;
      // 335ב: the fill on the model, in the wall's law — and on the plane where no model is. Kept on
      // the polygon for its points (a walk over the model's sub-faces is not a thing to do per frame)
      { const key=JSON.stringify(P.pts);
        if(P._fk!==key){ P._fill=pgFill(P.pts,pos,uv,N,pgTexAt); P._fk=key; }
        if(!P._fill.wall&&P._fill.surf.length) P._fill.wall=pgWallOf(P._fill.surf,pos,uv,pgTexAt);   // the texture came since
        for(const m of pgMeshes(P._fill,T)){ m.userData.smAt=P.at; if(!open) m.userData.ring=P; polyGroup.add(m); } }
      let cx=0,cy=0,cz=0; for(const q of P.pts){cx+=q[0];cy+=q[1];cz+=q[2];}
      // 265: the ring is numbered 1..n WITHIN ITS LAYER, in marking order — the ruler's
      // rule, and the order the report lists the layer's rings in. A ring still being
      // drawn takes the next number, so its identity does not change when it closes.
      const _pi=polys.filter(q=>q.at===P.at).indexOf(P);
      const _pk=(_pi>=0)?_pi:polys.filter(q=>q.at===P.at).length;
      // 373: no number and no label on a ring in the measurement — the report numbers it
    };
    for(const P of polys) if(!amHidOf(types,P.at)) draw(P,false);
    if(curPoly&&curPoly.pts.length) draw(curPoly,true);
    smRebuild();                      // 329: the smoothed copies follow the layers too
    rescaleFixed(); invalidate();
  }
  function amPolyPick(e,el,cam,ray,pts,cast){
    // one click of a polygon: back on the first point (14 px, three points or more) closes it;
    // otherwise the ray's hit is the next point; nothing under the cursor, nothing
    const r=el.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
    if(pts&&pts.length>=3){
      const v=new THREE.Vector3(...pts[0]).project(cam);
      const d=Math.hypot((v.x+1)*(r.width/2)-px,(1-v.y)*(r.height/2)-py);
      if(d<14) return {close:true};
    }
    const ndc=new THREE.Vector2((px/r.width)*2-1,-(py/r.height)*2+1);
    ray.setFromCamera(ndc,cam);
    const hit=cast(ray);
    if(!hit.length) return null;
    return {p:[hit[0].point.x,hit[0].point.y,hit[0].point.z]};
  }
  function polyAt(e){
    // 470: the click itself — the close on the first point, the ray's point — is amPolyPick, shared
    // with the training screen's crop polygon
    const k=amPolyPick(e,el,camera,ray,curPoly&&curPoly.pts,r=>r.intersectObject(mesh,false));
    if(!k) return;
    if(k.close){                                 // back on the first point: close it
      const P={id:++pSeq,at:(types[activeT]||types[0]).id,pts:curPoly.pts.slice(),area:0};
      polyRecompute(P); polys.push(P); curPoly=null; polyRebuild(); markDirty(); return;
    }
    if(!curPoly) curPoly={at:(types[activeT]||types[0]).id,pts:[],area:0};
    curPoly.pts.push(k.p);
    polyRebuild();
    if(typeof updateHB==='function') updateHB();   // 527: ↶ is live while a polygon is open — it takes back its last point
  }
  function polyCancel(){ if(curPoly){ curPoly=null; polyRebuild(); if(typeof updateHB==='function') updateHB(); } }
  function polyUndoPoint(){
    if(!curPoly||!curPoly.pts.length) return false;
    curPoly.pts.pop();
    if(!curPoly.pts.length) curPoly=null;
    polyRebuild(); markDirty(); if(typeof updateHB==='function') updateHB();
    return true;
  }   // 526: Ctrl+Z (an external keyboard) and ↶ on an open polygon
  function polyEraseAt(e){
    const r=el.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
    const hw=r.width/2, hh=r.height/2, v=new THREE.Vector3();
    let best=-1, bd=14;
    for(let i=0;i<polys.length;i++){
      for(const q of polys[i].pts){
        v.set(q[0],q[1],q[2]).project(camera);
        if(v.z<-1||v.z>1) continue;
        const d=Math.hypot((v.x+1)*hw-px,(1-v.y)*hh-py);
        if(d<bd){bd=d;best=i;}
      }
    }
    if(best<0) return;
    amPolyOut(best);
  }
  // ---- 258: moving a point that is already placed ---------------------------------------
  // Eli, 18/09: "I want to add the option of dragging a point of a polygon or a ruler."
  // The plain drag has to stay the camera: the reason to move a point is almost always that
  // turning the model showed it sitting wrong, so the hand needs the camera free first.
  // The grab therefore gets a gesture of its own — Ctrl with the left button on a desk,
  // press-and-hold then drag under a finger. The point is dragged ON the model, never into
  // the air: it is raycast onto the surface exactly as it was when it was first placed.
  const AM_GRAB_PX=14, AM_HOLD_MS=450, AM_HOLD_SLOP=10;
  let amGrab=null, amHold=null;
  function amPointHandle(e){
    const r=el.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
    const hw=r.width/2, hh=r.height/2, v=new THREE.Vector3();
    let best=null, bd=AM_GRAB_PX;
    for(const q of rulPts){
      if(amHidOf(rulTypes,q.t)) continue;       // 9: what is not on screen cannot be grabbed
      v.set(q.x,q.y,q.z).project(camera);
      if(v.z<-1||v.z>1) continue;
      const d=Math.hypot((v.x+1)*hw-px,(1-v.y)*hh-py);
      if(d<bd){bd=d; best={kind:'rul',id:q.id};}
    }
    // a ring still being drawn is grabbable too — that is when a point is most often wrong
    const rings=curPoly?polys.concat([curPoly]):polys;
    for(const P of rings) for(let i=0;i<P.pts.length;i++){
      if(P!==curPoly&&amHidOf(types,P.at)) break;
      const q=P.pts[i];
      v.set(q[0],q[1],q[2]).project(camera);
      if(v.z<-1||v.z>1) continue;
      const d=Math.hypot((v.x+1)*hw-px,(1-v.y)*hh-py);
      if(d<bd){bd=d; best={kind:'poly',ring:P,i:i};}
    }
    return best;
  }
  function amGrabBegin(h){
    if(!h) return false;
    const q=(h.kind==='rul')?rulPtById(h.id):null;
    if(h.kind==='rul'&&!q) return false;
    h.from=(h.kind==='rul')?[q.x,q.y,q.z]:h.ring.pts[h.i].slice();
    amGrab=h; return true;
  }
  function amGrabMove(e){
    if(!amGrab) return;
    const r=el.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObject(mesh,false);
    if(!hit.length) return;          // dragged past the edge of the model: the point stays
    const p=hit[0].point;
    if(amGrab.kind==='rul'){
      const q=rulPtById(amGrab.id); if(!q) return;
      q.x=p.x; q.y=p.y; q.z=p.z; rulRebuild();
    } else {
      amGrab.ring.pts[amGrab.i]=[p.x,p.y,p.z];
      polyRecompute(amGrab.ring); polyRebuild();
    }
  }
  function amGrabEnd(){
    if(!amGrab) return;
    const h=amGrab; amGrab=null;
    let now=null;
    if(h.kind==='rul'){const q=rulPtById(h.id); if(q) now=[q.x,q.y,q.z];}
    else if(h.ring.pts[h.i]) now=h.ring.pts[h.i].slice();
    if(!now) return;
    // a grab that went nowhere is not an edit, and must not fill the history with no-ops
    if(Math.hypot(now[0]-h.from[0],now[1]-h.from[1],now[2]-h.from[2])<1e-9) return;
    undoStack.push([(h.kind==='rul')?['M',{kind:'rul',id:h.id,from:h.from}]
                               :['M',{kind:'poly',ring:h.ring,i:h.i,from:h.from}]]);
    redoStack.length=0; markDirty(); updateHB(); updateArea();
  }
  function amHoldClear(){ if(amHold){clearTimeout(amHold.t); amHold=null;} }
  function amHoldArm(e){
    amHoldClear();
    const h=amPointHandle(e);
    if(!h) return;
    amHold={x:e.clientX,y:e.clientY,h:h,t:setTimeout(()=>{
      amHold=null;
      if(amGrabBegin(h)) dragging='grab';
    },AM_HOLD_MS)};
  }
  window.amRescaleFixed=rescaleFixed;   // the tick loop lives outside this closure
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
  function mkCntType(name,hex){const T={id:'c'+(cSeq++),name:name,hex:hex,size:cntDefSize(),op:1.0,
    design:0.6,designU:{value:0.6}};cntTypes.push(T);return T;}
  function xObj(m){const T=cntTypes.find(x=>x.id===m.t);
    // a standing diamond with VOLUME (round 4): a flat sprite sank into scan bumps.
    // OctahedronGeometry takes a RADIUS; T.size is the true diameter on the model.
    const dm=new THREE.Mesh(AM_MK.geometry(((T&&T.size)||cntDefSize())/2),
      AM_MK.material(T?T.hex:'#c71f37', T?(T.op!==undefined?T.op:1):1, (T&&T.designU)||amDesignU, m.n||1));
    dm.position.set(m.p[0],m.p[1],m.p[2]); dm.renderOrder=3; return dm;}
  function resizeCnt(T){for(const m of [...xmarks])if(m.t===T.id&&m.obj){
    scene.remove(m.obj);m.obj=xObj(m);m.obj.visible=!T.hid;scene.add(m.obj);}}
  // 449 (Eli, 05/10: "all the counters came out with the number 1"): numbered within their layer, in marking
  // order, as the measurement screen numbers them — the iPad never had it
  function amRenumberCnt(){
    const seen={};
    for(const m of xmarks){
      seen[m.t]=(seen[m.t]||0)+1;
      if(m.n===seen[m.t]) continue;
      m.n=seen[m.t];
      if(m.obj&&m.obj.material&&m.obj.material.userData.amTexU)
        m.obj.material.userData.amTexU.value=AM_MK.texture(m.n);
    }
  }
  function addX(m){if(!m.obj)m.obj=xObj(m); m.obj.visible=!amHidOf(cntTypes,m.t); scene.add(m.obj); if(!xmarks.includes(m))xmarks.push(m); amRenumberCnt();}
  function delX(m){if(m.obj)scene.remove(m.obj); const i=xmarks.indexOf(m); if(i>=0)xmarks.splice(i,1); amRenumberCnt();}
  function placeXAt(e){if(activeC<0)return;
    const hit=castAt(e); if(!hit.length)return;
    const h=hit[0];
    const T=cntTypes[activeC];
    const lift=((T&&T.size)||cntDefSize())/2;      // lift tracks the diamond's actual radius
    const toCam=camera.position.clone().sub(h.point).normalize();   // always toward the viewer
    const m={t:cntTypes[activeC].id,
      p:[h.point.x+toCam.x*lift,h.point.y+toCam.y*lift,h.point.z+toCam.z*lift],obj:null};
    addX(m); undoStack.push([['X+',m]]); redoStack.length=0; markUnexported(true); updateHB(); amLenCntShow(); invalidate();}
  // Erase what you AIM AT (12/08, mirror of the desktop fix): the ray hits the diamonds
  // themselves. A diamond is lifted half its diameter off the surface, so it blocks the
  // ray and a mesh-based test measured from a point BEHIND it; and the brush slider is
  // the diamond diameter here, not a radius. On a finger-driven device this matters more.
  function eraseXAt(e){
    const r=el.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/Math.max(1,r.width))*2-1,-((e.clientY-r.top)/Math.max(1,r.height))*2+1);
    ray.setFromCamera(ndc,camera);
    const diff=[];
    const objs=xmarks.filter(m=>m.obj).map(m=>m.obj);
    const hits=objs.length?ray.intersectObjects(objs,false):[];
    if(hits.length){
      // a direct aim removes exactly the diamond under the cursor — nothing else
      const target=xmarks.find(m=>m.obj===hits[0].object);
      if(target){diff.push(['X-',target]);delX(target);}
    } else {
      // fallback: no direct hit, so accept a near miss — measured against the diamond's
      // own centre, with a tolerance scaled to ITS size (never the brush slider)
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
    if(diff.length){undoStack.push(diff);redoStack.length=0;markUnexported(true);updateHB();amLenCntShow();invalidate();}}

  // ---- 332: tag layers — a title, a text and a photo on a point of the model ----
  // As in the measurement screen, with one difference: the iPad has no link to the
  // computer, so a photo lives HERE — in its own store on the device (never in the
  // recovery copy, which is rewritten on every change) — and rides out inside the sheet
  // on export (`tagImgs`). The sheet itself only names it.
  const tagTypes=[]; let activeG=-1, gSeq=0;
  const tags=[];
  const TAG_IMG=new Map();                        // name -> data URL, for the tags of this work
  const tagGroup=new THREE.Group(); scene.add(tagGroup);
  const _tagPinGeo=new THREE.SphereGeometry(1,12,8);
  function mkTagType(name,hex){let id; do{ id='tg'+(gSeq++); }while(tagTypes.some(x=>x.id===id));
    const T={id:id,name:name,hex:hex};tagTypes.push(T);return T;}
  async function tagSrc(g){ if(!g||!g.img) return null;
    if(!TAG_IMG.has(g.img)){ const v=await imgGet(g.img); if(v) TAG_IMG.set(g.img,v); }
    return TAG_IMG.get(g.img)||null; }
  function tagRebuild(){
    for(const o of [...tagGroup.children]){ forgetOnScreen(o); tagGroup.remove(o);
      if(o.material){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); } }
    for(const g of tags){
      const T=tagTypes.find(x=>x.id===g.t); if(!T) continue;
      const shown=!T.hid;
      const pin=new THREE.Mesh(_tagPinGeo,new THREE.MeshBasicMaterial({color:T.hex,depthTest:false}));
      pin.position.set(g.p[0],g.p[1],g.p[2]); pin.renderOrder=1000; pin.visible=shown;
      tagGroup.add(keepOnScreen(pin,RUL_PT_K));
      const sp=amTagSprite(g.title,T.hex,!!g.img);
      sp.position.copy(pin.position); sp.visible=shown;
      sp.userData.amTag={kind:'tag',g:g};
      tagGroup.add(keepOnScreen(sp,RUL_LAB_K));
    }
    rescaleFixed(); invalidate();
  }
  function tagHist(d){ undoStack.push(d); redoStack.length=0; markUnexported(true); updateHB(); buildChips(); }
  function tagApply(g,v){
    g.title=v.title; g.text=v.text;
    if(v.img===null) g.img=null;
    else if(typeof v.img==='string'){ const nm=amTagId()+'.jpg'; TAG_IMG.set(nm,v.img); imgPut(nm,v.img); g.img=nm; }
  }
  async function tagAt(e){
    if(activeG<0) return;
    const hs=castAt(e); if(!hs.length) return; const h=hs[0];
    const T=tagTypes[activeG];
    const n=(h.face?h.face.normal.clone():new THREE.Vector3(0,0,1)).transformDirection(mesh.matrixWorld);
    if(n.dot(camera.position.clone().sub(h.point))<0) n.negate();       // toward the one who placed it
    const r3=v=>Math.round(v*1000)/1000;
    const g={id:amTagId(),t:T.id,p:[r3(h.point.x),r3(h.point.y),r3(h.point.z)],
             nrm:[r3(n.x),r3(n.y),r3(n.z)],title:'',text:'',img:null};
    // the point shows while the card is open, so it is clear what is being tagged — drawn
    // apart from the tags, so a save that lands meanwhile never writes a tag with no title
    const ghost=new THREE.Mesh(_tagPinGeo,new THREE.MeshBasicMaterial({color:T.hex,depthTest:false}));
    ghost.position.set(g.p[0],g.p[1],g.p[2]); ghost.renderOrder=1000;
    tagGroup.add(keepOnScreen(ghost,RUL_PT_K)); rescaleFixed(); invalidate();
    const v=await amTagCard({});
    forgetOnScreen(ghost); tagGroup.remove(ghost); ghost.material.dispose(); invalidate();
    if(!v) return;
    tagApply(g,v); tags.push(g); tagRebuild(); tagHist([['G+',g]]);
  }
  async function tagEdit(g){
    const v=await amTagCard({title:g.title,text:g.text,img:await tagSrc(g)});
    if(!v) return;
    const before={title:g.title,text:g.text,img:g.img};
    tagApply(g,v);
    const after={title:g.title,text:g.text,img:g.img};
    if(JSON.stringify(before)===JSON.stringify(after)) return;
    tagRebuild(); tagHist([['GE',{g:g,from:before,to:after}]]);
  }
  function tagDel(g){ const i=tags.indexOf(g); if(i<0) return;
    tags.splice(i,1); tagRebuild(); tagHist([['G-',{g:g,i:i}]]); }
  function activateG(i){activeKind='tag';activeG=i;syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}

  function eraseLineAt(p){
    const r2=Math.max(0.02,lineW*2)**2;   // eraser reach: at least 2cm around the pass
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
    amLenCntShow();   // 494: a tape changed — its length, not every area layer
  }
  function addLine(L){if(!L.obj)L.obj=lineObj(L); L.obj.visible=!amHidOf(lenTypes,L.t); scene.add(L.obj); if(!lines.includes(L))lines.push(L);}
  function delLine(L){if(L.obj)scene.remove(L.obj); const i=lines.indexOf(L); if(i>=0)lines.splice(i,1);}
  function lineLen(pts){let s=0;for(let i=3;i<pts.length;i+=3){
    s+=Math.hypot(pts[i]-pts[i-3],pts[i+1]-pts[i-2],pts[i+2]-pts[i-1]);}return s;}

  /* ---- undo/redo + op-log hookup (type-aware; lines ride the same stack) ---- */
  const undoStack=[],redoStack=[]; let curDiff=null,curT=null;
  const beginH=()=>{curDiff=[];curT=new Set();};
  // null-safe: a paint outside an open stroke still mutates, just without history
  const recH=(ti,f)=>{const k=ti*N+f;
    if(curT&&!curT.has(k)){curT.add(k);curDiff.push([ti,f,types[ti].manual[f]]);}};
  function commitH(){if(curDiff&&curDiff.length){undoStack.push(curDiff);redoStack.length=0;markUnexported(true);}curDiff=null;curT=null;updateHB();}
  // export-reminder anchor (decision 19): unexported marks must be VISIBLE —
  // with non-technical users the export is the step that gets forgotten
  function markUnexported(on){
    $('mExport').textContent=on?'⚠ ייצוא גיליון':'ייצוא גיליון';
    $('mExport').style.outline=on?'2px solid #c71f37':'';
    if(on) amSnapSoon(); else { clearTimeout(amSnapT); snapDrop(); }   // 327
  }
  // 327: the recovery copy — the whole sheet, a second and a half after the last change.
  // Armed once the visit's own restore question is answered, so loading is not a change
  var amSnapOn=false, amSnapT=0;     // a var: the history may be drawn before this line runs
  function amSnapSoon(){
    if(!amSnapOn) return;
    clearTimeout(amSnapT);
    // 494 (3): the copy is the sheet WITHOUT the report's derived fields (typeAreas, repairFaces, the totals) — the
    // restore (applySheet) reads none of them, and they were half of the copy's work after every change
    amSnapT=setTimeout(()=>{ try{ snapPut(getSheet(false)); }catch(_){} },1500);
  }
  function applyDiff(diff){const inv=[];
    for(let i=diff.length-1;i>=0;i--){const d=diff[i];
      if(d[0]==='L+'){inv.push(['L-',d[1]]);delLine(d[1]);}
      else if(d[0]==='L-'){inv.push(['L+',d[1]]);addLine(d[1]);}
      else if(d[0]==='X+'){inv.push(['X-',d[1]]);delX(d[1]);}
      else if(d[0]==='X-'){inv.push(['X+',d[1]]);addX(d[1]);}
      // a closed hole undoes like every other edit: the click writes, Ctrl+Z takes it
      // back (decision 128 — the approve step went, the undo carries its weight)
      else if(d[0]==='V'){                       // a volume-brush stroke
        const back=[];
        for(const pr of d[1]){ back.push([pr[0],volPaint[pr[0]]]); volPaint[pr[0]]=pr[1]; recolorFace(pr[0]); }
        // 325: the stroke's balls leave with its undo and come back with its redo
        if(d[2]){ if(d[3]) volOpIn(d[2]); else volOpOut(d[2]); }
        inv.push(['V',back,d[2]||null,!d[3]]); volCount(); volSmSoon();
      }
      // 258: a point that was dragged undoes to where it came from — Ctrl+Z puts it back,
      // it does not delete it. The ring is held by reference, the way a line already is.
      else if(d[0]==='M'){const m=d[1];
        if(m.kind==='rul'){const q=rulPtById(m.id);
          if(q){inv.push(['M',{kind:'rul',id:m.id,from:[q.x,q.y,q.z]}]);
            q.x=m.from[0];q.y=m.from[1];q.z=m.from[2];rulRebuild();}}
        else if(m.ring&&m.ring.pts[m.i]){
          inv.push(['M',{kind:'poly',ring:m.ring,i:m.i,from:m.ring.pts[m.i].slice()}]);
          m.ring.pts[m.i]=m.from.slice(); polyRecompute(m.ring); polyRebuild();}}
      // 2: a deleted layer comes back whole, in its place; redo takes it again
      else if(d[0]==='D'){inv.push(['D-',d[1]]);amLayerIn(d[1]);}
      // 329: a smoothed region's stroke, erasure or level — the layer's regions before and after
      else if(d[0]==='SMR'){inv.push(['SMR',{at:d[1].at,before:d[1].after,after:d[1].before}]);smSetLayer(d[1].at,d[1].before);}
      else if(d[0]==='SML'){const T=types.find(q=>q.id===d[1].at); inv.push(['SML',{at:d[1].at,from:d[1].to,to:d[1].from}]);   // 433: the layer's level
        if(T){T.sm=d[1].from; T._smSig=null; smSyncNow();}}
      // 324: a stroke's balls, or a grow, leave with its undo and come back with its redo
      else if(d[0]==='OP'){inv.push(['OP-',d[1],d[2]]);amOpOut(d[1],d[2]);}
      else if(d[0]==='OP-'){inv.push(['OP',d[1],d[2]]);amOpIn(d[1],d[2]);}
      // 321: an erased run or ring comes back in its place; redo takes it again
      else if(d[0]==='RD'){inv.push(['RA',d[1]]);amRulIn(d[1]);}
      else if(d[0]==='RA'){inv.push(['RD',d[1]]);amRulOut(d[1]);}
      else if(d[0]==='PD'){inv.push(['PA',d[1]]);polys.splice(Math.min(d[1].i,polys.length),0,d[1].ring);polyRebuild();}
      else if(d[0]==='PA'){inv.push(['PD',d[1]]);const k=polys.indexOf(d[1].ring);if(k>=0)polys.splice(k,1);polyRebuild();}
      else if(d[0]==='D-'){inv.push(['D',d[1]]);amLayerOut(d[1]);}
      // 332: a tag placed, deleted, edited — and the compose screen's whole set (GS)
      else if(d[0]==='G+'){const k=tags.indexOf(d[1]); inv.push(['G-',{g:d[1],i:k}]); if(k>=0) tags.splice(k,1); tagRebuild(); buildChips();}
      else if(d[0]==='G-'){inv.push(['G+',d[1].g]); tags.splice(Math.min(d[1].i,tags.length),0,d[1].g); tagRebuild(); buildChips();}
      else if(d[0]==='GE'){const g=d[1].g; inv.push(['GE',{g:g,from:d[1].to,to:d[1].from}]);
        g.title=d[1].from.title; g.text=d[1].from.text; g.img=d[1].from.img; tagRebuild(); buildChips();}
      else if(d[0]==='GS'){inv.push(['GS',{from:d[1].to,to:d[1].from}]); tagSetAll(d[1].from.ts,d[1].from.gs);}
      // 391: a deleted volume comes back in its place; redo takes it again
      else if(d[0]==='VD'){inv.push(['VA',d[1]]);MEMBRANES.splice(Math.min(d[1].i,MEMBRANES.length),0,d[1].rec);volRimBuild();volChips();volLayerChips();volCount();}
      else if(d[0]==='VA'){inv.push(['VD',d[1]]);volDelete(d[1].rec.id);}
      else if(d[0]==='H+'){inv.push(['H-',d[1]]);holeRemove(d[1].id);}
      else if(d[0]==='H-'){inv.push(['H+',d[1]]);holeAdd(d[1]);}
      else {const ti=d[0],f=d[1],o=d[2];inv.push([ti,f,types[ti].manual[f]]);types[ti].manual[f]=o;amSUpd(ti,f);recolorFace(f);}}
    inv.reverse(); colAttr.needsUpdate=true;flatAttr.needsUpdate=true;desAttr.needsUpdate=true;updateArea();return inv;}
  const undo=()=>{if(undoStack.length){redoStack.push(applyDiff(undoStack.pop()));updateHB();}};
  const redo=()=>{if(redoStack.length){undoStack.push(applyDiff(redoStack.pop()));updateHB();}};
  function updateHB(){
    // 527: an open polygon is something to take back too — its last point (256), so ↶ is not dimmed while it is open
    const open=(typeof curPoly!=='undefined'&&!!curPoly&&curPoly.pts.length>0);
    document.getElementById('undo').disabled=!undoStack.length&&!open;document.getElementById('redo').disabled=!redoStack.length;
    amSnapSoon();}                     // 327: every step of the history is a change of the work
  function findOrMkType(hex,name){
    let T=types.find(t=>t.hex===hex); if(!T){T=mkType(name||'',hex||'#38b000');buildChips();}
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
  function startPinch(){const t=touchList();if(t.length<2)return;amPinchH=undefined;
    pinch={d:pdist(t[0],t[1]),mx:(t[0].x+t[1].x)/2,my:(t[0].y+t[1].y)/2,a:Math.atan2(t[1].y-t[0].y,t[1].x-t[0].x),tw:0,on:false};}
  /* ---- 1 (24/09): NAVIGATION AROUND WHAT IS UNDER THE HAND --------------------------
     Eli, on long models and after a crop: close to a wall, a drag moves the view by almost
     nothing, and turning swings around a centre far away. The camera turned around the
     bounding sphere's CENTRE and panned at a speed set by the distance to it — right for a
     model seen whole, wrong for a wall seen from a metre (CloudCompare: "נשמע כיוון טוב").
     Three things, each measured from the point under the cursor:
     - TURN about the point where the drag began. The turn is made as always — yaw and
       pitch, never a roll — and then the centre of view is carried by the SAME rigid
       rotation about that point, so the point stays exactly where it is on the screen.
     - GRAB: a pan moves the wall with the hand — one pixel is what one pixel is worth at
       the depth of the point that was grabbed, not at the depth of the model's centre.
     - ZOOM toward the point under the cursor, and stop short of the SURFACE, not of the
       centre. Empty space behaves as before: turn about the centre of view, pan and zoom
       at its distance. */
  const _amNavRay=new THREE.Raycaster();
  let amNavDown=null, amPivot=undefined, amPanK=undefined, amPinchH=undefined, amWheel=null;
  function amNavHit(e){
  camera.updateMatrixWorld();
    const r=el.getBoundingClientRect();
    _amNavRay.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,
                                              -((e.clientY-r.top)/r.height)*2+1),camera);
    const h=_amNavRay.intersectObject(mesh,false);
    return h.length?h[0].point.clone():null;
  }
  function amApply(){ apply(); camera.updateMatrixWorld(); }
function amNavArm(e){ amNavDown={clientX:e.clientX,clientY:e.clientY}; amPivot=undefined; amPanK=undefined; }
  function amDepthOf(p){ camera.updateMatrixWorld(); return p.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())); }
  function amWorldPerPx(depth){
    const r=el.getBoundingClientRect();
    return 2*Math.max(depth,1e-6)*Math.tan(camera.fov*Math.PI/360)/Math.max(1,r.height);
  }
  function amTurn(dAz,dPol){
    if(amPivot===undefined) amPivot=amNavDown?amNavHit(amNavDown):null;
    const q0=camera.quaternion.clone();
    az+=dAz; pol+=dPol; amApply();
    if(!amPivot) return;
    const Rq=camera.quaternion.clone().multiply(q0.invert());
    target.sub(amPivot).applyQuaternion(Rq).add(amPivot); amApply();
  }
  function amPanBy(dx,dy,k){
    const r=new THREE.Vector3(); camera.getWorldDirection(r);
    const right=new THREE.Vector3().crossVectors(r,camera.up).normalize();
    const up=new THREE.Vector3().crossVectors(right,r).normalize();
    target.addScaledVector(right,-dx*k); target.addScaledVector(up,dy*k); amApply();
  }
  function amPan(dx,dy){
    if(amPanK===undefined){ const h=amNavDown?amNavHit(amNavDown):null;
      amPanK=amWorldPerPx(h?amDepthOf(h):dist); }
    amPanBy(dx,dy,amPanK);
  }
  // scale the view about h by s (<1 in, >1 out): h keeps its place on the screen
  function amZoomAbout(h,s){
    const Rb=bs.radius;
    if(h&&s<1){ const d=camera.position.distanceTo(h), minD=Math.max(Rb*0.002,0.005);
      if(d*s<minD) s=Math.min(1,minD/Math.max(d,1e-9)); }
    if(dist*s>Rb*8) s=Rb*8/dist;
    if(dist*s<Rb*1e-5) s=Rb*1e-5/dist;
    if(h) target.sub(h).multiplyScalar(s).add(h);
    dist*=s; amApply();
  }
  // the wheel asks once per burst: while the cursor stays put the point under it does too
  function amWheelAt(e,s){
    const now=performance.now();
    if(!amWheel||now-amWheel.t>250||Math.hypot(e.clientX-amWheel.x,e.clientY-amWheel.y)>4)
      amWheel={x:e.clientX,y:e.clientY,h:amNavHit(e)};
    amWheel.t=now;
    amZoomAbout(amWheel.h,s);
  }
  function amPinch(s,mx,my,dmx,dmy){
    if(amPinchH===undefined) amPinchH=amNavHit({clientX:mx,clientY:my});
    amZoomAbout(amPinchH,s);
    amPanBy(dmx,dmy,amWorldPerPx(amPinchH?amDepthOf(amPinchH):dist));
  }  const AM_NAV_R=()=>bs.radius;   // 379: the model's radius, for the walk's floor
  const AM_YAW_SIGN=1;
  const AM_PITCH_SIGN=1, AM_NAV_LOCKED=()=>false;   // 483
  /*AM_NAV361_START*/
  // 361 (Eli, 29/09): two more ways to move, in the navigation mode. Shift+wheel turns the
  // view IN PLACE — the camera stands and the gaze swings about the upright axis through it
  // ("כמו סיבוב המבט כשאתה עומד במקום"); Ctrl+wheel WALKS forward or back along the ray under
  // the cursor, the zoom unchanged, and through walls — the zoom stops short of the surface,
  // the walk does not. Written against the camera, not the orbit's formula, so the same text
  // holds in every screen (a gate compares them); AM_YAW_SIGN is each screen's own, so the
  // wheel turns the gaze the same way everywhere.
  // 362 (Eli, on 361 in the field: "צריך להקטין את הצעדים"): the turn halved, the walk a tenth
  const AM_YAW_STEP=2.5*Math.PI/180, AM_WALK_STEP=0.016;   // 366: the walk doubled (Eli: "לחזק פי שניים")
  // 379 (Eli, 01/10, the training screen: "הצעד של ההליכה נהיה ממש קטן"): the step is a share of the
  // orbit's distance, and close to a wall — where the holes are worked — that distance is small, and
  // the walk does not grow it. A floor of 3% of the model's radius (AM_NAV_R, each screen's own): far
  // off the walk is as it was; close in it does not shrink below the floor (Eli: "מאשר 3%")
  const AM_WALK_MIN=0.03;
  function amYawInPlace(dAz){
    const c=camera.position.clone(); az+=dAz*AM_YAW_SIGN; amApply();
    target.add(c.sub(camera.position)); amApply(); amWheel=null;
  }
  function amWalk(e,f){
    camera.updateMatrixWorld();
    const r=el.getBoundingClientRect();
    _amNavRay.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,
                                              -((e.clientY-r.top)/r.height)*2+1),camera);
    target.addScaledVector(_amNavRay.ray.direction,f*dist); amApply(); amWheel=null;
  }
  // 420 (Eli, 01/10): "אני רוצה שהיא תהיה זמינה תמיד, בכל מצב, ואותו דבר גם הסיבוב במקום" — held
  // Space + wheel walks, held Alt + wheel turns in place, in EVERY mode of every screen; Ctrl and
  // Shift no longer move ("זה צריך להיות אחיד") and are left to the tools and to the zoom. Space is
  // held, not typed: in a field that takes text it stays a space; elsewhere it is kept from scrolling
  // the page and from pressing the button last clicked. Alt alone is kept from the window's menu.
  let amSpace=false;
  function amTyping(t){
    if(!t||!t.tagName) return false;
    if(t.isContentEditable||t.tagName==='TEXTAREA'||t.tagName==='SELECT') return true;
    return t.tagName==='INPUT'&&!/^(range|button|checkbox|radio|color|file|submit|reset|image)$/i.test(t.type||'');
  }
  window.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!amTyping(e.target)){ amSpace=true; e.preventDefault(); }
    else if(e.key==='Alt') e.preventDefault();
  },true);
  window.addEventListener('keyup',e=>{
    if(e.code==='Space'){ const was=amSpace; amSpace=false; if(was) e.preventDefault(); }
    else if(e.key==='Alt') e.preventDefault();
  },true);
  window.addEventListener('blur',()=>{ amSpace=false; });
  // a sideways scroll is read too: a mouse may send its wheel on either axis
  function amWheelMove(e){
    const d=e.deltaY||e.deltaX; if(!d) return false;
    if(e.altKey){ amYawInPlace(Math.sign(d)*AM_YAW_STEP); return true; }
    if(amSpace){ amWalk(e,-Math.sign(d)*Math.max(AM_WALK_STEP,AM_WALK_MIN*AM_NAV_R()/Math.max(dist,1e-9))); return true; }
    return false;
  }
  // 483 (Eli, 12/10): "חץ לבד מסובב את המבט בכיוון (כמו ALT+גלגלת) — ימינה, שמאלה, למטה ולמעלה. חץ + רווח הולך
  // בכיוון החץ — ימינה, שמאלה, למטה ולמעלה (קדימה ואחורה זה גלגלת + רווח, כמו היום)". A tap is one wheel step; held,
  // the view moves on, slowly (Eli: "15 מעלות לשנייה עם הגברה ל-30 אחרי שנייה") — the walk in the same measure of
  // steps. Not while a field takes the keys (text, a slider, a choice), and not while the view is locked
  const AM_ARROW_TPS=6, AM_ARROW_BOOST=2, AM_ARROW_BOOST_AT=1000;   // 6 steps of 2.5° a second = 15°/s, twice that after a second
  let amArrow=null;
  function amPitchInPlace(dPol){
    const c=camera.position.clone(); pol+=dPol*AM_PITCH_SIGN; amApply();
    target.add(c.sub(camera.position)); amApply(); amWheel=null;
  }
  function amStrafe(sx,sy,f){
    camera.updateMatrixWorld(); const d=new THREE.Vector3(); camera.getWorldDirection(d);
    const right=new THREE.Vector3().crossVectors(d,camera.up).normalize();
    const up=new THREE.Vector3().crossVectors(right,d).normalize();
    target.addScaledVector(right,sx*f*dist).addScaledVector(up,sy*f*dist); amApply(); amWheel=null;
  }
  function amArrowMove(sx,sy){
    if(amSpace){ amStrafe(sx,sy,Math.max(AM_WALK_STEP,AM_WALK_MIN*AM_NAV_R()/Math.max(dist,1e-9))); return; }
    if(sx) amYawInPlace(-sx*AM_YAW_STEP);
    if(sy) amPitchInPlace(sy*AM_YAW_STEP);
  }
  function amArrowFrame(now){
    if(!amArrow) return;
    const dt=Math.min(0.1,Math.max(0,(now-amArrow.last)/1000)); amArrow.last=now;
    if(!AM_NAV_LOCKED()){
      let sx=0, sy=0;
      for(const s of amArrow.keys.values()){
        const n=AM_ARROW_TPS*(now-s.t0>=AM_ARROW_BOOST_AT?AM_ARROW_BOOST:1)*dt;
        s.moved+=n; sx+=s.v[0]*n; sy+=s.v[1]*n; }
      if(sx||sy) amArrowMove(sx,sy);
    }
    amArrow.raf=requestAnimationFrame(amArrowFrame);
  }
  function amArrowKey(e,down){
    const v={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(!v) return false;
    if(down){
      if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey) return false;
      const t=e.target;
      if(amTyping(t)||(t&&t.tagName==='INPUT'&&/^(range|radio)$/i.test(t.type||''))) return false;
      if(AM_NAV_LOCKED()) return false;
      const now=performance.now();
      if(!amArrow) amArrow={keys:new Map(), last:now, raf:0};
      if(!amArrow.keys.has(e.key)) amArrow.keys.set(e.key,{v:v,t0:now,moved:0});
      if(!amArrow.raf) amArrow.raf=requestAnimationFrame(amArrowFrame);
      return true;
    }
    if(!amArrow||!amArrow.keys.has(e.key)) return false;
    const s=amArrow.keys.get(e.key); amArrow.keys.delete(e.key);
    if(s.moved<1&&!AM_NAV_LOCKED()) amArrowMove(s.v[0]*(1-s.moved),s.v[1]*(1-s.moved));   // a tap is one wheel step
    if(!amArrow.keys.size) amArrowStop();
    return true;
  }
  function amArrowStop(){ if(amArrow){ cancelAnimationFrame(amArrow.raf); amArrow=null; } }
  window.addEventListener('keydown',e=>{ if(amArrowKey(e,true)) e.preventDefault(); },true);
  window.addEventListener('keyup',e=>{ if(amArrowKey(e,false)) e.preventDefault(); },true);
  window.addEventListener('blur',()=>{ amArrowStop(); });
  window.amArrowKey=amArrowKey;   // the outer page hands the keys to the frame on screen (as Ctrl+Z)
  window.amSpaceHeld=v=>{ amSpace=!!v; };   // and the held Space with them — its keydown never reaches the frame
  /*AM_NAV361_END*/

  // Is the press ON the model, or in empty space?
  function amOnSurface(e){
    const r=el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,
                                        -((e.clientY-r.top)/r.height)*2+1),camera);
    if(mode==='wallshape') return !!(wallEdit&&wallEdit.mesh&&ray.intersectObject(wallEdit.mesh,false).length);
    return ray.intersectObject(mesh,false).length>0;
  }
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType==='pen'){
      for(const [id,p] of [...ptrs]) if(p.type==='touch'){try{el.releasePointerCapture(id);}catch(_){}ptrs.delete(id);}
      if(dragging==='pinch'||dragging==='rot'){pinch=null;dragging=null;dragId=null;}
    } else if(e.pointerType==='touch'&&hasPen()) return;
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    last=[e.clientX,e.clientY]; dragId=e.pointerId; amNavArm(e);
    if(touchList().length>=2&&!hasPen()){
      if(dragging==='smpaint')smStrokeEnd();
      if(dragging==='paint'&&paintManual){amStrokeEnd();commitH();}
      if(dragging==='line')endLine();
      startPinch();dragging='pinch';return;}
    // a finger ALWAYS navigates — marking/erasing/growing is pencil-only
    // (user decision 08/08/2026; also the original editor's behaviour)
    // 258: a finger rotates, and a finger that STAYS on a point for a moment grabs it
    if(e.pointerType==='touch'){dragging='rot'; amHoldArm(e);}
    else if(mode==='nav'){dragging='rot';}
    // 12 (24/09): a pencil press that meets NOTHING turns the model, in every marking
    // mode — the measurement screen's rule and the training screen's since 297. The
    // ruler still reads a press in the air as the end of its chain.
    // 321: the eraser takes a run or a ring by its tag — tried before the model, since
    // a tag often floats over empty space
    else if(mode==='rem'&&amTagErase(e)){dragging=null;}
    else if(activeKind==='none'&&(mode==='add'||mode==='rem'||mode==='grow')){dragging='rot';}   // 357
    // 332: a touch of the pencil on a tag of this layer opens its card
    else if(activeKind==='tag'&&mode==='add'&&amTagAt(e,'tag')&&activeG>=0&&amTagAt(e,'tag').g.t===tagTypes[activeG].id){
      tagEdit(amTagAt(e,'tag').g);dragging=null;}
    else if(activeKind==='tag'&&mode==='rem'){dragging=amOnSurface(e)?null:'rot';}
    else if(!amOnSurface(e)){ if(activeKind==='rul') rulEnd(); dragging='rot'; }
    else if(mode==='grow'){growAt(e);dragging=null;}
    // 329: the smoothed surface — a tag chooses the region the wheel acts on; else the brush
    else if(activeKind==='area'&&areaTool===AM_SMOOTH){dragging='smpaint';smStroke=new Set();smPaintAt(e);}
    else if(activeKind==='area'&&areaTool===AM_POLY&&mode==='add'){
      polyAt(e);dragging=null;}
    else if(activeKind==='area'&&areaTool===AM_POLY&&mode==='rem'){
      polyEraseAt(e);dragging=null;}
    else if(activeKind==='rul'&&mode==='add'){rulAt(e);dragging=null;}
    else if(activeKind==='rul'&&mode==='rem'){rulEraseAt(e);dragging=null;}
    else if(activeKind==='len'&&mode==='add'){dragging='line';curLine=null;lineAt(e);}
    else if(activeKind==='len'&&mode==='rem'){dragging='lerase';lineEraseAt(e);}
    else if(activeKind==='cnt'&&mode==='add'){placeXAt(e);dragging=null;}
    else if(activeKind==='tag'){if(mode==='add')tagAt(e);dragging=null;}
    else if(activeKind==='cnt'&&mode==='rem'){dragging='xerase';eraseXAt(e);}
    else {dragging='paint';paintManual=true;beginH();amStrokeBegin();paintAt(e);}
  });
  el.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;                    // hovering pencil guard
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
    if(dragging==='pinch'){const t=touchList();if(t.length<2||!pinch)return;
      const nd=pdist(t[0],t[1]),nmx=(t[0].x+t[1].x)/2,nmy=(t[0].y+t[1].y)/2;
      if(nd>0){amPinch(pinch.d/nd,nmx,nmy,nmx-pinch.mx,nmy-pinch.my);}
      // 361: two fingers turning on the glass turn the gaze in place — the iPad's Shift+wheel.
      // Only past 8° of twist, so a pinch that wobbles is still a pinch
      const na=Math.atan2(t[1].y-t[0].y,t[1].x-t[0].x);
      let da=na-pinch.a; if(da>Math.PI) da-=2*Math.PI; if(da<-Math.PI) da+=2*Math.PI;
      const tw=pinch.tw+da, on=pinch.on||Math.abs(tw)>0.14;
      if(on) amYawInPlace(pinch.on?da:tw);
      pinch={d:nd,mx:nmx,my:nmy,a:na,tw:on?0:tw,on:on};return;}
    if(dragId!==null&&e.pointerId!==dragId) return;       // palm guard
    // a finger that travels is navigating, not holding — the grab must not fire behind it
    if(amHold&&Math.hypot(e.clientX-amHold.x,e.clientY-amHold.y)>AM_HOLD_SLOP) amHoldClear();
    const dx=e.clientX-last[0],dy=e.clientY-last[1];last=[e.clientX,e.clientY];
    if(dragging==='rot'){amTurn(-dx*0.006,-dy*0.006);}
    else if(dragging==='line'){lineAt(e);}
    else if(dragging==='lerase'){lineEraseAt(e);}
    else if(dragging==='xerase'){eraseXAt(e);}
    else if(dragging==='grab'){amGrabMove(e);}
    else if(dragging==='smpaint'){smPaintAt(e);}
    else if(dragging==='paint'){paintAt(e);}
  });
  function endDrag(e){
    amHoldClear();
    if(e){ ptrs.delete(e.pointerId); if(e.pointerId===dragId) dragId=null; }
    if(dragging==='pinch'){ if(touchList().length>=2)startPinch(); else {pinch=null;dragging=null;} return; }
    if(dragging==='grab')amGrabEnd();
    if(dragging==='wallshape')wallEnd();
    if(dragging==='volpaint')volCommit();
    if(dragging==='smpaint')smStrokeEnd();
    if(dragging==='paint'&&paintManual){amStrokeEnd();commitH();}
    if(dragging==='line')endLine();
    if(dragging==='rect'){const wr=wrap.getBoundingClientRect();selectRect(rectStart[0],rectStart[1],last[0]-wr.left,last[1]-wr.top);rubber.style.display='none';rectStart=null;}
    dragging=null; dragId=null;}
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
    // 536 (14/10): the About box and the keyboard check scroll under a finger (once a work is loaded this guard is on, and
    // it cancelled every scroll inside them). Measured in WebKit at iPad sizes the box does not overflow — not the cause
    // of 536, a guard all the same
    if(t.closest&&t.closest('#infoModal,#amKbCheck')) return;
    if(!(t.closest&&t.closest('input,button,select,textarea,label'))) e.preventDefault();
  },{passive:false});
  document.addEventListener('dblclick',e=>e.preventDefault());
  /* ---- 452 (Eli, 05/10: "dragging the top bar stutters — sometimes it works, sometimes only from very specific
     points, sometimes it moves the whole bar aside and leaves a black gap on the left; and widen the area for the
     sideways drag, a little upward, where there are no buttons"): the layer row is dragged by our own hand, not
     by the browser's scroll. The guard above lets the browser scroll only from a button, a label or a field, so a
     drag begun on a layer went nowhere, one begun on its name both scrolled and edited it, and at the row's end
     the scroll ran on into the bar itself. A sideways drag from anywhere in the row — or from the bar's empty
     parts above it, off its buttons, sliders and labels — moves the row; a press that does not travel stays a tap */
  (function amLayerDrag(){
    const row=$('layerRow'), bar=$('bar');
    if(!row||!bar||bar.dataset.amDrag) return; bar.dataset.amDrag='1';
    const AM_DRAG_PX=8;
    let d=null, eat=false, glide=0;
    function inBand(t,y){
      if(row.contains(t)) return true;
      if(!bar.contains(t)||t.closest('button,input,select,textarea,label,.slot')) return false;
      return y<row.getBoundingClientRect().top;
    }
    bar.addEventListener('pointerdown',e=>{
      d=null;                                            // a new press starts afresh, whatever became of the last
      if(!inBand(e.target,e.clientY)) return;
      cancelAnimationFrame(glide);
      d={id:e.pointerId,x:e.clientX,y:e.clientY,s:row.scrollLeft,on:false,lx:e.clientX,lt:e.timeStamp,v:0};
    });
    bar.addEventListener('pointermove',e=>{
      if(!d||e.pointerId!==d.id) return;
      const dx=e.clientX-d.x;
      if(!d.on){
        if(Math.abs(dx)<AM_DRAG_PX) return;
        if(Math.abs(e.clientY-d.y)>Math.abs(dx)){ d=null; return; }     // up or down: not ours
        d.on=true; try{bar.setPointerCapture(e.pointerId);}catch(_){}
      }
      row.scrollLeft=d.s-dx;
      const dt=Math.max(1,e.timeStamp-d.lt); d.v=0.7*d.v+0.3*(e.clientX-d.lx)/dt; d.lx=e.clientX; d.lt=e.timeStamp;
      e.preventDefault();
    });
    function up(e){
      if(!d||e.pointerId!==d.id) return;
      const was=d; d=null;
      if(!was.on) return;
      eat=true; setTimeout(()=>{eat=false;},350);       // the click that ends a drag is not a tap
      const a=document.activeElement; if(a&&a.tagName==='INPUT'&&row.contains(a)) a.blur();
      let v=(e.timeStamp-was.lt>80)?0:was.v, t0=performance.now();
      const step=now=>{ const dt=now-t0; t0=now; row.scrollLeft-=v*dt; v*=Math.pow(0.92,dt/16);
        if(Math.abs(v)>0.02) glide=requestAnimationFrame(step); };
      if(Math.abs(v)>0.05) glide=requestAnimationFrame(step);
    }
    bar.addEventListener('pointerup',up); bar.addEventListener('pointercancel',up);
    bar.addEventListener('click',e=>{ if(eat){ eat=false; e.stopPropagation(); e.preventDefault(); } },true);
  })();

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
    const seedVal = lum[FACEOF[seed]];
    const visited=new Uint8Array(N); const q=[seed]; visited[seed]=1; let head=0, added=0; const CAP=80000;
    const M=types[activeT].manual;
    beginH();
    const gop={t:'faces', m:new Map()};          // 324: the grow, as an act in the layer's order
    while(head<q.length && added<CAP){const s=q[head++];
      gop.m.set(s,1);
      if(M[s]!==1){recH(activeT,s);M[s]=1;amSUpd(activeT,s);recolorFace(s);} added++;
      const cx=cen[s*3],cy=cen[s*3+1],cz=cen[s*3+2];
      const ix0=Math.floor((cx-RG)/CELL),ix1=Math.floor((cx+RG)/CELL);
      const iy0=Math.floor((cy-RG)/CELL),iy1=Math.floor((cy+RG)/CELL);
      const iz0=Math.floor((cz-RG)/CELL),iz1=Math.floor((cz+RG)/CELL);
      for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
        const a=grid.get(ckey(ix,iy,iz)); if(!a)continue;
        for(let n=0;n<a.length;n++){const g=a[n]; if(visited[g])continue;
          const dx=cen[g*3]-cx,dy=cen[g*3+1]-cy,dz=cen[g*3+2]-cz; if(dx*dx+dy*dy+dz*dz>RG2)continue;
          const ok = Math.abs(lum[FACEOF[g]]-seedVal) <= growTol;
          if(ok){visited[g]=1; q.push(g);} else visited[g]=1;
        }}
    }
    { const T=types[activeT]; if(!T.ops) T.ops=[];
      if(gop.m.size){ T.ops.push(gop); if(curDiff) curDiff.push(['OP',activeT,gop]); if(amHasBalls(T)) amMarkAt(T,gop); } }
    colAttr.needsUpdate=true; flatAttr.needsUpdate=true;desAttr.needsUpdate=true; updateArea(); amMarkDraw(); commitH();
  }

  /* ---- brush paint ---- */
  /* 6 (24/09): the two shapes, one meaning in every screen — the ball is the ball; the
     flat one is the ball CUT BY what is seen on screen (Eli). One pass draws every
     sub-face in the colour of its id, again only when the camera moved. */
  let brushShape='ball';
  const AMID={mat:null, rt:null, cam:null, ok:true, W:0, H:0, n:0};
  function amIdRender(){
    if(!AMID.ok) return false;
    try{
      const g=mesh.geometry, n=g.attributes.position.count;
      if(!AMID.mat||AMID.n!==n){
        const a=new Uint8Array(n*3);
        for(let i=0;i<n;i++){ const f=((i/3)|0)+1;         // 0 is "nothing"
          a[i*3]=f&255; a[i*3+1]=(f>>8)&255; a[i*3+2]=(f>>16)&255; }
        g.setAttribute('aFid', new THREE.BufferAttribute(a,3,true));
        if(!AMID.mat) AMID.mat=new THREE.ShaderMaterial({
          vertexShader:'attribute vec3 aFid; varying vec3 vFid;'
                      +'void main(){ vFid=aFid; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader:'varying vec3 vFid; void main(){ gl_FragColor=vec4(vFid,1.0); }',
          side:THREE.DoubleSide});
        AMID.n=n; AMID.cam=null;
      }
      if(AMID.cam&&camera.matrixWorld.equals(AMID.cam)&&AMID.rt) return true;
      const sz=renderer.getDrawingBufferSize(new THREE.Vector2());
      const W=Math.max(16,Math.min(2048,Math.round(sz.x))), H=Math.max(16,Math.min(2048,Math.round(sz.y)));
      if(!AMID.rt||AMID.rt.width!==W||AMID.rt.height!==H){
        if(AMID.rt) AMID.rt.dispose();
        AMID.rt=new THREE.WebGLRenderTarget(W,H,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
      }
      AMID.W=W; AMID.H=H;
      const prevT=renderer.getRenderTarget(), prevM=mesh.material, hid=[];
      scene.traverse(o=>{ if(o!==mesh&&o.visible&&(o.isMesh||o.isLine||o.isLineSegments||o.isPoints||o.isSprite)){o.visible=false;hid.push(o);} });
      const cc=new THREE.Color(); renderer.getClearColor(cc); const ca=renderer.getClearAlpha();
      mesh.material=AMID.mat;
      renderer.setRenderTarget(AMID.rt); renderer.setClearColor(0x000000,1); renderer.clear();
      renderer.render(scene,camera);
      renderer.setRenderTarget(prevT); renderer.setClearColor(cc,ca); mesh.material=prevM;
      for(const o of hid) o.visible=true;
      AMID.cam=camera.matrixWorld.clone();
      return true;
    }catch(_){ AMID.ok=false; return false; }
  }
  function amSeenUnder(e,p){
    if(brushShape!=='flat'||!amIdRender()) return null;
    const r=el.getBoundingClientRect();
    const X=((e.clientX-r.left)/r.width)*AMID.W, Y=(1-(e.clientY-r.top)/r.height)*AMID.H;
    // the ball's outline on screen, at its NEAR side: a face in the ball that is nearer the
    // camera than p projects farther from the centre than p's own radius would say
    const right=new THREE.Vector3(); camera.getWorldDirection(right);
    right.cross(camera.up); if(right.lengthSq()<1e-12) right.set(1,0,0); right.normalize();
    const a=p.clone().project(camera), b=p.clone().addScaledVector(right,brushR).project(camera);
    const d=camera.position.distanceTo(p);
    const rp=Math.max(1,Math.abs(b.x-a.x)*0.5*AMID.W*(d/Math.max(d-brushR,0.25*d)));
    const x0=Math.max(0,Math.floor(X-rp)), y0=Math.max(0,Math.floor(Y-rp));
    const x1=Math.min(AMID.W-1,Math.ceil(X+rp)), y1=Math.min(AMID.H-1,Math.ceil(Y+rp));
    const w=x1-x0+1, h=y1-y0+1; if(w<1||h<1) return new Set();
    const buf=new Uint8Array(4*w*h);
    renderer.readRenderTargetPixels(AMID.rt,x0,y0,w,h,buf);
    const out=new Set(), r2=rp*rp, ids=new Int32Array(w*h);
    for(let j=0;j<h;j++) for(let i=0;i<w;i++){
      const k=4*(j*w+i), f=(buf[k]|(buf[k+1]<<8)|(buf[k+2]<<16))-1;
      ids[j*w+i]=(f>=0&&f<N)?f:-1;
      const dx=x0+i-X, dy=y0+j-Y; if(dx*dx+dy*dy>r2) continue;
      if(f>=0&&f<N) out.add(f);
    }
    // 458 (Eli, 06/10: "a thin strip of marking — the eraser only moves it"; "and the flat brush marks with many
    // holes"): a pixel is owned by the one sub-face at its centre, so a sub-face smaller than a pixel — most of
    // them on a thin strip, at a grazing angle or zoomed out — owned none and was never "seen", never painted and
    // never erased, while the screen's antialiasing still showed it as a dot. It is seen when the pixel it falls
    // on, or one around it, is owned by a sub-face on the same surface: no farther from it than two and a half
    // pixels at its depth, or one and a half of the longer edge of the two.
    // 473/4 (Eli, 06/10: "אני רוצה שתהיה יותר שטוחה (כמו קודם) אבל בלי כל החורים; אולי להגדיר את הקרבה בין הפאות לפי
    // מסלול על המשטח ולא מרחק אווירי"): "no farther" is measured ALONG THE SURFACE — face to face through shared
    // corners, centroid to centroid (amSurfNet) — not through the air. Through the air the tolerance jumped the gap
    // of a folded wall (two sheets a centimetre apart, joined somewhere): on the map's overview, cells of ~43 cm, a
    // reach of ~65 cm took the inside sheet through the outside one. Along the surface the way round the fold is
    // long, so the sheet behind stays; the sub-faces of the sheet in front are a few faces from their pixels' owners
    const edge=f=>{ const o=f*9; let m=0;
      for(let c=0;c<3;c++){ const q=(c+1)%3; m=Math.max(m,Math.hypot(pos[o+c*3]-pos[o+q*3],pos[o+c*3+1]-pos[o+q*3+1],pos[o+c*3+2]-pos[o+q*3+2])); }
      return m; };
    const v=new THREE.Vector3(), kp=2.5*2*Math.tan(camera.fov*Math.PI/360)/AMID.H;   // 2.5 pixels, in metres per metre of depth
    const tol=(f,g)=>Math.max(1.5*Math.max(edge(f),edge(g)), kp*camera.position.distanceTo(v.set(cen[f*3],cen[f*3+1],cen[f*3+2])));
    // the surface net, built once in the dab and only when a face that owns no pixel is asked: every face within the
    // reach of the ball, the owners of the window's pixels as its sources, as far as the largest tolerance there
    let net=null;
    const mkNet=()=>{ const seeds=new Set(); let E=0;
      for(let k=0;k<ids.length;k++){ const g=ids[k]; if(g>=0&&!seeds.has(g)){ seeds.add(g); E=Math.max(E,edge(g)); } }
      const T=Math.max(1.5*E, kp*(d+brushR));
      return amSurfNet(p,brushR+T,seeds,T); };
    return {has:f=>{
      if(out.has(f)) return true;
      v.set(cen[f*3],cen[f*3+1],cen[f*3+2]).project(camera); if(v.z<-1||v.z>1) return false;
      const pi=Math.floor((v.x+1)*0.5*AMID.W)-x0, pj=Math.floor((v.y+1)*0.5*AMID.H)-y0, O=[];
      for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){ const i=pi+di, j=pj+dj;
        if(i<0||j<0||i>=w||j>=h) continue; const g=ids[j*w+i]; if(g>=0&&O.indexOf(g)<0) O.push(g); }
      if(!O.length) return false;
      if(O.indexOf(f)>=0){ out.add(f); return true; }
      if(!net) net=mkNet();
      const i=net.loc.get(f); if(i===undefined) return false;
      // the nearest owner along the surface is, almost always, one of the pixels around it: then the answer is read off
      const g=net.lab[i];
      if(g>=0&&O.indexOf(g)>=0&&net.D[i]<=tol(f,g)){ out.add(f); return true; }
      // otherwise (the edge of a wall, a fold) a search of its own toward the owners around it, within their tolerance
      let tm=0; for(const q of O) tm=Math.max(tm,tol(f,q));
      if(net.D[i]>tm&&tm<=net.T) return false;
      if(net.reach(i,O,q=>tol(f,q),tm)){ out.add(f); return true; }
      return false; }};
  }
  // 473/4: the surface around a dab of the flat brush, as a net of faces — the faces whose centroid is within R of p
  // (the screen's amBallFaces), joined where they share a corner (by position, to 10 µm: the screens' faces are
  // unindexed, and their shared corners are the same numbers — measured on the payloads, the map's overview and the
  // package's subdivision), each step the distance between the two centroids. D: the distance along it from every
  // face to the nearest seed (the faces that own a pixel), up to T, and lab: which seed; reach(i,O,tolOf,tm): whether
  // face i reaches one of the faces O within that face's tolerance — a search of its own, at most 20,000 steps
  function amSurfNet(p,R,seed,T){
    const L=[], loc=new Map();
    amBallFaces(p,R,f=>{ if(!loc.has(f)){ loc.set(f,L.length); L.push(f); } });
    const M=L.length;
    let cap=16; while(cap<6*M) cap<<=1; const mask=cap-1;
    const slot=new Int32Array(cap).fill(-1), K=new Float64Array(9*M+3), vid=new Int32Array(3*M); let nv=0;
    for(let i=0;i<M;i++){ const o=L[i]*9;
      for(let c=0;c<3;c++){ const kx=Math.round(pos[o+c*3]*1e5), ky=Math.round(pos[o+c*3+1]*1e5), kz=Math.round(pos[o+c*3+2]*1e5);
        let hh=(Math.imul(kx|0,73856093)^Math.imul(ky|0,19349663)^Math.imul(kz|0,83492791))&mask;
        for(;;){ const s=slot[hh];
          if(s<0){ slot[hh]=nv; K[nv*3]=kx; K[nv*3+1]=ky; K[nv*3+2]=kz; vid[i*3+c]=nv++; break; }
          if(K[s*3]===kx&&K[s*3+1]===ky&&K[s*3+2]===kz){ vid[i*3+c]=s; break; }
          hh=(hh+1)&mask; } } }
    const st=new Int32Array(nv+1); for(let k=0;k<3*M;k++) st[vid[k]+1]++;
    for(let k=0;k<nv;k++) st[k+1]+=st[k];
    const at=st.slice(0,nv), fv=new Int32Array(3*M); for(let k=0;k<3*M;k++) fv[at[vid[k]]++]=(k/3)|0;
    const C=new Float64Array(3*M); for(let i=0;i<M;i++){ const a=L[i]*3; C[i*3]=cen[a]; C[i*3+1]=cen[a+1]; C[i*3+2]=cen[a+2]; }
    const step=(i,j)=>{ const x=C[i*3]-C[j*3], y=C[i*3+1]-C[j*3+1], z=C[i*3+2]-C[j*3+2]; return Math.sqrt(x*x+y*y+z*z); };
    // a binary heap of (distance, face)
    const heap=()=>{ const hv=[], hi=[];
      return {n:()=>hv.length,
        push(x,i){ let k=hv.length; hv.push(x); hi.push(i);
          while(k>0){ const u=(k-1)>>1; if(hv[u]<=x) break; hv[k]=hv[u]; hi[k]=hi[u]; k=u; } hv[k]=x; hi[k]=i; },
        pop(){ const ti=hi[0], lx=hv.pop(), li=hi.pop(), n=hv.length;
          if(n){ let k=0; for(;;){ let c=2*k+1; if(c>=n) break; if(c+1<n&&hv[c+1]<hv[c]) c++; if(hv[c]>=lx) break; hv[k]=hv[c]; hi[k]=hi[c]; k=c; }
            hv[k]=lx; hi[k]=li; }
          return ti; },
        top:()=>hv[0]}; };
    const D=new Float64Array(M).fill(Infinity), lab=new Int32Array(M).fill(-1), Q=heap();
    for(let i=0;i<M;i++) if(seed.has(L[i])){ D[i]=0; lab[i]=L[i]; Q.push(0,i); }
    while(Q.n()){ const x=Q.top(), i=Q.pop(); if(x>D[i]) continue;
      for(let c=0;c<3;c++){ const vv=vid[i*3+c];
        for(let k=st[vv];k<st[vv+1];k++){ const j=fv[k]; if(j===i) continue;
          const nd=x+step(i,j); if(nd<D[j]&&nd<=T){ D[j]=nd; lab[j]=lab[i]; Q.push(nd,j); } } } }
    function reach(i0,O,tolOf,tm){
      const dd=new Map([[i0,0]]), H=heap(); H.push(0,i0); let n=0;
      while(H.n()&&n<20000){ const x=H.top(), i=H.pop(); if(x>dd.get(i)) continue; n++;
        if(O.indexOf(L[i])>=0&&x<=tolOf(L[i])) return true;
        for(let c=0;c<3;c++){ const vv=vid[i*3+c];
          for(let k=st[vv];k<st[vv+1];k++){ const j=fv[k]; if(j===i) continue;
            const nd=x+step(i,j); if(nd<=tm&&!(dd.get(j)<=nd)){ dd.set(j,nd); H.push(nd,j); } } } }
      return false;
    }
    return {loc:loc, D:D, lab:lab, T:T, reach:reach, M:M};
  }
  // 473/4: every face whose centroid is within R of p — for amSurfNet, on the measurement screen's and the iPad's
  // grid of cells (the map has its own, on the brush's cells)
  function amBallFaces(p,R,fn){
    const R2=R*R, i0=Math.floor((p.x-R)/CELL), i1=Math.floor((p.x+R)/CELL), j0=Math.floor((p.y-R)/CELL), j1=Math.floor((p.y+R)/CELL),
          k0=Math.floor((p.z-R)/CELL), k1=Math.floor((p.z+R)/CELL);
    for(let ix=i0;ix<=i1;ix++) for(let iy=j0;iy<=j1;iy++) for(let iz=k0;iz<=k1;iz++){
      const a=grid.get(ckey(ix,iy,iz)); if(!a) continue;
      for(let n=0;n<a.length;n++){ const f=a[n], dx=cen[f*3]-p.x, dy=cen[f*3+1]-p.y, dz=cen[f*3+2]-p.z;
        if(dx*dx+dy*dy+dz*dz<=R2) fn(f); } }
  }
  function amSetShape(k){
    brushShape=(k==='flat')?'flat':'ball';
    const b=document.getElementById('sBall'), f=document.getElementById('sFlat');
    if(b) b.classList.toggle('on',brushShape==='ball'); if(f) f.classList.toggle('on',brushShape==='flat');
  }
  if($('sBall')) $('sBall').onclick=()=>amSetShape('ball');
  if($('sFlat')) $('sFlat').onclick=()=>amSetShape('flat');
  function paintAt(e){
    const hit=castAt(e); if(!hit.length)return;
    const p=hit[0].point,r2=brushR*brushR;let ch=false;
    const val=(mode==='add')?1:-1;
    amStrokeDab(p); if(val<0&&smLevelOf(types[activeT])>0) smLiveHide(types[activeT].id,p,brushR);   // 433                               // 324: the stroke's balls
    const seen=amSeenUnder(e,p);                  // 6: null = the ball; a set = the flat cut
    const ix0=Math.floor((p.x-brushR)/CELL),ix1=Math.floor((p.x+brushR)/CELL);
    const iy0=Math.floor((p.y-brushR)/CELL),iy1=Math.floor((p.y+brushR)/CELL);
    const iz0=Math.floor((p.z-brushR)/CELL),iz1=Math.floor((p.z+brushR)/CELL);
    for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
      const a=grid.get(ckey(ix,iy,iz)); if(!a)continue;
      for(let n=0;n<a.length;n++){const f=a[n];
        const dx=cen[f*3]-p.x,dy=cen[f*3+1]-p.y,dz=cen[f*3+2]-p.z;
        if(dx*dx+dy*dy+dz*dz<=r2&&(!seen||seen.has(f))){
          { const M=types[activeT].manual;
            if(M[f]!==val){recH(activeT,f);M[f]=val;amSUpd(activeT,f);recolorFace(f);ch=true;} }
        }}}
    // 494: the sub-faces it recoloured go up at the frame (amColFlush); the area is counted once the stroke ends
    // (amStrokeEnd), by the same full count — a touch with no stroke (no ball line) still counts it here
    if(ch&&!amLive) updateArea();}

  /* ---- length stroke: sample the pencil path into a surface polyline ---- */
  function lineEraseAt(e){const hit=castAt(e); if(!hit.length)return;
    eraseLineAt(hit[0].point); invalidate();
  }
  function lineAt(e){if(activeL<0)return;
    const hit=castAt(e); if(!hit.length)return;
    // 522: a wide tape is not lifted off the wall by its width — the line is measured where it is drawn, so the lift
    // stops where the old widest tape's was (2.4 cm)
    const h=hit[0]; const nrm=h.face?h.face.normal:null; const lift=Math.min(0.024,Math.max(0.004,lineW*0.8));
    const px=h.point.x+(nrm?nrm.x*lift:0), py=h.point.y+(nrm?nrm.y*lift:0), pz=h.point.z+(nrm?nrm.z*lift:0);
    if(!curLine){curLine={t:lenTypes[activeL].id,pts:[px,py,pz],len:0,w:lineW,obj:null};return;}
    const p=curLine.pts, n=p.length;
    const d=Math.hypot(px-p[n-3],py-p[n-2],pz-p[n-1]);
    if(d<MIN_SEG)return;
    p.push(px,py,pz); curLine.len+=d;
    if(curLine.obj)scene.remove(curLine.obj);
    curLine.obj=lineObj(curLine); scene.add(curLine.obj); invalidate();
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
      // 333: the tree keeps the triangles in the model's own order (indirect). Built by default it
      // REORDERS them, and hit.faceIndex then counts in the new order, while every caller reads it
      // as the model's face: measured 28/09, 198 of 200 rays named a face up to 1.97 m from the
      // hit. Kept apart, the order is the model's, the geometry stays unindexed (4.5 MB less on
      // Kziv), and the closest point and the normals the tape fit asks are the same to the bit.
      amBVH=new MeshBVHLib.MeshBVH(geo,{indirect:true});
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
      // Continue-a-line (user 14/08): a stroke that begins or ends within 3 cm of an
      // endpoint of an existing line OF THE SAME LAYER is welded to it — one line, one
      // repair number — so the user can stop, orbit, zoom, and keep drawing. The match is
      // made against the endpoints the user SEES (the fit stations when they exist).
      const WELD2=0.03*0.03, _p=curLine.pts;
      const _ends=L=>{const s=(L.fit&&L.fit.stations)||L.pts;
        return [[s[0],s[1],s[2]],[s[s.length-3],s[s.length-2],s[s.length-1]]];};
      const _d2=(a,b)=>{const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2];return dx*dx+dy*dy+dz*dz;};
      const _S=[_p[0],_p[1],_p[2]], _E=[_p[_p.length-3],_p[_p.length-2],_p[_p.length-1]];
      let _host=null,_mode=0,_bd=WELD2;
      for(const L of lines){
        if(L.t!==curLine.t) continue;
        const he=_ends(L);
        const cand=[[_d2(_S,he[1]),1],[_d2(_S,he[0]),2],[_d2(_E,he[1]),3],[_d2(_E,he[0]),4]];
        for(const c of cand) if(c[0]<_bd){_bd=c[0];_host=L;_mode=c[1];}
      }
      if(_host){
        const _rev=a=>{const o=[];for(let i=a.length-3;i>=0;i-=3)o.push(a[i],a[i+1],a[i+2]);return o;};
        let merged;
        if(_mode===1) merged=_host.pts.concat(_p);            // new starts at host's end
        else if(_mode===2) merged=_rev(_host.pts).concat(_p); // new starts at host's start
        else if(_mode===3) merged=_host.pts.concat(_rev(_p)); // new ends at host's end
        else merged=_p.concat(_host.pts);                     // new ends at host's start
        if(curLine.obj) scene.remove(curLine.obj);
        delLine(_host);
        curLine={t:curLine.t, pts:merged, len:0, w:_host.w||curLine.w, obj:null};
        const mf=amMeasureStroke(curLine.pts, curLine.w);
        if(mf){curLine.fit=mf;curLine.len=mf.length_m;} else curLine.len=lineLen(curLine.pts);
        addLine(curLine);
        undoStack.push([['L-',_host],['L+',curLine]]);
        redoStack.length=0;markUnexported(true);updateHB();amLenCntShow();   // 494: the tape's length only
        curLine=null; invalidate(); return;
      }
      // the stations become the stroke's truth; without a BVH the stroke stays raw
      const fit=amMeasureStroke(curLine.pts, curLine.w);
      if(fit){ curLine.fit=fit; curLine.len=fit.length_m;
        if(curLine.obj){scene.remove(curLine.obj);curLine.obj=null;} }
      addLine(curLine);
      undoStack.push([['L+',curLine]]);redoStack.length=0;markUnexported(true);updateHB();amLenCntShow();}
    else if(curLine.obj)scene.remove(curLine.obj);
    curLine=null;
  }

  /* ---- auto-complete (logistic head on quadratic feature expansion) ---- */
  // 513: the learning's 90 means and spreads, once a session (the features themselves are expanded when asked)
  const LSTATS={v:null};
  // 513: the 90 features of face `fo` (its 12, their squares, their 66 products) — as buildEX stored them: the 12 through a
  // Float32Array (q/25), and every square and product rounded to float32 as its store did; with `st` (amLearnStats),
  // normalised as buildEX normalised them ((x - mean) / spread, rounded to float32). `out`: a Float64Array(90).
  function amLearnRow(q,fo,out,st){
    const f=amLearnRow.f||(amLearnRow.f=new Float32Array(12)); let c=0;
    for(let k=0;k<12;k++) f[k]=q[fo*12+k]/25;
    for(let k=0;k<12;k++) out[c++]=f[k];
    for(let k=0;k<12;k++) out[c++]=Math.fround(f[k]*f[k]);
    for(let a=0;a<12;a++) for(let b=a+1;b<12;b++) out[c++]=Math.fround(f[a]*f[b]);
    if(st){ const M=st.mean, S=st.std; for(let k=0;k<90;k++) out[k]=Math.fround((out[k]-M[k])/S[k]); }
    return out;
  }
  // 513: the 90 means and spreads buildEX computed over every face — the same sums in the same order (float64 over the
  // float32 values), in two passes, giving the page back every ~40 ms (`ms`; `tick(done)` answers false to stop: cancelled).
  async function amLearnStats(q,FO,tick,ms){
    const lim=(ms==null)?40:ms;
    const mean=new Float64Array(90), std=new Float64Array(90), r=new Float64Array(90);
    let t=performance.now();
    for(let pass=0;pass<2;pass++){
      for(let fo=0;fo<FO;fo++){
        amLearnRow(q,fo,r,null);
        if(pass===0){ for(let k=0;k<90;k++) mean[k]+=r[k]; }
        else{ for(let k=0;k<90;k++){ const d=r[k]-mean[k]; std[k]+=d*d; } }
        if((fo&4095)===0&&performance.now()-t>=lim){ if(!(await tick(pass*FO+fo))) return null; t=performance.now(); }
      }
      if(pass===0) for(let k=0;k<90;k++) mean[k]/=FO;
    }
    for(let k=0;k<90;k++) std[k]=Math.sqrt(std[k]/FO)+1e-6;
    return {mean,std};
  }
  // 513: one learning for the active layer — the examples (its marks; other layers' positives neutral; outside the orange
  // zone a sampled clean negative), 500 steps of the logistic head, and the probability of every face — the arithmetic of
  // the two copies it replaces, step for step. o: {types, activeT, N, FO, FACEOF, OFF, roi, roiCount, qfeat, stats (a
  // holder: {v}), progress(f,next), cancelled(), sliceMs (40 when not given)}. Answers {few:true,npos,nneg} (too few examples, nothing computed),
  // null (cancelled — nothing written), or {prob: Float32Array(N), npos, nneg} for the caller to put on the layer.
  async function amLearnRun(o){
    const T=o.types[o.activeT], N=o.N, FO=o.FO, FACEOF=o.FACEOF, OFF=o.OFF;
    const cnt=new Int32Array(FO);
    for(let s=0;s<N;s++){const m=T.manual[s]; if(m!==0) cnt[FACEOF[s]]+=m;}
    const otherPos=new Uint8Array(FO);
    for(let tj=0;tj<o.types.length;tj++){ if(tj===o.activeT)continue; const M=o.types[tj].manual;
      for(let s=0;s<N;s++) if(M[s]===1) otherPos[FACEOF[s]]=1; }
    const Xi=[],yi=[]; const labeled=new Uint8Array(FO);
    for(let fo=0;fo<FO;fo++){ if(cnt[fo]>0){Xi.push(fo);yi.push(1);labeled[fo]=1;} else if(cnt[fo]<0){Xi.push(fo);yi.push(0);labeled[fo]=1;} }
    let npos=0; for(const y of yi) npos+=y; let nneg=yi.length-npos;
    if(o.roiCount>0){
      const rf=new Uint8Array(FO); for(let s=0;s<N;s++) if(o.roi[s]) rf[FACEOF[s]]=1;
      const out=[]; for(let fo=0;fo<FO;fo++) if(!rf[fo]&&!labeled[fo]&&!otherPos[fo]) out.push(fo);
      const cap=Math.min(out.length, Math.max(300, npos*3));
      for(let i=0;i<cap;i++){const fo=out[(Math.random()*out.length)|0]; if(labeled[fo])continue; labeled[fo]=1; Xi.push(fo); yi.push(0); nneg++;}
    }
    if(npos<15||nneg<15) return {few:true,npos,nneg};
    // the work's units, for the fraction: two passes over the faces (once a session), the steps over the examples, the
    // prediction over the faces — each face-row about one unit
    const st0=o.stats.v, uStats=st0?0:2*FO, uTrain=500*Xi.length*2, uPred=2*FO, U=Math.max(1,uStats+uTrain+uPred);
    const say=(u,un)=>{ if(o.progress) o.progress(u/U, un/U); };
    const go=async(u,un)=>{ say(u,un); await new Promise(r=>setTimeout(r,0)); return !o.cancelled(); };
    let st=st0; const lim=(o.sliceMs==null)?40:o.sliceMs;
    if(!st){ st=await amLearnStats(o.qfeat,FO,d=>go(d,Math.min(uStats,d+FO/8)),lim);
      if(!st) return null; o.stats.v=st; }
    // the examples' rows, normalised once — the same float32 numbers buildEX's array held for them
    const NE=90, X=new Float32Array(Xi.length*NE), r=new Float64Array(NE);
    for(let n=0;n<Xi.length;n++){ amLearnRow(o.qfeat,Xi[n],r,st); for(let k=0;k<NE;k++) X[n*NE+k]=r[k]; }
    const w=new Float64Array(NE); let bw=0;
    const wpos=yi.length/(2*npos), wneg=yi.length/(2*nneg), lr=0.3, lam=0.02;
    let t=performance.now();
    for(let it=0;it<500;it++){
      const gw=new Float64Array(NE); let gb=0;
      for(let n=0;n<Xi.length;n++){const o2=n*NE; let z=bw;
        for(let k=0;k<NE;k++) z+=w[k]*X[o2+k];
        const p=1/(1+Math.exp(-z)); const e=(p-yi[n])*(yi[n]?wpos:wneg);
        for(let k=0;k<NE;k++) gw[k]+=e*X[o2+k]; gb+=e;}
      const m=Xi.length; for(let k=0;k<NE;k++) w[k]-=lr*(gw[k]/m+lam*w[k]); bw-=lr*gb/m;
      // the clock asked every 10 steps (a step is ~2 ms)
      if((it%10)===9&&performance.now()-t>=lim){ const u=uStats+(it+1)*Xi.length*2; if(!(await go(u,u+Xi.length*20))) return null; t=performance.now(); }
    }
    const prob=new Float32Array(N); t=performance.now();
    for(let fo=0;fo<FO;fo++){ amLearnRow(o.qfeat,fo,r,st); let z=bw; for(let k=0;k<NE;k++) z+=w[k]*r[k];
      const p=1/(1+Math.exp(-z)); for(let s=OFF[fo];s<OFF[fo+1];s++) prob[s]=p;
      if((fo&4095)===0&&performance.now()-t>=lim){ const u=uStats+uTrain+2*fo; if(!(await go(u,u+FO/4))) return null; t=performance.now(); }
    }
    say(U,U);
    return {prob,npos,nneg};
  }
  // 513 (Eli, 14/10: "תתחילו בשניהם"; the iPad too): the planimeter on the waiting screen after 1.5 s, driven by the
  // work done, and "ביטול" on it — nothing is written until the end, so a cancelled learning leaves the screen as it was
  let LEARN_OP=null;
  async function autoComplete(){
    if(LEARN_OP)return;
    const T=types[activeT], op={}; LEARN_OP=op;
    const veil=$('amLoad'), cb=$('amLoadCancel'); let shown=false;
    const tv=setTimeout(()=>{ if(veil.style.display!=='none')return; shown=true;
      $('amLoadMsg').textContent='לומד את הסימונים…';
      if(cb){ cb.hidden=false; cb.disabled=false; cb.textContent='ביטול';
        cb.onclick=async()=>{ if(!(await amAsk('לבטל את הלמידה?\nהסימונים יישארו כפי שהיו.',
            [{t:'לבטל את הלמידה',v:true,primary:true},{t:'להמשיך',v:false}],false)))return;
          if(LEARN_OP===op){ LEARN_OP=null; cb.disabled=true; cb.textContent='מבטל…'; } }; }
      veil.style.display='flex'; if(window.__pmStart)window.__pmStart('לומד את הסימונים',{progress:true}); },1500);
    let r=null,ok=false;
    try{
      r=await amLearnRun({types:types,activeT:activeT,N:N,FO:FO,FACEOF:FACEOF,OFF:OFF,roi:roi,roiCount:roiCount,qfeat:qfeat,stats:LSTATS,
        progress:(f,nx)=>{ if(shown&&window.__pmProgress)window.__pmProgress(f,nx); },
        cancelled:()=>LEARN_OP!==op});
      ok=true;
    }finally{
      clearTimeout(tv); if(LEARN_OP===op)LEARN_OP=null; if(cb)cb.hidden=true;
      if(shown){ const hide=()=>{veil.style.display='none';};
        if(ok&&r&&!r.few&&window.__pmFinish)window.__pmFinish(hide); else{ if(window.__pmStop)window.__pmStop(); hide(); } }
    }
    if(!r)return;                                   // cancelled: the screen as it was
    if(r.few){ const npos=r.npos, nneg=r.nneg; amTell('צריך עוד דוגמאות לסוג "'+(T.name||'ללא שם')+'": לפחות ~15 פאות מסומנות (＋) ו-15 לא (−).\nכרגע: '+npos+' כן, '+nneg+' לא.'); return; }
    if(!T.prob||T.prob===prob&&activeT!==0)T.prob=new Float32Array(N);
    T.prob.set(r.prob);
    T.hasProb=true;recolorAll();
    const ab=$('auto');const old=ab.textContent;ab.textContent='✓ הושלם ('+r.npos+'+/'+r.nneg+'−)';
    setTimeout(()=>{ab.textContent=old;},2500);
  }
  // קרומי נפח (החלטות 114+120): גאומטריה מפורשת החיה בגיליון בלבד.
  // הצפיין אינו יוצר אותם ואינו מציג אותם עדיין — הוא מחזיר אותם כמות שהם,
  // כדי שמסלול האייפד לא ירוקן גיליון שיש בו קרומים.
  let MEMBRANES=[];
  // Carried, not used: the iPad does not draw volumes, but the sheet passes
  // through here and a field this file does not carry comes back empty.
  // volLayers holds each volume layer's name, colour and closure method
  // (decision 142); dropping it would leave records pointing at nothing.
  let VOL_LAYERS=[];
  /* ---- sheet export: field-for-field the desktop getSheet(withDerived=true) --- */
  function typeState(T){
    const m=[], ov=[];
    for(let f=0;f<N;f++){
      if(T.manual[f]!==0) m.push([f,T.manual[f]]);
      if(T.faceThr && !isNaN(T.faceThr[f])) ov.push([f,Math.round(T.faceThr[f]*1000)/1000]);
    }
    return {id:T.id, name:T.name, color:T.hex, thr:T.thr, op:T.op, hid:!!T.hid, repHid:!!T.repHid,
            am:(T.am||AM_BRUSH),   // 256: the layer's measurement mode travels with it
            design:Math.round(((typeof T.design==='number')?T.design:0.6)*100)/100, manual:m, faceThr:ov,
            ops:amOpsOut(T),     // 324: the strokes' balls and the grows, in their order
            ...(smLevelOf(T)?{sm:smLevelOf(T)}:{}),   // 433: the layer's smoothing level
            hasProb:T.hasProb,
            prob:T.hasProb?(()=>{const p=new Array(FO);
              for(let fo=0;fo<FO;fo++)p[fo]=Math.round(T.prob[OFF[fo]]*1000)/1000;return p;})():null};
  }
  function getSheet(withDerived){
    smSyncNow();   // 433: the regions are the brush's marking as it is now
    const t0=typeState(types[0]);
    const H=amSheetHost();   // 349: what the product gives the sheet — its layout counts, its volume layers, its identity
    // The zone that travels back to the training stage is DERIVED: what the user painted,
    // widened by every face carrying an area mark. A repair marked outside the zone must not
    // depend on the user remembering to paint it — and because the widening is derived and
    // not stored as paint, erasing that mark takes the implied orange back with it instead of
    // leaving an orphan. Area marks only: tapes and counters live in world coordinates and
    // consume neither features nor sub-face resolution (decision 84).
    const rp=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]])rp.push(fo);   // painted, per original face
    const mkf=new Uint8Array(FO);
    for(const T of types){const M=T.manual; for(let s=0;s<N;s++) if(M[s]===1) mkf[FACEOF[s]]=1;}
    const rf=[];for(let fo=0;fo<FO;fo++)if(roi[OFF[fo]]||mkf[fo])rf.push(fo);
    // v4 only when the sheet actually carries a ruler. A work with no ruler still
    // writes v3 and still opens in every reader that came before it — the version is
    // a statement about the CONTENT, not about the build that wrote it.
    const o={_sheet:1, sheetVersion:((rulPts.length||polys.length)?4:3), Fo:FO, Nsub:N, subdiv:SUBK, cnt:H.cnt,
             // the child order the flat indices were written against; a reader that does not
             // know this scheme refuses the file instead of guessing (decision 85)
             subScheme:AM_SUB_SCHEME,
             // one wheel for the whole work; additive field, so every older sheet still
             // opens and simply falls back to the default (contract, decisions 18/19)
             designLevel:Math.round((((types[0]||{}).design??0.6))*100)/100,
             globalThreshold:types[0].thr, faceThr:t0.faceThr, manual:t0.manual, roiFaces:rf,
             roiPainted:rp,
             hasProb:t0.hasProb, prob:t0.prob,
             types:types.map(typeState),
             lenTypes:lenTypes.map(T=>({id:T.id,name:T.name,color:T.hex,hid:!!T.hid,repHid:!!T.repHid,
               design:Math.round((T.design||0)*100)/100,
               op:(typeof T.op==='number')?T.op:1})),
             cntTypes:cntTypes.map(T=>({id:T.id,name:T.name,color:T.hex,hid:!!T.hid,repHid:!!T.repHid,
               size:Math.round((T.size||cntDefSize())*1000)/1000,
               design:Math.round(((typeof T.design==='number')?T.design:0.6)*100)/100,
               op:(typeof T.op==='number')?T.op:1})),
             counters:cntTypes.map(T=>({t:T.id,
               pts:[].concat(...xmarks.filter(m=>m.t===T.id).map(m=>m.p.map(v=>Math.round(v*1000)/1000)))})),
             // the ruler (251). Points and SEGMENTS travel, never the runs: the runs are
             // derived from them, and a stored run would be a second copy of the truth that
             // could disagree with it. `len` rides along per run for a reader that only
             // wants the number, but loadSheet recomputes it and never trusts it.
             // 253: polygons travel as their POINTS. `area` rides along as a reading,
             // and loadSheet recomputes it — the points are the truth, the same rule
             // the length pen has followed since 58.
             polygons:polys.map(P=>({id:P.id,at:P.at,
               area:Math.round(P.area*10000)/10000,
               pts:P.pts.map(q=>[Math.round(q[0]*1000)/1000,
                                 Math.round(q[1]*1000)/1000,
                                 Math.round(q[2]*1000)/1000])})),
             rulTypes:rulTypes.map(T=>({id:T.id,name:T.name,color:T.hex,hid:!!T.hid,repHid:!!T.repHid,
               op:(typeof T.op==='number')?T.op:1,
               // 25/09: the dash and the width travel, so the report opens as measured
               design:Math.round(((typeof T.design==='number')?T.design:0)*100)/100,
               w:amRulWOf(T)})),
             rulerPts:rulPts.map(q=>({id:q.id,t:q.t,
               p:[Math.round(q.x*1000)/1000,Math.round(q.y*1000)/1000,Math.round(q.z*1000)/1000]})),
             rulerSegs:rulSegs.map(g=>({t:g.t,a:g.a,b:g.b})),
             rulerRuns:[].concat(...rulTypes.map(T=>rulRuns(T.id).map(g=>({
               t:T.id,n:g.n,len:Math.round(g.len*1000)/1000,
               c:[Math.round(g.c.x*1000)/1000,Math.round(g.c.y*1000)/1000,
                  Math.round(g.c.z*1000)/1000]})))),
             lengths:lines.map(L=>({t:L.t, fit:L.fit||undefined, len:Math.round(L.len*1000)/1000,
               w:Math.round((L.w||0.008)*1000)/1000,
               pts:L.pts.map(v=>Math.round(v*1000)/1000)})),
             membranes:MEMBRANES, volLayers:H.volLayers,
             // 251: a ruler demands reader 3. Not a formality — the iPad writes sheets
             // too, and at reader 2 it would open a work with a ruler, ignore the three
             // fields it does not know, and DROP THE RULER the moment it saved. Refusing
             // out loud is the same choice membranes made when they took reader 2.
             // 329: a sheet with smoothed regions needs a reader that knows them — an older
             // one would drop them without a word and write the sheet back without them
             // 332: a sheet with tags needs a reader that knows them — an older one would
             // drop them without a word
             minReader:(SMR.length?8:SMR.some(r=>r.level>SM_SOFT)?7:((SMR.some(r=>r.pc)||[...smTs.values()].some(t=>t.ops.length))?6:(tags.length?5:(SMR.length?4:((rulPts.length||polys.length)?3:(MEMBRANES.length?2:1)))))),   // 335: a smooth line needs reader 6 · 382: a level above 10, reader 7
             tagTypes:tagTypes.map(T=>({id:T.id,name:T.name,color:T.hex,hid:!!T.hid,repHid:!!T.repHid})),
             tags:tags.map(g=>({id:g.id,t:g.t,p:g.p.slice(),nrm:g.nrm?g.nrm.slice():null,
                                title:g.title,text:g.text,img:g.img||null})),
             ...((typeof TAG_PENDING!=='undefined'&&TAG_PENDING.size)?{tagImgs:Object.fromEntries(TAG_PENDING)}:{}),   // the editor: photos waiting for the server; the iPad adds its own at export
             smooths:SMR.map(r=>Object.assign({id:r.id,at:r.at,level:r.level,faces:r.faces.slice(),
               area:Math.round(r.area*10000)/10000},
               // 335: a sub-face on the line, by its cut part — the report builds the copy from these
               r.pc?{pieces:[...r.pc].map(([f,b])=>[f].concat(b))}:{})),
             // 433: no smoothed marking apart from the brush's — the brush's marking and the layer's level (sm) are all
             saved:new Date().toISOString(),
             jobId:H.jobId, exportedBy:H.exportedBy};   // the iPad's identity fields, now on every sheet
    if(withDerived){
      // 324: every layer with the parts of the sub-faces on its line — the report counts them
      // as the screen does, and draws them as the screen does
      const per=types.map((T,ti)=>smBrushLeft(T,amMarkDerived(T,ti)));   // 433: a smoothed layer reaches the report as its regions (smooths) and its specks
      const un=new Map();
      per.forEach(d=>{ const fr=new Map(d.frac); for(const f of d.faces){ const v=fr.has(f)?fr.get(f):1; if(!(un.get(f)>=v)) un.set(f,v); } });
      const rep=[...un.keys()].sort((x,y)=>x-y); let unM=0; for(const [f,v] of un) unM+=v*area[f];
      let ar=0; for(const d of per) ar+=d.a;
      o.repairFaces=rep; o.areaM2=ar; o.unionM2=unM;
      o.typeAreas=types.map((T,ti)=>{if(T.park) return null; const a=per[ti].a, fs=per[ti].faces;
        // 7 (24/09): the layer's opacity rides to the report screen with its design
        return {id:T.id,name:T.name,color:T.hex,areaM2:Math.round(a*1000)/1000,
                op:(typeof T.op==='number')?Math.round(T.op*100)/100:0.75,
                design:Math.round(((typeof T.design==='number')?T.design:0.6)*100)/100,faces:fs,
                frac:per[ti].frac, pieces:per[ti].pieces};}).filter(Boolean);   // 357: not a parked layer
      o.lenTotals=lenTypes.map(T=>{let s=0;for(const L of lines)if(L.t===T.id)s+=L.len;
        return {id:T.id,name:T.name,color:T.hex,lenM:Math.round(s*1000)/1000};});
      o.cntTotals=cntTypes.map(T=>{let n=0;for(const m of xmarks)if(m.t===T.id)n++;
        return {id:T.id,name:T.name,color:T.hex,n:n};});
    }
    amLabOut(o);                         // 355
    return o;
  }
  function amSheetHost(){ return {cnt:CNT?b64u8(CNT):null, volLayers:VOL_LAYERS, jobId:AM.jobId, exportedBy:'A-morphometry iPad'}; }   // 349: the product's own fields for the shared getSheet
  $('mExport').onclick=async()=>{
    const sheet=getSheet(true);
    // 332: the photos go out INSIDE the sheet — the computer has no other way to receive them
    const imgs={};
    for(const g of tags) if(g.img&&!imgs[g.img]){ const v=await tagSrc(g); if(v) imgs[g.img]=v; }
    if(Object.keys(imgs).length) sheet.tagImgs=imgs;
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
  // 421 (Eli, 03/10): "ניווט" changes the hand only — the side bar goes on showing what was open
  function setMode(m){
    // the wall's shaping ends when another tool is taken — also after a turn of the model (421)
    if((mode==='wallshape'||(mode==='nav'&&amKeepMode==='wallshape'))&&m!=='wallshape'&&m!=='nav'&&typeof wallTeardown==='function') wallTeardown();
    if(mode!=='nav'&&m==='nav') amKeepMode=mode; else if(m!=='nav') amKeepMode=m;
    mode=m;
    document.getElementById('mNav').classList.toggle('on',m==='nav');
    document.getElementById('mAdd').classList.toggle('on',m==='add');
    document.getElementById('mRem').classList.toggle('on',m==='rem');
    // 256: an UNCLOSED ring survives leaving the tool. I had it discarded here, reasoning
    // that a half-drawn ring should not outlive the mode — and that reasoning ignored how
    // the ring is drawn: Eli, 18/09, "if I did not finish closing a polygon and I pressed
    // navigate, all the points I marked reset; it matters that I can turn the model in
    // order to choose the points well." Turning the model is PART of placing them. Escape
    // is the way out, and it is the only one.
    {const b=document.getElementById('mRegion'); if(b) b.classList.toggle('on',m==='region');}   // the editor's rectangle tool
    document.getElementById('mGrow').classList.toggle('on',m==='grow');
    amSideWhat();
    // leaving the tool takes its drawing with it: outside this mode the model is never
    // read through a net of outlines (the reality meeting, 29/08)
    invalidate();
    el.style.cursor=m==='nav'?'grab':'crosshair';}
  $('mNav').onclick=()=>setMode('nav');
  $('mAdd').onclick=()=>setMode('add');
  $('mRem').onclick=()=>setMode('rem');

  $('mGrow').onclick=()=>setMode('grow');
  function amSetAreaTool(k){
    areaTool=(k===AM_POLY)?k:AM_BRUSH;   // 433: the smoothed tool is the brush, at the layer's level
    const T=types[activeT]; if(T&&T.am!==areaTool){T.am=areaTool; markUnexported(true);}
    if(mode!=='add'&&mode!=='rem') setMode('add'); else amSideWhat();
    applyBrush(); invalidate();
  }
  $('aBrush').onclick=()=>amSetAreaTool(AM_BRUSH);
  $('aPoly').onclick=()=>amSetAreaTool(AM_POLY);
  // The keys stay — a keyboard may be attached, and the same page opens on a computer —
  // but the NOTE about them is gone (user decision 13/08): an iPad normally has no
  // keyboard, so a strip telling the user about Ctrl+Z described something that is not
  // there. On this shell the buttons are the whole story. Gestures for undo/redo were
  // proposed and dropped in the same breath — two fingers are already the pinch.
  // 527 (13/10: no way out of an open polygon on the iPad): ↶ takes back an open shape's last point first, as Ctrl+Z does
  // (256) — the polygon's last point gone, the polygon is gone; then the history
  $('undo').onclick=()=>{
    if(activeKind==='rul'&&rulLast!==null&&rulUndoPoint()) return;
    if(activeKind==='area'&&curPoly&&polyUndoPoint()) return;
    undo(); };
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
    // 256: while a shape is open, Ctrl+Z takes back the last POINT and nothing else
    if(z&&!ev.shiftKey){
      if(activeKind==='rul'&&rulLast!==null&&rulUndoPoint()){ev.preventDefault();return;}
      if(activeKind==='area'&&curPoly&&polyUndoPoint()){ev.preventDefault();return;}
    }
    if(z&&!ev.shiftKey){ev.preventDefault();undo();}
    else if(y||(z&&ev.shiftKey)){ev.preventDefault();redo();}
  });
  $('auto').onclick=autoComplete;
  /* WHAT THE SLIDER MEANS NOW, in words (301). It has changed meaning with the layer
     since 256 and never said which. */
  const AM_BRUSH_WHAT={area:'רדיוס המברשת', len:'רוחב הקו', cnt:'קוטר הסמן',
                       rul:'רוחב הקו', vol:'רדיוס המברשת'};
  const AM_TOOL_NAME={area:'סימון שטח', len:'סרט מדידה', cnt:'מונה', rul:'סרגל', vol:'נפח אזור', tag:'תגית'};
  // The tolerance belongs to growing alone (Eli, 24/09) — hidden, not dimmed, in every
  // other mode; while growing the side bar's title says so.
  function amSideWhat(){
    const sm=(mode==='nav')?amKeepMode:mode;        // 421: what the bar is about, under navigation too
    const growing=(sm==='grow'&&activeKind==='area');
    const walling=(sm==='wallshape'&&!!wallEdit);
    const poly=(activeKind==='area'&&areaTool===AM_POLY&&!growing&&!walling);
    const smooth=(activeKind==='area'&&areaTool===AM_BRUSH&&!growing&&!walling);   // 329 · 433: the brush carries the level wheel
    const w=document.getElementById('brushWhat'); if(w) w.textContent=AM_BRUSH_WHAT[activeKind]||'גודל המברשת';
    const t=document.getElementById('sideTool');
    if(t) t.textContent=activeKind==='none'?'אין שכבה פתוחה':walling?'עיצוב הקיר':growing?'נביטה':poly?'שטח פוליגון':(AM_TOOL_NAME[activeKind]||'סימון');
    const smw=document.getElementById('smWrap'); if(smw) smw.style.display=(smooth||(activeKind==='vol'&&!walling))?'':'none';   // 430
    const ws=document.getElementById('wallSide'); if(ws) ws.style.display=walling?'':'none';
    // 421: under navigation the wall's shaping is taken up again by "סימון"
    for(const id of ['mAdd','mRem']){const b=document.getElementById(id); if(b) b.style.display=(walling&&!(id==='mAdd'&&mode==='nav'))?'none':'';}
    const g=document.getElementById('growWrap'); if(g) g.style.display=growing?'':'none';
    // 10: the tool pair belongs to an area layer; a polygon has no brush size
    const aw=document.getElementById('areaToolWrap'); if(aw) aw.style.display=(activeKind==='area'&&!walling)?'':'none';
    const bw=document.getElementById('brushWrap'); if(bw) bw.style.display=(poly||activeKind==='tag')?'none':'';
    // 6: the shape belongs to the brushes that paint FACES — an area layer's brush and the
    // volume brush; a tape, a counter and a ruler do not paint faces
    const sw=document.getElementById('shapeWrap');
    if(sw) sw.style.display=(!walling&&((activeKind==='area'&&!poly&&!growing)||activeKind==='vol'))?'':'none';
    const ab=document.getElementById('aBrush'), apl=document.getElementById('aPoly'), asm=document.getElementById('aSmooth');
    if(ab) ab.classList.toggle('on',areaTool===AM_BRUSH); if(apl) apl.classList.toggle('on',areaTool===AM_POLY);
    if(asm) asm.classList.toggle('on',areaTool===AM_SMOOTH);
  }
  function applyBrush(){const v=+document.getElementById('brush').value;
    // 432 (Eli, 02/10): the slider runs 1–100 cm for every brush; a tape's width keeps its own
    // 2–30 mm, read off the slider's ends (as the way back below has always done)
    // 522 (Eli, 13/10: "סרט המדידה צר מאוד (על המודל הזה שהוא גדול מאוד)"): 2 mm to 50 cm, on a logarithmic slider —
    // as fine at the narrow end as it was, wide enough at the far end for a facade; the tape's own width on the model
    if(activeKind==='len'){const br=document.getElementById('brush');
      lineW=0.002*Math.pow(250,(v-(+br.min))/((+br.max)-(+br.min)));
      document.getElementById('brushV').textContent=lineW<0.01?(lineW*1000).toFixed(lineW<0.003?1:0)+' מ"מ':(lineW*100).toFixed(lineW<0.1?1:0)+' ס"מ';}
    else if(activeKind==='cnt'){
      // on a counter layer the slider is the diamond DIAMETER, in true metres on the
      // model (user 12/08): slider 2..40 -> 2..40cm; existing diamonds resize live
      const T=cntTypes[activeC];
      document.getElementById('brushV').textContent=v.toFixed(0)+' ס"מ';
      if(T&&Math.abs(T.size-v/100)>1e-9){T.size=v/100;resizeCnt(T);markUnexported(true);invalidate();}}
  // 25/09: on a ruler layer the slider is the LINE'S WIDTH, in screen pixels (Eli's choice
  // ב) — the layer's own, like a counter's diameter, and it redraws live
    else if(activeKind==='rul'){const T=rulTypes[activeR], br=document.getElementById('brush');
      const w=amRulWFromSlider(v,+br.min,+br.max);
      document.getElementById('brushV').textContent=w+(w===1?' פיקסל':' פיקסלים');
      if(T&&amRulWOf(T)!==w){T.w=w;rulRebuild();markUnexported(true);}}
    else {brushR=v/100;document.getElementById('brushV').textContent=(brushR*100).toFixed(0)+' ס"מ';}}
  $('brush').oninput=applyBrush;
  $('grtol').oninput=e=>{growTol=+e.target.value;$('grtolV').textContent=e.target.value;};
  $('thr').oninput=e=>{const v=e.target.value/1000;$('thrV').textContent=v.toFixed(3);
    types[activeT].thr=v;recolorAll();};

  /* ---- palette chips (mirror of the desktop): a chip per type, tools follow it --- */
  // The design wheel, wired exactly as on the desktop — same control, same meaning, and
  // synced through the ONE path every activation crosses. Wiring it around the activate*
  // functions is what failed silently there (decision 87), and the same trap exists here.
  function amSyncDesign(){
    const ds=document.getElementById('design'), dv=document.getElementById('designV');
    if(!ds) return;
    let v=null;
    if(activeKind==='cnt'){const T=cntTypes[activeC]; v=T?(T.design??0.6):null;}
    else if(activeKind==='len'){const T=lenTypes[activeL]; v=T?(T.design||0):null;}
    else if(activeKind==='area'){const T=types[activeT]; v=T?(T.design??0.6):null;}
    else if(activeKind==='rul'){const T=rulTypes[activeR]; v=T?(T.design||0):null;}
    else if(activeKind==='vol'){const L=volLayer(); v=L?volDesOf(L):null;}   // 448: a volume layer has a design again
    ds.disabled=(v===null);                     // a tape layer has no design yet
    if(v!==null){ds.value=Math.round(v*100);dv.textContent=Math.round(v*100)+'%';}
  }
  if($('clear')) $('clear').oninput=e=>{
    $('clearV').textContent=e.target.value+'%';
    amApplyClear(e.target.value);};
  if($('design')) $('design').oninput=e=>{
    const v=e.target.value/100;
    $('designV').textContent=e.target.value+'%';
    if(activeKind==='cnt'){const T=cntTypes[activeC];if(T){T.design=v;T.designU.value=v;}}
    else if(activeKind==='len'){const T=lenTypes[activeL];if(T){T.design=v;if(!T.designU)T.designU={value:v};T.designU.value=v;}}
    // 257: the polygon reads the same wheel through a uniform, so the layer's own
    // designU has to move with it — a brush layer repaints, a polygon layer does not
    else if(activeKind==='area'){const T=types[activeT];if(T){T.design=v;
      if(!T.designU)T.designU={value:v}; T.designU.value=v; amDessSoon(); if(SMR.length) smRecolor();}}   // 448: its smoothed copies too
    // 25/09: a ruler's design is its dash — the 302 definition
    else if(activeKind==='rul'){const T=rulTypes[activeR];if(T){T.design=v;rulRebuild();markUnexported(true);}}
    // this viewer renders on a continuous tick, so nothing has to be poked to redraw
  };
  // 7 (24/09): the layer's opacity, through the same one path every activation crosses
  function amActiveLayer(){
    if(activeKind==='cnt') return cntTypes[activeC];
    if(activeKind==='len') return lenTypes[activeL];
    if(activeKind==='rul') return rulTypes[activeR];
    if(activeKind==='area') return types[activeT];
    return null;
  }
  function amSyncOp(){
    const r=document.getElementById('repop'), rv=document.getElementById('repopV'); if(!r) return;
    const T=amActiveLayer();
    r.disabled=!T;
    if(T){const o=(typeof T.op==='number')?T.op:(activeKind==='area'?0.75:1);
          r.value=Math.round(o*100); rv.textContent=Math.round(o*100)+'%';}
  }
  if($('repop')) $('repop').oninput=e=>{
    const v=e.target.value/100, T=amActiveLayer();
    $('repopV').textContent=e.target.value+'%';
    if(!T) return;
    T.op=v;
    if(activeKind==='area') amAreaOpSoon(types.indexOf(T));   // 545: the opacity alone, once a frame
    else if(activeKind==='len') applyLenOp(T);
    else if(activeKind==='cnt'){for(const m of xmarks) if(m.t===T.id&&m.obj){
      m.obj.material.transparent=v<1; m.obj.material.opacity=v; m.obj.material.needsUpdate=true;}}
    else if(activeKind==='rul') rulRebuild();
    markUnexported(true);
  };
  function syncKindUI(){
    // The design wheel follows the active layer. It used to be wired by wrapping
    // activateT/C/L through `window[...]` (14/08) — but this whole script runs inside an
    // IIFE, so those names were never on `window` and the wrapper silently did nothing.
    // The wheel then kept showing the PREVIOUS layer's value: opening a tape layer, whose
    // design is 0, displayed 60% — and the first nudge applied the lie (user 15/08).
    // Every activate* call passes through here, so this is the one place that cannot be
    // bypassed. A control that misreports state is worse than one that is missing.
    amSyncDesign();
    amSyncOp();   // 306: the opacity slider follows the active layer from here too — every activate* crosses this
    const other=activeKind!=='area';
    {const ro=document.getElementById('repop'); if(ro) ro.disabled=(activeKind==='tag');}
    document.getElementById('auto').disabled=other;
    document.getElementById('thr').disabled=other;
    // grow floods FACES by similarity — meaningless for lines and counters (user, 12/08)
    document.getElementById('mGrow').disabled=other;
    document.getElementById('grtol').disabled=other;
    if(typeof amVolGo==='function') amVolGo();   // volume layers: the editor only
    amSideWhat();
    // 25/09: ONE slider, and each kind's own value in it. A ruler's width and a counter's
    // diameter are the layer's; the area and volume brush's radius and the tape's width are
    // the hand's. Without this the slider kept the last kind's position, and the next kind
    // read it as its own — a ruler at 10 pixels came back to the area brush as 60 cm.
    {const br=document.getElementById('brush');
     if(activeKind==='area'||activeKind==='vol') br.value=Math.round(brushR*100);
     else if(activeKind==='len') br.value=Math.round(+br.min+Math.log(Math.max(0.002,Math.min(0.5,lineW))/0.002)/Math.log(250)*(+br.max-(+br.min)));}   // 522
    applyBrush();}
  function activateC(i){activeKind='cnt';activeC=i;
    const T=cntTypes[i];
    if(T)document.getElementById('brush').value=Math.round((T.size||cntDefSize())*100);
    syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}
  function activateT(i){activeKind='area';activeT=i;const T=types[i];
    areaTool=(T&&(T.am===AM_POLY))?T.am:AM_BRUSH;   // 10: the tool last used on this layer
    document.getElementById('thr').value=Math.round(T.thr*1000);document.getElementById('thrV').textContent=T.thr.toFixed(3);
    syncKindUI();buildChips();}
  function activateR(i){activeKind='rul';activeR=i;rulEnd();
    const T=rulTypes[i];                                    // 25/09: the layer's width
    if(T){const br=document.getElementById('brush'); br.value=amRulWToSlider(amRulWOf(T),+br.min,+br.max);}
    syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}
  function activateL(i){activeKind='len';activeL=i;syncKindUI();buildChips();
    if(mode!=='add'&&mode!=='rem')setMode('add');}
  // 9 (24/09): one eye on every layer, as in the measurement screen — display only; a
  // hidden layer is still measured and saved, drops out of the alternating triangles,
  // and marking on it does not show it again (Eli's ruling).
  function amEye(shown,toggle){
    const e=document.createElement('i'); e.className='eye'+(shown?'':' off'); e.textContent='👁';
    e.title=shown?'השכבה מוצגת · '+AM_TAP_WORD+' מסתירה אותה (תצוגה בלבד — המדידה נשארת)'
                 :'השכבה מוסתרת · '+AM_TAP_WORD+' מציגה אותה';
    e.onclick=ev=>{ev.stopPropagation();toggle();};
    return e;
  }
  /* 355 (Eli, 29/09): a label switch on each layer — "N : value" on every measurement of it,
     or the number alone, which is the default. Here it reaches what has a number in this
     screen: a ring, a smoothed region, a ruler run (a painted patch, a tape and a volume are
     numbered only in the report, which honours the same switch). A new field, `lab`; an
     older reader drops it and loses nothing but the look. */
  function amLabBtn(T,redraw){
    const e=document.createElement('i'); e.className='lab'+(T.lab?'':' off'); e.textContent='1:';
    e.title=T.lab?'תוויות מוצגות — מספר וערך · לחיצה משאירה את המספר בלבד'
                 :'מוצג המספר בלבד · לחיצה מציגה תוויות — מספר וערך (חל גם על הדוח)';
    e.onclick=ev=>{ev.stopPropagation(); T.lab=!T.lab; redraw(); buildChips(); markUnexported(true);};
    return e;
  }
  const amLab=(list,id)=>{const T=list.find(x=>x.id===id);return !!(T&&T.lab);};
  function amLabOut(o){
    const put=(arr,list)=>{ if(Array.isArray(arr)) arr.forEach((x,i)=>{
      const T=(x&&x.id!==undefined)?list.find(t=>t.id===x.id):list[i]; if(T&&T.lab) x.lab=true; }); };
    put(o.types,types); put(o.typeAreas,types); put(o.rulTypes,rulTypes); put(o.lenTypes,lenTypes);
  }
  function amLabIn(j){
    const get=(arr,list)=>{ if(Array.isArray(arr)) arr.forEach((x,i)=>{
      const T=(x&&x.id!==undefined)?list.find(t=>t.id===x.id):list[i]; if(T) T.lab=(x.lab===true); }); };
    get(j.types,types); get(j.rulTypes,rulTypes); get(j.lenTypes,lenTypes);
  }

  const amHidOf=(list,id)=>{const T=list.find(x=>x.id===id);return !!(T&&T.hid);};
  function amShowLines(){for(const L of lines) if(L.obj) L.obj.visible=!amHidOf(lenTypes,L.t); invalidate();}
  function amShowCnts(){for(const m of xmarks) if(m.obj) m.obj.visible=!amHidOf(cntTypes,m.t); invalidate();}
  // 2 (24/09): deleting a layer, as in the measurement screen — a ✕ on every chip, a
  // question when marks go with it, and Ctrl+Z brings it back whole IN ITS PLACE (an area
  // stroke in the history names its layer by position). The last area layer leaves an
  // empty one behind.
  const AM_KIND_LIST={area:()=>types,len:()=>lenTypes,cnt:()=>cntTypes,rul:()=>rulTypes,tag:()=>tagTypes};
  function amLayerHeld(kind,T){
    if(kind==='area'){const np=polys.filter(P=>P.at===T.id).length, ns=SMR.filter(r=>r.at===T.id).length;
      return {n:((T.area||0)>0?1:0)+np+ns,
              say:(T.area||0).toFixed(2)+' מ״ר'+(np?(' · '+np+' פוליגונים'):'')+(ns?(' · '+ns+' אזורים מוחלקים'):'')};}
    if(kind==='len'){const n=lines.filter(L=>L.t===T.id).length; return {n:n,say:n+' קווים'};}
    if(kind==='cnt'){const n=xmarks.filter(m=>m.t===T.id).length; return {n:n,say:n+' סמנים'};}
    if(kind==='rul'){const n=rulPts.filter(q=>q.t===T.id).length; return {n:n,say:n+' נקודות'};}
    if(kind==='tag'){const n=tags.filter(g=>g.t===T.id).length; return {n:n,say:n+' תגיות'};}
    const n=MEMBRANES.filter(M=>M.kind==='volume'&&M.layer===T.id).length; return {n:n,say:n+' נפחים'};
  }
  function amLayerOut(snap){               // take the layer and everything on it off the screen
    const list=AM_KIND_LIST[snap.kind](), T=snap.T;
    if(snap.kind==='area'){
      if(curPoly&&curPoly.at===T.id) curPoly=null;
      snap.polys=polys.filter(P=>P.at===T.id);
      for(const P of snap.polys) polys.splice(polys.indexOf(P),1);
      snap.smr=SMR.filter(r=>r.at===T.id);                       // 329
      for(const r of snap.smr) SMR.splice(SMR.indexOf(r),1);
      if(smSel&&smSel.at===T.id) smSel=null;
    } else if(snap.kind==='len'){snap.lines=lines.filter(L=>L.t===T.id); for(const L of snap.lines) delLine(L);}
    else if(snap.kind==='cnt'){snap.xs=xmarks.filter(m=>m.t===T.id); for(const m of snap.xs) delX(m);}
    else if(snap.kind==='rul'){
      if(rulLast!==null&&(rulPtById(rulLast)||{}).t===T.id) rulLast=null;
      snap.pts=rulPts.filter(q=>q.t===T.id); snap.segs=rulSegs.filter(g=>g.t===T.id);
      for(const q of snap.pts) rulPts.splice(rulPts.indexOf(q),1);
      for(const g of snap.segs) rulSegs.splice(rulSegs.indexOf(g),1);
    } else if(snap.kind==='tag'){snap.gs=tags.filter(g=>g.t===T.id);
      for(const g of snap.gs) tags.splice(tags.indexOf(g),1);
    } else {snap.mems=MEMBRANES.filter(M=>M.kind==='volume'&&M.layer===T.id);
      for(const M of snap.mems) MEMBRANES.splice(MEMBRANES.indexOf(M),1);}
    list.splice(snap.i,1);
    if(snap.kind==='area'&&!types.length){          // never without an area layer — a parked one (357)
      if(!snap.fill) snap.fill=mkType('','#38b000'); else types.push(snap.fill);
      snap.fill.park=true;
    }
    amLayerAfter(snap.kind);
  }
  function amLayerIn(snap){                // and back, whole, in its own place
    const list=AM_KIND_LIST[snap.kind]();
    if(snap.fill){const k=types.indexOf(snap.fill); if(k>=0) types.splice(k,1);}
    list.splice(snap.i,0,snap.T);
    if(snap.kind==='area'){ for(const P of (snap.polys||[])) polys.push(P); for(const r of (snap.smr||[])) SMR.push(r); }
    else if(snap.kind==='len') for(const L of (snap.lines||[])) addLine(L);
    else if(snap.kind==='cnt') for(const m of (snap.xs||[])) addX(m);
    else if(snap.kind==='rul'){for(const q of (snap.pts||[])) rulPts.push(q);
                               for(const g of (snap.segs||[])) rulSegs.push(g);}
    else if(snap.kind==='tag') for(const g of (snap.gs||[])) tags.push(g);
    else for(const M of (snap.mems||[])) MEMBRANES.push(M);
    amLayerAfter(snap.kind);
  }
  function amLayerAfter(kind){
    const clamp=(i,list)=>Math.max(-1,Math.min(i,list.length-1));
    activeT=Math.max(0,clamp(activeT,types)); activeL=clamp(activeL,lenTypes);
    activeC=clamp(activeC,cntTypes); activeR=clamp(activeR,rulTypes); if(typeof volLayers!=='undefined') activeV=clamp(activeV,volLayers);
    activeG=clamp(activeG,tagTypes);
    if((activeKind==='len'&&activeL<0)||(activeKind==='cnt'&&activeC<0)
       ||(activeKind==='rul'&&activeR<0)||(activeKind==='vol'&&activeV<0)
       ||(activeKind==='tag'&&activeG<0)) activeKind=amKindLeft();
    if(activeKind==='area'&&(!types[activeT]||types[activeT].park)){           // 357: never onto a parked layer
      const k=types.findIndex(T=>!T.park); if(k>=0) activeT=k; else activeKind='none';}
    recolorAll(); polyRebuild(); rulRebuild(); tagRebuild();
    if(typeof volRimBuild==='function'){ volRimBuild(); volChips(); volLayerChips(); }   // volume layers: the editor only
     syncKindUI(); buildChips(); updateArea(); markUnexported(true); invalidate();
  }
  async function amLayerDelete(kind,i){
    const list=AM_KIND_LIST[kind](), T=list[i]; if(!T) return;
    const held=amLayerHeld(kind,T);
    if(held.n&&!(await amAsk('למחוק את השכבה "'+(T.name||'ללא שם')+'"?\n\nיימחקו איתה: '+held.say
                        +'.\nאפשר להחזיר אותה '+AM_UNDO_WORD+'.',
                        [{t:'למחוק את השכבה',v:true,primary:true},{t:'ביטול',v:false}],false))) return;
    const snap={kind:kind,i:i,T:T};
    amLayerOut(snap);
    undoStack.push([['D',snap]]); redoStack.length=0; updateHB();
  }
  function amDelX(kind,i){
    const e=document.createElement('i'); e.className='del'; e.textContent='✕';
    e.title='מחיקת השכבה · אפשר להחזיר '+AM_UNDO_WORD;
    e.onclick=ev=>{ev.stopPropagation();amLayerDelete(kind,i);};
    return e;
  }
  // 349: the layer bar — one chip per layer of every kind (area, counter, tape, ruler, tag), with the
  // name field, the running total, the eye and the ✕. Shared by the editor and the iPad: the dirty
  // flag is markUnexported(true) (the editor's one-line shim), the strips are looked up by id and
  // a missing strip is skipped.
  function buildChips(){
    const A=document.getElementById('chipsA');if(!A)return;A.innerHTML='';
    types.forEach((T,i)=>{
      if(T.park) return;                    // 357: held for the first new layer, not shown
      const c=document.createElement('span');c.className='chip'+(activeKind==='area'&&i===activeT?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);amPalSw(sw,'area',T);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הסוג';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='tA_'+T.id;b.textContent=(T.area||0).toFixed(2);c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='מ״ר';c.appendChild(u);
      // 10: no measurement-mode menu on the layer — a layer holds both, and the side bar
      // picks the tool (the menu and its lock were 256's "the two cannot be mixed")
      if(T.hid) c.style.opacity='0.45';
      c.appendChild(amEye(!T.hid,()=>{T.hid=!T.hid;amAreaVis(i);buildChips();markUnexported(true);}));   // 547: the layer alone
      c.appendChild(amDelX('area',i));
      c.onclick=()=>{activateT(i);if(mode==='nav')setMode('add');};
      A.appendChild(c);});
    const C=document.getElementById('chipsC');if(C){C.innerHTML='';
    cntTypes.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(activeKind==='cnt'&&i===activeC?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);amPalSw(sw,'cnt',T);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם המונה';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='cA_'+T.id;b.textContent='0';c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='יח׳';c.appendChild(u);
      if(T.hid) c.style.opacity='0.45';
      c.appendChild(amEye(!T.hid,()=>{T.hid=!T.hid;amShowCnts();buildChips();markUnexported(true);}));
      c.appendChild(amDelX('cnt',i));
      c.onclick=()=>activateC(i);
      C.appendChild(c);});}
    const L=document.getElementById('chipsL');if(!L)return;L.innerHTML='';
    lenTypes.forEach((T,i)=>{
      const c=document.createElement('span');c.className='chip'+(activeKind==='len'&&i===activeL?' on':'');c.style.setProperty('--c',T.hex);
      const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);amPalSw(sw,'len',T);
      const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הקו';
      inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
      c.appendChild(inp);
      const b=document.createElement('b');b.id='lA_'+T.id;b.textContent='0.00';c.appendChild(b);
      const u=document.createElement('span');u.className='u';u.textContent='מ״א';c.appendChild(u);
      if(T.hid) c.style.opacity='0.45';
      c.appendChild(amEye(!T.hid,()=>{T.hid=!T.hid;amShowLines();buildChips();markUnexported(true);}));
      c.appendChild(amDelX('len',i));
      c.onclick=()=>activateL(i);
      L.appendChild(c);});
    const R=document.getElementById('chipsR');
    if(R){
      R.innerHTML='';
      rulTypes.forEach((T,i)=>{
        const c=document.createElement('span');
        c.className='chip'+(activeKind==='rul'&&i===activeR?' on':'');
        c.style.setProperty('--c',T.hex);
        const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);amPalSw(sw,'rul',T);
        const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם הסרגל';
        inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
        c.appendChild(inp);
        // the layer's total: every run of it, summed — the same number the report prints
        const b=document.createElement('b');b.id='rA_'+T.id;
        let tot=0; for(const g of rulRuns(T.id)) tot+=g.len;
        b.textContent=tot.toFixed(2); c.appendChild(b);
        const u=document.createElement('span');u.className='u';u.textContent='מ׳';c.appendChild(u);
        if(T.hid) c.style.opacity='0.45';
        c.appendChild(amEye(!T.hid,()=>{T.hid=!T.hid;rulRebuild();buildChips();markUnexported(true);}));
        c.appendChild(amDelX('rul',i));
        c.onclick=()=>activateR(i);
        R.appendChild(c);});
    }
    const G=document.getElementById('chipsG');
    if(G){
      G.innerHTML='';
      tagTypes.forEach((T,i)=>{
        const c=document.createElement('span');
        c.className='chip'+(activeKind==='tag'&&i===activeG?' on':'');
        c.style.setProperty('--c',T.hex);
        const sw=document.createElement('i');sw.className='sw';c.appendChild(sw);amPalSw(sw,'tag',T);
        const inp=document.createElement('input');inp.value=T.name;inp.placeholder='שם השכבה';
        inp.onchange=()=>{T.name=inp.value;markUnexported(true);};inp.onclick=e=>e.stopPropagation();
        c.appendChild(inp);
        const b=document.createElement('b');b.textContent=String(tags.filter(g=>g.t===T.id).length);c.appendChild(b);
        const u=document.createElement('span');u.className='u';u.textContent='תגיות';c.appendChild(u);
        if(T.hid) c.style.opacity='0.45';
        c.appendChild(amEye(!T.hid,()=>{T.hid=!T.hid;tagRebuild();buildChips();markUnexported(true);}));
        c.appendChild(amDelX('tag',i));
        c.onclick=()=>activateG(i);
        G.appendChild(c);});
    }
    // 430 (Eli, 02/10): the volume layers' row too, so one chip is lit in the whole bar
    // (the measurement screen's; the iPad has no volume layers, and the catch swallows the missing names)
    try{ volLayerChips(); volSmWheel(); }catch(_){}
    updateArea();}
/*AM_PAL400_START*/
// 400 (Eli, 01/10): one colour board wherever a colour is chosen. The six palettes Eli sent,
// as a matrix: a row each (red, yellow, green, blue, violet, summer), dark on the right and
// light on the left, every row the same width; a shade that nearly repeats one in a row above
// (CIEDE2000 under 3) is kept only there, and two more came out by Eli's hand, and the summer row keeps its own yellow by his hand too. No names, no
// codes, square corners. Under it a sample from the model, and the round wheel that opens the
// browser's free picker — its well lies over the wheel itself, since a picker opens only from
// the hand's own press (375). No colour is reserved: "זה לא נראה אותו דבר ולא מבלבל".
// The same text in the three screens that choose colours; each gives it only `sample`.
const amPal=(function(){
  const ROWS=[['641220','6E1423','85182A','A11D33','A71E34','B21E35','BD1F36','C71F37','DA1E37','E01E37'],
    ['FF7B00','FF8800','FF9500','FFAA00','FFB700','FFC300','FFD000','FFDD00','FFEA00'],
    ['004B23','006400','007200','008000','38B000','70E000','9EF01A','CCFF33'],
    ['0D47A1','1565C0','1976D2','2196F3','42A5F5','64B5F6','90CAF9','BBDEFB','E3F2FD'],
    ['240046','3C096C','5A189A','7B2CBF','9D4EDD'],
    ['6A4C93','1982C4','FF6D00','FF595E','8AC926','FFCA3A']];
  const HEAD={add:'צבע לשכבה החדשה',recolor:'צבע השכבה',patch:'צבע הטלאי'};
  const SAY={add:'לחיצה פותחת את השכבה בצבע הזה',recolor:'לחיצה צובעת את השכבה בצבע הזה',patch:'לחיצה צובעת את הטלאי בצבע הזה'};
  const EYE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 6l4.5 4.5-8.8 8.8H4.7v-4.5z"/><path d="M17.5 3.2a1.8 1.8 0 0 1 2.5 0l.8.8a1.8 1.8 0 0 1 0 2.5l-1.3 1.3-3.3-3.3z" fill="currentColor"/></svg>';
  let box=null, opts=null, samp=null, hint=null;
  const hx=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  function css(){
    if(document.getElementById('amPalCss')) return;
    const s=document.createElement('style'); s.id='amPalCss';
    s.textContent='.amPal{position:fixed;z-index:9000;direction:rtl;background:#141210;border:1px solid #6b5a33;padding:10px 12px;color:#d8cdb8;font:13px system-ui,"Segoe UI",Arial,sans-serif;width:300px;box-sizing:border-box;box-shadow:0 6px 24px #000a}'
      +'.amPal .h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}'
      +'.amPal .x{cursor:pointer;color:#8a8272;padding:0 4px}'
      +'.amPal .r{display:flex;gap:2px;height:22px;margin-bottom:2px}'
      +'.amPal .r i{flex:1 1 0;cursor:pointer}'
      +'.amPal .r i:hover{outline:2px solid #d8cdb8;outline-offset:-2px}'
      +'.amPal .f{border-top:1px solid #3a3228;margin-top:8px;padding-top:9px;display:flex;align-items:center;justify-content:space-between}'
      +'.amPal .w{position:relative;display:flex;align-items:center;gap:8px;cursor:pointer}'
      +'.amPal .w b{width:26px;height:26px;border-radius:50%;background:conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444);border:2px solid #d8cdb8;box-sizing:border-box}'
      +'.amPal .w input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0;margin:0}'
      +'.amPal .s{display:flex;align-items:center;gap:6px;border:1px solid #6b5a33;border-radius:0;padding:4px 9px;background:#232019;cursor:pointer;color:#d8cdb8;font:inherit}'
      +'.amPal .n{margin-top:8px;min-height:18px;font-weight:700}'
      +'.amPalHint{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9001;direction:rtl;background:#141210;border:1px solid #b8934a;color:#d8cdb8;padding:7px 14px;font:13px system-ui,"Segoe UI",Arial,sans-serif}';
    document.head.appendChild(s);
  }
  function outside(e){ if(box&&!box.contains(e.target)) close(); }
  function esc(e){ if(e.key==='Escape'&&(box||samp)){ e.stopPropagation(); e.preventDefault(); close(); endSample(); } }
  function close(){
    if(box){ box.remove(); box=null; }
    document.removeEventListener('pointerdown',outside,true);
    if(!samp) document.removeEventListener('keydown',esc,true);
  }
  function pick(hex){ const o=opts; close(); if(o&&o.onPick) o.onPick(String(hex).toLowerCase()); }
  function place(a){
    const r=a?a.getBoundingClientRect():{left:innerWidth/2,right:innerWidth/2,top:80,bottom:80};
    const W=box.offsetWidth, H=box.offsetHeight;
    let x=r.right-W, y=r.bottom+4;
    if(y+H>innerHeight-6) y=Math.max(6,r.top-H-4);
    x=Math.max(6,Math.min(x,innerWidth-W-6));
    box.style.left=x+'px'; box.style.top=y+'px';
  }
  function open(anchor,o){
    close(); endSample(); css(); opts=o||{};
    const v=HEAD[opts.verb]?opts.verb:'add';
    box=document.createElement('div'); box.className='amPal';
    const h=document.createElement('div'); h.className='h'; h.textContent=HEAD[v];
    const x=document.createElement('span'); x.className='x'; x.textContent='✕'; x.title='סגירה'; x.onclick=close;
    h.appendChild(x); box.appendChild(h);
    const n=document.createElement('div'); n.className='n';
    for(const row of ROWS){
      const r=document.createElement('div'); r.className='r';
      for(const c of row){
        const i=document.createElement('i'); i.style.background='#'+c; i.dataset.c='#'+c.toLowerCase();
        i.onmouseenter=()=>{ n.textContent=SAY[v]; n.style.color='#'+c; };
        i.onclick=()=>pick('#'+c);
        r.appendChild(i);
      }
      box.appendChild(r);
    }
    const f=document.createElement('div'); f.className='f';
    const w=document.createElement('label'); w.className='w'; w.title='בוחר צבעים חופשי';
    w.appendChild(document.createElement('b')); w.appendChild(document.createTextNode('צבע חופשי'));
    const inp=document.createElement('input'); inp.type='color';
    inp.value=/^#[0-9a-f]{6}$/i.test(opts.current||'')?opts.current:'#0d47a1';
    inp.onchange=()=>pick(inp.value);
    w.appendChild(inp); f.appendChild(w);
    if(opts.sample){
      const s=document.createElement('button'); s.type='button'; s.className='s';
      s.innerHTML=EYE+'דגימה מהמודל'; s.title='לחיצה על נקודה במודל לוקחת את הגוון שלה';
      s.onclick=startSample; f.appendChild(s);
    }
    box.appendChild(f); box.appendChild(n);
    document.body.appendChild(box); place(anchor);
    setTimeout(()=>{ if(box) document.addEventListener('pointerdown',outside,true); },0);
    document.addEventListener('keydown',esc,true);
  }
  function startSample(){
    const o=opts; close(); samp=o;
    hint=document.createElement('div'); hint.className='amPalHint';
    hint.textContent='לחיצה על נקודה במודל לוקחת את הגוון שלה · Esc לביטול';
    document.body.appendChild(hint);
    o.sample.el.style.cursor='crosshair';
    o.sample.el.addEventListener('pointerdown',grab,true);
    document.addEventListener('keydown',esc,true);
  }
  function grab(e){
    if(!samp) return;
    if(e.pointerType==='touch'&&samp.sample.penOnly) return;      // a finger still turns the view
    e.stopImmediatePropagation(); e.preventDefault();
    const hex=samp.sample.at(e);
    if(!hex){ if(hint) hint.textContent='הלחיצה לא נחתה על המודל. אפשר ללחוץ שוב, או Esc לביטול.'; return; }
    const o=samp; endSample(); if(o.onPick) o.onPick(hex.toLowerCase());
  }
  function endSample(){
    if(!samp) return;
    samp.sample.el.style.cursor=''; samp.sample.el.removeEventListener('pointerdown',grab,true);
    if(hint){ hint.remove(); hint=null; }
    samp=null; if(!box) document.removeEventListener('keydown',esc,true);
  }
  // the colour of the SURFACE at a point: the texture itself, not the shaded pixel on screen
  const _cv=new WeakMap();
  function texHex(img,u,v,flipY){
    if(!img||!img.width) return null;
    let c=_cv.get(img);
    if(!c){ c=document.createElement('canvas'); c.width=img.width; c.height=img.height; c.getContext('2d').drawImage(img,0,0); _cv.set(img,c); }
    u=((u%1)+1)%1; v=((v%1)+1)%1;
    const x=Math.min(c.width-1,Math.floor(u*c.width)), y=Math.min(c.height-1,Math.floor((flipY?1-v:v)*c.height));
    const d=c.getContext('2d').getImageData(x,y,1,1).data;
    return hx(d[0],d[1],d[2]);
  }
  // without a texture: the pixel under the press, read in the frame that was just drawn
  function glHex(renderer,scene,camera,e){
    renderer.render(scene,camera);
    const r=renderer.domElement.getBoundingClientRect(), gl=renderer.getContext(), px=new Uint8Array(4);
    const x=Math.floor((e.clientX-r.left)/r.width*gl.drawingBufferWidth);
    const y=Math.floor((1-(e.clientY-r.top)/r.height)*gl.drawingBufferHeight);
    gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    return hx(px[0],px[1],px[2]);
  }
  return {open,close,texHex,glHex,ROWS,isOpen:()=>!!box,isSampling:()=>!!samp};
})();
/*AM_PAL400_END*/
  // 400: the iPad's part of the board — where a sample is taken (a pencil or a finger tap), and what a new colour does
  function amPalSampleAt(e){ const r=el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1),camera);
    const h=ray.intersectObject(mesh,false)[0]; if(!h) return null;
    return (h.uv&&tex&&tex.image&&tex.image.width)?amPal.texHex(tex.image,h.uv.x,h.uv.y,tex.flipY):amPal.glHex(renderer,scene,camera,e); }
  function amPalOpen(anchor,verb,current,onPick){ amPal.open(anchor,{verb:verb,current:current,onPick:onPick,sample:{el:el,at:amPalSampleAt}}); }
  function amRecolor(kind,T,hex){ T.hex=hex;
    if(kind==='area'){ T.color=hex2rgb(hex); recolorAll(); polyRebuild(); smRebuild(); }
    else if(kind==='cnt') resizeCnt(T);
    else if(kind==='len'){ for(const L of lines) if(L.t===T.id&&L.obj){ scene.remove(L.obj); L.obj=lineObj(L); L.obj.visible=!T.hid; scene.add(L.obj); } }
    else if(kind==='rul') rulRebuild();
    else if(kind==='tag') tagRebuild();
    else if(kind==='vol'){ volRimBuild(); volChips(); volLayerChips(); volColSync(); volSmSoon(); }
    buildChips(); markUnexported(true); invalidate(); }
  // every layer's dot is its colour control (400: "תעשה שאפשר לשנות לכולם")
  function amPalSw(sw,kind,T){ sw.title='שינוי צבע השכבה'; sw.style.cursor='pointer';
    sw.onclick=ev=>{ ev.stopPropagation(); amPalOpen(sw,'recolor',T.hex,hex=>amRecolor(kind,T,hex)); }; }
  $('typeColor').onchange=e=>{const hex=e.target.value;
    const name=amAreaName(), k=types.findIndex(T=>T.park);
    if(k>=0){const T=types[k]; T.park=false; T.name=name; T.hex=hex; T.color=hex2rgb(hex); recolorAll(); activateT(k);}
    else {mkType(name,hex);activateT(types.length-1);}
    setMode('add');markUnexported(true);
    amInvite(document.querySelector('#chipsA .chip.on input'));};   // 453
  $('cntColor').onchange=e=>{const hex=e.target.value;
    mkCntType('',hex);activateC(cntTypes.length-1);markUnexported(true);
    amInvite(document.querySelector('#chipsC .chip.on input'));};   // 453
  $('tagColor').onchange=e=>{const hex=e.target.value;
    mkTagType('',hex);activateG(tagTypes.length-1);markUnexported(true);
    amInvite(document.querySelector('#chipsG .chip.on input'));};   // 453
  $('rulColor').onchange=e=>{const hex=e.target.value;
    mkRulType('',hex);activateR(rulTypes.length-1);markUnexported(true);
    amInvite(document.querySelector('#chipsR .chip.on input'));};   // 453
  $('lenColor').onchange=e=>{const hex=e.target.value;
    mkLenType('',hex);activateL(lenTypes.length-1);markUnexported(true);
    amInvite(document.querySelector('#chipsL .chip.on input'));};   // 453

  // the add buttons open the board (400); its wheel holds the browser's picker
  function amPalAdd(B,id){ const I=document.getElementById(id);
    amPalOpen(B,'add',I.value,hex=>{ I.value=hex; I.onchange({target:I}); }); }
  $('addType').onclick=e=>amPalAdd(e.currentTarget,'typeColor');
  $('addCnt').onclick=e=>amPalAdd(e.currentTarget,'cntColor');
  $('addLen').onclick=e=>amPalAdd(e.currentTarget,'lenColor');
  $('addRul').onclick=e=>amPalAdd(e.currentTarget,'rulColor');
  $('addTag').onclick=e=>amPalAdd(e.currentTarget,'tagColor');
  fit(); amParkIdle(); buildChips(); syncKindUI(); recolorAll(); updateHB();
  if($('fit')) $('fit').onclick=()=>fit();      // 361: מרכוז, as in the report screen
  // 361 (Eli: "א"): the iPad has no wheel, and five fingers belong to the system — so the
  // walk is two buttons. Held, each walks toward (or away from) the middle of the screen, a
  // quarter of the wheel's step every 50 ms; the zoom stays, and walls are passed through.
  // 362: the held walk keeps its own pace (2% every 50 ms, as 361 had it) — the wheel's step
  // shrank to a tenth, and a button held that slowly would barely move
  const AM_HOLD_STEP=0.02;
  for(const [id,f] of [['walkF',1],['walkB',-1]]){ const b=$(id); if(!b) continue;
    let tm=0; const stop=()=>{ clearInterval(tm); tm=0; };
    b.addEventListener('pointerdown',e=>{ e.preventDefault(); stop();
      const r=el.getBoundingClientRect(), mid={clientX:r.left+r.width/2,clientY:r.top+r.height/2};
      amWalk(mid,f*AM_HOLD_STEP); tm=setInterval(()=>amWalk(mid,f*AM_HOLD_STEP),50); });
    for(const ev of ['pointerup','pointercancel','pointerleave']) b.addEventListener(ev,stop); }

  /* ---- sheet application (decision 42): one function, two callers — the sheet
     embedded in the file at boot, and a sheet the user loads from Files (slice 2).
     Field-for-field mirror of the desktop loadSheet — one engine, one meaning.
     Throws on mismatch, reporting the measured numbers (decision 35). ---- */
  // ---- the layout is a cache; the identity is (face, child) — decision 85 --------------
  // Same translator as the editor, in the same words: a flat sub-face index means something
  // only together with the counts it was written against, and the sheet carries those
  // counts. The file alone decides — no history, no server, no memory of another device.
  const AM_SHEET_READER = 8;   // 433: one brush, a level per layer   // 1 = marks only; 2 = membranes; 3 = the ruler (251); 5 = tags (332); 6 = the smooth line (335); 7 = levels 11-20 (382)
  const AM_SUB_SCHEME = (am.subScheme===2)?2:1;   // 539: 1 — one k; 2 — a target size, k_f = sqrt(cnt) (the work says which)
  function amB64u8(b){ const t=atob(b), a=new Uint8Array(t.length);
    for(let i=0;i<t.length;i++) a[i]=t.charCodeAt(i); return a; }
  function dec(b64){const bin=atob(b64),len=bin.length,u=new Uint8Array(len);for(let i=0;i<len;i++)u[i]=bin.charCodeAt(i);return u.buffer;}   // 349: the shared amRemap reads the sheet layout with it
  function amRemap(j){
    const sch=(typeof j.subScheme==='number')?j.subScheme:AM_SUB_SCHEME;
    if(sch!==AM_SUB_SCHEME) return {ok:false,why:(sch===1||sch===2)
      ? 'הגיליון נכתב לפריסת תת-פאות אחרת (סכימה '+sch+') מזו של המודל הפתוח (סכימה '+AM_SUB_SCHEME+').'   // 539
      : 'סדר תת-הפאות בקובץ (סכימה '+sch+') אינו מוכר לתוכנה הזאת.'};
    const oldK=(typeof j.subdiv==='number')?j.subdiv:SUBK;
    if(oldK!==SUBK) return {ok:false,why:'דקוּת הסימון בקובץ ('+oldK+') שונה מזו של המודל הפתוח ('+SUBK+').'};
    const oSPF=oldK*oldK;
    let oCnt=null;
    try{ oCnt=j.cnt?new Uint8Array(dec(j.cnt)):null; }catch(e){ return {ok:false,why:'פריסת הגיליון פגומה.'}; }
    let oFo=(typeof j.Fo==='number')?j.Fo:FO;
    if(oCnt&&oCnt.length!==oFo) return {ok:false,why:'פריסת הגיליון אינה תואמת למספר הפאות.'};
    // A DELETED membrane makes the mesh shorter than the sheet that was written
    // over it. The scanned faces are still a prefix, so the marks on them are still
    // valid; what was marked on the patch goes with the patch. Truncate, and count
    // what fell off so it can be said out loud rather than vanish.
    let cutSub=0;
    if(oFo>FO){
      for(let fo=FO;fo<oFo;fo++) cutSub+=(oCnt?oCnt[fo]:oSPF);
      oFo=FO;
    }
    // Faces the sheet never knew about are the membranes appended since (decision
    // 132). They carry no marks, and they take the CURRENT layout so the translator
    // maps them to themselves.
    const oOFF=new Uint32Array(FO+1);
    for(let fo=0;fo<FO;fo++)
      oOFF[fo+1]=oOFF[fo]+(fo>=oFo ? (OFF[fo+1]-OFF[fo]) : (oCnt?oCnt[fo]:oSPF));
    let same=true;
    for(let fo=0;fo<=FO;fo++) if(oOFF[fo]!==OFF[fo]){same=false;break;}
    if(same) return {ok:true,same:true,oOFF:oOFF,oFo:oFo,cutSub:cutSub};
    for(let fo=0;fo<FO;fo++){
      const oc=oOFF[fo+1]-oOFF[fo], nc=OFF[fo+1]-OFF[fo];
      // growth only, by the user's decision for this version: a face may gain children, never
      // lose them. Folding k^2 back into one would have to decide all-or-nothing, and that
      // changes the measured area — refused out loud instead.
      if(nc<oc) return {ok:false,why:'הפריסה החדשה גסה מזו של הגיליון — סימון היה נאלץ להתקפל.'};
      if(nc!==oc&&oc!==1) return {ok:false,why:'פאה שינתה רזולוציה שלא בהתפצלות של שלם.'};
    }
    return {ok:true,same:false,oOFF:oOFF,oFo:oFo,cutSub:cutSub};
  }
  function amFaceOf(m,s){       // which original face an OLD flat index belongs to
    const o=m.oOFF; let lo=0,hi=FO-1;
    if(s<0||s>=o[FO]) return -1;
    while(lo<hi){const mid=(lo+hi+1)>>1; if(o[mid]<=s)lo=mid; else hi=mid-1;}
    return lo;
  }
  function amEach(m,s,fn){      // every NEW sub-face that carries old index s
    const fo=amFaceOf(m,s); if(fo<0) return false;
    const oc=m.oOFF[fo+1]-m.oOFF[fo], nc=OFF[fo+1]-OFF[fo];
    if(nc===oc){ fn(OFF[fo]+(s-m.oOFF[fo])); return true; }
    for(let t=OFF[fo];t<OFF[fo+1];t++) fn(t);   // 1 -> k^2: the whole face was marked
    return true;
  }
  function amFracOld(pairs,m){
    const sig=new Float64Array(FO);
    for(const pr of pairs){ if(pr[1]!==1) continue;
      const fo=amFaceOf(m,pr[0]); if(fo>=0) sig[fo]+=1/(m.oOFF[fo+1]-m.oOFF[fo]); }
    return sig;
  }
  function amFracNew(M){
    const sig=new Float64Array(FO);
    for(let s=0;s<N;s++) if(M[s]===1){ const fo=FACEOF[s]; sig[fo]+=1/(OFF[fo+1]-OFF[fo]); }
    return sig;
  }
  function amFirstGap(a,b){
    for(let fo=0;fo<FO;fo++) if(Math.abs(a[fo]-b[fo])>1e-9) return fo;
    return -1;
  }
  function applySheet(sh){
    const _need=(sh&&typeof sh.minReader==='number')?sh.minReader:1;
    if(_need>AM_SHEET_READER)
      throw new Error('\u05d4\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05e0\u05db\u05ea\u05d1 \u05d1\u05d2\u05e8\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05d9\u05d5\u05ea\u05e8 \u05e9\u05dc \u05d4\u05ea\u05d5\u05db\u05e0\u05d4. \u05e2\u05d3\u05db\u05df \u05d0\u05ea \u05d4\u05e6\u05e4\u05d9\u05d9\u05df.');
    if(!sh||!(sh._sheet||sh._work)) throw new Error('הקובץ אינו גיליון של התוכנה.');
    if(sh.Fo!==FO)
      throw new Error('הגיליון אינו תואם לעבודה הפתוחה — בגיליון '+sh.Fo
                      +' פאות, כאן '+FO+'.');
    // OLD -> TRANSFORM -> VALIDATE -> COMMIT, exactly as in the editor: the transfer is
    // rehearsed on a copy and checked per face before a single mark is installed.
    const MAP=amRemap(sh);
    if(!MAP.ok) throw new Error('אי אפשר לטעון את הסימונים: '+MAP.why+'\nהעבודה לא שונתה.');
    if(MAP.same && sh.Nsub!==N)
      throw new Error('הגיליון מצהיר על פריסה זהה אך על '+sh.Nsub+' תת-פאות במקום '+N+'.');
    if(!MAP.same){
      for(const src of (sh.types&&sh.types.length?sh.types:[sh])){
        const tmp=new Int8Array(N);
        for(const pr of (src.manual||[])) amEach(MAP,pr[0],t=>{tmp[t]=pr[1];});
        const bad=amFirstGap(amFracOld(src.manual||[],MAP), amFracNew(tmp));
        if(bad>=0) throw new Error('בדיקת השלמות נכשלה בהעברת הסימונים (פאה '+bad+').\n'+
                                   'הפעולה בוטלה והעבודה לא שונתה.');
      }
    }
    MEMBRANES = Array.isArray(sh.membranes) ? sh.membranes : [];
    VOL_LAYERS = Array.isArray(sh.volLayers) ? sh.volLayers : [];
    for(const L of [...lines]) delLine(L);
    for(const m of [...xmarks]) delX(m);
    lenTypes.length=0; activeL=-1;
    cntTypes.length=0; activeC=-1;
    types.length=1; activeT=0;
    const T0=types[0]; T0.manual.fill(0); T0.faceThr=null; T0.prob=prob; T0.hasProb=false;
    T0.name='שטח 1'; T0.hex='#38b000'; T0.color=hex2rgb(T0.hex); T0.hid=false;
    roi.fill(0);roiCount=0;
    for(const fo of (sh.roiPainted||sh.roiFaces||[])) if(fo<FO)
      for(let t=OFF[fo];t<OFF[fo+1];t++){ if(!roi[t]){roi[t]=1;roiCount++;} }
    const loadT=(T,src)=>{
      T.am=(src.am===AM_POLY)?AM_POLY:AM_BRUSH; T.sm=Math.max(0,Math.min(SM_MAXLEVEL,Math.round(+src.sm||0)));   // 433: the layer's smoothing level   // an older sheet is a brush layer
      if(src.name!==undefined)T.name=src.name;
      if(src.color){T.hex=src.color;T.color=hex2rgb(src.color);}
      if(typeof src.thr==='number')T.thr=src.thr;
      if(typeof src.op==='number')T.op=src.op;
      T.hid=(src.hid===true); T.repHid=(src.repHid===true);    // 328: the report's own eye, kept
      for(const pr of (src.manual||[])) amEach(MAP,pr[0],t=>{T.manual[t]=pr[1];});
      // 324: the strokes and the grows come back in their order; a sheet from before them has
      // its marks as one face-level act, so a new eraser stroke cuts into them smoothly too
      T.ops=[];
      if(Array.isArray(src.ops)){ for(const o of src.ops){
          if(o&&o.t==='balls'&&Array.isArray(o.c)&&o.c.length) T.ops.push({t:'balls',r:(+o.r>0)?+o.r:0.1,s:(o.s<0)?-1:1,c:o.c.slice()});
          else if(o&&o.t==='faces'&&Array.isArray(o.f)){ const m=new Map();
            o.f.forEach((f,i)=>amEach(MAP,f,t=>m.set(t,(o.v&&o.v[i]<0)?-1:1))); if(m.size) T.ops.push({t:'faces',m:m}); } } }
      else { const m=new Map(); for(let t=0;t<N;t++) if(T.manual[t]!==0) m.set(t,T.manual[t]); if(m.size) T.ops.push({t:'faces',m:m}); }
      if((src.faceThr||[]).length){T.faceThr=new Float32Array(N).fill(NaN);
        for(const pr of src.faceThr) amEach(MAP,pr[0],t=>{T.faceThr[t]=pr[1];});}
      if(src.hasProb&&src.prob&&src.prob.length===FO){
        if(!T.prob||(T.prob===prob&&T!==types[0]))T.prob=new Float32Array(N);
        for(let fo=0;fo<FO;fo++) for(let t=OFF[fo];t<OFF[fo+1];t++) T.prob[t]=src.prob[fo];
        T.hasProb=true;}
    };
    if(Array.isArray(sh.types)&&sh.types.length){          // v3 sheet: full multi-type state
      loadT(T0,sh.types[0]); if(sh.types[0].id)T0.id=sh.types[0].id;
      for(let i=1;i<sh.types.length;i++){const T=mkType('','#0d47a1');loadT(T,sh.types[i]);
        if(sh.types[i].id)T.id=sh.types[i].id;}
    } else {                                               // legacy sheet: single type
      loadT(T0,{name:'שטח 1',thr:(typeof sh.globalThreshold==='number')?sh.globalThreshold:T0.thr,
                manual:sh.manual,faceThr:sh.faceThr,hasProb:sh.hasProb,prob:sh.prob});
    }
    rulTypes.length=0; activeR=-1; rulPts.length=0; rulSegs.length=0; rulLast=null;
    polys.length=0; curPoly=null; pSeq=0; SMR.length=0; smSel=null; smTs.clear(); polyRebuild();
    rulRebuild();
    for(const src of (sh.rulTypes||[])){const T=mkRulType(src.name||'',src.color||'#b8934a');
      if(src.id)T.id=src.id; if(typeof src.op==='number')T.op=src.op; T.hid=(src.hid===true); T.repHid=(src.repHid===true);
      if(typeof src.design==='number')T.design=src.design;
      if(typeof src.w==='number')T.w=amRulWOf({w:src.w});}
    for(const src of (sh.rulerPts||[])){const q=src.p||[];
      rulPts.push({id:src.id,t:src.t,x:q[0],y:q[1],z:q[2]});
      if(src.id>rpSeq) rpSeq=src.id;}
    for(const src of (sh.rulerSegs||[])) rulSegs.push({t:src.t,a:src.a,b:src.b});
    // 335: each layer's smooth marking — its whole and held-out sub-faces through the same map,
    // its strokes' balls as they are, and the line asked again; then the regions the sheet names,
    // found again in that marking (a sheet from before 335 marks whole sub-faces only)
    // 433: one brush. A sheet from before it (reader 7 and below) kept the smoothed tool's marking apart
    // (smoothOps: its whole and held-out sub-faces and its strokes; before 335 only the regions'
    // faces). It joins the layer's brush marking once, here — a sub-face both tools marked is one
    // mark and counts once — and the layer takes the level of its largest smoothed region.
    smTs.clear(); SMR.length=0;
    if(!(_need>=8)){
      const lvAt=new Map(), opsAt=new Map();
      for(const src of (sh.smooths||[])){ if(!src||!src.at) continue; const n=(src.faces||[]).length, L=lvAt.get(src.at);
        if(!L||n>L[1]) lvAt.set(src.at,[Math.max(0,Math.min(SM_MAXLEVEL,Math.round(+src.level||0))),n]); }
      for(const src of (sh.smoothOps||[])) if(src&&src.at) opsAt.set(src.at,src);
      for(const T of types){ const O=opsAt.get(T.id), L=lvAt.get(T.id); if(!O&&!L) continue;
        const X=new Set(); if(O) for(const f of (O.X||[])) amEach(MAP,f,q=>X.add(q));
        const add=q=>{ if(!X.has(q)) T.manual[q]=1; };
        if(O){ for(const f of (O.S||[])) amEach(MAP,f,add);
          if(!T.ops) T.ops=[];
          for(const o of (O.ops||[])) if(o&&o.t==='balls'&&Array.isArray(o.c)&&o.c.length)
            T.ops.push({t:'balls', r:(+o.r>0)?+o.r:0.1, s:(o.s<0)?-1:1, c:o.c.map(Number)}); }
        else for(const src of (sh.smooths||[])) if(src&&src.at===T.id) for(const f of (src.faces||[])) amEach(MAP,f,add);
        if(L) T.sm=L[0];
        amSOf(T); amMarkFull(T); T._smSig=null; } }
    for(const T of types) T._smSig=null;
    smSyncNow();
    for(const src of (sh.polygons||[])){
      const P={id:src.id||(++pSeq),at:src.at,pts:(src.pts||[]).map(q=>q.slice()),area:0};
      if(src.id&&src.id>pSeq) pSeq=src.id;
      polyRecompute(P); polys.push(P);}
    if(polys.length) polyRebuild();
    if(rulTypes.length){activeR=0; rulRebuild();}
    for(const src of (sh.lenTypes||[])){const T=mkLenType(src.name||'',src.color||'#eab308');if(src.id)T.id=src.id;
      if(typeof src.op==='number')T.op=src.op; T.hid=(src.hid===true); T.repHid=(src.repHid===true);}
    for(const src of (sh.lengths||[])){
      const L={t:src.t,pts:src.pts.slice(),fit:src.fit||null,
        len:(src.fit&&typeof src.fit.length_m==='number')?src.fit.length_m:lineLen(src.pts),
        w:src.w||0.008,obj:null};  // a measured stroke keeps its truth on the iPad too
      addLine(L);}
    for(const src of (sh.cntTypes||[])){const T=mkCntType(src.name||'',src.color||'#c71f37');if(src.id)T.id=src.id;
      if(typeof src.size==='number')T.size=src.size;
      if(typeof src.op==='number')T.op=src.op; T.hid=(src.hid===true); T.repHid=(src.repHid===true);}
    for(const src of (sh.counters||[])){const pts=src.pts||[];
      for(let i=0;i+2<pts.length;i+=3) addX({t:src.t,p:[pts[i],pts[i+1],pts[i+2]],obj:null});}
    if(cntTypes.length)activeC=0;
    // 332: the tags, and the photos a sheet brought along (from the computer's package, or
    // an exported sheet loaded back) — into the device's own store
    tagTypes.length=0; tags.length=0; activeG=-1; gSeq=0;
    if(sh.tagImgs&&typeof sh.tagImgs==='object')
      for(const [n,v] of Object.entries(sh.tagImgs)) if(typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}[.]jpg$/.test(n)){ TAG_IMG.set(n,v); imgPut(n,v); }
    for(const src of (Array.isArray(sh.tagTypes)?sh.tagTypes:[])){const T=mkTagType(src.name||'',src.color||'#7dd3fc');
      if(src.id)T.id=src.id; T.hid=(src.hid===true); T.repHid=(src.repHid===true);}
    for(const src of (Array.isArray(sh.tags)?sh.tags:[])){
      if(!src||!Array.isArray(src.p)||src.p.length!==3||!tagTypes.some(T=>T.id===src.t)) continue;
      tags.push({id:src.id||amTagId(),t:src.t,p:src.p.map(Number),nrm:Array.isArray(src.nrm)?src.nrm.map(Number):null,
                 title:String(src.title||''),text:String(src.text||''),img:(typeof src.img==='string'?src.img:null)});}
    if(tagTypes.length)activeG=0;
    tagRebuild();
    areaTool=(types[activeT]&&types[activeT].am===AM_POLY)?AM_POLY:AM_BRUSH;   // 10
    if(lenTypes.length)activeL=0;
    $('thr').value=Math.round(types[0].thr*1000);
    $('thrV').textContent=types[0].thr.toFixed(3);
    amLabIn(sh); polyRebuild(); smRebuild(); rulRebuild();   // 355: each layer's label switch
    undoStack.length=0;redoStack.length=0;updateHB();  // loaded state is the new baseline
    amParkIdle(); syncKindUI();
    buildChips();
    recolorAll();
  }
  if(sheet){
    try{applySheet(sheet);}
    catch(ex){amTell('הגיליון שבקובץ העבודה לא נטען:\n'+ex.message+'\nהמודל נפתח בלי סימונים.');}
  }

  /* ---- 327: the recovery copy of THIS work, offered back when it differs ----
     compared without the moment it was written: a copy of exactly what loaded is not news */
  dbReady.then(snapRead).then(async sn=>{
    try{
      if(!sn||!sn.sheet) return;
      // 494 (3): compared without the derived fields too — a copy written before 494 carries them, and is the same work
      const bare=o=>{ const c=Object.assign({},o); for(const k of ['saved','repairFaces','areaM2','unionM2','typeAreas','lenTotals','cntTotals']) delete c[k]; return JSON.stringify(c); };
      let same=false; try{ same=bare(sn.sheet)===bare(getSheet(false)); }catch(_){}
      if(same) return;
      const when=new Date(sn.t).toLocaleString('he-IL');
      if(await amAsk('נמצא עותק של העבודה הזאת מהביקור הקודם, עם שינויים שלא יוצאו לגיליון (נשמר '+when+').',
                     [{t:'לשחזר',v:true,primary:true},{t:'לא לשחזר',v:false}],false)){
        try{ applySheet(sn.sheet); markUnexported(true); }
        catch(ex){ amTell('השחזור נכשל:\n'+((ex&&ex.message)||ex)+'\nהעבודה נשארה כפי שנטענה.'); }
      } else snapDrop();
    } finally { amSnapOn=true; }
  });

  /* exposed for the sheet-import path and the smoke harness — not a public API */
  window.__am={N,FO,types,lenTypes,lines,roi,prob,area,getSheet,applySheet,paintAt,growAt,
    autoComplete,beginH,commitH,undo,redo,setMode:setMode,isRepair,isType,fit,
    mkType,mkLenType,activateT,activateL};
}

