#!/usr/bin/env node
// LOCAL TEST ACCOUNTS ONLY.   npm run logins
// Prints the logins created by scripts/seed-dev.mjs, and the test Owner's current
// authenticator code (only if the seed registered the authenticator itself).
import fs from 'node:fs'
import { totp } from './lib/totp-dev.mjs'

const file = new URL('./.dev-users.json', import.meta.url)
if (!fs.existsSync(file)) {
  console.log('No test accounts yet. Run:  npm run db:seed')
  process.exit(0)
}
const users = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).users)

console.log('\nLocal test logins for http://localhost:5173 (these do not exist on any live site)\n')
console.table(users.map((u) => ({ username: u.username, role: u.role, password: u.password })))

const owner = users.find((u) => u.role === 'owner')
if (owner?.totp_secret) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30)
  console.log(`Owner authenticator code right now: ${totp(owner.totp_secret)}  (valid ${left}s more; run again for a fresh one)`)
  console.log(`To use your phone instead, add this key in Google/Microsoft Authenticator (Enter a setup key): ${owner.totp_secret}\n`)
} else {
  console.log('Owner two-step code: use the authenticator app on your phone (you scan the QR code at your first sign-in).\n')
}
