import { addUser, as, asService, createDb, denied, eq, ok, summary } from './harness.mjs'

const db = await createDb({ quiet: true })
const one = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0]
const rpc = (uid, sql, p) => as(db, uid, (u) => u.val(sql, p))
const svc = (sql, p) => asService(db, (s) => s.val(sql, p))

const owner = await addUser(db, { username: 'owner', role: 'owner', name: 'Owner' })
const sales = await addUser(db, { username: 'sales', role: 'sales', name: 'Sales One' })
const sales2 = await addUser(db, { username: 'sales2', role: 'sales', name: 'Sales Two' })
const analyst = await addUser(db, { username: 'analyst', role: 'analyst', name: 'Analyst' })

console.log('\n# Mail')
const lead = (await rpc(sales, `select create_lead($1)`, [{ name: 'Amit Sharma', phone: '9876543210', email: 'amit@example.com' }])).id

eq(await rpc(owner, `select can_manage_mail()`), true, 'owner can manage mail')
eq(await rpc(sales, `select can_manage_mail()`), false, 'sales cannot manage mail')
await denied(rpc(sales, `select get_mail_account()`), 'sales cannot read mail settings')
eq(await rpc(owner, `select get_mail_account()`), null, 'no mailbox yet')

await svc(`select svc_save_mail_account($1, 'Sai Space', 'sales@x.com', 'smtp.x.com', 587, 'sales@x.com', 'app-pass-123')`, [owner])
const acct = await rpc(owner, `select get_mail_account()`)
eq(acct.smtp_host, 'smtp.x.com', 'mailbox saved')
ok(!JSON.stringify(acct).includes('app-pass'), 'password is not returned to the browser')
ok((await one(`select password_enc from mail_account`)) !== null && (await one(`select encode(password_enc,'escape') like '%app-pass%' from mail_account`)) === false, 'password stored encrypted')
eq((await svc(`select svc_mail_credentials()`)).password, 'app-pass-123', 'service role can read the password')
await denied(as(db, owner, (u) => u.val(`select svc_mail_credentials()`)), 'signed-in users cannot call the credential function')
await denied(as(db, owner, (u) => u.val(`select password_enc from mail_account`)), 'no direct table access for signed-in users')

await svc(`select svc_save_mail_account($1, 'Sai Space', 'sales@x.com', 'smtp.y.com', 465, 'sales@x.com', '')`, [owner])
eq((await svc(`select svc_mail_credentials()`)).password, 'app-pass-123', 'blank password keeps the stored one')

eq(await rpc(sales, `select can_email_lead($1)`, [lead]), true, 'owner of the lead can email it')
eq(await rpc(sales2, `select can_email_lead($1)`, [lead]), false, 'another sales person cannot')
eq(await rpc(analyst, `select can_email_lead($1)`, [lead]), false, 'read-only analyst cannot')
eq((await svc(`select svc_lead_mail_target($1)`, [lead])).email, 'amit@example.com', 'recipient address decrypted server-side')

await svc(`select svc_log_email($1, $2, 'Hello', 'Body text')`, [sales, lead])
eq(await one(`select count(*)::int from lead_activities where lead_id = $1 and type = 'email'`, [lead]), 1, 'email logged on the timeline')
ok((await rpc(sales, `select count(*)::int from lead_timeline($1) where type = 'email' and body like 'Hello%'`, [lead])) === 1, 'timeline shows the subject')
eq(await one(`select count(*)::int from audit_log where action = 'email_sent'`), 1, 'send audited')

for (let i = 0; i < 29; i++) await svc(`select svc_log_email($1, $2, 's', 'b')`, [sales, lead])
eq(await svc(`select svc_mail_allow($1)`, [sales]), false, 'rate limit: 30 per hour')
eq(await svc(`select svc_mail_allow($1)`, [owner]), true, 'limit is per user')

summary()
