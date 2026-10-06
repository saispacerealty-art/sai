import { addUser, as, asService, createDb, denied, eq, ok, summary } from './harness.mjs'

const db = await createDb({ quiet: true })
const one = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0]
const rpc = (uid, sql, p) => as(db, uid, (u) => u.val(sql, p))
const rows = (uid, sql, p) => as(db, uid, (u) => u.q(sql, p))

const owner = await addUser(db, { username: 'owner', role: 'owner', name: 'Owner' })
const mgr = await addUser(db, { username: 'mgr', role: 'manager', manager: owner, name: 'Manager' })
const sales = await addUser(db, { username: 'sales', role: 'sales', manager: mgr, name: 'Sales One' })
const sales2 = await addUser(db, { username: 'sales2', role: 'sales', name: 'Sales Two' })
const tc = await addUser(db, { username: 'tele', role: 'telecaller', manager: mgr, name: 'Tele' })
const mkt = await addUser(db, { username: 'mkt', role: 'marketing', name: 'Marketing' })
const analyst = await addUser(db, { username: 'analyst', role: 'analyst', name: 'Analyst' })

console.log('\n# Leads')
const r1 = await rpc(sales, `select create_lead($1)`, [{ name: 'Amit Sharma', phone: '+91 98765 43210', source: 'Referral', budget_max: '8500000', note: 'Wants 2BHK', email: 'Amit@Example.com' }])
ok(r1.duplicate === false && r1.visible === true, 'create_lead returns a new visible lead')
const lead1 = r1.id
eq(await one(`select phone_hint from leads where id = $1`, [lead1]), '98••••••10', 'phone stored masked')
eq(await one(`select private.dec(phone_enc) from leads where id = $1`, [lead1]), '9876543210', 'phone stored encrypted + normalised')
eq(await one(`select owner_id from leads where id = $1`, [lead1]), sales, 'creator owns the lead by default')
ok((await one(`select score from leads where id = $1`, [lead1])) > 20, 'score computed on insert')
ok((await one(`select next_follow_up_at > now() from leads where id = $1`, [lead1])) === true, 'default follow-up date set')

const dup = await rpc(tc, `select create_lead($1)`, [{ name: 'A. Sharma', phone: '09876543210', source: 'Website' }])
ok(dup.duplicate === true && dup.id === lead1 && dup.visible === false, 'same phone -> duplicate, no second lead, not visible to the telecaller')
eq(await one(`select count(*)::int from leads`), 1, 'still exactly one lead')
eq(await one(`select count(*)::int from notifications where user_id = $1 and title like 'Repeat%'`, [sales]), 1, 'owner told about the repeat enquiry')

await denied(rpc(sales, `select create_lead($1)`, [{ name: 'X', phone: '12345' }]), 'invalid phone rejected')
await denied(rpc(sales, `select create_lead($1)`, [{ name: 'X', phone: '9000000001', owner_id: sales2 }]), 'sales cannot create a lead for someone else')
await denied(rpc(analyst, `select create_lead($1)`, [{ name: 'X', phone: '9000000002' }]), 'read-only analyst cannot create leads')
const r2 = await rpc(mgr, `select create_lead($1)`, [{ name: 'Priya Patil', phone: '9822012345', owner_id: tc }])
const lead2 = r2.id
eq(await one(`select count(*)::int from notifications where user_id = $1 and title = 'New lead assigned'`, [tc]), 1, 'assignee notified')

eq((await rpc(sales, `select reveal_lead_contact($1, 'view')`, [lead1])).phone, '9876543210', 'sales can view the full number')
eq((await rpc(sales, `select reveal_lead_contact($1, 'view')`, [lead1])).email, 'amit@example.com', 'email decrypts (lower-cased)')
await denied(rpc(tc, `select reveal_lead_contact($1, 'view')`, [lead2]), 'telecaller cannot VIEW full numbers')
eq((await rpc(tc, `select reveal_lead_contact($1, 'call')`, [lead2])).phone, '9822012345', 'telecaller can dial')
await denied(rpc(tc, `select reveal_lead_contact($1, 'call')`, [lead1]), "cannot reveal a lead you can't see")
eq(await one(`select count(*)::int from audit_log where action = 'view_pii'`), 3, 'every reveal is audited')
eq(await one(`select count(*)::int from lead_activities where lead_id = $1 and type = 'call'`, [lead2]), 1, 'call logged on the timeline')

