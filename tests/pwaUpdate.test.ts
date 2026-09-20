import { expect, it } from 'vitest'
import { canActivateUpdate } from '../src/lib/pwaUpdate'
it('blocks updates while any form or dialog is open', () => {
  expect(canActivateUpdate(true, false)).toBe(false)
  expect(canActivateUpdate(false, true)).toBe(false)
  expect(canActivateUpdate(true, true)).toBe(false)
  expect(canActivateUpdate(false, false)).toBe(true)
})
