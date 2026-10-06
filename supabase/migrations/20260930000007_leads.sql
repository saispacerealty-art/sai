-- =====================================================================
-- 0007 · Leads (Phase 2)
-- Every write that touches a phone/email/note goes through these
-- SECURITY DEFINER functions: they check permission + scope, encrypt,
-- maintain the blind index, log to the timeline and audit log.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;
create index if not exists leads_name_trgm on public.leads using gin (name extensions.gin_trgm_ops);

create or replace function private.forbid(p_msg text default 'You do not have permission to do that')
returns void language plpgsql as $$
begin raise exception '%', p_msg using errcode = '42501'; end $$;

create or replace function private.bad(p_msg text) returns void language plpgsql as $$
begin raise exception '%', p_msg using errcode = '22023'; end $$;

-- ---------- score (0-100): how warm is this lead ----------
create or replace function private.lead_score(l public.leads) returns int
language sql stable set search_path = '' as $$
  select case when l.stage = 'lost' then 0 else least(100, greatest(0,
      (case l.stage when 'new' then 5 when 'contacted' then 15 when 'qualified' then 30 when 'visit_scheduled' then 40
                    when 'visit_done' then 55 when 'negotiation' then 70 when 'booked' then 100 else 0 end)
    + (case when l.budget_max is not null or l.budget_min is not null then 8 else 0 end)
    + (case when l.project_id is not null then 7 else 0 end)
    + (case when l.source in ('Referral', 'Walk-in') then 10 else 0 end)
    + (case when l.last_activity_at > now() - interval '3 days' then 10
            when l.last_activity_at > now() - interval '7 days' then 5
            when l.last_activity_at < now() - interval '21 days' then -15
            when l.last_activity_at < now() - interval '7 days' then -5 else 0 end)
  )) end $$;

