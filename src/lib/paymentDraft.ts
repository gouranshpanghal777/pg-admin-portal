export const DRAFT_PREFIX = 'pg95:payment-draft:v1:'
export const DRAFT_TTL = 24 * 60 * 60 * 1000
export type PaymentDraft = {
  requestId: string; tenantId: string; paymentMode: string; paymentDate: string;
  rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number;
  description: string; attempted: boolean; rentPeriod?: string;
}
export const paymentDraftKey = (user: string, branch: string, tenant: string) => DRAFT_PREFIX + JSON.stringify([user, branch, tenant || 'new'])
export function decodePaymentDraft(raw: string | null, now = Date.now()): PaymentDraft | undefined {
  try {
    if (!raw) return
    const envelope = JSON.parse(raw)
    if (envelope.version !== 1 || !Number.isFinite(envelope.savedAt) || now - envelope.savedAt > DRAFT_TTL || envelope.savedAt > now) return
    const d = envelope.value
    if (!d || !/^[a-f0-9-]{36}$/i.test(d.requestId) || typeof d.tenantId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.paymentDate)) return
    if (!['Cash', 'UPI', 'Bank Transfer', 'Card'].includes(d.paymentMode) || typeof d.attempted !== 'boolean' || typeof d.description !== 'string') return
    if (![d.rentAmount, d.securityAmount, d.electricityAmount, d.otherAmount].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return
    // Explicit allowlist prevents passwords, identity documents or unexpected fields restoring.
    return { requestId: d.requestId, tenantId: d.tenantId, paymentMode: d.paymentMode, paymentDate: d.paymentDate, rentAmount: d.rentAmount, securityAmount: d.securityAmount, electricityAmount: d.electricityAmount, otherAmount: d.otherAmount, description: d.description.slice(0, 2000), attempted: d.attempted, rentPeriod: typeof d.rentPeriod === 'string' && /^\d{4}-\d{2}$/.test(d.rentPeriod) ? d.rentPeriod : undefined }
  } catch { return }
}
export function encodePaymentDraft(value: PaymentDraft, now = Date.now()) {
  return JSON.stringify({ version: 1, savedAt: now, value })
}
export function purgePaymentDrafts(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (key?.startsWith(DRAFT_PREFIX)) storage.removeItem(key)
  }
}
