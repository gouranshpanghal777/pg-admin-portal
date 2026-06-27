import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = request.headers.get('Authorization')!
    const caller = createClient(url, serviceKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) throw new Error('Unauthorized')
    const admin = createClient(url, serviceKey)
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') throw new Error('Admin access required')

    const body = await request.json()
    if (body.deactivate && body.id) {
      await admin.from('profiles').update({ active: false }).eq('id', body.id)
      const { error } = await admin.auth.admin.updateUserById(body.id, { ban_duration: '876000h' })
      if (error) throw error
      return new Response(JSON.stringify({ id: body.id }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const email = body.email || `${body.username}@staff.pg95.local`
    let id = body.id as string | undefined
    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, { email, password: body.password || undefined, user_metadata: { name: body.name, role: 'staff' } })
      if (error) throw error
      await admin.from('branch_assignments').delete().eq('user_id', id)
      await admin.from('staff_permissions').delete().eq('user_id', id)
    } else {
      const { data: created, error: authError } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { name: body.name, role: 'staff' } })
      if (authError) throw authError
      id = created.user.id
    }
    await admin.from('profiles').update({ name: body.name, phone: body.phone, role: 'staff', active: true }).eq('id', id)
    await admin.from('staff_members').upsert({ id, email, username: body.username, created_by: user.id })
    if (body.branchIds?.length) await admin.from('branch_assignments').insert(body.branchIds.map((branch_id: string) => ({ user_id: id, branch_id, assigned_by: user.id })))
    if (body.permissions?.length) await admin.from('staff_permissions').insert(body.permissions.map((permission: string) => ({ user_id: id, permission, allowed: true, updated_by: user.id })))
    return new Response(JSON.stringify({ id }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
