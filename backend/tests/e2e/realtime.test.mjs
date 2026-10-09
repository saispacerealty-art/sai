#!/usr/bin/env node
// Live notifications over Supabase Realtime (local stack, after seed):
//   node --env-file=.env.scripts.local tests/e2e/realtime.test.mjs
// Checks that a user receives their own notification instantly and that
// another user subscribed to the same table receives nothing (RLS applies to realtime).
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ ?? '')) throw new Error('local stack only')
const creds = JSON.parse(fs.readFileSync(new URL('../../scripts/.dev-users.json', import.meta.url), 'utf8')).users

async function signIn(who) {
  const res = await fetch(`${URL_}/functions/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', apikey: ANON },
    body: JSON.stringify({ username: creds[who].username, password: creds[who].password }),
  })
  const { session } = await res.json()
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await c.auth.setSession(session)
  await c.realtime.setAuth(session.access_token)
  c.uid = (await c.auth.getUser()).data.user.id
  return c
}
const listen = (client, filterUser) =>
  new Promise((resolve, reject) => {
    const got = []
    const ch = client
      .channel('t-' + Math.random())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', ...(filterUser ? { filter: `user_id=eq.${filterUser}` } : {}) }, (p) => got.push(p.new))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve({ got, ch })
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('subscribe: ' + status))
      })
  })

let pass = 0
const fails = []
const ok = (c, label) => { if (c) pass++; else fails.push(label); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}`) }

const neha = await signIn('neha')
const rohit = await signIn('rohit')
const bikash = await signIn('bikash')

console.log('\n# Realtime notifications')
const mine = await listen(rohit, rohit.uid)       // what the app does: own notifications
const snoop = await listen(bikash, null)          // another user listening to the whole table
ok(true, 'both users subscribed')
await new Promise((r) => setTimeout(r, 5000)) // realtime needs a few seconds after a stack restart

// the manager assigns a task to Rohit -> trigger inserts a notification for Rohit
const { error } = await neha.from('tasks').insert({ title: 'Realtime test task', description: null, lead_id: null, assigned_to: rohit.uid, assigned_by: neha.uid, due_at: null, priority: 'normal', type: 'general' }).select('id')
ok(!error, 'manager assigned a task' + (error ? ': ' + error.message : ''))
await new Promise((r) => setTimeout(r, 4000))

ok(mine.got.length === 1 && mine.got[0].title === 'New task assigned', `assignee received the notification live (${mine.got.length})`)
ok(snoop.got.length === 0, `another user listening to the table received nothing (${snoop.got.length})`)

await neha.from('tasks').delete().eq('title', 'Realtime test task')
for (const c of [neha, rohit, bikash]) await c.removeAllChannels()
console.log(`\n${pass} passed, ${fails.length} failed`)
process.exit(fails.length ? 1 : 0)
