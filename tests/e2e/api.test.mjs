#!/usr/bin/env node
// End-to-end checks against the LOCAL Supabase stack (after scripts/seed-dev.mjs):
//   node --env-file=.env.scripts.local tests/e2e/api.test.mjs
// Covers the Edge Functions that the database tests cannot reach:
// CORS allowlist, lead-intake webhook auth + rate limit, document upload + download.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { enrollTotp, verifyTotp } from '../../scripts/lib/totp-dev.mjs'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ ?? '')) throw new Error('local stack only')
const creds = JSON.parse(fs.readFileSync(new URL('../../scripts/.dev-users.json', import.meta.url), 'utf8')).users
const ORIGIN = 'http://localhost:5173'

let pass = 0
const fails = []
const ok = (c, label) => { if (c) pass++; else fails.push(label); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}`) }

async function call(name, { body, token, origin = ORIGIN, headers = {}, raw, query = '' } = {}) {
  const res = await fetch(`${URL_}/functions/v1/${name}${query}`, {
    method: 'POST',
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(origin ? { Origin: origin } : {}), apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => ({})), cors: res.headers.get('access-control-allow-origin') }
}
async function signIn(who) {
  const r = await call('login', { body: { username: creds[who].username, password: creds[who].password } })
  if (r.status !== 200) throw new Error(`login ${who}: ${r.status} ${JSON.stringify(r.json)}`)
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await c.auth.setSession(r.json.session)
  if (creds[who].totp_secret) await verifyTotp(c, creds[who].totp_secret)
  c.token = async () => (await c.auth.getSession()).data.session.access_token
  return c
}

console.log('\n# Origin allowlist (enforced inside the function, not only by CORS headers)')
{
  // The LOCAL dev gateway (Kong) adds its own "Access-Control-Allow-Origin: *" and answers
  // preflights itself, so header values can only be verified on the hosted project (docs/DEPLOY.md).
  // What matters everywhere: the function itself refuses requests coming from other websites.
  const good = await call('login', { body: { username: 'nobody', password: 'x' } })
  ok(good.status === 401, 'allowed origin reaches the function (401 = bad credentials)')
  const evil = await call('login', { body: { username: 'nobody', password: 'x' }, origin: 'https://evil.example' })
  ok(evil.status === 403 && evil.json.error === 'Origin not allowed', 'another website is refused by the function (403)')
  const evil2 = await call('admin-users', { body: { action: 'unlock', user_id: '00000000-0000-4000-8000-000000000000' }, origin: 'https://evil.example', token: 'x' })
  ok(evil2.status === 403 || evil2.status === 401, 'admin function is not reachable from another website')
  ok(good.json.error === 'Invalid username or password.', 'unknown user gets the same generic message')
}

// A throw-away Admin with its own authenticator stands in for the Owner, so these
// tests never touch the real Owner account or the authenticator on their phone.
const service = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const tmpName = 'tmp_admin_' + Date.now().toString(36)
const tmpPass = 'Tmp' + crypto.randomBytes(9).toString('base64url') + '9x'
const tmpUser = (await service.auth.admin.createUser({ email: `${tmpName}@staff.saispace-crm.local`, password: tmpPass, email_confirm: true })).data.user
await service.from('profiles').insert({ id: tmpUser.id, username: tmpName, full_name: 'Temp Admin', role: 'admin', must_change_password: false })
creds[tmpName] = { username: tmpName, password: tmpPass }
const owner = await signIn(tmpName)
await enrollTotp(owner)
const bikash = await signIn('bikash')
const tele = await signIn('sanjay_tc')

console.log('\n# Lead-intake webhook')
{
  const hook = (await owner.rpc('create_webhook', { p_source: 'Website ' + Date.now().toString().slice(-5), p_owner: null, p_project: null })).data
  ok(!!hook?.secret, 'owner creates a webhook')
  const q = `?id=${hook.id}`
  const phone = '9' + String(Date.now()).slice(-9)
  const body = JSON.stringify({ full_name: 'Webhook Lead', mobile: phone, message: 'Interested in 2 BHK' })
  const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex')

  ok((await call('lead-intake', { raw: body, query: q, origin: null, headers: { 'Content-Type': 'application/json' } })).status === 401, 'no secret -> 401')
  ok((await call('lead-intake', { raw: body, query: q, origin: null, headers: { 'X-Webhook-Secret': 'wrong' } })).status === 401, 'wrong secret -> 401')
  ok((await call('lead-intake', { raw: body, query: '?id=00000000-0000-4000-8000-000000000000', origin: null, headers: { 'X-Webhook-Secret': hook.secret } })).status === 401, 'unknown webhook id looks the same as a wrong secret')
  ok((await call('lead-intake', { raw: body, query: q, headers: { 'X-Webhook-Secret': hook.secret } })).status === 403, 'browser (Origin header) -> 403')
  const a = await call('lead-intake', { raw: body, query: q, origin: null, headers: { 'X-Signature': sig } })
  ok(a.status === 200 && a.json.duplicate === false, 'valid HMAC signature -> lead created')
  const b = await call('lead-intake', { raw: body, query: q, origin: null, headers: { 'X-Webhook-Secret': hook.secret } })
  ok(b.status === 200 && b.json.duplicate === true, 'same phone again (shared secret) -> duplicate, not a second lead')
  ok((await call('lead-intake', { raw: body + ' ', query: q, origin: null, headers: { 'X-Signature': sig } })).status === 401, 'tampered body fails the signature')
  ok((await call('lead-intake', { raw: JSON.stringify({ name: 'Bad', phone: '123' }), query: q, origin: null, headers: { 'X-Webhook-Secret': hook.secret } })).status === 422, 'invalid phone -> 422')
  const found = (await owner.rpc('find_lead_by_phone', { p_phone: phone })).data
  const lead = (await owner.from('leads').select('name, source, owner_id').eq('id', found).single()).data
  ok(lead?.name === 'Webhook Lead' && lead.source.startsWith('Website') && !!lead.owner_id, 'lead stored with source and auto-assigned owner')

  let limited = 0
  for (let i = 0; i < 62; i++) {
    const r = await call('lead-intake', { raw: body, query: q, origin: null, headers: { 'X-Webhook-Secret': hook.secret } })
    if (r.status === 429) limited++
  }
  ok(limited >= 1, `rate limit kicks in after 60 requests a minute (${limited} refused)`)
  await owner.rpc('set_webhook', { p_id: hook.id, p_active: false, p_delete: true })
}

console.log('\n# Document upload & download')
{
  const clients = (await bikash.rpc('list_clients')).data
  ok(clients?.length >= 1, 'sales person has a client')
  const c = clients[0]
  const upload = async (who, bytes, name, leadId = c.lead_id) => {
    const form = new FormData()
    form.append('file', new Blob([bytes]), name)
    form.append('lead_id', leadId)
    form.append('booking_id', c.booking_id)
    form.append('type', 'kyc')
    const res = await fetch(`${URL_}/functions/v1/upload-document`, { method: 'POST', headers: { Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${await who.token()}` }, body: form })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%test\n'), crypto.randomBytes(200)])
  const exe = Buffer.concat([Buffer.from('MZ\x90\x00'), crypto.randomBytes(200)])
  const up = await upload(bikash, pdf, 'pan card <script>.pdf')
  ok(up.status === 200 && !!up.json.id, 'real PDF uploads')
  ok((await upload(bikash, exe, 'invoice.pdf')).status === 415, 'an .exe renamed to .pdf is rejected (checked by content)')
  ok((await upload(tele, pdf, 'x.pdf')).status === 403, 'telecaller cannot upload documents')
  ok((await upload(bikash, pdf, 'x.pdf', '00000000-0000-4000-8000-000000000000')).status === 403, 'cannot upload against a lead you cannot see')

  const doc = (await bikash.from('documents').select('id, file_name, file_path, mime').eq('id', up.json.id).single()).data
  ok(doc?.file_name === 'pan card _script_.pdf' && doc.mime === 'application/pdf', 'file name sanitised; type taken from content')
  const direct = await bikash.storage.from('documents').upload(`${c.lead_id}/hack.pdf`, pdf, { contentType: 'application/pdf' })
  ok(!!direct.error, 'browser cannot write to the bucket directly')
  const path = (await bikash.rpc('log_document_download', { p_document: doc.id })).data
  const signed = await bikash.storage.from('documents').createSignedUrl(path, 300)
  const got = signed.data ? await fetch(signed.data.signedUrl) : null
  ok(got?.status === 200 && Buffer.from(await got.arrayBuffer()).equals(pdf), 'owner of the client gets a working 5-minute link')
  ok(!!(await tele.storage.from('documents').createSignedUrl(path, 300)).error, 'someone without access cannot get a link')
  const pub = await fetch(`${URL_}/storage/v1/object/public/documents/${path}`)
  ok(pub.status >= 400, 'no public URL exists for the file')
  const audit = (await owner.rpc('audit_feed', { p_limit: 30 })).data
  ok(audit.some((a) => a.action === 'document_upload') && audit.some((a) => a.action === 'download'), 'upload and download are in the audit log')
}

await service.auth.admin.deleteUser(tmpUser.id)

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) { fails.forEach((f) => console.log('  FAILED:', f)); process.exit(1) }
