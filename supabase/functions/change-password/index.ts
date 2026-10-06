// POST { current_password, new_password } — the signed-in user changes their own password.
// Enforces the password policy + breach check and clears must_change_password.
// (Other devices can be signed out with "Log out all devices" in the user menu.)
import { admin, anon, callerId } from '../_shared/clients.ts'
import { checkPassword, guard, json, usernameToEmail } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const early = guard(req)
  if (early) return early

  const me = await callerId(req)
  if (!me) return json(req, { error: 'Not signed in' }, 401)

  const body = await req.json().catch(() => null) as { current_password?: unknown; new_password?: unknown } | null
  const current = typeof body?.current_password === 'string' ? body.current_password : ''
  const next = typeof body?.new_password === 'string' ? body.new_password : ''

  const { data: profile } = await admin.from('profiles').select('username, is_active').eq('id', me).single()
  if (!profile?.is_active) return json(req, { error: 'Account inactive' }, 403)

  const { error: authErr } = await anon().auth.signInWithPassword({ email: usernameToEmail(profile.username), password: current })
  if (authErr) return json(req, { error: 'Current password is incorrect.' }, 400)
  if (current === next) return json(req, { error: 'New password must be different from the current one.' }, 400)

  const pwErr = await checkPassword(next, profile.username)
  if (pwErr) return json(req, { error: pwErr }, 400)

  const { error } = await admin.auth.admin.updateUserById(me, { password: next })
  if (error) return json(req, { error: error.message }, 500)
  await admin.from('profiles').update({ must_change_password: false }).eq('id', me)
  await admin.rpc('svc_audit', { p_actor: me, p_action: 'password_change', p_entity: 'profile', p_entity_id: me, p_meta: {} })
  return json(req, { ok: true })
})
