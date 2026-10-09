import { addUser, as, createDb, eq, ok, summary } from './harness.mjs'

const db = await createDb({ quiet: true })
const one = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0]

const owner = await addUser(db, { username: 'owner', role: 'owner' })
const sales = await addUser(db, { username: 'sales', role: 'sales', manager: owner })

console.log('\n# Before rotation (key v1)')
const lead = (await as(db, sales, (u) => u.val(`select create_lead($1)`, [{ name: 'Rotate Me', phone: '9876543210', email: 'r@example.com', note: 'secret note' }]))).id
await as(db, sales, (u) => u.q(`select check_in(18.59, 73.78, 10, true)`))
const project = await one(`insert into projects (name) values ('Test Project') returning id`)
const tower = await one(`insert into towers (project_id, name) values ($1, 'A') returning id`, [project])
const unit = await one(`insert into units (project_id, tower_id, unit_no, price) values ($1, $2, '101', 100) returning id`, [project, tower])
const booking = await as(db, sales, (u) => u.val(`select create_booking($1)`, [{ lead_id: lead, unit_id: unit, agreement_value: 7500000 }]))
eq(await one(`select get_byte(phone_enc, 0) from leads where id = $1`, [lead]), 1, 'lead phone is under key v1')
const bidxBefore = await one(`select phone_bidx from leads where id = $1`, [lead])
const updatedBefore = await one(`select updated_at::text from leads where id = $1`, [lead])
const scoreBefore = await one(`select score from leads where id = $1`, [lead])

console.log('\n# Rotate')
const res = await one(`select private.rotate_data_key()`)
ok(res.key_version === 2 && res.values_reencrypted >= 6, `rotation re-encrypted ${res.values_reencrypted} values under key v2`)
eq(await one(`select count(*)::int from vault.secrets where name like 'crm_data_key_v%'`), 2, 'both key versions are kept in the vault')

console.log('\n# After rotation')
eq(await one(`select get_byte(phone_enc, 0) from leads where id = $1`, [lead]), 2, 'lead phone is now under key v2')
eq(await one(`select private.dec(phone_enc) from leads where id = $1`, [lead]), '9876543210', 'phone still decrypts')
eq(await one(`select private.dec(email_enc) from leads where id = $1`, [lead]), 'r@example.com', 'email still decrypts')
eq(await one(`select private.dec(body_enc) from lead_activities where type = 'note'`), 'secret note', 'note still decrypts')
eq(await one(`select private.dec_num(agreement_value_enc) from bookings where id = $1`, [booking]), '7500000', 'booking amount still decrypts')
eq(await one(`select private.dec(loc_enc) from location_pings limit 1`), '18.59,73.78', 'location still decrypts')
eq(await one(`select phone_bidx from leads where id = $1`, [lead]), bidxBefore, 'blind index unchanged (separate key) — duplicate detection still works')
eq(await one(`select updated_at::text from leads where id = $1`, [lead]), updatedBefore, 'rotation did not touch updated_at')
eq(await one(`select score from leads where id = $1`, [lead]), scoreBefore, 'rotation did not change business data')
eq(await one(`select count(*)::int from lead_activities where lead_id = $1 and type = 'stage'`, [lead]), 1, 'rotation logged no fake timeline entries')
eq((await as(db, sales, (u) => u.val(`select reveal_lead_contact($1, 'view')`, [lead]))).phone, '9876543210', 'the app still reveals the number')
const dup = await as(db, sales, (u) => u.val(`select create_lead($1)`, [{ name: 'Again', phone: '9876543210' }]))
ok(dup.duplicate === true, 'duplicate detection works across the rotation')
const fresh = (await as(db, sales, (u) => u.val(`select create_lead($1)`, [{ name: 'New Lead', phone: '9123456780' }]))).id
eq(await one(`select get_byte(phone_enc, 0) from leads where id = $1`, [fresh]), 2, 'new data is written under key v2')
eq((await one(`select private.reencrypt_all()`)).values_reencrypted, 0, 're-running the job changes nothing')
eq(await one(`select count(*)::int from audit_log where action = 'key_rotation'`), 1, 'rotation is recorded in the audit log')
ok((await db.query(`select 1 from pg_trigger where tgname = 'audit_log_no_update' and tgenabled = 'O'`)).rows.length === 1, 'audit log protection is still enabled')
ok((await db.query(`select 1 from pg_trigger where tgname = 'leads_guard' and tgenabled = 'O'`)).rows.length === 1, 'lead triggers are re-enabled')

summary()
