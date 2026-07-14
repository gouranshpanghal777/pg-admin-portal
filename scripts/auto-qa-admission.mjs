#!/usr/bin/env node
/**
 * Auto-QA: Tenant Admission Idempotency + Rent Collection Summary
 *
 * 1. Signs in as admin
 * 2. Admits a test tenant with a stable request ID
 * 3. Verifies exactly one tenant was created
 * 4. Retries with the SAME request ID → proves idempotency (returns same tenant, no duplicate)
 * 5. Calls get_branch_rent_collection_summary and validates the response shape
 * 6. Cleans up all test records
 */

const SUPABASE_URL = 'https://jgurmuvshaqmwjypiqtl.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpndXJtdXZzaGFxbXdqeXBpcXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTEyMDIsImV4cCI6MjA5ODEyNzIwMn0.-BO_-w97ghJbmj4kUPM1M-rRaUe9cRYnbCg2zlB4dEw'

const headers = () => ({
  'Content-Type': 'application/json',
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${globalThis._accessToken}`,
})

let pass = 0
let fail = 0

function assert(condition, message) {
  if (condition) { pass++; console.log(`  ✓ ${message}`) }
  else { fail++; console.error(`  ✗ ${message}`) }
}

async function gql(operationName, query, variables) {
  const res = await fetch(`${SUPABASE_URL.replace('/rest/v1/', '')}/graphql/v1`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ operationName, query, variables }),
  })
  return res.json()
}

async function rest(table, method, body, params = '') {
  const res = await fetch(`${SUPABASE_URL}/${table}?${params}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${table} failed: ${res.status} ${await res.text()}`)
  if (method === 'DELETE') return null
  return res.json()
}

async function rpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL.replace('/rest/v1/', '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL.replace('/rest/v1/', '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Sign-in failed: ${JSON.stringify(data)}`)
  globalThis._accessToken = data.access_token
  return data
}

