const CACHE_NAME = 'chemeng-shell-v129';
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192-v2.png',
  '/icon-512-v2.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('chemeng-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated API calls or protected engineering data endpoints
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    return;
  }

  // Never cache manifest or sw.js aggressively so updates propagate immediately
  if (url.pathname === '/manifest.json' || url.pathname === '/sw.js') {
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    /^\/icon-(maskable-)?(192|512)(-v2)?\.png$/.test(url.pathname) ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/apple-touch-icon-v2.png' ||
    url.pathname === '/favicon.ico';

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
          }
          return response;
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChemEng Studio — 오프라인</title></head><body style="font-family:sans-serif;background:#0B1528;color:#E2E8F0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;"><div><h2 style="margin:0 0 8px;">네트워크 연결을 확인해 주세요</h2><p style="font-size:14px;color:#94A3B8;margin:0 0 16px;">서버와 연결되지 않아 오프라인 상태입니다.</p><button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:none;background:#06B6D4;color:#0F172A;font-weight:800;cursor:pointer;">다시 연결</button></div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
      )
    );
  }
});
