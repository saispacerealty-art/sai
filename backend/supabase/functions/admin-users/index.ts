// POST { action, ... } — employee account management (Employees page).
//   create          { full_name, username, role, manager_id?, phone?, temp_password, overrides? }
//   update          { user_id, full_name?, role?, manager_id?, scope_override?, is_active?, overrides? }
//   reset_password  { user_id, temp_password }
//   unlock          { user_id }
// Rules: caller needs `employees.manage`; nobody edits their own role/permissions/status;
// only the Owner may create or modify Admins; nobody can create another Owner.
import { z } from 'npm:zod@4'
import { admin, asCaller, callerId } from '../_shared/clients.ts'
import { checkPassword, guard, json, USERNAME_RE, usernameToEmail } from '../_shared/http.ts'

const PERM_KEYS = [
  'dashboard', 'leads', 'projects', 'visits', 'bookings', 'clients', 'tasks', 'attendance', 'tracking',
  'employees', 'incentives', 'reports', 'settings', 'leads.assign', 'leads.delete', 'leads.import',
  'leads.export', 'leads.view_contact', 'projects.edit', 'bookings.approve', 'incentives.approve',
  'employees.manage', 'read_only',
] as const

const Role = z.enum(['admin', 'manager', 'sales', 'telecaller', 'marketing', 'analyst', 'team_member'])
const Overrides = z.record(z.enum(PERM_KEYS), z.boolean()).optional()
const Id = z.uuid()

const Create = z.object({
  action: z.literal('create'),
  full_name: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(USERNAME_RE),
  role: Role,
  manager_id: Id.nullish(),
  phone: z.string().trim().regex(/^[+\d\s-]{10,16}$/).nullish(),
  scope_override: z.enum(['own', 'team', 'all']).nullish(),
  temp_password: z.string(),
  overrides: Overrides,
})
const Update = z.object({
  action: z.literal('update'),
  user_id: Id,
  full_name: z.string().trim().min(2).max(80).optional(),
  role: Role.optional(),
  manager_id: Id.nullish(),
  scope_override: z.enum(['own', 'team', 'all']).nullish(),
  is_active: z.boolean().optional(),
  phone: z.string().trim().regex(/^[+\d\s-]{10,16}$/).nullish(),
  overrides: Overrides,
})
const Reset = z.object({ action: z.literal('reset_password'), user_id: Id, temp_password: z.string() })
const Unlock = z.object({ action: z.literal('unlock'), user_id: Id })
const Body = z.discriminatedUnion('action', [Create, Update, Reset, Unlock])

const fail = (req: Request, msg: string, status = 400) => json(req, { error: msg }, status)

