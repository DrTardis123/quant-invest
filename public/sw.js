// Service Worker for 퀀트 투자 대시보드 PWA
// 전략:
//   - App Shell (HTML/CSS/JS/매니페스트): cache-first (빠른 재방문)
//   - /data/*.json: stale-while-revalidate (오프라인 시 캐시 응답)
//   - 외부 CDN: stale-while-revalidate (오프라인 fallback)
//   - /api/* (Vercel): network-first (실시간성 우선), 실패 시 캐시 fallback
//
// 캐시 버전: 캐시 구조 변경 시 BUMP
const CACHE_VERSION = 'v5';  // v5: cleanUrls (no .html) — 캐시 키도 변경
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const CDN_CACHE = `cdn-${CACHE_VERSION}`;

// App shell (오프라인에서도 동작할 핵심 자산)
// cleanUrls: true → .html 없는 경로가 캐시 키
const APP_SHELL = [
  '/',
  '/explore',
  '/analysis',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/common.js',
  '/js/strategies.js',
  '/js/api.js',
  '/js/reweight.js',
  '/js/chart-loader.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// === 설치: App Shell 캐시 ===
self.addEventListener('install', (event) => {
  console.log(`[SW] install v${CACHE_VERSION}`);
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL).catch((e) => {
        // 일부 자산 (예: 192.png) 없으면 무시 (icon SVG fallback)
        console.warn('[SW] shell addAll partial:', e.message);
        return cache.add(APP_SHELL.filter((u) => !u.includes('192') && !u.includes('512')));
      }))
      .then(() => self.skipWaiting())  // 새 SW 즉시 활성화
  );
});

// === 활성화: 오래된 캐시 정리 ===
self.addEventListener('activate', (event) => {
  console.log(`[SW] activate v${CACHE_VERSION}`);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => ![APP_SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE, CDN_CACHE].includes(k))
          .map((k) => { console.log('[SW] delete', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())  // 즉시 컨트롤
  );
});

// === fetch 이벤트: 전략별 라우팅 ===
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1) /api/* (Vercel serverless) → network-first, 실패 시 캐시
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, RUNTIME_CACHE));
    return;
  }

  // 2) /data/*.json → stale-while-revalidate (오프라인 시 캐시 즉시 응답)
  if (url.origin === location.origin && url.pathname.startsWith('/data/')) {
    event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
    return;
  }

  // 3) 외부 CDN (chart.js, alpine.js, bootstrap) → stale-while-revalidate
  if (url.origin !== location.origin && (url.hostname.includes('jsdelivr') || url.hostname.includes('cdn'))) {
    event.respondWith(staleWhileRevalidate(event.request, CDN_CACHE));
    return;
  }

  // 4) App Shell (HTML/CSS/JS) → cache-first, 네트워크 fallback
  if (url.origin === location.origin) {
    event.respondWith(cacheFirst(event.request, APP_SHELL_CACHE));
    return;
  }
});

// === 전략 구현 ===

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    // 오프라인 → 캐시 fallback
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', message: '오프라인 상태입니다' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch((e) => {
    console.warn('[SW] fetch fail:', request.url, e.message);
    return null;
  });
  // 캐시 있으면 즉시 반환, 백그라운드에서 갱신
  return cached || (await fetchPromise) || new Response('Offline', { status: 503 });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    // 오프라인이고 캐시도 없으면 index.html fallback (SPA 라우팅)
    if (request.mode === 'navigate') {
      const fallback = await cache.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}

// === 메시지: 클라이언트가 "SKIP_WAITING" 요청 시 ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => event.ports[0]?.postMessage({ ok: true }));
  }
});