-- replaces the 0003 guard: same rules, plus score upkeep and a smarter "last activity"
create or replace function private.leads_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      if auth.uid() is not null and not public.has_perm('leads.assign')
         and not (old.owner_id is null and new.owner_id = auth.uid()) then
        perform private.forbid('You do not have permission to reassign leads');
      end if;
      insert into public.lead_activities (lead_id, type, body, meta)
      values (new.id, 'assign', 'Lead reassigned', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
      if new.owner_id is not null and new.owner_id is distinct from auth.uid() then
        insert into public.notifications (user_id, title, body, link)
        values (new.owner_id, 'New lead assigned', new.name, '/leads?open=' || new.id);
      end if;
      new.last_activity_at := now();
    end if;
    if new.stage is distinct from old.stage then
      if new.stage <> 'lost' then new.lost_reason := null; end if;
      insert into public.lead_activities (lead_id, type, body, meta)
      values (new.id, 'stage', 'Stage changed',
              jsonb_build_object('from', old.stage, 'to', new.stage, 'reason', new.lost_reason));
      new.last_activity_at := now();
    end if;
    if new.next_follow_up_at is distinct from old.next_follow_up_at then new.last_activity_at := now(); end if;
  end if;
  new.score := private.lead_score(new);
  return new;
end $$;
drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before insert or update on public.leads
  for each row execute function private.leads_guard();
revoke update (score) on public.leads from authenticated;   -- computed, not user-editable

-- ---------- assignment helper: least-loaded active sales person ----------
create or replace function private.next_assignee() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.is_active and p.role in ('sales', 'telecaller')
  order by (select count(*) from public.leads l where l.owner_id = p.id and l.created_at > now() - interval '1 day'),
           (select count(*) from public.leads l where l.owner_id = p.id and l.stage not in ('booked', 'lost')),
           p.created_at
  limit 1 $$;

-- ---------- core insert with duplicate handling ----------
-- returns {id, duplicate}. A duplicate phone never creates a second lead:
-- the enquiry is logged on the existing lead and its owner is told.
create or replace function private.upsert_lead(p jsonb, p_actor uuid, p_owner uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p ->> 'phone');
  v_name  text := btrim(coalesce(p ->> 'name', ''));
  v_bidx  text;
  v_old   public.leads;
  v_id    uuid;
  v_days  int;
  v_src   text := coalesce(nullif(btrim(p ->> 'source'), ''), 'Manual');
begin
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then perform private.bad('Enter a valid 10-digit mobile number'); end if;
  if length(v_name) < 1 or length(v_name) > 80 then perform private.bad('Enter the lead''s name (up to 80 characters)'); end if;
  v_bidx := private.bidx(v_phone);

  select * into v_old from public.leads where phone_bidx = v_bidx;
  if found then
    insert into public.lead_activities (lead_id, type, body, meta, created_by)
    values (v_old.id, 'system', 'Duplicate enquiry received', jsonb_build_object('source', v_src), p_actor);
    update public.leads set last_activity_at = now() where id = v_old.id;
    if v_old.owner_id is not null and v_old.owner_id is distinct from p_actor then
      insert into public.notifications (user_id, title, body, link)
      values (v_old.owner_id, 'Repeat enquiry on your lead', v_old.name || ' · ' || v_src, '/leads?open=' || v_old.id);
    end if;
    return jsonb_build_object('id', v_old.id, 'duplicate', true);
  end if;

  select follow_up_default_days into v_days from public.company_settings where id = 1;
  insert into public.leads (name, phone_enc, phone_hint, phone_bidx, alt_phone_enc, email_enc, source, source_ref,
                            project_id, budget_min, budget_max, config_wanted, owner_id, created_by, next_follow_up_at)
  values (v_name, private.enc(v_phone), public.phone_hint(v_phone), v_bidx,
          private.enc(public.normalize_phone(p ->> 'alt_phone')), private.enc(lower(nullif(btrim(p ->> 'email'), ''))),
          v_src, nullif(p ->> 'source_ref', ''),
          nullif(p ->> 'project_id', '')::uuid, nullif(p ->> 'budget_min', '')::numeric, nullif(p ->> 'budget_max', '')::numeric,
          nullif(btrim(p ->> 'config_wanted'), ''), p_owner, p_actor,
          coalesce(nullif(p ->> 'next_follow_up_at', '')::timestamptz, now() + make_interval(days => coalesce(v_days, 2))))
  returning id into v_id;

  insert into public.lead_activities (lead_id, type, body, meta, created_by)
  values (v_id, 'system', 'Lead created', jsonb_build_object('source', v_src), p_actor);
  if nullif(btrim(p ->> 'note'), '') is not null then
    insert into public.lead_activities (lead_id, type, body_enc, created_by) values (v_id, 'note', private.enc(p ->> 'note'), p_actor);
  end if;
  if p_owner is not null and p_owner is distinct from p_actor then
    insert into public.notifications (user_id, title, body, link)
    values (p_owner, 'New lead assigned', v_name || ' · ' || v_src, '/leads?open=' || v_id);
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- ---------- public RPCs ----------
create or replace function public.create_lead(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_owner uuid := nullif(p ->> 'owner_id', '')::uuid; v_res jsonb;
begin
  if not public.can_write('leads') then perform private.forbid(); end if;
  if v_owner is null then v_owner := auth.uid();
  elsif v_owner <> auth.uid() and not public.has_perm('leads.assign') then
    perform private.forbid('You can only create leads for yourself');
  end if;
  if not exists (select 1 from public.profiles where id = v_owner and is_active) then perform private.bad('Selected owner is not active'); end if;
  v_res := private.upsert_lead(p, auth.uid(), v_owner);
  return v_res || jsonb_build_object('visible', public.can_see_lead((v_res ->> 'id')::uuid));
end $$;

create or replace function public.update_lead_contact(p_lead uuid, p_phone text, p_alt_phone text, p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_phone text := public.normalize_phone(p_phone); v_bidx text;
begin
  if not public.can_write('leads') or not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then perform private.bad('Enter a valid 10-digit mobile number'); end if;
  v_bidx := private.bidx(v_phone);
  if exists (select 1 from public.leads where phone_bidx = v_bidx and id <> p_lead) then
    perform private.bad('Another lead already has this mobile number');
  end if;
  update public.leads
     set phone_enc = private.enc(v_phone), phone_hint = public.phone_hint(v_phone), phone_bidx = v_bidx,
         alt_phone_enc = private.enc(public.normalize_phone(p_alt_phone)),
         email_enc = private.enc(lower(nullif(btrim(p_email), '')))
   where id = p_lead;
  perform private.audit('edit_pii', 'lead', p_lead::text);
end $$;

-- Decrypts contact details for one lead. Every call is audited.
--   purpose 'view'     -> needs leads.view_contact
--   purpose 'call' / 'whatsapp' -> anyone who can see the lead (they must be able to dial); logged on the timeline
create or replace function public.reveal_lead_contact(p_lead uuid, p_purpose text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare l public.leads;
begin
  if p_purpose not in ('view', 'call', 'whatsapp') then perform private.bad('Unknown purpose'); end if;
  if not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  if p_purpose = 'view' and not public.has_perm('leads.view_contact') then
    perform private.forbid('Your account cannot view full phone numbers');
  end if;
  select * into l from public.leads where id = p_lead;
  perform private.audit('view_pii', 'lead', p_lead::text, jsonb_build_object('purpose', p_purpose));
  if p_purpose in ('call', 'whatsapp') then
    insert into public.lead_activities (lead_id, type, body)
    values (p_lead, p_purpose, case p_purpose when 'call' then 'Call started' else 'WhatsApp opened' end);
    update public.leads set last_activity_at = now() where id = p_lead;
  end if;
  return jsonb_build_object('phone', private.dec(l.phone_enc), 'alt_phone', private.dec(l.alt_phone_enc), 'email', private.dec(l.email_enc));
end $$;

create or replace function public.add_lead_note(p_lead uuid, p_text text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.can_write('leads') or not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  if length(btrim(coalesce(p_text, ''))) < 1 or length(p_text) > 4000 then perform private.bad('Note must be 1 to 4000 characters'); end if;
  insert into public.lead_activities (lead_id, type, body_enc) values (p_lead, 'note', private.enc(btrim(p_text)));
  update public.leads set last_activity_at = now() where id = p_lead;
end $$;

create or replace function public.lead_timeline(p_lead uuid)
returns table (id bigint, type text, body text, meta jsonb, created_by uuid, created_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_see_lead(p_lead) then perform private.forbid(); end if;
  return query
    select a.id, a.type, coalesce(private.dec(a.body_enc), a.body), a.meta, a.created_by, p.full_name, a.created_at
    from public.lead_activities a left join public.profiles p on p.id = a.created_by
    where a.lead_id = p_lead order by a.created_at desc, a.id desc limit 200;
end $$;

-- exact-match phone search (no partial search is possible on encrypted data)
create or replace function public.find_lead_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.leads l
  where l.phone_bidx = private.bidx(public.normalize_phone(p_phone)) and public.can_see_lead(l.id) $$;

-- bulk import: [{name, phone, source?, project_id?, budget_min?, budget_max?, config_wanted?, note?}, ...]
create or replace function public.import_leads(p_rows jsonb, p_owner uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb; v_res jsonb; v_created int := 0; v_dup int := 0; v_bad jsonb := '[]'; i int := 0; v_owner uuid; v_rr boolean;
begin
  if not public.has_perm('leads.import') then perform private.forbid(); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then perform private.bad('Import up to 2000 rows at a time'); end if;
  select round_robin into v_rr from public.company_settings where id = 1;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_owner := coalesce(p_owner, case when v_rr then private.next_assignee() end);
      v_res := private.upsert_lead(r || jsonb_build_object('source', coalesce(nullif(r ->> 'source', ''), 'Import')), auth.uid(), v_owner);
      if (v_res ->> 'duplicate')::boolean then v_dup := v_dup + 1; else v_created := v_created + 1; end if;
    exception when sqlstate '22023' or sqlstate '22P02' or sqlstate '23503' then
      v_bad := v_bad || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  perform private.audit('import', 'lead', null, jsonb_build_object('created', v_created, 'duplicates', v_dup, 'rejected', jsonb_array_length(v_bad)));
  return jsonb_build_object('created', v_created, 'duplicates', v_dup, 'rejected', v_bad);
end $$;

-- export with full phone numbers: needs leads.export, always audited
create or replace function public.export_leads()
returns table (name text, phone text, email text, source text, project text, stage text, budget_min numeric, budget_max numeric,
               owner text, next_follow_up_at timestamptz, created_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_perm('leads.export') then perform private.forbid(); end if;
  perform private.audit('export', 'lead', null);
  return query
    select l.name, private.dec(l.phone_enc), private.dec(l.email_enc), l.source, pr.name, l.stage, l.budget_min, l.budget_max,
           o.full_name, l.next_follow_up_at, l.created_at
    from public.leads l
    left join public.projects pr on pr.id = l.project_id
    left join public.profiles o on o.id = l.owner_id
    where l.anonymized_at is null and (public.in_scope(l.owner_id) or l.created_by = auth.uid())
    order by l.created_at desc;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.create_lead(jsonb), public.update_lead_contact(uuid, text, text, text), public.reveal_lead_contact(uuid, text),
  public.add_lead_note(uuid, text), public.lead_timeline(uuid), public.find_lead_by_phone(text),
  public.import_leads(jsonb, uuid), public.export_leads()
  to authenticated;

-- nightly: let idle leads cool down
create or replace function private.refresh_lead_scores() returns void
language sql security definer set search_path = '' as $$
  update public.leads l set score = private.lead_score(l)
   where l.stage not in ('booked', 'lost') and l.score is distinct from private.lead_score(l) $$;
revoke execute on function private.refresh_lead_scores() from public, anon, authenticated;
select cron.schedule('crm-refresh-lead-scores', '15 20 * * *', $$select private.refresh_lead_scores()$$);
