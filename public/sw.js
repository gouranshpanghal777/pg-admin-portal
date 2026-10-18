const CACHE = 'pg95-shell-v11'
const SHELL = ['/', '/icons/apple-touch-icon.png', '/icons/favicon-32.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' })
            if (response.ok) await cache.put(url, response)
          } catch {
            // Keep install resilient when one optional shell asset is unavailable.
          }
        }),
      )
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PG95_ACTIVATE_UPDATE') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('pg95-shell-') && key !== CACHE).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE)
            await cache.put('/', response.clone())
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    )
    return
  }

  if (/\.(js|css|woff2?|ttf|eot)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
      ),
    )
    return
  }

  if (/\.(svg|png|ico|webmanifest)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
      ),
    )
  }
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() } catch { return }
  const title = typeof payload.title === 'string' ? payload.title : 'PG 95 Maintenance'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'New maintenance request',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: typeof payload.ticketId === 'string' ? 'maintenance-' + payload.ticketId : 'maintenance',
    data: { url: '/?maintenance=1', ticketId: payload.ticketId },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/?maintenance=1', self.location.origin).href
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus()
        client.postMessage({ type: 'PG95_OPEN_MAINTENANCE' })
        return
      }
    }
    await clients.openWindow(target)
  })())
})