async function main() {
  console.log('\n=== Auto-QA: Admission Idempotency + Rent Summary ===\n')

  // Sign in
  console.log('1. Signing in as admin...')
  await signIn('admin@pg95.local', 'Admin@12345')
  assert(true, 'Admin sign-in succeeded')

  // Get a test branch
  const branches = await rest('branches', 'GET', null, 'select=id,name&active=eq.true&limit=1')
  assert(branches.length > 0, `Found branch: ${branches[0].name}`)
  const branchId = branches[0].id

  // Get a vacant room
  const rooms = await rest('rooms', 'GET', null, `select=id,number,beds,branch_id&branch_id=eq.${branchId}&status=eq.Vacant&limit=1`)
  assert(rooms.length > 0, `Found vacant room: ${rooms[0].number}`)
  const roomId = rooms[0].id

  const stableRequestId = crypto.randomUUID()
  const paymentRequestId = crypto.randomUUID()
  const testTenantName = `AUTO_QA_TENANT_${Date.now()}`

  console.log(`\n2. Admitting test tenant "${testTenantName}" (request_id: ${stableRequestId})...`)
  let tenantId
  try {
    tenantId = await rpc('admit_tenant_v2', {
      p_request_id: stableRequestId,
      p_branch_id: branchId,
      p_name: testTenantName,
      p_phone: '9999900000',
      p_email: '',
      p_room_id: roomId,
      p_bed_no: 1,
      p_joining_date: new Date().toISOString().slice(0, 10),
      p_due_date: new Date().toISOString().slice(0, 10),
      p_monthly_rent: 6500,
      p_security: 2500,
      p_electricity: 'Included',
      p_electricity_amount: 0,
      p_id_proof: '',
    })
    assert(typeof tenantId === 'string' && tenantId.length > 0, `Tenant admitted: ${tenantId}`)
  } catch (err) {
    assert(false, `Admission failed: ${err.message}`)
    process.exit(1)
  }

  console.log('\n3. Verifying exactly one tenant exists for this request_id...')
  const tenants1 = await rest('tenants', 'GET', null, `select=id,name,admission_request_id&admission_request_id=eq.${stableRequestId}`)
  assert(tenants1.length === 1, `Exactly 1 tenant found (got ${tenants1.length})`)
  assert(tenants1[0]?.name === testTenantName, `Tenant name matches: ${tenants1[0]?.name}`)

  console.log('\n4. Retrying with SAME request_id (idempotency test)...')
  let retryTenantId
  try {
    retryTenantId = await rpc('admit_tenant_v2', {
      p_request_id: stableRequestId,
      p_branch_id: branchId,
      p_name: testTenantName,
      p_phone: '9999900000',
      p_email: '',
      p_room_id: roomId,
      p_bed_no: 1,
      p_joining_date: new Date().toISOString().slice(0, 10),
      p_due_date: new Date().toISOString().slice(0, 10),
      p_monthly_rent: 6500,
      p_security: 2500,
      p_electricity: 'Included',
      p_electricity_amount: 0,
      p_id_proof: '',
    })
    assert(retryTenantId === tenantId, `Retry returned same tenant_id: ${retryTenantId} === ${tenantId}`)
  } catch (err) {
    assert(false, `Retry failed: ${err.message}`)
  }

  console.log('\n5. Verifying still exactly one tenant (no duplicates)...')
  const tenants2 = await rest('tenants', 'GET', null, `select=id&admission_request_id=eq.${stableRequestId}`)
  assert(tenants2.length === 1, `Still 1 tenant (got ${tenants2.length}) — no duplicates`)

  console.log('\n6. Verifying payment obligation was created...')
  const obligations = await rest('payment_obligations', 'GET', null, `select=id,period,payment_type,agreed_amount&tenant_id=eq.${tenantId}&payment_type=eq.rent`)
  assert(obligations.length >= 1, `At least 1 rent obligation created (got ${obligations.length})`)
  assert(obligations[0]?.agreed_amount === 6500, `Obligation agreed_amount = 6500`)

  console.log('\n7. Verifying activity log was created...')
  const logs = await rest('activity_logs', 'GET', null, `select=id,action_type,description&metadata->>tenant_id=eq.${tenantId}`)
  assert(logs.length >= 1, `Activity log created for admission`)

  console.log('\n8. Calling get_branch_rent_collection_summary RPC...')
  try {
    const summary = await rpc('get_branch_rent_collection_summary', {
      p_branch_id: branchId,
      p_as_of_date: new Date().toISOString().slice(0, 10),
    })
    assert(typeof summary === 'object' && summary !== null, 'RPC returned an object')
    assert('expected_till_month_end' in summary, 'Has expected_till_month_end')
    assert('pending_till_today' in summary, 'Has pending_till_today')
    assert('previous_months_pending' in summary, 'Has previous_months_pending')
    assert('current_month_total_outstanding' in summary, 'Has current_month_total_outstanding')
    assert('current_month_due_till_today' in summary, 'Has current_month_due_till_today')
    assert('current_month_not_yet_due' in summary, 'Has current_month_not_yet_due')
    assert('tenant_count_with_pending' in summary, 'Has tenant_count_with_pending')
    assert('calculated_at' in summary, 'Has calculated_at')
    assert(Number(summary.expected_till_month_end) >= 0, `expected_till_month_end >= 0: ${summary.expected_till_month_end}`)
    assert(Number(summary.pending_till_today) >= 0, `pending_till_today >= 0: ${summary.pending_till_today}`)
    assert(Number(summary.pending_till_today) <= Number(summary.expected_till_month_end), `pending_till_today <= expected_till_month_end`)
    console.log(`\n   Summary values:`)
    console.log(`   Expected Rent Till Month End: ₹${summary.expected_till_month_end}`)
    console.log(`   Pending Till Today: ₹${summary.pending_till_today}`)
    console.log(`   Previous Months Pending: ₹${summary.previous_months_pending}`)
    console.log(`   Current Month Total: ₹${summary.current_month_total_outstanding}`)
    console.log(`   Current Month Due Today: ₹${summary.current_month_due_till_today}`)
    console.log(`   Current Month Not Yet Due: ₹${summary.current_month_not_yet_due}`)
    console.log(`   Tenants with pending: ${summary.tenant_count_with_pending}`)
  } catch (err) {
    assert(false, `RPC call failed: ${err.message}`)
  }

  console.log('\n9. Cleaning up test records...')
  // Delete admission request
  await rest('admission_requests', 'DELETE', null, `request_id=eq.${stableRequestId}`)
  // Delete payment obligations for this tenant
  await rest('payment_obligations', 'DELETE', null, `tenant_id=eq.${tenantId}`)
  // Delete activity logs for this tenant
  await rest('activity_logs', 'DELETE', null, `metadata->>tenant_id=eq.${tenantId}`)
  // Delete the test tenant
  await rest('tenants', 'DELETE', null, `id=eq.${tenantId}`)
  assert(true, 'Test records cleaned up')

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => { console.error('Test failed:', err); process.exit(1) })