Deno.serve(async (req) => {
  const early = guard(req)
  if (early) return early

  const me = await callerId(req)
  if (!me) return fail(req, 'Not signed in', 401)
  const { data: allowed } = await asCaller(req).rpc('has_perm', { p_key: 'employees.manage' })
  if (allowed !== true) return fail(req, 'You do not have permission to manage employees', 403)

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(req, 'Invalid input: ' + parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '))
  const b = parsed.data

  const { data: caller } = await admin.from('profiles').select('role').eq('id', me).single()
  const callerIsOwner = caller?.role === 'owner'

  const loadTarget = async (id: string) =>
    (await admin.from('profiles').select('id, username, role').eq('id', id).maybeSingle()).data

  const checkManager = async (id: string | null | undefined) => {
    if (!id) return true
    const { data } = await admin.from('profiles').select('is_active').eq('id', id).maybeSingle()
    return data?.is_active === true
  }

  const writeOverrides = async (userId: string, ov: Record<string, boolean> | undefined) => {
    if (!ov) return
    await admin.from('user_overrides').delete().eq('user_id', userId)
    const rows = Object.entries(ov).map(([key, allowed]) => ({ user_id: userId, key, allowed }))
    if (rows.length) await admin.from('user_overrides').insert(rows)
  }

  const audit = (action: string, target: string, meta: Record<string, unknown>) =>
    admin.rpc('svc_audit', { p_actor: me, p_action: action, p_entity: 'profile', p_entity_id: target, p_meta: meta })

  // ---------------- create ----------------
  if (b.action === 'create') {
    if (b.role === 'admin' && !callerIsOwner) return fail(req, 'Only the Owner can create Admin accounts', 403)
    if (!(await checkManager(b.manager_id))) return fail(req, 'Selected manager is not an active employee')
    const pwErr = await checkPassword(b.temp_password, b.username)
    if (pwErr) return fail(req, pwErr)
    const { data: taken } = await admin.from('profiles').select('id').eq('username', b.username).maybeSingle()
    if (taken) return fail(req, 'That username is already taken', 409)

    const { data: created, error } = await admin.auth.admin.createUser({
      email: usernameToEmail(b.username),
      password: b.temp_password,
      email_confirm: true,
      user_metadata: { username: b.username },
    })
    if (error || !created.user) return fail(req, 'Could not create the login: ' + (error?.message ?? 'unknown'), 500)
    const uid = created.user.id

    const { error: pErr } = await admin.from('profiles').insert({
      id: uid, username: b.username, full_name: b.full_name, role: b.role,
      manager_id: b.manager_id ?? null, scope_override: b.scope_override ?? null, must_change_password: true,
    })
    if (pErr) {
      await admin.auth.admin.deleteUser(uid)
      return fail(req, 'Could not create the profile: ' + pErr.message, 500)
    }
    if (b.phone) await admin.rpc('svc_set_profile_phone', { p_user: uid, p_phone: b.phone })
    await writeOverrides(uid, b.overrides)
    await audit('employee_create', uid, { username: b.username, role: b.role, overrides: b.overrides ?? {} })
    return json(req, { ok: true, user_id: uid })
  }

  // ---------------- actions on an existing user ----------------
  const target = await loadTarget(b.user_id)
  if (!target) return fail(req, 'Employee not found', 404)
  if (target.role === 'owner' && !callerIsOwner) return fail(req, 'Only the Owner can change the Owner account', 403)
  if (target.role === 'admin' && !callerIsOwner) return fail(req, 'Only the Owner can change Admin accounts', 403)

  if (b.action === 'update') {
    const self = b.user_id === me
    if (self && (b.role !== undefined || b.overrides !== undefined || b.is_active !== undefined || b.scope_override !== undefined))
      return fail(req, 'You cannot change your own role, permissions or status', 403)
    if (b.role === 'admin' && !callerIsOwner) return fail(req, 'Only the Owner can grant the Admin role', 403)
    if (target.role === 'owner' && b.role !== undefined) return fail(req, 'The Owner role cannot be changed here', 403)
    if (b.manager_id === b.user_id) return fail(req, 'An employee cannot be their own manager')
    if (!(await checkManager(b.manager_id))) return fail(req, 'Selected manager is not an active employee')

    const patch: Record<string, unknown> = {}
    if (b.full_name !== undefined) patch.full_name = b.full_name
    if (b.role !== undefined) patch.role = b.role
    if (b.manager_id !== undefined) patch.manager_id = b.manager_id
    if (b.scope_override !== undefined) patch.scope_override = b.scope_override
    if (b.is_active !== undefined) patch.is_active = b.is_active
    if (Object.keys(patch).length) {
      const { error } = await admin.from('profiles').update(patch).eq('id', b.user_id)
      if (error) return fail(req, error.message, 500)
    }
    if (b.phone !== undefined) await admin.rpc('svc_set_profile_phone', { p_user: b.user_id, p_phone: b.phone ?? '' })
    await writeOverrides(b.user_id, b.overrides)

    if (b.is_active === false) {
      await admin.auth.admin.updateUserById(b.user_id, { ban_duration: '876000h' })
      await admin.rpc('svc_revoke_sessions', { p_user: b.user_id })
    } else if (b.is_active === true) {
      await admin.auth.admin.updateUserById(b.user_id, { ban_duration: 'none' })
    }
    const permChange = b.role !== undefined || b.overrides !== undefined || b.scope_override !== undefined || b.is_active !== undefined
    await audit(permChange ? 'perm_change' : 'employee_update', b.user_id, { ...patch, overrides: b.overrides })
    return json(req, { ok: true })
  }

  if (b.action === 'reset_password') {
    if (b.user_id === me) return fail(req, 'Use “Change password” for your own account', 403)
    const pwErr = await checkPassword(b.temp_password, target.username)
    if (pwErr) return fail(req, pwErr)
    const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.temp_password })
    if (error) return fail(req, error.message, 500)
    await admin.from('profiles').update({ must_change_password: true, failed_logins: 0, locked_until: null }).eq('id', b.user_id)
    await admin.rpc('svc_revoke_sessions', { p_user: b.user_id })
    await audit('password_reset', b.user_id, {})
    return json(req, { ok: true })
  }

  // unlock
  await admin.from('profiles').update({ failed_logins: 0, locked_until: null }).eq('id', b.user_id)
  await audit('account_unlock', b.user_id, {})
  return json(req, { ok: true })
})
