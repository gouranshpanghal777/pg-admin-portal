/** Date-only billing values are calendar dates, not UTC instants. */
export function businessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function nextPeriod(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid billing period')
  const [year, month] = period.split('-').map(Number)
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`
}

export function periodsBetween(start: string, end: string): string[] {
  const periods: string[] = []
  for (let period = start; period <= end; period = nextPeriod(period)) {
    if (periods.length >= 1200) throw new Error('Billing history exceeds supported range; review the joining date')
    periods.push(period)
  }
  return periods
}

export function dueDateForPeriod(anchor: string, period: string): string {
  if (!validDate(anchor)) throw new Error('Invalid rent due date')
  nextPeriod(period) // validate without interpreting a date-only string in the local timezone
  const [year, month] = period.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate()
  return `${period}-${String(Math.min(Number(anchor.slice(8, 10)), lastDay)).padStart(2, '0')}`
}

export const calendarDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
export const roundMoney = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100
