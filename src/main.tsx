import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PublicMaintenanceRequest from './PublicMaintenanceRequest.tsx'
import UpdateNotice from './features/UpdateNotice'
import { registerPwa } from './lib/pwaUpdate'
import { registerDayRollover } from './lib/dayRollover'

const path = window.location.pathname
// All maintenance QR routes must show the public page, never the admin login.
const publicMaintenanceRoute = /^\/maintenance\/request(?:\/|$)/i.test(path)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicMaintenanceRoute ? <PublicMaintenanceRequest /> : <App />}
    {!publicMaintenanceRoute && <UpdateNotice />}
  </StrictMode>,
)

if (!publicMaintenanceRoute) registerDayRollover()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD && !publicMaintenanceRoute) {
    window.addEventListener('load', registerPwa)
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
