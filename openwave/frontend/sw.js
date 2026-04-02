const CACHE='ow-v1';
const SHELL=['/','/css/main.css','/css/theme.css','/js/api.js','/js/ws.js','/js/ui.js','/js/app.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/')||e.request.url.includes('/ws'))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
