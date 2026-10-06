-- =====================================================================
-- 0010 · Dashboard, reports, settings, lead webhooks (Phases 7-8)
-- All figures respect the caller's data scope (own / team / all).
-- =====================================================================

create or replace function private.lead_in_scope(l public.leads) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.in_scope(l.owner_id) or l.created_by = auth.uid() $$;

-- ---------- dashboard ----------
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_leads boolean := public.has_perm('leads'); v_visits boolean := public.has_perm('visits');
  v_book boolean := public.has_perm('bookings'); v_inc boolean := public.has_perm('incentives');
  v_today date := private.today_ist(); out jsonb := '{}';
begin
  if not public.has_perm('dashboard') then perform private.forbid(); end if;

  if v_leads then
    out := out || (
      select jsonb_build_object(
        'leads_total', count(*),
        'leads_new_7d', count(*) filter (where l.created_at > now() - interval '7 days'),
        'leads_open', count(*) filter (where l.stage not in ('booked', 'lost')),
        'followups_today', count(*) filter (where l.stage not in ('booked', 'lost') and (l.next_follow_up_at at time zone 'Asia/Kolkata')::date = v_today),
        'followups_overdue', count(*) filter (where l.stage not in ('booked', 'lost') and (l.next_follow_up_at at time zone 'Asia/Kolkata')::date < v_today))
      from public.leads l where l.anonymized_at is null and private.lead_in_scope(l));
    out := out || jsonb_build_object('pipeline', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'count', coalesce(c.n, 0)) order by s.ord), '[]')
      from unnest(array['new','contacted','qualified','visit_scheduled','visit_done','negotiation','booked','lost']) with ordinality s(stage, ord)
      left join (select l.stage, count(*) n from public.leads l where l.anonymized_at is null and private.lead_in_scope(l) group by l.stage) c using (stage)));
    out := out || jsonb_build_object('due_leads', (
      select coalesce(jsonb_agg(x order by x.next_follow_up_at), '[]') from (
        select l.id, l.name, l.phone_hint, l.stage, l.next_follow_up_at from public.leads l
        where l.owner_id = auth.uid() and l.stage not in ('booked', 'lost')
          and (l.next_follow_up_at at time zone 'Asia/Kolkata')::date <= v_today
        order by l.next_follow_up_at limit 8) x));
  end if;

  if v_visits then
    out := out || (
      select jsonb_build_object(
        'visits_upcoming', count(*) filter (where v.status in ('scheduled', 'confirmed') and v.scheduled_at >= now()),
        'visits_done_30d', count(*) filter (where v.status = 'done' and v.done_at > now() - interval '30 days'))
      from public.site_visits v where public.in_scope(v.executive_id) or v.created_by = auth.uid());
    out := out || jsonb_build_object('upcoming_visits', (
      select coalesce(jsonb_agg(x order by x.scheduled_at), '[]') from (
        select v.id, l.name as lead_name, pr.name as project, v.scheduled_at, v.status, p.full_name as executive
        from public.site_visits v join public.leads l on l.id = v.lead_id
        left join public.projects pr on pr.id = v.project_id join public.profiles p on p.id = v.executive_id
        where v.status in ('scheduled', 'confirmed') and v.scheduled_at > now() - interval '3 hours'
          and (public.in_scope(v.executive_id) or v.created_by = auth.uid())
        order by v.scheduled_at limit 6) x));
  end if;

  if v_book then
    out := out || (
      select jsonb_build_object(
        'bookings_30d', count(*) filter (where b.status = 'approved' and b.approved_at > now() - interval '30 days'),
        'bookings_pending', count(*) filter (where b.status = 'pending'),
        'revenue_30d', coalesce(sum(private.dec_num(b.agreement_value_enc)) filter (where b.status = 'approved' and b.approved_at > now() - interval '30 days'), 0))
      from public.bookings b where public.in_scope(b.closed_by) or b.created_by = auth.uid());
  end if;

  if v_inc then
    out := out || (
      select jsonb_build_object(
        'my_incentive_pending', coalesce(sum(private.dec_num(i.amount_enc)) filter (where i.status in ('pending', 'approved')), 0),
        'my_incentive_paid', coalesce(sum(private.dec_num(i.amount_enc)) filter (where i.status = 'paid'), 0))
      from public.incentives i where i.user_id = auth.uid());
  end if;

  out := out || jsonb_build_object(
    'tasks_open', (select count(*) from public.tasks t where t.assigned_to = auth.uid() and t.status = 'open'),
    'tasks_overdue', (select count(*) from public.tasks t where t.assigned_to = auth.uid() and t.status = 'open' and t.due_at < now()),
    'checked_in', exists (select 1 from public.attendance a where a.user_id = auth.uid() and a.work_date = v_today and a.check_out_at is null));
  return out;
