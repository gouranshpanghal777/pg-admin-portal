const CACHE = 'pg95-shell-v7'
const SHELL = ['/', '/icons/apple-touch-icon.png', '/icons/favicon-32.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (/\.(js|css|woff2?|ttf|eot)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
        return res
      }))
    )
    return
  }

  if (/\.(svg|png|ico|webmanifest)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
        return res
      }))
    )
    return
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})
