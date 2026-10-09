-- =====================================================================
-- 0009 · Attendance + GPS, tasks, incentives, reminders (Phases 5-6)
-- Locations are stored encrypted ("lat,lng"); coordinates are only ever
-- decrypted inside these functions for callers with the right permission.
-- =====================================================================

create or replace function private.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- great-circle distance in metres
create or replace function private.distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))::numeric $$;

create or replace function private.check_coords(p_lat numeric, p_lng numeric) returns void
language plpgsql as $$
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Location is required. Allow location access and try again.' using errcode = '22023';
  end if;
end $$;

-- ---------- attendance ----------
create or replace function public.check_in(p_lat numeric, p_lng numeric, p_accuracy real, p_consent boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare s public.company_settings; v_id uuid; v_loc text;
begin
  if not public.has_perm('attendance') then perform private.forbid(); end if;
  perform private.check_coords(p_lat, p_lng);
  if not coalesce(p_consent, false)
     and (select location_consent_at from public.profiles where id = auth.uid()) is null then
    perform private.bad('Location consent is required to check in');
  end if;
  if exists (select 1 from public.attendance where user_id = auth.uid() and work_date = private.today_ist()) then
    perform private.bad('You have already checked in today');
  end if;
  select * into s from public.company_settings where id = 1;
  if s.geofence_m is not null and s.office_lat is not null
     and private.distance_m(p_lat, p_lng, s.office_lat, s.office_lng) > s.geofence_m + coalesce(p_accuracy, 0) then
    perform private.bad('You are too far from the office to check in');
  end if;
  update public.profiles set location_consent_at = coalesce(location_consent_at, now()) where id = auth.uid();
  v_loc := p_lat::text || ',' || p_lng::text;
  insert into public.attendance (user_id, work_date, check_in_loc_enc)
  values (auth.uid(), private.today_ist(), private.enc(v_loc)) returning id into v_id;
  insert into public.location_pings (user_id, loc_enc, accuracy_m) values (auth.uid(), private.enc(v_loc), p_accuracy);
  return v_id;
end $$;

create or replace function public.check_out(p_lat numeric, p_lng numeric) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.check_coords(p_lat, p_lng);
  update public.attendance
     set check_out_at = now(), check_out_loc_enc = private.enc(p_lat::text || ',' || p_lng::text)
   where user_id = auth.uid() and work_date = private.today_ist() and check_out_at is null;
  if not found then perform private.bad('You are not checked in'); end if;
end $$;

-- accepted only between check-in and check-out; at most one ping a minute is stored
create or replace function public.record_ping(p_lat numeric, p_lng numeric, p_accuracy real) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.check_coords(p_lat, p_lng);
  if not exists (select 1 from public.attendance where user_id = auth.uid() and work_date = private.today_ist() and check_out_at is null) then
    return false;
  end if;
  if exists (select 1 from public.location_pings where user_id = auth.uid() and recorded_at > now() - interval '55 seconds') then
    return true;
  end if;
  insert into public.location_pings (user_id, loc_enc, accuracy_m)
  values (auth.uid(), private.enc(p_lat::text || ',' || p_lng::text), p_accuracy);
  return true;
end $$;

-- live map: last known position of everyone in scope who is checked in today
create or replace function public.live_locations()
returns table (user_id uuid, full_name text, role_label text, lat numeric, lng numeric, accuracy_m real,
               recorded_at timestamptz, status text, check_in_at timestamptz, check_out_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm('tracking') then perform private.forbid(); end if;
  return query
    select p.id, p.full_name, rp.label,
           split_part(private.dec(lp.loc_enc), ',', 1)::numeric, split_part(private.dec(lp.loc_enc), ',', 2)::numeric,
           lp.accuracy_m, lp.recorded_at,
           case when a.check_out_at is not null then 'offline'
                when lp.recorded_at > now() - interval '5 minutes' then 'online'
                when lp.recorded_at > now() - interval '20 minutes' then 'idle'
                else 'offline' end,
           a.check_in_at, a.check_out_at
    from public.attendance a
    join public.profiles p on p.id = a.user_id
    join public.role_presets rp on rp.role = p.role
    join lateral (select x.loc_enc, x.accuracy_m, x.recorded_at from public.location_pings x
                  where x.user_id = a.user_id order by x.recorded_at desc limit 1) lp on true
    where a.work_date = private.today_ist() and p.is_active and public.in_scope(a.user_id)
    order by p.full_name;
end $$;

-- one person's trail for a day (audited: this is sensitive)
create or replace function public.location_trail(p_user uuid, p_date date)
returns table (lat numeric, lng numeric, recorded_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_perm('tracking') or not public.in_scope(p_user) then perform private.forbid(); end if;
  perform private.audit('view_location_trail', 'profile', p_user::text, jsonb_build_object('date', p_date));
  return query
    select split_part(private.dec(x.loc_enc), ',', 1)::numeric, split_part(private.dec(x.loc_enc), ',', 2)::numeric, x.recorded_at
    from public.location_pings x
    where x.user_id = p_user and (x.recorded_at at time zone 'Asia/Kolkata')::date = p_date
    order by x.recorded_at;
end $$;

-- ---------- tasks ----------
create or replace function private.task_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is distinct from auth.uid() then
      insert into public.notifications (user_id, title, body, link) values (new.assigned_to, 'New task assigned', new.title, '/tasks');
    end if;
  else
    if new.status = 'done' and old.status <> 'done' then new.done_at := now(); end if;
    if new.status = 'open' then new.done_at := null; end if;
    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is distinct from auth.uid() then
      insert into public.notifications (user_id, title, body, link) values (new.assigned_to, 'Task assigned to you', new.title, '/tasks');
    end if;
  end if;
  return new;
end $$;
create trigger task_changed before insert or update on public.tasks
  for each row execute function private.task_changed();

-- ---------- incentives ----------
create or replace function public.list_incentives()
returns table (id uuid, booking_id uuid, user_id uuid, user_name text, lead_name text, project text, unit_no text,
               agreement_value numeric, amount numeric, rule text, status text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.booking_id, i.user_id, p.full_name, l.name, pr.name, u.unit_no,
         private.dec_num(b.agreement_value_enc), private.dec_num(i.amount_enc),
         case when r.id is null then null when r.calc = 'percent' then trim(to_char(r.value, 'FM990.00')) || '%' else 'Fixed' end,
         i.status, i.created_at, i.paid_at
  from public.incentives i
  join public.bookings b on b.id = i.booking_id
  join public.leads l on l.id = b.lead_id
  join public.units u on u.id = b.unit_id
  join public.projects pr on pr.id = u.project_id
  join public.profiles p on p.id = i.user_id
  left join public.incentive_rules r on r.id = i.rule_id
  where i.user_id = auth.uid() or (public.has_perm('incentives') and public.in_scope(i.user_id) and public.my_scope() <> 'own')
  order by i.created_at desc $$;

create or replace function public.set_incentive_status(p_incentive uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare i public.incentives;
begin
  if not public.has_perm('incentives.approve') then perform private.forbid(); end if;
  select * into i from public.incentives where id = p_incentive;
  if not found then perform private.forbid(); end if;
  if i.user_id = auth.uid() then perform private.forbid('You cannot approve your own incentive'); end if;
  if not ((i.status = 'pending' and p_status = 'approved') or (i.status = 'approved' and p_status = 'paid')
          or (i.status in ('pending', 'approved') and p_status = 'cancelled')) then
    perform private.bad('That status change is not allowed');
  end if;
  update public.incentives
     set status = p_status, approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_incentive;
  perform private.audit('incentive_' || p_status, 'incentive', p_incentive::text);
  if p_status in ('approved', 'paid') then
    insert into public.notifications (user_id, title, body, link)
    values (i.user_id, 'Incentive ' || p_status, null, '/incentives');
  end if;
end $$;

-- ---------- reminders (scheduled) ----------
-- 09:00 IST daily: follow-ups due today/overdue, and visits scheduled for today
create or replace function private.daily_reminders() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, title, body, link)
  select l.owner_id, 'Follow-ups due today',
         count(*)::text || ' lead' || case when count(*) > 1 then 's need' else ' needs' end || ' a follow-up', '/leads?due=1'
  from public.leads l
  where l.owner_id is not null and l.stage not in ('booked', 'lost')
    and (l.next_follow_up_at at time zone 'Asia/Kolkata')::date <= private.today_ist()
  group by l.owner_id;

  insert into public.notifications (user_id, title, body, link)
  select v.executive_id, 'Site visits today', count(*)::text || ' visit' || case when count(*) > 1 then 's' else '' end || ' scheduled', '/visits'
  from public.site_visits v
  where v.status in ('scheduled', 'confirmed') and (v.scheduled_at at time zone 'Asia/Kolkata')::date = private.today_ist()
  group by v.executive_id;
end $$;

-- 10:30 IST Mon-Sat: tell each manager who on their team has not checked in
create or replace function private.checkin_nudges() returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, link)
  select m.id, 'Team not checked in', string_agg(p.full_name, ', ' order by p.full_name), '/attendance'
  from public.profiles p
  join public.profiles m on m.id = p.manager_id and m.is_active
  join public.role_presets rp on rp.role = p.role and 'attendance' = any(rp.modules)
  where p.is_active
    and not exists (select 1 from public.attendance a where a.user_id = p.id and a.work_date = private.today_ist())
  group by m.id $$;

-- notifications older than 60 days are dropped
create or replace function private.purge_old_notifications() returns void
language sql security definer set search_path = '' as $$
  delete from public.notifications where created_at < now() - interval '60 days' $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.check_in(numeric, numeric, real, boolean), public.check_out(numeric, numeric), public.record_ping(numeric, numeric, real),
  public.live_locations(), public.location_trail(uuid, date), public.list_incentives(), public.set_incentive_status(uuid, text)
  to authenticated;

-- UTC times: 03:30 = 09:00 IST, 05:00 = 10:30 IST
select cron.schedule('crm-daily-reminders',    '30 3 * * *',   $$select private.daily_reminders()$$);
select cron.schedule('crm-checkin-nudges',     '0 5 * * 1-6',  $$select private.checkin_nudges()$$);
select cron.schedule('crm-purge-notifications','10 21 * * *',  $$select private.purge_old_notifications()$$);

-- live updates in the browser (RLS still applies to what each user receives)
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.leads;
