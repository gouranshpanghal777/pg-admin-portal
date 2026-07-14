import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PublicMaintenanceRequest from './PublicMaintenanceRequest.tsx'

const path = window.location.pathname
const maintenanceMatch = path.match(/^\/maintenance\/request\/([a-f0-9]+)$/)
const tokenFromUrl = maintenanceMatch?.[1]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tokenFromUrl ? <PublicMaintenanceRequest /> : <App />}
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })

    window.addEventListener('load', () => {
      void navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => registration.update())
        .catch((error) => console.warn('Service worker registration failed', error))
    })
  } else {
    void navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    if ('caches' in window) {
      void caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('pg95-shell-')).map((key) => caches.delete(key))),
      )
    }
  }
}
