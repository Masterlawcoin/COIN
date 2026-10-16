'use strict';
const CACHE='masterlawex-pwa-v3';
const SHELL=['/','/p2p.html','/login.html','/app.css','/metamask-connect.js','/core.js','/auth.js','/p2p-wallet-auth.js','/wallet-flow.js','/p2p-masterlaw-gate.js','/p2p-v15-trade.js','/p2p-v15-abi.js','/manifest.webmanifest','/app-icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>null).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname==='/release.json')return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(req);
      if(fresh&&fresh.ok){const cache=await caches.open(CACHE);cache.put(req,fresh.clone()).catch(()=>{})}
      return fresh;
    }catch{
      const cached=await caches.match(req,{ignoreSearch:true});
      if(cached)return cached;
      if(req.mode==='navigate')return (await caches.match('/p2p.html'))||(await caches.match('/login.html'));
      throw new Error('OFFLINE_RESOURCE_UNAVAILABLE');
    }
  })());
});