await rpc(sales, `select add_lead_note($1, 'Prefers east-facing')`, [lead1])
{
  const t = await rows(sales, `select type, body from lead_timeline($1)`, [lead1])
  ok(t.some((x) => x.type === 'note' && x.body === 'Prefers east-facing') && t.some((x) => x.body === 'Wants 2BHK'), 'timeline shows decrypted notes')
  ok((await db.query(`select body from lead_activities where type = 'note'`)).rows.every((x) => x.body === null), 'notes are not stored in plain text')
}
await denied(rows(sales2, `select * from lead_timeline($1)`, [lead1]), "cannot read another person's timeline")
eq(await rpc(sales, `select find_lead_by_phone('98765-43210')`), lead1, 'exact phone search finds the lead')
eq(await rpc(sales2, `select find_lead_by_phone('9876543210')`), null, 'phone search hides leads out of scope')
await rpc(sales, `select update_lead_contact($1, '9876500000', null, null)`, [lead1])
eq(await rpc(sales, `select find_lead_by_phone('9876500000')`), lead1, 'contact update re-indexes the phone')
await denied(rpc(sales, `select update_lead_contact($1, '9822012345', null, null)`, [lead1]), 'cannot change to a number another lead has')

{
  const imp = await rpc(mkt, `select import_leads($1)`, [JSON.stringify([
    { name: 'Imp One', phone: '9111111111' }, { name: 'Imp Two', phone: '9222222222', budget_max: '5000000' },
    { name: 'Dup', phone: '9822012345' }, { name: 'Bad', phone: '123' }, { name: '', phone: '9333333333' },
  ])])
  ok(imp.created === 2 && imp.duplicates === 1 && imp.rejected.length === 2, 'import: 2 created, 1 duplicate, 2 rejected with row numbers')
  ok((await db.query(`select owner_id from leads where name like 'Imp %'`)).rows.every((x) => x.owner_id !== null), 'imported leads are auto-assigned (round robin)')
}
await denied(rpc(sales, `select import_leads('[]')`), 'sales cannot import')
{
  const ex = await rows(mgr, `select * from export_leads()`)
  ok(ex.length >= 2 && ex.every((x) => /^\d{10}$/.test(x.phone)), 'manager export returns full numbers for team leads')
  await denied(rows(sales, `select * from export_leads()`), 'sales cannot export')
}

console.log('\n# Inventory')
const project = await rpc(mgr, `insert into projects (name, location, price_min, price_max) values ('Skyline Heights', 'Pimple Saudagar', 7800000, 12500000) returning id`)
const tower = await rpc(mgr, `insert into towers (project_id, name, floors) values ($1, 'A', 12) returning id`, [project])
eq(await rpc(mgr, `select generate_units($1, 1, 3, 4, '2 BHK', 850, 8500000)`, [tower]), 12, 'generate_units creates 12 units')
eq(await rpc(mgr, `select generate_units($1, 1, 3, 4, '2 BHK', 850, 8500000)`, [tower]), 0, 're-running creates no duplicates')
await denied(rpc(sales, `insert into projects (name) values ('Hack') returning id`), 'sales cannot add projects')
await denied(rpc(sales, `select generate_units($1, 1, 1, 1, 'x', 1, 1)`, [tower]), 'sales cannot generate units')
const unit = await one(`select id from units where unit_no = '101'`)
const unit2 = await one(`select id from units where unit_no = '102'`)
await rpc(sales, `select hold_unit($1)`, [unit])
eq(await one(`select status from units where id = $1`, [unit]), 'hold', 'sales can hold a unit')
await denied(rpc(sales2, `select hold_unit($1)`, [unit]), 'a held unit cannot be held again')
await denied(rpc(sales2, `select release_unit($1)`, [unit]), "cannot release someone else's hold")

