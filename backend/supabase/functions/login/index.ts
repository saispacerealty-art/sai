// POST { username, password } -> { session } | { error }
// Username/password sign-in with per-account lockout and per-IP throttling.
// Deployed with verify_jwt = false (the caller isn't signed in yet).
import { admin, anon } from '../_shared/clients.ts'
import { clientIp, guard, json, USERNAME_RE, usernameToEmail } from '../_shared/http.ts'

const GENERIC = 'Invalid username or password.'

Deno.serve(async (req) => {
  const early = guard(req)
  if (early) return early

  let body: { username?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'Bad request' }, 400)
  }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 200) {
    return json(req, { error: GENERIC }, 401)
  }
  const ip = clientIp(req)

  const { data: gate, error: gateErr } = await admin.rpc('login_gate', { p_username: username, p_ip: ip })
  if (gateErr) return json(req, { error: 'Sign-in is unavailable. Try again shortly.' }, 503)
  if (gate === 'ip_blocked') return json(req, { error: 'Too many failed attempts. Try again in 15 minutes.' }, 429)
  if (gate === 'locked') return json(req, { error: 'Account temporarily locked after failed attempts. Try again in 15 minutes.' }, 423)
  if (gate === 'inactive') {
    await admin.rpc('login_record', { p_username: username, p_ip: ip, p_success: false })
    return json(req, { error: GENERIC }, 401)   // don't reveal that the account exists
  }

  const { data, error } = await anon().auth.signInWithPassword({ email: usernameToEmail(username), password })
  await admin.rpc('login_record', { p_username: username, p_ip: ip, p_success: !error && !!data.session })
  if (error || !data.session) return json(req, { error: GENERIC }, 401)

  const { access_token, refresh_token, expires_in, expires_at } = data.session
  return json(req, { session: { access_token, refresh_token, expires_in, expires_at } })
})
