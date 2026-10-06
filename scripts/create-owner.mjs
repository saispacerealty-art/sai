#!/usr/bin/env node
// One-time bootstrap: creates the Owner account (the only account not created from the Employees page).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-owner.mjs
//
// Asks for username, full name, mobile number (optional) and password interactively (the password is never
// passed on the command line, so it doesn't end up in shell history).
import { createClient } from '@supabase/supabase-js'
import readline from 'node:readline'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
const ask = (q) => new Promise((r) => rl.question(q, r))
const askHidden = (q) =>
  new Promise((resolve) => {
    const write = rl._writeToOutput.bind(rl)
    rl._writeToOutput = (s) => write(s.startsWith(q) ? s : '*')
    rl.question(q, (a) => {
      rl._writeToOutput = write
      process.stdout.write('\n')
      resolve(a)
    })
  })

const username = (await ask('Owner username (a-z 0-9 _ .): ')).trim().toLowerCase()
const fullName = (await ask('Full name: ')).trim()
const mobile = (await ask('Mobile number (optional, press Enter to skip): ')).replace(/\D/g, '').slice(-10)
const password = await askHidden('Password (10+ chars, upper, lower, digit): ')
rl.close()

if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new Error('Invalid username')
if (fullName.length < 2) throw new Error('Full name required')
if (mobile && !/^[6-9]\d{9}$/.test(mobile)) throw new Error('Enter a valid 10-digit Indian mobile number, or leave it empty')
if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password))
  throw new Error('Password does not meet the policy')

const admin = createClient(url, key, { auth: { persistSession: false } })
const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner')
if (count) throw new Error('An Owner account already exists.')

const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@staff.saispace-crm.local`,
  password,
  email_confirm: true,
  user_metadata: { username },
})
if (error) throw error

const { error: pErr } = await admin.from('profiles').insert({
  id: data.user.id, username, full_name: fullName, role: 'owner', must_change_password: false,
})
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id)
  throw pErr
}
if (mobile) {
  const { error: phErr } = await admin.rpc('svc_set_profile_phone', { p_user: data.user.id, p_phone: mobile })
  if (phErr) throw phErr
}
console.log(`Owner "${username}" created. At the first sign-in, scan the QR code with Google or Microsoft Authenticator (free); after that every sign-in asks for the app's 6-digit code.`)
