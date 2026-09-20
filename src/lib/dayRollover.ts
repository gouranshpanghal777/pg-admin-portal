import { businessDate } from './businessDate'
import { updateBlocked } from './pwaUpdate'

export function shouldReloadForBusinessDay(startDate: string, nowDate: string, blocked: boolean, alreadyReloaded: boolean) {
  return !alreadyReloaded && !blocked && nowDate !== startDate
}

export function registerDayRollover(intervalMs = 60_000) {
  const startDate = businessDate()
  let reloaded = false

  const check = () => {
    if (reloaded) return
    const nowDate = businessDate()
    if (!shouldReloadForBusinessDay(startDate, nowDate, updateBlocked(), reloaded)) return
    reloaded = true
    window.location.reload()
  }

  const timer = window.setInterval(check, intervalMs)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)

  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', check)
  }
}
