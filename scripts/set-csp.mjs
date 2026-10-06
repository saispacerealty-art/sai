#!/usr/bin/env node
// Writes your Supabase project host into vercel.json's Content-Security-Policy,
// and switches the policy between report-only and enforcing.
//
//   node scripts/set-csp.mjs <project-ref>            # report-only (first few days after go-live)
//   node scripts/set-csp.mjs <project-ref> --enforce  # after the report-only period is clean
//
// <project-ref> is the id in your Supabase URL: https://<project-ref>.supabase.co
import fs from 'node:fs'

const [ref, flag] = process.argv.slice(2)
if (!/^[a-z0-9]{15,30}$/.test(ref ?? '')) {
  console.error('Usage: node scripts/set-csp.mjs <project-ref> [--enforce]')
  process.exit(1)
}
const host = `${ref}.supabase.co`
const file = new URL('../vercel.json', import.meta.url)
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
const headers = cfg.headers[0].headers
const i = headers.findIndex((h) => h.key.startsWith('Content-Security-Policy'))
headers[i] = {
  key: flag === '--enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
  value: headers[i].value.replace(/__SUPABASE_HOST__|[a-z0-9]{15,30}\.supabase\.co/g, host),
}
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
console.log(`vercel.json: ${headers[i].key} now allows ${host}`)
