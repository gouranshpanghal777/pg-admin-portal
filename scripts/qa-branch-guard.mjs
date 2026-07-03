const PROTECTED_BRANCH_NAME = 'pg 95 farukhnagar'
const PROTECTED_ADDRESS_FRAGMENT = 'farukhnagar'

export function assertQaBranch(branch, expectedBranchId) {
  if (!branch?.id || !expectedBranchId || branch.id !== expectedBranchId) {
    throw new Error('QA SAFETY STOP: selected branch ID does not match the approved test branch ID.')
  }

  const name = String(branch.name || '').trim().toLowerCase()
  const address = String(branch.address || '').trim().toLowerCase()
  if (name === PROTECTED_BRANCH_NAME || name.includes('farukhnagar') || address.includes(PROTECTED_ADDRESS_FRAGMENT)) {
    throw new Error('QA SAFETY STOP: PG 95 Farukhnagar is read-only and cannot receive test mutations.')
  }
  if (name !== 'pg 95') {
    throw new Error(`QA SAFETY STOP: expected the PG 95 test branch, received "${branch.name || 'unknown'}".`)
  }
  return branch
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, name, address, expectedId] = process.argv.slice(2)
  assertQaBranch({ id, name, address }, expectedId)
  console.log(`QA branch guard passed for ${name} (${id}).`)
}