console.log('\n# Site visits')
const visit = await rpc(sales, `insert into site_visits (lead_id, project_id, scheduled_at, executive_id) values ($1, $2, now() + interval '1 day', $3) returning id`, [lead1, project, sales])
eq(await one(`select stage from leads where id = $1`, [lead1]), 'visit_scheduled', 'scheduling a visit moves the lead stage')
await denied(rpc(sales2, `insert into site_visits (lead_id, scheduled_at, executive_id) values ($1, now(), $2) returning id`, [lead1, sales2]), "cannot schedule a visit on a lead you can't see")
await denied(rpc(sales, `update site_visits set status = 'done' where id = $1`, [visit]), "cannot mark done directly (must capture GPS via RPC)")
await rpc(sales, `select mark_visit_done($1, 18.5983, 73.8007, 'Liked the sample flat')`, [visit])
eq(await one(`select stage from leads where id = $1`, [lead1]), 'visit_done', 'completing the visit moves the lead stage')
eq(await one(`select private.dec(done_loc_enc) from site_visits where id = $1`, [visit]), '18.5983,73.8007', 'visit GPS stored encrypted')
await denied(rpc(sales, `select mark_visit_done($1, 18.5, 73.8, 'again')`, [visit]), 'a closed visit cannot be re-closed')

console.log('\n# Bookings')
await denied(rpc(sales2, `select create_booking($1)`, [{ lead_id: lead1, unit_id: unit2, agreement_value: 100 }]), "cannot book on a lead you can't see")
await denied(rpc(tc, `select create_booking($1)`, [{ lead_id: lead2, unit_id: unit2, agreement_value: 100 }]), 'telecaller (no bookings module) cannot book')
const booking = await rpc(sales, `select create_booking($1)`, [{ lead_id: lead1, unit_id: unit, agreement_value: 9200000, token_amount: 100000 }])
ok(!!booking, 'sales creates a booking on the unit they hold')
eq(await one(`select private.dec_num(agreement_value_enc) from bookings where id = $1`, [booking]), '9200000', 'agreement value stored encrypted')
await denied(rpc(mgr, `select create_booking($1)`, [{ lead_id: lead1, unit_id: unit, agreement_value: 1 }]), 'a unit with a pending booking cannot be booked again')
ok((await one(`select count(*)::int from notifications where title = 'Booking awaiting approval'`)) >= 2, 'approvers notified')
await denied(rpc(sales, `select approve_booking($1)`, [booking]), 'sales cannot approve')
await rpc(mgr, `select approve_booking($1)`, [booking])
eq(await one(`select status from units where id = $1`, [unit]), 'booked', 'approval marks the unit booked')
eq(await one(`select stage from leads where id = $1`, [lead1]), 'booked', 'approval marks the lead booked')
eq(await one(`select private.dec_num(amount_enc) from incentives where booking_id = $1`, [booking]), '184000.00', 'incentive = 2% of agreement value')
{
  const b = (await rows(sales, `select * from list_bookings()`))[0]
  ok(b.agreement_value === '9200000' && b.unit_no === '101' && b.status === 'approved', 'list_bookings decrypts for the closer')
  eq((await rows(sales2, `select * from list_bookings()`)).length, 0, 'other sales sees no bookings')
  eq((await rows(analyst, `select * from list_bookings()`)).length, 1, 'analyst (scope all) sees bookings')
  await denied(rows(analyst, `select agreement_value_enc from bookings`), 'ciphertext column still blocked')
}

