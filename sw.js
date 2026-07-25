// Service Worker - كابيتال هوم
// إصدار الكاش: غيّر الرقم ده مع أي تحديث كبير للملفات الأساسية عشان
// المتصفح يجبر تحميل نسخة جديدة بدل ما يفضل شايل القديمة.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `capital-home-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `capital-home-runtime-${CACHE_VERSION}`;
const SHEET_CACHE = `capital-home-sheet-${CACHE_VERSION}`;

// الملفات الأساسية (App Shell) اللي بتتخزن وقت التثبيت عشان الموقع
// يفتح حتى لو النت ضعيف أو مقطوع تماماً.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/brand-og-image.jpg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

// أي طلب متجه لجوجل شيت (بيانات العقارات الحية)
function isSheetRequest(url) {
  return url.hostname === 'docs.google.com' && url.pathname.includes('/gviz/tq');
}

// صور العقارات المحلية
function isLocalImageRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/images/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW install cache error:', err))
  );
});

self.addEventListener('activate', (event) => {
  const validCaches = [SHELL_CACHE, RUNTIME_CACHE, SHEET_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !validCaches.includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) بيانات جوجل شيت: جرّب النت أولاً، ولو فشل رجّع آخر نسخة متخزنة
  //    (Network First مع fallback للكاش) عشان يفضل عندك آخر بيانات
  //    شغالة حتى لو النت اتقطع فجأة.
  if (isSheetRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(SHEET_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 2) طلبات التنقل بين الصفحات (بما فيها روابط /property/:id النظيفة):
  //    الموقع صفحة واحدة (SPA-like)، فكل تنقل بيرجع نفس index.html.
  //    Network First مع fallback لآخر نسخة مخزنة من index.html.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 3) صور العقارات المحلية: Cache First (الصور ثابتة وما بتتغيرش غالباً)
  if (isLocalImageRequest(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 4) باقي ملفات الـ Shell (manifest، أيقونات، الخط...) : Cache First
  if (SHELL_ASSETS.includes(url.pathname) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 5) أي حاجة تانية (خطوط جوجل، Tailwind CDN...): جرّب النت، ولو فشل
  //    استخدم الكاش لو موجود، غير كده سيب المتصفح يتعامل معاها عادي.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
