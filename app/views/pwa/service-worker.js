// Static export replaces the version and shell list with content hashes.
const VERSION = 'calorie-v1';
const FILES = ['./','./index.html','./manifest.webmanifest','./app/styles.css','./app/application.js','./app/domain.js','./app/database.js','./app/clipboard.js','./app/pwa.js','./app/widget_sync.js','./app/icon.svg','./app/icon-192.png','./app/icon-512.png','./app/apple-touch-icon.png'];
const CACHE = `${VERSION}-${self.registration.scope}`;
const scopeURL=new URL(self.registration.scope);
const scopedFiles=new Set(FILES.map(path=>new URL(path,scopeURL).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    // Rails has no /index.html route. Cache its root shell under both names.
    const root=await fetch(new Request(scopeURL,{cache:'reload'}));if(!root.ok)throw new Error('App shell unavailable');
    await cache.put(scopeURL,root.clone());await cache.put(new URL('index.html',scopeURL),root);
    await cache.addAll(FILES.filter(path=>path!=='./'&&path!=='./index.html').map(path=>new Request(new URL(path,scopeURL),{cache:'reload'})));
  }));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('calorie-')&&key.endsWith(`-${self.registration.scope}`)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());
});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request;const url=new URL(req.url);
  if(req.headers?.has('Authorization')||url.pathname==='/api/summary')return;
  if(req.method!=='GET'||url.origin!==scopeURL.origin||!url.pathname.startsWith(scopeURL.pathname))return;
  if(req.mode==='navigate') {
    event.respondWith(caches.open(CACHE).then(async cache=>await cache.match(scopeURL)||fetch(req)));return;
  }
  // Only the explicit app shell is cached. IndexedDB records never enter caches.
  if(scopedFiles.has(url.href))event.respondWith(caches.open(CACHE).then(async cache=>await cache.match(req)||fetch(req)));
});