console.log('\n# Payments & clients')
const ms = await rpc(sales, `select add_milestone($1, 'On agreement', current_date + 30, 1840000)`, [booking])
await rpc(sales, `select record_payment($1, 1000000)`, [ms])
await denied(rpc(sales, `select record_payment($1, 99999999)`, [ms]), 'cannot record more than the milestone amount')
await denied(rpc(sales2, `select add_milestone($1, 'x', current_date, 5)`, [booking]), "cannot add milestones to a booking you can't see")
eq((await rows(sales, `select received_amount from list_milestones($1)`, [booking]))[0].received_amount, '1000000', 'milestone shows received amount')
eq((await rows(sales, `select received from list_bookings()`))[0].received, '1000000', 'booking shows total received')
await rpc(sales, `select set_client_profile($1, 'abcde1234f', '1234 5678 9012', 'Flat 4, Pune')`, [lead1])
eq((await rpc(sales, `select get_client_profile($1)`, [lead1])).pan, 'ABCDE1234F', 'KYC round-trips (PAN upper-cased)')
await denied(rpc(sales, `select set_client_profile($1, 'BADPAN', null, null)`, [lead1]), 'bad PAN rejected')
await denied(rpc(tc, `select get_client_profile($1)`, [lead2]), 'telecaller (no clients module) cannot read KYC')
{
  const c = await rows(sales, `select * from list_clients()`)
  ok(c.length === 1 && c[0].has_kyc === true && c[0].name === 'Amit Sharma', 'list_clients shows the booked customer')
}
eq(await rpc(sales, `select can_upload_document($1)`, [lead1]), true, 'sales may upload documents for their client')
eq(await rpc(tc, `select can_upload_document($1)`, [lead2]), false, 'telecaller may not upload documents')
const doc = await asService(db, (s) => s.val(`select svc_add_document($1, $2, $3, 'kyc', $4, 'pan.pdf', 'application/pdf', 1234)`, [sales, lead1, booking, `${lead1}/abc.pdf`]))
eq(await rpc(sales, `select log_document_download($1)`, [doc]), `${lead1}/abc.pdf`, 'download is allowed + audited for the owner')
await denied(rpc(sales2, `select log_document_download($1)`, [doc]), "cannot download another client's document")
await denied(rpc(sales, `insert into documents (lead_id, type, file_path, file_name, mime, size_bytes) values ($1,'kyc','x','x','application/pdf',1) returning id`, [lead1]), 'browser cannot insert document rows directly')

console.log('\n# Incentives')
{
  const mine = await rows(sales, `select amount, status, rule from list_incentives()`)
  ok(mine.length === 1 && mine[0].amount === '184000.00' && mine[0].rule === '2.00%', 'sales sees own incentive')
  eq((await rows(sales2, `select * from list_incentives()`)).length, 0, "other sales sees none")
  const inc = await one(`select id from incentives`)
  await denied(rpc(mgr, `select set_incentive_status($1, 'approved')`, [inc]), 'manager lacks incentives.approve')
  await rpc(owner, `select set_incentive_status($1, 'approved')`, [inc])
  await denied(rpc(owner, `select set_incentive_status($1, 'pending')`, [inc]), 'invalid status transition rejected')
  await rpc(owner, `select set_incentive_status($1, 'paid')`, [inc])
  eq(await one(`select status from incentives`), 'paid', 'owner approves then pays')
}
{
  const b2 = await rpc(sales, `select create_booking($1)`, [{ lead_id: lead1, unit_id: unit2, agreement_value: 5000000 }])
  await rpc(sales, `select cancel_booking($1, 'Customer changed mind')`, [b2])
  eq(await one(`select status from units where id = $1`, [unit2]), 'available', 'cancelling a pending booking frees the unit')
  await denied(rpc(sales, `select cancel_booking($1, 'x y z')`, [booking]), 'sales cannot cancel an approved booking')
}

