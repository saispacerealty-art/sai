#!/usr/bin/env node
// Authenticator-app two-step verification for Owner/Admin (local stack):
//   node --env-file=.env.scripts.local tests/e2e/totp-mfa.test.mjs
// Uses a throw-away Admin so the real Owner's registered app is never touched.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { totp } from '../../scripts/lib/totp-dev.mjs'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ ?? '')) throw new Error('local stack only')
const service = createClient(URL_, SERVICE, { auth: { persistSession: false } })

let pass = 0
const fails = []
const ok = (c, label) => { if (c) pass++; else fails.push(label); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}`) }

async function signIn(username, password) {
  const res = await fetch(`${URL_}/functions/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', apikey: ANON },
    body: JSON.stringify({ username, password }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error('login: ' + JSON.stringify(j))
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await c.auth.setSession(j.session)
  return c
}
const claims = async (c) => JSON.parse(Buffer.from((await c.auth.getSession()).data.session.access_token.split('.')[1], 'base64url').toString())

// throw-away Admin account
const username = 'tmp_admin_' + Date.now().toString(36)
const password = 'Tmp' + crypto.randomBytes(9).toString('base64url') + '9x'
const { data: created } = await service.auth.admin.createUser({ email: `${username}@staff.saispace-crm.local`, password, email_confirm: true })
const uid = created.user.id
await service.from('profiles').insert({ id: uid, username, full_name: 'Temp Admin', role: 'admin', must_change_password: false })

try {
  console.log('\n# First sign-in: set up the authenticator')
  let c = await signIn(username, password)
  let me = (await c.rpc('my_permissions')).data
  ok(me.granted.length === 0 && me.mfa_ok === false, 'password alone gives nothing and asks for two-step setup')
  const sms = await c.auth.mfa.enroll({ factorType: 'phone', phone: '+919999988888' })
  ok(!!sms.error, 'SMS/phone codes are refused: ' + (sms.error?.message ?? 'no error').slice(0, 50))
  const enr = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator', issuer: 'Sai Space CRM' })
  ok(!enr.error && enr.data.totp.qr_code.startsWith('data:image/svg+xml') && /^[A-Z2-7]{16,}$/.test(enr.data.totp.secret), 'QR code and setup key are issued')
  ok(decodeURIComponent(enr.data.totp.uri).includes('issuer=Sai Space CRM'), 'the app will show the account as "Sai Space CRM"')
  const bad = await c.auth.mfa.challengeAndVerify({ factorId: enr.data.id, code: totp(enr.data.totp.secret) === '000000' ? '111111' : '000000' })
  ok(!!bad.error, 'a wrong code is rejected')
  const good = await c.auth.mfa.challengeAndVerify({ factorId: enr.data.id, code: totp(enr.data.totp.secret) })
  ok(!good.error, 'the app code verifies' + (good.error ? ': ' + good.error.message : ''))
  const cl = await claims(c)
  ok(cl.aal === 'aal2' && cl.amr.some((a) => a.method === 'totp'), 'session is aal2 via the authenticator')
  me = (await c.rpc('my_permissions')).data
  ok(me.mfa_ok === true && me.granted.includes('settings'), 'full Admin access after the code')

  console.log('\n# Next sign-in')
  c = await signIn(username, password)
  ok((await c.rpc('my_permissions')).data.granted.length === 0, 'a new sign-in again has nothing until the code')
  const f = (await c.auth.mfa.listFactors()).data.totp.find((x) => x.status === 'verified')
  ok(!!f, 'the registered app is remembered (no QR code again)')
  const second = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Another phone' })
  ok(!!second.error, 'nobody can add a second authenticator before passing the first one')
  await new Promise((r) => setTimeout(r, 1000))
  const v = await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(enr.data.totp.secret) })
  ok(!v.error && (await c.rpc('my_permissions')).data.granted.includes('settings'), 'the current app code signs in again')
} finally {
  await service.auth.admin.deleteUser(uid)
}

console.log(`\n${pass} passed, ${fails.length} failed`)
process.exit(fails.length ? 1 : 0)
