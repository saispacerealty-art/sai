import { addUser, as, createDb, denied, eq, ok, summary } from './harness.mjs'

const db = await createDb({ quiet: true })
const one = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0]

const owner = await addUser(db, { username: 'owner', role: 'owner' })
const admin = await addUser(db, { username: 'admin1', role: 'admin' })
const sales = await addUser(db, { username: 'sales1', role: 'sales' })

console.log('\n# Permissions need an authenticator-verified session')
eq(await as(db, owner, (u) => u.val(`select has_perm('settings')`)), true, 'owner with aal2 + authenticator has access')
eq(await as(db, owner, (u) => u.val(`select has_perm('settings')`), { aal: 'aal1' }), false, 'owner with password only has nothing')
eq((await as(db, owner, (u) => u.val(`select my_permissions()`), { aal: 'aal1' })).mfa_ok, false, 'app is told two-step is still needed')
eq((await as(db, owner, (u) => u.val(`select my_permissions()`))).mfa_ok, true, 'app is told two-step is done')
await db.query(`delete from auth.mfa_factors where user_id = $1`, [admin])
eq(await as(db, admin, (u) => u.val(`select has_perm('leads')`)), false, 'admin with aal2 but no registered app has nothing')
eq((await as(db, admin, (u) => u.val(`select my_permissions()`))).mfa_ok, false, '...and is sent back to the setup screen')
eq(await as(db, sales, (u) => u.val(`select has_perm('leads')`), { aal: 'aal1' }), true, 'staff need no two-step code')

console.log('\n# Factor guard (auth.mfa_factors)')
await denied(db.query(`insert into auth.mfa_factors (user_id, factor_type, phone) values ($1, 'phone', '919999988888')`, [admin]), 'admin cannot use SMS/phone codes')
await db.query(`insert into auth.mfa_factors (user_id, factor_type) values ($1, 'totp')`, [admin])
ok(true, 'admin can register an authenticator app')
await denied(db.query(`update auth.mfa_factors set factor_type = 'phone' where user_id = $1`, [admin]), 'an authenticator factor cannot be turned into a phone factor')
await db.query(`insert into auth.mfa_factors (user_id, factor_type, phone) values ($1, 'phone', '919000000000')`, [sales])
ok(true, 'the guard does not interfere with staff accounts')

console.log('\n# SMS pieces are gone')
eq(await one(`select count(*)::int from pg_proc where proname in ('my_mfa_phone','svc_dev_otp_store','svc_dev_otp_latest','has_phone_factor','has_whatsapp_factor')`), 0, 'no SMS/WhatsApp functions remain')
eq(await one(`select to_regclass('private.dev_otp_outbox') is null`), true, 'no code outbox table remains')

summary()