console.log('\n# Attendance & tracking')
await denied(rpc(sales, `select check_in(18.59, 73.78, 12, false)`), 'check-in needs location consent the first time')
await rpc(sales, `select check_in(18.5904, 73.7850, 12, true)`)
await denied(rpc(sales, `select check_in(18.59, 73.78, 12, true)`), 'cannot check in twice')
await denied(rpc(sales, `select check_in(null, null, null, true)`), 'location is required')
eq(await rpc(sales, `select record_ping(18.5910, 73.7860, 10)`), true, 'ping accepted while checked in')
eq(await one(`select count(*)::int from location_pings where user_id = $1`, [sales]), 1, 'pings within a minute are collapsed')
eq(await rpc(sales2, `select record_ping(18.5, 73.7, 10)`), false, 'ping ignored when not checked in')
{
  const live = await rows(mgr, `select full_name, lat, lng, status from live_locations()`)
  ok(live.length === 1 && live[0].lat === '18.5904' && live[0].status === 'online', 'manager sees the team member live')
  await denied(rows(sales, `select * from live_locations()`), 'sales cannot open live tracking')
  eq((await rows(mgr, `select * from location_trail($1, (now() at time zone 'Asia/Kolkata')::date)`, [sales])).length, 1, 'manager can read the trail')
  await denied(rows(mgr, `select * from location_trail($1, current_date)`, [sales2]), 'manager cannot read trails outside their team')
  await denied(rows(mgr, `select loc_enc from location_pings`), 'raw location ciphertext not selectable')
}
await db.query(`update company_settings set office_lat = 18.5904, office_lng = 73.7850, geofence_m = 200`)
await denied(rpc(tc, `select check_in(19.0760, 72.8777, 10, true)`), 'geofence: Mumbai is too far from the Pune office')
await rpc(tc, `select check_in(18.5905, 73.7851, 10, true)`)
ok(true, 'geofence: near the office is accepted')
await rpc(sales, `select check_out(18.59, 73.78)`)
await denied(rpc(sales, `select check_out(18.59, 73.78)`), 'cannot check out twice')
eq((await rows(sales, `select check_out_at is not null as done from attendance`))[0].done, true, 'sales reads own attendance')
eq((await rows(mgr, `select 1 from attendance`)).length, 2, 'manager reads team attendance')
eq((await rows(sales2, `select 1 from attendance`)).length, 0, 'others read none')

console.log('\n# Tasks')
const task = await rpc(mgr, `insert into tasks (title, assigned_to, assigned_by, due_at) values ('Call Amit', $1, $2, now() - interval '1 hour') returning id`, [sales, mgr])
eq(await one(`select count(*)::int from notifications where user_id = $1 and title = 'New task assigned'`, [sales]), 1, 'assignee notified of the task')
await denied(rpc(sales, `insert into tasks (title, assigned_to, assigned_by) values ('x', $1, $2) returning id`, [sales2, sales]), 'sales cannot assign tasks to others')
await rpc(sales, `update tasks set status = 'done' where id = $1 returning id`, [task])
ok((await one(`select done_at is not null from tasks where id = $1`, [task])) === true, 'completing a task stamps done_at')
eq((await rows(sales2, `select 1 from tasks`)).length, 0, "cannot see other people's tasks")

console.log('\n# Scheduled jobs')
await db.query(`update leads set next_follow_up_at = now() - interval '1 day' where id = $1`, [lead2])
await db.query(`select private.daily_reminders()`)
eq(await one(`select count(*)::int from notifications where user_id = $1 and title = 'Follow-ups due today'`, [tc]), 1, 'daily reminder created for overdue follow-up')
await db.query(`select private.checkin_nudges()`)
ok((await one(`select count(*)::int from notifications where title = 'Team not checked in'`)) >= 0, 'check-in nudge runs')
await db.query(`select private.refresh_lead_scores(), private.release_expired_holds(), private.purge_old_pings(), private.anonymize_stale_lost_leads(), private.purge_old_notifications(), private.purge_login_attempts()`)
ok(true, 'all maintenance jobs run without error')
await db.query(`update leads set stage = 'lost', lost_reason = 'Budget', last_activity_at = now() - interval '3 years' where id = $1`, [lead2])
await db.query(`update leads set last_activity_at = now() - interval '3 years' where id = $1`, [lead2])
await db.query(`select private.anonymize_stale_lost_leads()`)
{
  const l = (await db.query(`select name, phone_enc, phone_bidx, anonymized_at from leads where id = $1`, [lead2])).rows[0]
  ok(l.name === 'Anonymised lead' && l.phone_enc === null && l.phone_bidx === null && l.anonymized_at !== null, 'stale lost lead is anonymised')
}

