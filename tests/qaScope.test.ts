import { describe, expect, it } from 'vitest'
import { assertQaBranch, assertQaRecord, QA_BRANCH_ID, QA_RECORD_PREFIX } from '../src/lib/qaScope'

const branch = { id: QA_BRANCH_ID, name: 'pg 95 ' }
describe('owner-approved QA scope', () => {
  it('accepts only the verified branch ID and normalized exact name', () => {
    expect(() => assertQaBranch(branch)).not.toThrow()
    expect(() => assertQaBranch({ ...branch, name: 'PG 95 FARUKHNAGAR' })).toThrow('safety stop')
    expect(() => assertQaBranch({ ...branch, id: 'another-branch' })).toThrow('safety stop')
  })
  it('protects existing and cross-branch records even if labelled as samples', () => {
    const sample = { id: 'sample-id', branchId: QA_BRANCH_ID, label: `${QA_RECORD_PREFIX}TENANT-01` }
    const created = new Set(['sample-id'])
    expect(() => assertQaRecord(branch, sample, created)).not.toThrow()
    expect(() => assertQaRecord(branch, sample, new Set())).toThrow('safety stop')
    expect(() => assertQaRecord(branch, { ...sample, branchId: 'another' }, created)).toThrow('safety stop')
    expect(() => assertQaRecord(branch, { ...sample, label: 'Existing tenant' }, created)).toThrow('safety stop')
  })
})
