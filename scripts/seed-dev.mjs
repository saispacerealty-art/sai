#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY. Fills the local Supabase with a test team and sample
// data by driving the real login / admin functions and RPCs (so it doubles as an
// end-to-end smoke test). Refuses to run against anything but localhost.
//
//   node --env-file=.env.scripts.local scripts/seed-dev.mjs
//
// Generated test credentials are written to scripts/.dev-users.json (git-ignored).
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { enrollTotp } from './lib/totp-dev.mjs'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SERVICE) throw new Error('Run with: node --env-file=.env.scripts.local scripts/seed-dev.mjs')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) throw new Error('seed-dev only runs against a local Supabase (http://127.0.0.1)')

const OUT = new URL('./.dev-users.json', import.meta.url)
const ORIGIN = 'http://localhost:5173'
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
const log = (...a) => console.log(' ', ...a)

// ---- helpers ----
const pw = () => 'Dev' + crypto.randomBytes(9).toString('base64url') + '7a'
async function fn(name, body, token, attempt = 1) {
  const res = await fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${token ?? ANON}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  // the local runtime answers 502/503 while it compiles a function for the first time
  if ([502, 503, 504].includes(res.status) && attempt < 6) {
    await new Promise((r) => setTimeout(r, 2500))
    return fn(name, body, token, attempt + 1)
  }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${json.error ?? JSON.stringify(json)}`)
  return json
}
async function signIn(username, password) {
  const { session } = await fn('login', { username, password })
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await c.auth.setSession(session)
  c.token = async () => (await c.auth.getSession()).data.session.access_token
  return c
}
const must = async (p) => {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

// ---- 0. start clean? ----
const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
if (count > 0) {
  console.log(`Database already has ${count} users. Run "npx supabase db reset" first for a fresh seed.`)
  process.exit(0)
}
const creds = { note: 'LOCAL TEST ACCOUNTS ONLY', users: {} }

// ---- 1. owner (created the way scripts/create-owner.mjs does) ----
console.log('Owner')
creds.users.owner = { username: 'owner', password: pw(), role: 'owner' }
{
  const u = await must(admin.auth.admin.createUser({ email: 'owner@staff.saispace-crm.local', password: creds.users.owner.password, email_confirm: true }))
  await must(admin.from('profiles').insert({ id: u.user.id, username: 'owner', full_name: 'Hrushikesh Ghoti', role: 'owner', must_change_password: false }))
}
const owner = await signIn('owner', creds.users.owner.password)
log('login function OK')
{
  const before = await must(owner.rpc('my_permissions'))
  if (before.granted.length !== 0) throw new Error('owner should have NO permissions before MFA')
  log('owner has no permissions before MFA (as designed)')
  creds.users.owner.totp_secret = await enrollTotp(owner) // test only; a real Owner scans the QR code with their phone
  const after = await must(owner.rpc('my_permissions'))
  if (after.aal !== 'aal2' || !after.granted.includes('settings')) throw new Error('MFA upgrade failed')
  log('authenticator code verified -> full access')
}
const ownerId = (await owner.auth.getUser()).data.user.id

// ---- 2. team via the admin-users function, then each sets their own password ----
console.log('Team')
const team = [
  ['neha', 'Neha Kulkarni', 'manager', 'owner', '9822012323'],
  ['bikash', 'Bikash Bernwal', 'sales', 'neha', '9765432181'],
  ['rohit', 'Rohit Kumar', 'sales', 'neha', '9890011214'],
  ['sanjay_tc', 'Sanjay Rao', 'telecaller', 'neha', '9922334407'],
  ['aditi_dm', 'Aditi Verma', 'marketing', 'owner', '9011223362'],
  ['karan_an', 'Karan Mehta', 'analyst', 'owner', null],
]
const ids = { owner: ownerId }
const clients = { owner }
for (const [username, full_name, role, mgr, phone] of team) {
  const temp = pw()
  const r = await fn('admin-users', { action: 'create', username, full_name, role, manager_id: ids[mgr], phone, temp_password: temp }, await owner.token())
  ids[username] = r.user_id
  const c = await signIn(username, temp)
  const me = await must(c.rpc('my_permissions'))
  if (!me.must_change_password) throw new Error('new user should be forced to change password')
  const final = pw()
  await fn('change-password', { current_password: temp, new_password: final }, await c.token())
  clients[username] = await signIn(username, final)
  creds.users[username] = { username, password: final, role }
  log(`${username} (${role}) created, password changed`)
}
fs.writeFileSync(OUT, JSON.stringify(creds, null, 2))

// negative checks on the functions
const ownerToken = await owner.token()
const clients_nehaToken = await clients.neha.token()
for (const [label, p] of [
  ['weak password refused', () => fn('admin-users', { action: 'create', username: 'weak1', full_name: 'Weak', role: 'sales', temp_password: 'password' }, ownerToken)],
  ['breached password refused', () => fn('admin-users', { action: 'create', username: 'weak2', full_name: 'Weak', role: 'sales', temp_password: 'Password123' }, ownerToken)],
  ['manager cannot manage employees', () => fn('admin-users', { action: 'create', username: 'x1x', full_name: 'Nope', role: 'sales', temp_password: pw() }, clients_nehaToken)],
  ['owner cannot change own role', () => fn('admin-users', { action: 'update', user_id: ownerId, role: 'sales' }, ownerToken)],
  ['wrong password refused', () => fn('login', { username: 'bikash', password: 'nope-nope-nope' })],
]) {
  let refused = null
  await p().catch((e) => (refused = e.message))
  if (!refused) throw new Error('SHOULD HAVE BEEN REFUSED: ' + label)
  log(`${label}: "${refused.slice(0, 80)}"`)
}

// ---- 3. inventory (as the manager) ----
console.log('Inventory')
const mgr = clients.neha
const projects = {}
for (const [name, location, config, lo, hi, towers] of [
  ['Skyline Heights', 'Pimple Saudagar', '2 & 3 BHK', 7800000, 12500000, ['A', 'B']],
  ['Urban Nest', 'Wakad', '1 & 2 BHK', 5500000, 8900000, ['A']],
  ['Green Valley', 'Ravet', '2 & 3 BHK', 6800000, 11500000, ['A']],
]) {
  const p = await must(mgr.from('projects').insert({ name, location, config, price_min: lo, price_max: hi }).select('id').single())
  projects[name] = p.id
  for (const t of towers) {
    const tw = await must(mgr.from('towers').insert({ project_id: p.id, name: `Tower ${t}`, floors: 6 }).select('id').single())
    const n = await must(mgr.rpc('generate_units', { p_tower: tw.id, p_floor_from: 1, p_floor_to: 6, p_per_floor: 4, p_config: config.includes('3') ? '2 BHK' : '1 BHK', p_carpet: 780, p_price: lo + 400000 }))
    log(`${name} / Tower ${t}: ${n} units`)
  }
}

// ---- 4. leads (as the people who would really add them) ----
console.log('Leads')
const leadIds = {}
const mk = async (who, row) => {
  const r = await must(clients[who].rpc('create_lead', { p: row }))
  leadIds[row.name] = r.id
  return r
}
await mk('bikash', { name: 'Amit Sharma', phone: '9876543210', source: 'Referral', project_id: projects['Skyline Heights'], budget_min: 8000000, budget_max: 9500000, config_wanted: '2 BHK', note: 'Wants a higher floor, east facing.' })
await mk('bikash', { name: 'Rahul More', phone: '9765432109', source: 'Walk-in', project_id: projects['Green Valley'], budget_max: 12000000, config_wanted: '3 BHK' })
await mk('rohit', { name: 'Sneha Joshi', phone: '9890011223', source: 'Facebook', project_id: projects['Skyline Heights'], budget_max: 7800000 })
await mk('rohit', { name: 'Kiran Rao', phone: '9871234560', source: 'Website', budget_min: 20000000, budget_max: 23000000, config_wanted: '3 BHK' })
await mk('sanjay_tc', { name: 'Priya Patil', phone: '9822012345', source: 'Instagram', project_id: projects['Urban Nest'], budget_max: 6200000, note: 'Call back after 6 pm.' })
await mk('sanjay_tc', { name: 'Deepa Nair', phone: '9812309876', source: 'Website', budget_max: 5500000 })
await mk('neha', { name: 'Arvind Shah', phone: '9900887766', source: 'Referral', owner_id: ids.rohit, budget_min: 15000000 })
await mk('neha', { name: 'Meena Iyer', phone: '9876512345', source: '99acres', owner_id: ids.sanjay_tc, budget_max: 10000000 })
const dup = await must(clients.sanjay_tc.rpc('create_lead', { p: { name: 'Amit S', phone: '+91 98765 43210', source: 'Website' } }))
if (!dup.duplicate) throw new Error('duplicate phone should not create a second lead')
log('8 leads created; duplicate phone detected')
const imp = await must(clients.aditi_dm.rpc('import_leads', { p_rows: [
  { name: 'Pooja Nair', phone: '9000112233', source: 'Google Ads', budget_max: '31000000' },
  { name: 'S. Reddy', phone: '9855511122', source: 'Google Ads' },
  { name: 'Broken Row', phone: '12' },
] }))
log(`import: ${imp.created} created, ${imp.duplicates} duplicate, ${imp.rejected.length} rejected`)

// progress some leads
await must(clients.bikash.rpc('reveal_lead_contact', { p_lead: leadIds['Amit Sharma'], p_purpose: 'call' }))
await must(clients.bikash.rpc('add_lead_note', { p_lead: leadIds['Amit Sharma'], p_text: 'Spoke to him, visiting on the weekend with family.' }))
await must(clients.rohit.from('leads').update({ stage: 'contacted' }).eq('id', leadIds['Sneha Joshi']).select('id'))
await must(clients.rohit.from('leads').update({ stage: 'qualified' }).eq('id', leadIds['Kiran Rao']).select('id'))
await must(clients.sanjay_tc.from('leads').update({ stage: 'contacted', next_follow_up_at: new Date(Date.now() - 3600e3).toISOString() }).eq('id', leadIds['Priya Patil']).select('id'))
await must(clients.sanjay_tc.from('leads').update({ stage: 'lost', lost_reason: 'Budget' }).eq('id', leadIds['Deepa Nair']).select('id'))

// ---- 5. visits, booking, approval, payment ----
console.log('Visits & bookings')
const visit = await must(clients.bikash.from('site_visits').insert({ lead_id: leadIds['Amit Sharma'], project_id: projects['Skyline Heights'], scheduled_at: new Date(Date.now() - 2 * 3600e3).toISOString(), executive_id: ids.bikash }).select('id').single())
await must(clients.bikash.rpc('mark_visit_done', { p_visit: visit.id, p_lat: 18.5983, p_lng: 73.8007, p_feedback: 'Liked the sample flat. Negotiating on price.' }))
await must(clients.bikash.from('site_visits').insert({ lead_id: leadIds['Rahul More'], project_id: projects['Green Valley'], scheduled_at: new Date(Date.now() + 26 * 3600e3).toISOString(), executive_id: ids.bikash }).select('id'))
await must(clients.rohit.from('site_visits').insert({ lead_id: leadIds['Kiran Rao'], project_id: projects['Skyline Heights'], scheduled_at: new Date(Date.now() + 50 * 3600e3).toISOString(), executive_id: ids.rohit }).select('id'))
const unit = await must(clients.bikash.from('units').select('id, unit_no').eq('project_id', projects['Skyline Heights']).eq('unit_no', '402').limit(1).single())
await must(clients.bikash.rpc('hold_unit', { p_unit: unit.id }))
const booking = await must(clients.bikash.rpc('create_booking', { p: { lead_id: leadIds['Amit Sharma'], unit_id: unit.id, agreement_value: 9200000, token_amount: 200000 } }))
await must(mgr.rpc('approve_booking', { p_booking: booking }))
const ms = await must(clients.bikash.rpc('add_milestone', { p_booking: booking, p_label: 'Token', p_due: new Date().toISOString().slice(0, 10), p_amount: 200000 }))
await must(clients.bikash.rpc('record_payment', { p_milestone: ms, p_amount: 200000 }))
await must(clients.bikash.rpc('add_milestone', { p_booking: booking, p_label: 'On agreement (20%)', p_due: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), p_amount: 1840000 }))
await must(clients.bikash.rpc('set_client_profile', { p_lead: leadIds['Amit Sharma'], p_pan: 'ABCDE1234F', p_id_number: '1234 5678 9012', p_address: 'Flat 12, Baner Road, Pune 411045' }))
const inc = await must(clients.bikash.rpc('list_incentives'))
log(`booking approved; incentive for closer = ₹${Number(inc[0].amount).toLocaleString('en-IN')}`)
// a second, pending booking
const unit2 = await must(clients.rohit.from('units').select('id').eq('project_id', projects['Skyline Heights']).eq('unit_no', '503').limit(1).single())
await must(clients.rohit.from('leads').update({ stage: 'negotiation' }).eq('id', leadIds['Kiran Rao']).select('id'))
await must(clients.rohit.rpc('create_booking', { p: { lead_id: leadIds['Kiran Rao'], unit_id: unit2.id, agreement_value: 21500000, token_amount: 500000 } }))

// ---- 6. attendance, tasks ----
console.log('Attendance & tasks')
const spots = { bikash: [18.5983, 73.8007], rohit: [18.5993, 73.7629], sanjay_tc: [18.5904, 73.785], neha: [18.559, 73.7868] }
for (const [who, [lat, lng]] of Object.entries(spots)) {
  await must(clients[who].rpc('check_in', { p_lat: lat, p_lng: lng, p_accuracy: 15, p_consent: true }))
}
const live = await must(mgr.rpc('live_locations'))
log(`${Object.keys(spots).length} checked in; manager's live map shows ${live.length}`)
await must(mgr.from('tasks').insert([
  { title: 'Send Skyline brochure to Sneha Joshi', assigned_to: ids.rohit, assigned_by: ids.neha, lead_id: leadIds['Sneha Joshi'], due_at: new Date(Date.now() + 5 * 3600e3).toISOString(), priority: 'high', type: 'follow_up' },
  { title: 'Collect KYC from Amit Sharma', assigned_to: ids.bikash, assigned_by: ids.neha, lead_id: leadIds['Amit Sharma'], due_at: new Date(Date.now() - 20 * 3600e3).toISOString(), priority: 'normal', type: 'general' },
  { title: 'Update price sheet for Green Valley', assigned_to: ids.neha, assigned_by: ids.neha, lead_id: null, due_at: new Date(Date.now() + 3 * 864e5).toISOString(), priority: 'low', type: 'general' },
]).select('id'))

// ---- 7. isolation spot-checks through the real API ----
console.log('Isolation checks')
const seen = async (who) => (await must(clients[who].from('leads').select('name'))).length
log(`leads visible — owner: ${await seen('owner')}, manager: ${await seen('neha')}, bikash: ${await seen('bikash')}, telecaller: ${await seen('sanjay_tc')}, analyst: ${await seen('karan_an')}`)
{
  const { error } = await clients.bikash.from('leads').select('phone_enc')
  if (!error) throw new Error('ciphertext column must not be selectable')
  log('ciphertext column blocked over the API: ' + error.message)
  const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } })
  const a = await anonClient.from('leads').select('id')
  if (!a.error && a.data.length) throw new Error('anonymous must see nothing')
  log('anonymous (not signed in) sees nothing: ' + (a.error?.message ?? '0 rows'))
  const d = await must(clients.neha.rpc('dashboard_stats'))
  log(`manager dashboard: ${d.leads_total} leads, revenue 30d ₹${Number(d.revenue_30d).toLocaleString('en-IN')}, pending bookings ${d.bookings_pending}`)
}

console.log(`\nDone. Test logins saved to scripts/.dev-users.json (git-ignored).`)