console.log('\n# Dashboard & reports')
{
  const d = await rpc(sales, `select dashboard_stats()`)
  ok(d.leads_total >= 1 && d.bookings_30d === 1 && Number(d.revenue_30d) === 9200000 && Number(d.my_incentive_paid) === 184000, 'sales dashboard: own leads, booking, revenue, incentive')
  ok(Array.isArray(d.pipeline) && d.pipeline.length === 8, 'pipeline has all 8 stages')
  const dt = await rpc(tc, `select dashboard_stats()`)
  ok(dt.revenue_30d === undefined && dt.bookings_30d === undefined, 'telecaller dashboard has no revenue figures')
  const dm = await rpc(mgr, `select dashboard_stats()`)
  ok(Number(dm.revenue_30d) === 9200000, 'manager dashboard includes team revenue')
  eq(Number((await rpc(sales2, `select dashboard_stats()`)).revenue_30d), 0, 'unrelated sales sees zero revenue')
}
ok((await rows(mgr, `select * from report_sources(current_date - 30, current_date + 1)`)).length >= 1, 'report_sources runs')
{
  const t = await rows(mgr, `select full_name, bookings, revenue from report_team(current_date - 30, current_date + 1)`)
  ok(t.some((x) => x.full_name === 'Sales One' && Number(x.revenue) === 9200000), 'report_team shows team revenue')
  ok(!t.some((x) => x.full_name === 'Sales Two'), 'report_team excludes people outside the team')
}
eq((await rows(mgr, `select * from report_monthly(6)`)).length, 6, 'report_monthly returns 6 months')
await denied(rows(sales, `select * from report_monthly(6)`), 'sales cannot open reports')
await denied(rpc(sales, `select log_export('leads', 5)`), 'sales cannot export')

console.log('\n# Settings & webhooks')
await rpc(owner, `select update_role_preset('telecaller', array['leads','tasks'], array['leads.view_contact'], 'own')`)
eq(await rpc(tc, `select has_perm('visits')`), false, 'preset change removes a module')
eq(await rpc(tc, `select has_perm('dashboard')`), true, 'dashboard is always kept')
await denied(rpc(mgr, `select update_role_preset('sales', array['leads'], '{}', 'own')`), 'manager cannot edit presets')
await denied(rpc(owner, `select update_role_preset('admin', array['leads'], '{}', 'own')`), 'admin preset is locked')
await denied(rpc(owner, `select update_role_preset('sales', array['hack'], '{}', 'own')`), 'unknown permission rejected')
ok((await rows(owner, `select * from audit_feed(50)`)).length > 5, 'owner reads the audit feed')
await denied(rows(mgr, `select * from audit_feed(50)`), 'manager cannot read the audit feed')
const hook = await rpc(owner, `select create_webhook('Website', null, $1)`, [project])
ok(/^[0-9a-f]{48}$/.test(hook.secret), 'webhook secret generated (shown once)')
await denied(rows(owner, `select secret_enc from lead_webhooks`), 'webhook secret not readable afterwards')
await denied(rpc(owner, `select create_webhook('Website', null, null)`), 'duplicate webhook name rejected')
eq((await asService(db, (s) => s.val(`select svc_webhook_secret($1)`, [hook.id]))).secret, hook.secret, 'service role can read the secret to verify signatures')
{
  const res = await asService(db, (s) => s.val(`select svc_intake_lead($1, $2)`, [hook.id, { name: 'Web Lead', phone: '9444444444', note: 'From website form' }]))
  ok(res.duplicate === false, 'webhook creates a lead')
  const l = (await db.query(`select source, owner_id, project_id from leads where id = $1`, [res.id])).rows[0]
  ok(l.source === 'Website' && l.owner_id !== null && l.project_id === project, 'webhook lead: source set, auto-assigned, default project')
  const again = await asService(db, (s) => s.val(`select svc_intake_lead($1, $2)`, [hook.id, { name: 'Web Lead', phone: '9444444444' }]))
  ok(again.duplicate === true, 'webhook repeat is a duplicate, not a new lead')
}
await rpc(owner, `select set_webhook($1, false)`, [hook.id])
await denied(asService(db, (s) => s.val(`select svc_intake_lead($1, $2)`, [hook.id, { name: 'X', phone: '9555555555' }])), 'inactive webhook refuses leads')
await denied(rpc(owner, `select svc_intake_lead($1, '{}')`, [hook.id]), 'browser cannot call the intake function')

summary()
