import { expect, it } from 'vitest'
import { decodePaymentDraft, encodePaymentDraft, paymentDraftKey, DRAFT_TTL, type PaymentDraft } from '../src/lib/paymentDraft'
const draft: PaymentDraft = { requestId: '12345678-1234-1234-1234-123456789abc', tenantId: 'tenant', paymentMode: 'Cash', paymentDate: '2026-09-20', rentAmount: 600, securityAmount: 0, electricityAmount: 0, otherAmount: 0, description: '', attempted: true }
it('restores the same request ID and values for retry after remount', () => {
  expect(decodePaymentDraft(encodePaymentDraft(draft, 100), 101)).toEqual(draft)
})
it('isolates user, branch and entity scopes', () => {
  expect(new Set([paymentDraftKey('a', 'b', 'c'), paymentDraftKey('b', 'b', 'c'), paymentDraftKey('a', 'd', 'c'), paymentDraftKey('a', 'b', 'd')]).size).toBe(4)
})
it('rejects expired, invalid and incompatible drafts', () => {
  expect(decodePaymentDraft(encodePaymentDraft(draft, 100), 101 + DRAFT_TTL)).toBeUndefined()
  expect(decodePaymentDraft('{bad')).toBeUndefined()
  expect(decodePaymentDraft(encodePaymentDraft({ ...draft, rentAmount: -1 }))).toBeUndefined()
  expect(decodePaymentDraft(JSON.stringify({ version: 2, savedAt: 100, value: draft }), 101)).toBeUndefined()
})
it('does not restore extra identity or credential fields', () => {
  const restored = decodePaymentDraft(encodePaymentDraft({ ...draft, password: 'not-allowed', idProof: 'not-allowed' } as PaymentDraft))
  expect(restored).not.toHaveProperty('password')
  expect(restored).not.toHaveProperty('idProof')
})
