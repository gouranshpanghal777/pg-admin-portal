export const UPDATE_EVENT = 'pg95:update-ready'
let waiting: ServiceWorker | null = null
let reloadApproved = false
let reloaded = false

// Conservative: even an untouched open form blocks activation.
export function canActivateUpdate(hasOpenForm: boolean, hasOpenDialog: boolean) {
  return !hasOpenForm && !hasOpenDialog
}
export function updateBlocked() {
  return !canActivateUpdate(Boolean(document.querySelector('form')), Boolean(document.querySelector('[role="dialog"]')))
}
export function acceptUpdate() {
  if (!waiting || updateBlocked()) return false
  reloadApproved = true
  waiting.postMessage({ type: 'PG95_ACTIVATE_UPDATE' })
  return true
}
export function registerPwa() {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadApproved || reloaded || updateBlocked()) return
    reloaded = true
    window.location.reload()
  })
  const announce = (registration: ServiceWorkerRegistration) => {
    if (!registration.waiting) return
    waiting = registration.waiting
    window.dispatchEvent(new Event(UPDATE_EVENT))
  }
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
    announce(registration)
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') announce(registration)
      })
    })
    return registration.update()
  }).catch((error) => console.warn('Service worker update check failed', error))
}
