/**
 * Service Worker: 页面被关掉之后的第二层闹钟, 外加把页面缓存下来能离线打开。
 *
 * 注意: 浏览器会在空闲时回收 Service Worker, 里面的 setTimeout 会一起消失。
 * 所以这层是"尽力而为" —— 真正保证不出错的是页面里基于时间戳的结算。
 */

const CACHE = 'playtime-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icon.svg', './manifest.webmanifest',
  '../src/index.js', '../src/playtime-timer.js', '../src/storage.js', '../src/alarms.js'];

const timers = new Map();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 网络优先, 断网时回落到缓存, 这样离线也能打开看剩余时间
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      const cache = await caches.open(CACHE);
      cache.put(event.request, res.clone()).catch(() => {});
      return res;
    } catch {
      const cached = await caches.match(event.request);
      return cached ?? Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data ?? {};

  if (data.type === 'schedule') {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const alarm of data.alarms ?? []) {
      const delay = alarm.at - Date.now();
      if (delay <= 0) continue;
      timers.set(alarm.id, setTimeout(() => {
        timers.delete(alarm.id);
        show(alarm);
      }, delay));
    }
  }

  if (data.type === 'notify' && data.alarm) show(data.alarm);
});

function show(alarm) {
  return self.registration.showNotification(alarm.title, {
    body: alarm.body,
    tag: alarm.id,          // 同 tag 会替换, 页面和 SW 同时响也只看到一条
    renotify: false,
    requireInteraction: true,
    icon: './icon.svg',
    badge: './icon.svg',
    vibrate: [200, 100, 200],
  }).catch(() => {});
}

// 点通知回到 App
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow('./');
  })());
});
