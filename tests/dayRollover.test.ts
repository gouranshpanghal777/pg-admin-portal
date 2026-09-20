import { expect, it } from 'vitest'
import { shouldReloadForBusinessDay } from '../src/lib/dayRollover'

it('reloads once when the business date changes and the UI is safe', () => {
  expect(shouldReloadForBusinessDay('2026-09-20', '2026-09-21', false, false)).toBe(true)
})

it('does not reload while a form or dialog is open', () => {
  expect(shouldReloadForBusinessDay('2026-09-20', '2026-09-21', true, false)).toBe(false)
})

it('does not reload on the same day or after already reloading', () => {
  expect(shouldReloadForBusinessDay('2026-09-20', '2026-09-20', false, false)).toBe(false)
  expect(shouldReloadForBusinessDay('2026-09-20', '2026-09-21', false, true)).toBe(false)
})
