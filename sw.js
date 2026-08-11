/* A-morphometry viewer — offline shell. Full precache, cache-first: after the
   one-time install the viewer must work with no network at all (decision 19).
   Bump CACHE on every release; the old cache is dropped on activate. */
'use strict';
const CACHE='am-viewer-v16';
const ASSETS=['./','index.html','viewer.js','three.min.js','manifest.webmanifest',
              'icon-180.png','icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true})
    .then(r=>r||fetch(e.request)));
});
