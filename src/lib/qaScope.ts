/** Safety assertion for owner-authorized QA only; not an authorization/RLS replacement. */
export const QA_BRANCH_ID = 'd1512e15-8151-41b3-b77e-64ff88878add'
export const QA_RECORD_PREFIX = 'PG95-QA-20260920-'

export function assertQaBranch(branch: { id: string; name: string }) {
  if (branch.id !== QA_BRANCH_ID || branch.name.trim().toLowerCase() !== 'pg 95') {
    throw new Error('QA safety stop: only the explicitly approved PG 95 branch is allowed.')
  }
}

export function assertQaRecord(branch: { id: string; name: string }, record: { id: string; branchId: string; label: string }, createdRecordIds: ReadonlySet<string>) {
  assertQaBranch(branch)
  if (record.branchId !== branch.id || !record.label.startsWith(QA_RECORD_PREFIX) || !createdRecordIds.has(record.id)) {
    throw new Error('QA safety stop: existing or untracked records must not be changed.')
  }
}
