import { describe, expect, it } from 'vitest'
import { businessDate, dueDateForPeriod, nextPeriod, validDate } from '../src/lib/businessDate'

describe('India date-only billing', () => {
  it('uses the India day at a UTC month boundary', () => expect(businessDate(new Date('2026-08-31T20:00:00Z'))).toBe('2026-09-01'))
  it.each([['2026-02', '2026-02-28'], ['2024-02', '2024-02-29'], ['2026-04', '2026-04-30']])('clamps the 31st in %s', (period, due) => expect(dueDateForPeriod('2026-01-31', period)).toBe(due))
  it('preserves year boundaries', () => expect(nextPeriod('2026-12')).toBe('2027-01'))
  it('rejects invalid calendar input', () => { expect(validDate('2026-02-31')).toBe(false); expect(() => dueDateForPeriod('invalid', '2026-09')).toThrow() })
})
