// Runs every migration on real Postgres (PGlite, in-process) and gives tests
// helpers to act as a signed-in user, exactly as Supabase would set things up.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = path.join(here, '../../supabase/migrations')

export async function createDb({ quiet = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } })
  await db.exec(fs.readFileSync(path.join(here, 'supabase-shim.sql'), 'utf8'))
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    // platform extensions are provided by the shim
    const sql = fs
      .readFileSync(path.join(MIGRATIONS, f), 'utf8')
      .replace(/^create extension if not exists (supabase_vault|pg_cron).*$/gm, '')
    try {
      await db.exec(sql)
      if (!quiet) console.log('  migrated', f)
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`)
    }
  }
  return db
}

let seq = 0
/** Creates an auth user + profile directly (what the admin-users Edge Function does). */
export async function addUser(db, { username, role, manager = null, name = username, active = true }) {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${username}@test.local`])
  await db.query(
    `insert into public.profiles (id, username, full_name, role, manager_id, is_active, must_change_password)
     values ($1, $2, $3, $4, $5, $6, false)`,
    [id, username, name, role, manager, active],
  )
  if (role === 'owner' || role === 'admin') {
    // Owner/Admin sign in with an authenticator app: a verified TOTP factor
    await db.query(`insert into auth.mfa_factors (user_id, factor_type, status) values ($1, 'totp', 'verified')`, [id])
  }
  return id
}

/** Runs fn inside a transaction as the given user (role authenticated + JWT claims), then rolls the role back. */
export async function as(db, uid, fn, { aal = 'aal2', commit = true } = {}) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal, role: 'authenticated' })])
    await tx.exec(`set local role authenticated`)
    const out = await fn({
      q: async (sql, params) => (await tx.query(sql, params)).rows,
      one: async (sql, params) => (await tx.query(sql, params)).rows[0],
      val: async (sql, params) => Object.values((await tx.query(sql, params)).rows[0] ?? {})[0],
    })
    if (!commit) await tx.rollback()
    return out
  })
}

/** Runs fn as the service role (Edge Functions). */
export async function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`)
    return fn({
      q: async (sql, params) => (await tx.query(sql, params)).rows,
      val: async (sql, params) => Object.values((await tx.query(sql, params)).rows[0] ?? {})[0],
    })
  })
}

// ---- tiny assertion helpers ----
let passed = 0
const failures = []
export function ok(cond, label) {
  if (cond) passed++
  else failures.push(label)
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
}
export const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`)
export async function denied(promise, label) {
  try {
    await promise
    ok(false, label + ' (expected an error, none thrown)')
  } catch (e) {
    ok(true, `${label} -> "${String(e.message).slice(0, 70)}"`)
  }
}
export function summary() {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    failures.forEach((f) => console.log('  FAILED:', f))
    process.exit(1)
  }
}
