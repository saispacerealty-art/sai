-- =====================================================================
-- 0008 · Inventory, site visits, bookings, payments, clients (Phases 3-4)
-- =====================================================================

-- ---------- inventory ----------
-- bulk-create units: floors f1..f2, n per floor, numbered <floor><2-digit index> (e.g. 1204)
create or replace function public.generate_units(p_tower uuid, p_floor_from int, p_floor_to int, p_per_floor int,
                                                 p_config text, p_carpet numeric, p_price numeric) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_project uuid; v_n int;
begin
  if not public.can_write('projects.edit') then perform private.forbid(); end if;
  if p_floor_from < 0 or p_floor_to < p_floor_from or p_floor_to > 200 or p_per_floor not between 1 and 50 then
    perform private.bad('Check the floor range (0-200) and units per floor (1-50)');
  end if;
  select project_id into v_project from public.towers where id = p_tower;
  if v_project is null then perform private.bad('Tower not found'); end if;
  insert into public.units (project_id, tower_id, unit_no, floor, config, carpet_sqft, price)
  select v_project, p_tower, f::text || lpad(n::text, 2, '0'), f, nullif(btrim(p_config), ''), p_carpet, p_price
  from generate_series(p_floor_from, p_floor_to) f, generate_series(1, p_per_floor) n
  on conflict (tower_id, unit_no) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.hold_unit(p_unit uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_hours int;
begin
  if not public.can_write('bookings') then perform private.forbid(); end if;
  select hold_hours into v_hours from public.company_settings where id = 1;
  update public.units set status = 'hold', hold_by = auth.uid(), hold_until = now() + make_interval(hours => v_hours)
   where id = p_unit and status = 'available';
  if not found then perform private.bad('This unit is no longer available'); end if;
end $$;

create or replace function public.release_unit(p_unit uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.units set status = 'available', hold_by = null, hold_until = null
   where id = p_unit and status = 'hold'
     and (hold_by = auth.uid() or public.has_perm('bookings.approve') or public.has_perm('projects.edit'))
     and not exists (select 1 from public.bookings b where b.unit_id = p_unit and b.status <> 'cancelled');
  if not found then perform private.bad('This hold cannot be released by you'); end if;
end $$;

-- ---------- site visits ----------
create or replace function private.visit_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  select name into v_name from public.leads where id = new.lead_id;
  insert into public.lead_activities (lead_id, type, body, meta)
  values (new.lead_id, 'visit', 'Site visit scheduled', jsonb_build_object('at', new.scheduled_at, 'executive', new.executive_id));
  update public.leads set stage = 'visit_scheduled', next_follow_up_at = new.scheduled_at
   where id = new.lead_id and stage in ('new', 'contacted', 'qualified');
  if new.executive_id is distinct from auth.uid() then
    insert into public.notifications (user_id, title, body, link)
    values (new.executive_id, 'Site visit assigned', v_name || ' · ' || to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), '/visits');
  end if;
  return new;
end $$;
create trigger visit_created before insert on public.site_visits
  for each row execute function private.visit_created();

create or replace function public.mark_visit_done(p_visit uuid, p_lat numeric, p_lng numeric, p_feedback text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.site_visits;
begin
  select * into v from public.site_visits where id = p_visit;
  if not found or not public.can_write('visits')
     or not (public.in_scope(v.executive_id) or v.created_by = auth.uid()) then perform private.forbid(); end if;
  if v.status in ('done', 'cancelled') then perform private.bad('This visit is already closed'); end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then perform private.bad('Invalid location'); end if;
  update public.site_visits
     set status = 'done', done_at = now(), feedback = nullif(btrim(p_feedback), ''),
         done_loc_enc = case when p_lat is null then null else private.enc(p_lat::text || ',' || p_lng::text) end
   where id = p_visit;
  insert into public.lead_activities (lead_id, type, body, meta)
  values (v.lead_id, 'visit', 'Site visit completed', jsonb_build_object('gps', p_lat is not null));
  update public.leads set stage = 'visit_done'
   where id = v.lead_id and stage in ('new', 'contacted', 'qualified', 'visit_scheduled');
end $$;

-- ---------- bookings ----------
create or replace function private.can_see_booking(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.id = p_booking
                 and public.has_perm('bookings') and (public.in_scope(b.closed_by) or b.created_by = auth.uid())) $$;

create or replace function public.create_booking(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lead uuid := (p ->> 'lead_id')::uuid; v_unit uuid := (p ->> 'unit_id')::uuid;
  v_value numeric := (p ->> 'agreement_value')::numeric; v_token numeric := nullif(p ->> 'token_amount', '')::numeric;
  v_closer uuid := coalesce(nullif(p ->> 'closed_by', '')::uuid, auth.uid());
  u public.units; v_id uuid; v_lead_name text; r record;
begin
  if not public.can_write('bookings') or not public.can_see_lead(v_lead) then perform private.forbid(); end if;
  if v_closer <> auth.uid() and not public.in_scope(v_closer) then perform private.forbid('You can only book for yourself or your team'); end if;
  if v_value is null or v_value <= 0 then perform private.bad('Enter the agreement value'); end if;
  if v_token is not null and (v_token < 0 or v_token > v_value) then perform private.bad('Token amount must be between 0 and the agreement value'); end if;
  select * into u from public.units where id = v_unit for update;
  if not found then perform private.bad('Unit not found'); end if;
  if not (u.status = 'available' or (u.status = 'hold' and u.hold_by = auth.uid())) then
    perform private.bad('This unit is not available (it may be held or booked by someone else)');
  end if;

  insert into public.bookings (lead_id, unit_id, booking_date, agreement_value_enc, token_amount_enc, closed_by)
  values (v_lead, v_unit, coalesce(nullif(p ->> 'booking_date', '')::date, (now() at time zone 'Asia/Kolkata')::date),
          private.enc_num(v_value), private.enc_num(v_token), v_closer)
  returning id into v_id;
  update public.units set status = 'hold', hold_by = v_closer, hold_until = null where id = v_unit;
  select name into v_lead_name from public.leads where id = v_lead;
  insert into public.lead_activities (lead_id, type, body, meta)
  values (v_lead, 'booking', 'Booking submitted for approval', jsonb_build_object('unit', u.unit_no));
  update public.leads set stage = 'negotiation' where id = v_lead and stage not in ('negotiation', 'booked');

  -- tell everyone who can approve it: owner/admins, and the closer's manager
  for r in select pr.id from public.profiles pr
           where pr.is_active and pr.id <> auth.uid()
             and (pr.role in ('owner', 'admin') or pr.id = (select manager_id from public.profiles where id = v_closer)) loop
    insert into public.notifications (user_id, title, body, link)
    values (r.id, 'Booking awaiting approval', v_lead_name || ' · Unit ' || u.unit_no, '/bookings');
  end loop;
  return v_id;
end $$;

-- commission for the closer: most specific active rule wins (user > project > role)
create or replace function private.compute_incentive(p_booking uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v_project uuid; v_role text; rule public.incentive_rules; v_amount numeric;
begin
  select * into b from public.bookings where id = p_booking;
  select project_id into v_project from public.units where id = b.unit_id;
  select role into v_role from public.profiles where id = b.closed_by;
  select * into rule from public.incentive_rules r
   where r.active and ((r.applies_to = 'user' and r.target = b.closed_by::text)
                    or (r.applies_to = 'project' and r.target = v_project::text)
                    or (r.applies_to = 'role' and r.target = v_role))
   order by case r.applies_to when 'user' then 1 when 'project' then 2 else 3 end, r.created_at desc
   limit 1;
  if not found then return; end if;
  v_amount := case rule.calc when 'percent' then round(private.dec_num(b.agreement_value_enc) * rule.value / 100, 2) else rule.value end;
  insert into public.incentives (booking_id, user_id, rule_id, amount_enc)
  values (b.id, b.closed_by, rule.id, private.enc_num(v_amount))
  on conflict (booking_id, user_id) do update set amount_enc = excluded.amount_enc, rule_id = excluded.rule_id, status = 'pending';
end $$;

create or replace function public.approve_booking(p_booking uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not public.has_perm('bookings.approve') or not public.in_scope(b.closed_by) then perform private.forbid(); end if;
  if b.status <> 'pending' then perform private.bad('Only pending bookings can be approved'); end if;
  update public.bookings set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_booking;
  update public.units set status = 'booked', hold_by = null, hold_until = null where id = b.unit_id;
  update public.leads set stage = 'booked', next_follow_up_at = null where id = b.lead_id;
  insert into public.lead_activities (lead_id, type, body) values (b.lead_id, 'booking', 'Booking approved');
  perform private.compute_incentive(p_booking);
  if b.closed_by <> auth.uid() then
    insert into public.notifications (user_id, title, body, link)
    values (b.closed_by, 'Booking approved', (select name from public.leads where id = b.lead_id), '/bookings');
  end if;
  perform private.audit('booking_approve', 'booking', p_booking::text);
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform private.forbid(); end if;
  if not ((public.has_perm('bookings.approve') and public.in_scope(b.closed_by))
          or (b.status = 'pending' and b.created_by = auth.uid() and public.can_write('bookings'))) then
    perform private.forbid();
  end if;
  if b.status = 'cancelled' then perform private.bad('Already cancelled'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform private.bad('Give a reason for cancelling'); end if;
  update public.bookings set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_booking;
  update public.units set status = 'available', hold_by = null, hold_until = null where id = b.unit_id;
  update public.incentives set status = 'cancelled' where booking_id = p_booking and status <> 'paid';
  update public.leads set stage = 'negotiation' where id = b.lead_id and stage = 'booked';
  insert into public.lead_activities (lead_id, type, body, meta) values (b.lead_id, 'booking', 'Booking cancelled', jsonb_build_object('reason', btrim(p_reason)));
  perform private.audit('booking_cancel', 'booking', p_booking::text);
end $$;

create or replace function public.list_bookings()
returns table (id uuid, lead_id uuid, lead_name text, unit_id uuid, unit_no text, tower text, project text, booking_date date,
               agreement_value numeric, token_amount numeric, received numeric, closed_by uuid, closed_by_name text,
               status text, approved_at timestamptz, cancel_reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.lead_id, l.name, b.unit_id, u.unit_no, t.name, pr.name, b.booking_date,
         private.dec_num(b.agreement_value_enc), private.dec_num(b.token_amount_enc),
         coalesce((select sum(private.dec_num(m.received_amount_enc)) from public.payment_milestones m where m.booking_id = b.id), 0),
         b.closed_by, p.full_name, b.status, b.approved_at, b.cancel_reason, b.created_at
  from public.bookings b
  join public.leads l on l.id = b.lead_id
  join public.units u on u.id = b.unit_id
  join public.towers t on t.id = u.tower_id
  join public.projects pr on pr.id = u.project_id
  join public.profiles p on p.id = b.closed_by
  where public.has_perm('bookings') and (public.in_scope(b.closed_by) or b.created_by = auth.uid())
  order by b.created_at desc $$;

-- ---------- payment milestones ----------
create or replace function public.add_milestone(p_booking uuid, p_label text, p_due date, p_amount numeric) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.can_write('bookings') or not private.can_see_booking(p_booking) then perform private.forbid(); end if;
  if length(btrim(coalesce(p_label, ''))) < 1 or p_amount is null or p_amount <= 0 then perform private.bad('Enter a label and an amount'); end if;
  insert into public.payment_milestones (booking_id, label, due_date, amount_enc)
  values (p_booking, btrim(p_label), p_due, private.enc_num(p_amount)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_payment(p_milestone uuid, p_amount numeric) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.payment_milestones;
begin
  select * into m from public.payment_milestones where id = p_milestone;
  if not found or not public.can_write('bookings') or not private.can_see_booking(m.booking_id) then perform private.forbid(); end if;
  if p_amount is null or p_amount < 0 or p_amount > private.dec_num(m.amount_enc) then perform private.bad('Amount must be between 0 and the milestone amount'); end if;
  update public.payment_milestones
     set received_amount_enc = private.enc_num(p_amount), received_at = case when p_amount > 0 then now() end
   where id = p_milestone;
  perform private.audit('payment_record', 'milestone', p_milestone::text);
end $$;

create or replace function public.list_milestones(p_booking uuid)
returns table (id uuid, label text, due_date date, amount numeric, received_amount numeric, received_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_booking(p_booking) then perform private.forbid(); end if;
  return query select m.id, m.label, m.due_date, private.dec_num(m.amount_enc), coalesce(private.dec_num(m.received_amount_enc), 0), m.received_at
               from public.payment_milestones m where m.booking_id = p_booking order by m.due_date nulls last, m.created_at;
end $$;

-- ---------- clients (KYC) ----------
create or replace function public.list_clients()
returns table (lead_id uuid, name text, phone_hint text, project text, unit_no text, booking_id uuid, booking_status text,
               agreement_value numeric, received numeric, documents int, has_kyc boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.name, l.phone_hint, pr.name, u.unit_no, b.id, b.status, private.dec_num(b.agreement_value_enc),
         coalesce((select sum(private.dec_num(m.received_amount_enc)) from public.payment_milestones m where m.booking_id = b.id), 0),
         (select count(*)::int from public.documents d where d.lead_id = l.id),
         exists (select 1 from public.client_profiles c where c.lead_id = l.id and (c.pan_enc is not null or c.id_number_enc is not null))
  from public.bookings b
  join public.leads l on l.id = b.lead_id
  join public.units u on u.id = b.unit_id
  join public.projects pr on pr.id = u.project_id
  where b.status <> 'cancelled' and public.has_perm('clients')
    and (public.in_scope(l.owner_id) or l.created_by = auth.uid() or public.in_scope(b.closed_by))
  order by b.created_at desc $$;

create or replace function public.get_client_profile(p_lead uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.client_profiles;
begin
  if not public.has_perm('clients') or not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  select * into c from public.client_profiles where lead_id = p_lead;
  perform private.audit('view_pii', 'client', p_lead::text);
  return jsonb_build_object('pan', private.dec(c.pan_enc), 'id_number', private.dec(c.id_number_enc), 'address', private.dec(c.address_enc));
end $$;

create or replace function public.set_client_profile(p_lead uuid, p_pan text, p_id_number text, p_address text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.can_write('clients') or not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  if nullif(btrim(p_pan), '') is not null and upper(btrim(p_pan)) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then perform private.bad('PAN should look like ABCDE1234F'); end if;
  insert into public.client_profiles (lead_id, pan_enc, id_number_enc, address_enc, updated_at)
  values (p_lead, private.enc(upper(btrim(p_pan))), private.enc(btrim(p_id_number)), private.enc(btrim(p_address)), now())
  on conflict (lead_id) do update set pan_enc = excluded.pan_enc, id_number_enc = excluded.id_number_enc,
                                      address_enc = excluded.address_enc, updated_at = now();
  perform private.audit('edit_pii', 'client', p_lead::text);
end $$;

-- ---------- documents (rows are written only by the upload-document Edge Function) ----------
create or replace function public.can_upload_document(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.can_write('clients') or public.can_write('bookings')) and public.can_see_lead(p_lead) $$;

create or replace function public.svc_add_document(p_actor uuid, p_lead uuid, p_booking uuid, p_type text, p_path text,
                                                   p_name text, p_mime text, p_size int) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.documents (lead_id, booking_id, type, file_path, file_name, mime, size_bytes, uploaded_by)
  values (p_lead, p_booking, p_type, p_path, p_name, p_mime, p_size, p_actor) returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, 'document_upload', 'document', v_id::text, jsonb_build_object('lead', p_lead, 'type', p_type));
  return v_id;
end $$;

-- called by the browser right before it asks Storage for a 5-minute signed URL
create or replace function public.log_document_download(p_document uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document;
  if not found or not (public.has_perm('clients') or public.has_perm('bookings')) or not public.can_see_lead(d.lead_id) then
    perform private.forbid();
  end if;
  perform private.audit('download', 'document', p_document::text);
  return d.file_path;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.svc_add_document(uuid, uuid, uuid, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.svc_add_document(uuid, uuid, uuid, text, text, text, text, int) to service_role;
grant execute on function
  public.generate_units(uuid, int, int, int, text, numeric, numeric), public.hold_unit(uuid), public.release_unit(uuid),
  public.mark_visit_done(uuid, numeric, numeric, text),
  public.create_booking(jsonb), public.approve_booking(uuid), public.cancel_booking(uuid, text), public.list_bookings(),
  public.add_milestone(uuid, text, date, numeric), public.record_payment(uuid, numeric), public.list_milestones(uuid),
  public.list_clients(), public.get_client_profile(uuid), public.set_client_profile(uuid, text, text, text),
  public.can_upload_document(uuid), public.log_document_download(uuid)
  to authenticated;