end $$;

-- ---------- reports (need the `reports` module) ----------
create or replace function public.report_sources(p_from date, p_to date)
returns table (source text, leads bigint, visits bigint, booked bigint, lost bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm('reports') then perform private.forbid(); end if;
  return query
    select l.source, count(*),
           count(*) filter (where l.stage in ('visit_done', 'negotiation', 'booked')),
           count(*) filter (where l.stage = 'booked'), count(*) filter (where l.stage = 'lost')
    from public.leads l
    where l.created_at::date between p_from and p_to and private.lead_in_scope(l)
    group by l.source order by count(*) desc;
end $$;

create or replace function public.report_team(p_from date, p_to date)
returns table (user_id uuid, full_name text, role_label text, leads bigint, visits_done bigint, bookings bigint, revenue numeric, days_present bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm('reports') then perform private.forbid(); end if;
  return query
    select p.id, p.full_name, rp.label,
      (select count(*) from public.leads l where l.owner_id = p.id and l.created_at::date between p_from and p_to),
      (select count(*) from public.site_visits v where v.executive_id = p.id and v.status = 'done' and v.done_at::date between p_from and p_to),
      (select count(*) from public.bookings b where b.closed_by = p.id and b.status = 'approved' and b.booking_date between p_from and p_to),
      coalesce((select sum(private.dec_num(b.agreement_value_enc)) from public.bookings b
                where b.closed_by = p.id and b.status = 'approved' and b.booking_date between p_from and p_to), 0),
      (select count(*) from public.attendance a where a.user_id = p.id and a.work_date between p_from and p_to)
    from public.profiles p join public.role_presets rp on rp.role = p.role
    where p.is_active and p.role not in ('owner', 'admin', 'analyst', 'marketing') and public.in_scope(p.id)
    order by 7 desc, 4 desc;
end $$;

create or replace function public.report_monthly(p_months int default 6)
returns table (month date, leads bigint, bookings bigint, revenue numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm('reports') then perform private.forbid(); end if;
  return query
    select m::date,
      (select count(*) from public.leads l where date_trunc('month', l.created_at) = m and private.lead_in_scope(l)),
      (select count(*) from public.bookings b where b.status = 'approved' and date_trunc('month', b.booking_date) = m and public.in_scope(b.closed_by)),
      coalesce((select sum(private.dec_num(b.agreement_value_enc)) from public.bookings b
                where b.status = 'approved' and date_trunc('month', b.booking_date) = m and public.in_scope(b.closed_by)), 0)
    from generate_series(date_trunc('month', now()) - make_interval(months => least(greatest(p_months, 1), 24) - 1),
                         date_trunc('month', now()), interval '1 month') m
    order by 1;
end $$;

-- the browser calls this whenever it turns a report into a CSV
create or replace function public.log_export(p_kind text, p_rows int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_perm('leads.export') then perform private.forbid('Your account cannot export data'); end if;
  perform private.audit('export', left(p_kind, 40), null, jsonb_build_object('rows', p_rows));
end $$;

-- ---------- settings ----------
create or replace function public.update_role_preset(p_role text, p_modules text[], p_flags text[], p_scope text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  ok_modules text[] := array['dashboard','leads','projects','visits','bookings','clients','tasks','attendance','tracking','employees','incentives','reports','settings'];
  ok_flags   text[] := array['leads.assign','leads.delete','leads.import','leads.export','leads.view_contact','projects.edit','bookings.approve','incentives.approve','employees.manage','read_only'];
begin
  if not public.can_write('settings') then perform private.forbid(); end if;
  if p_role in ('owner', 'admin') then perform private.bad('Owner and Admin presets cannot be changed'); end if;
  if not (p_modules <@ ok_modules) or not (p_flags <@ ok_flags) or p_scope not in ('own', 'team', 'all') then perform private.bad('Unknown permission'); end if;
  if not ('dashboard' = any(p_modules)) then p_modules := array_prepend('dashboard', p_modules); end if;
  update public.role_presets set modules = p_modules, flags = p_flags, scope = p_scope where role = p_role;
  if not found then perform private.bad('Unknown role'); end if;
  perform private.audit('perm_change', 'role_preset', p_role, jsonb_build_object('modules', p_modules, 'flags', p_flags, 'scope', p_scope));
end $$;

create or replace function public.audit_feed(p_limit int default 100)
returns table (id bigint, actor text, action text, entity text, entity_id text, meta jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm('settings') then perform private.forbid(); end if;
  return query
    select a.id, p.full_name, a.action, a.entity, a.entity_id, a.meta, a.created_at
    from public.audit_log a left join public.profiles p on p.id = a.actor_id
    order by a.created_at desc, a.id desc limit least(greatest(p_limit, 1), 500);
end $$;

-- ---------- lead webhooks ----------
-- The secret is shown once, at creation; only its ciphertext is stored.
create or replace function public.create_webhook(p_source text, p_owner uuid, p_project uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_secret text := encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid;
begin
  if not public.can_write('settings') then perform private.forbid(); end if;
  if btrim(coalesce(p_source, '')) !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,39}$' then perform private.bad('Source name: 2-40 letters, digits, spaces, . _ -'); end if;
  insert into public.lead_webhooks (source_name, secret_enc, default_owner_id, default_project_id)
  values (btrim(p_source), private.enc(v_secret), p_owner, p_project) returning id into v_id;
  perform private.audit('webhook_create', 'webhook', v_id::text, jsonb_build_object('source', btrim(p_source)));
  return jsonb_build_object('id', v_id, 'secret', v_secret);
exception when unique_violation then
  raise exception 'A webhook with that source name already exists' using errcode = '22023';
end $$;

create or replace function public.set_webhook(p_id uuid, p_active boolean, p_delete boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.can_write('settings') then perform private.forbid(); end if;
  if p_delete then delete from public.lead_webhooks where id = p_id;
  else update public.lead_webhooks set active = p_active where id = p_id; end if;
  perform private.audit(case when p_delete then 'webhook_delete' else 'webhook_update' end, 'webhook', p_id::text);
end $$;

-- service-role only: used by the lead-intake Edge Function
create or replace function public.svc_webhook_secret(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('secret', private.dec(w.secret_enc), 'active', w.active, 'source', w.source_name)
  from public.lead_webhooks w where w.id = p_id $$;

create or replace function public.svc_intake_lead(p_id uuid, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare w public.lead_webhooks; v_owner uuid; v_rr boolean;
begin
  select * into w from public.lead_webhooks where id = p_id and active;
  if not found then raise exception 'Unknown or inactive webhook' using errcode = '22023'; end if;
  select round_robin into v_rr from public.company_settings where id = 1;
  v_owner := coalesce(w.default_owner_id, case when v_rr then private.next_assignee() end);
  return private.upsert_lead(
    jsonb_build_object('name', p ->> 'name', 'phone', p ->> 'phone', 'email', p ->> 'email', 'note', p ->> 'note',
                       'budget_min', p ->> 'budget_min', 'budget_max', p ->> 'budget_max', 'config_wanted', p ->> 'config_wanted',
                       'source_ref', left(p ->> 'source_ref', 200),
                       'source', w.source_name, 'project_id', coalesce(nullif(p ->> 'project_id', ''), w.default_project_id::text)),
    null, v_owner);
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.svc_webhook_secret(uuid), public.svc_intake_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.svc_webhook_secret(uuid), public.svc_intake_lead(uuid, jsonb) to service_role;
grant execute on function
  public.dashboard_stats(), public.report_sources(date, date), public.report_team(date, date), public.report_monthly(int),
  public.log_export(text, int), public.update_role_preset(text, text[], text[], text), public.audit_feed(int),
  public.create_webhook(text, uuid, uuid), public.set_webhook(uuid, boolean, boolean)
  to authenticated;
