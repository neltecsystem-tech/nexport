// Service Worker for Web Push Notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'WorkChat', body: '新しいメッセージがあります' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    tag: data.tag || 'workchat-' + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url || '/',
      channelId: data.channelId || null,
    },
  };

  event.waitUntil((async () => {
    // 通知を表示
    await self.registration.showNotification(data.title || 'WorkChat', options);
    // PWA アプリアイコンのバッジ数を更新 (アクティブな通知の総数)
    try {
      if ('setAppBadge' in self.navigator) {
        const notifs = await self.registration.getNotifications();
        await self.navigator.setAppBadge(notifs.length);
      }
    } catch (_) {}
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    // バッジクリア
    try {
      if ('clearAppBadge' in self.navigator) {
        await self.navigator.clearAppBadge();
      }
    } catch (_) {}
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

// 通知が個別に閉じられた時もバッジを再計算
self.addEventListener('notificationclose', (event) => {
  event.waitUntil((async () => {
    try {
      if ('setAppBadge' in self.navigator) {
        const notifs = await self.registration.getNotifications();
        if (notifs.length > 0) {
          await self.navigator.setAppBadge(notifs.length);
        } else if ('clearAppBadge' in self.navigator) {
          await self.navigator.clearAppBadge();
        }
      }
    } catch (_) {}
  })());
});
