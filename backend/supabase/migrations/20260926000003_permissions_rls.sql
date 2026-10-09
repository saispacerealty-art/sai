-- =====================================================================
-- 0003 · Permissions engine + Row-Level Security (PLAN.md §3, §6B-4)
--
-- Deny by default: anon gets nothing; authenticated gets only the table
-- privileges granted below (column-level where it matters), and RLS then
-- filters rows. Encrypted columns are never directly writable — they are
-- filled by SECURITY DEFINER RPCs added in later phases.
-- =====================================================================

-- ---------- role presets ----------
insert into public.role_presets (role, label, modules, flags, scope, sort) values
 ('owner',      'Owner',             '{}', '{}', 'all', 0),   -- bypasses all checks
 ('admin',      'Admin',
   array['dashboard','leads','projects','visits','bookings','clients','tasks','attendance','tracking','employees','incentives','reports','settings'],
   array['leads.assign','leads.delete','leads.import','leads.export','leads.view_contact','projects.edit','bookings.approve','incentives.approve','employees.manage'],
   'all', 10),
 ('manager',    'Manager',
   array['dashboard','leads','projects','visits','bookings','clients','tasks','attendance','tracking','employees','incentives','reports'],
   array['leads.assign','leads.import','leads.export','leads.view_contact','projects.edit','bookings.approve'],
   'team', 20),
 ('sales',      'Sales Person',
   array['dashboard','leads','projects','visits','bookings','clients','tasks','attendance','incentives'],
   array['leads.view_contact'], 'own', 30),
 ('telecaller', 'Telecaller',
   array['dashboard','leads','projects','visits','tasks','attendance'],
   '{}', 'own', 40),
 ('marketing',  'Digital Marketing',
   array['dashboard','leads','projects','reports'],
   array['leads.import','read_only'], 'all', 50),
 ('analyst',    'Analyst',
   array['dashboard','projects','bookings','incentives','reports'],
   array['leads.export','read_only'], 'all', 60),
 ('team_member','Team Member',
   array['dashboard','leads','projects','visits','tasks','attendance'],
   '{}', 'own', 70);

-- ---------- permission helpers (used by RLS; must be callable by authenticated) ----------
create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when not pr.is_active or (pr.locked_until is not null and pr.locked_until > now()) then false
      when pr.role = 'owner' then p_key <> 'read_only'
      else coalesce(
        (select o.allowed from public.user_overrides o where o.user_id = pr.id and o.key = p_key),
        p_key = any(rp.modules) or p_key = any(rp.flags))
    end
    from public.profiles pr
    join public.role_presets rp on rp.role = pr.role
    where pr.id = (select auth.uid())
  ), false) $$;

-- module access AND not a read-only account
create or replace function public.can_write(p_module text) returns boolean
language sql stable set search_path = '' as $$
  select public.has_perm(p_module) and not public.has_perm('read_only') $$;

create or replace function public.my_scope() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(pr.scope_override, rp.scope)
  from public.profiles pr join public.role_presets rp on rp.role = pr.role
  where pr.id = (select auth.uid()) $$;

-- true if a record belonging to p_user is inside the caller's data scope
create or replace function public.in_scope(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_scope()
    when 'all'  then true
    when 'team' then p_user = (select auth.uid())
                  or exists (select 1 from public.profiles p
                             where p.id = p_user and p.manager_id = (select auth.uid()))
    when 'own'  then p_user = (select auth.uid())
    else false
  end $$;

-- lead visibility: module + (owner or creator in scope)
create or replace function public.can_see_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead
      and (public.has_perm('leads') or public.has_perm('clients') or public.has_perm('bookings'))
      and (public.in_scope(l.owner_id) or l.created_by = (select auth.uid()))
  ) $$;

-- effective permissions for the signed-in user (drives the UI; the DB still re-checks everything)
create or replace function public.my_permissions() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select pr.*, rp.modules, rp.flags, rp.scope, rp.label
    from public.profiles pr join public.role_presets rp on rp.role = pr.role
    where pr.id = (select auth.uid())
  ), keys as (
    select unnest(array['dashboard','leads','projects','visits','bookings','clients','tasks','attendance','tracking','employees','incentives','reports','settings',
                        'leads.assign','leads.delete','leads.import','leads.export','leads.view_contact','projects.edit','bookings.approve','incentives.approve','employees.manage','read_only']) k
  )
  select jsonb_build_object(
    'user_id', me.id, 'username', me.username, 'full_name', me.full_name,
    'role', me.role, 'role_label', me.label,
    'scope', coalesce(me.scope_override, me.scope),
    'must_change_password', me.must_change_password,
    'granted', (select coalesce(jsonb_agg(k order by k), '[]') from keys where public.has_perm(k))
  ) from me $$;

-- ---------- lock everything down, then grant selectively ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant execute on function public.has_perm(text), public.can_write(text), public.my_scope(),
                          public.in_scope(uuid), public.can_see_lead(uuid), public.my_permissions(),
                          public.normalize_phone(text), public.phone_hint(text)
  to authenticated;

alter table public.role_presets       enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_overrides     enable row level security;
alter table public.company_settings   enable row level security;
alter table public.projects           enable row level security;
alter table public.towers             enable row level security;
alter table public.units              enable row level security;
alter table public.leads              enable row level security;
alter table public.lead_activities    enable row level security;
alter table public.client_profiles    enable row level security;
alter table public.site_visits        enable row level security;
alter table public.bookings           enable row level security;
alter table public.payment_milestones enable row level security;
alter table public.documents          enable row level security;
alter table public.tasks              enable row level security;
alter table public.attendance         enable row level security;
alter table public.location_pings     enable row level security;
alter table public.incentive_rules    enable row level security;
alter table public.incentives         enable row level security;
alter table public.notifications      enable row level security;
alter table public.lead_webhooks      enable row level security;
alter table public.audit_log          enable row level security;

-- ---------- role_presets / overrides ----------
grant select on public.role_presets to authenticated;
create policy role_presets_read on public.role_presets for select to authenticated using (true);
-- presets are edited only via RPC (settings), added in Phase 1

grant select on public.user_overrides to authenticated;
create policy overrides_read on public.user_overrides for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('employees'));

-- ---------- profiles ----------
-- Colleagues' names/roles are needed for assignment lists. Security-relevant
-- columns (failed_logins, locked_until, phone_enc) are not granted.
grant select (id, username, full_name, role, manager_id, is_active, phone_hint, created_at)
  on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (true);
-- all profile writes go through the admin Edge Function / RPCs (Phase 1)

-- ---------- company settings ----------
grant select on public.company_settings to authenticated;
grant update (name, phone, address, follow_up_default_days, hold_hours, round_robin,
              office_lat, office_lng, geofence_m, lead_sources, lost_reasons)
  on public.company_settings to authenticated;
create policy settings_read   on public.company_settings for select to authenticated using (true);
create policy settings_update on public.company_settings for update to authenticated
  using (public.can_write('settings')) with check (public.can_write('settings'));

-- ---------- inventory (list prices are not secret) ----------
grant select, insert, update, delete on public.projects, public.towers, public.units to authenticated;
create policy projects_read  on public.projects for select to authenticated using (true);
create policy projects_write on public.projects for insert to authenticated with check (public.can_write('projects.edit'));
create policy projects_upd   on public.projects for update to authenticated using (public.can_write('projects.edit')) with check (public.can_write('projects.edit'));
create policy projects_del   on public.projects for delete to authenticated using (public.has_perm('settings'));
create policy towers_read  on public.towers for select to authenticated using (true);
create policy towers_write on public.towers for insert to authenticated with check (public.can_write('projects.edit'));
create policy towers_upd   on public.towers for update to authenticated using (public.can_write('projects.edit')) with check (public.can_write('projects.edit'));
create policy towers_del   on public.towers for delete to authenticated using (public.can_write('projects.edit'));
create policy units_read  on public.units for select to authenticated using (true);
create policy units_write on public.units for insert to authenticated with check (public.can_write('projects.edit'));
create policy units_upd   on public.units for update to authenticated using (public.can_write('projects.edit')) with check (public.can_write('projects.edit'));
create policy units_del   on public.units for delete to authenticated using (public.can_write('projects.edit'));

-- ---------- leads ----------
-- Insert happens via RPC (phone must be encrypted + blind-indexed server-side).
-- Direct updates allowed only on non-sensitive columns.
grant select (id, name, phone_hint, source, source_ref, project_id, budget_min, budget_max, config_wanted,
              stage, lost_reason, score, owner_id, created_by, next_follow_up_at, last_activity_at,
              anonymized_at, created_at, updated_at)
  on public.leads to authenticated;
grant update (name, project_id, budget_min, budget_max, config_wanted, stage, lost_reason,
              owner_id, next_follow_up_at, score)
  on public.leads to authenticated;
grant delete on public.leads to authenticated;

create policy leads_read on public.leads for select to authenticated
  using (public.has_perm('leads') and (public.in_scope(owner_id) or created_by = (select auth.uid())));
create policy leads_update on public.leads for update to authenticated
  using (public.can_write('leads') and (public.in_scope(owner_id) or created_by = (select auth.uid())))
  with check (public.can_write('leads'));
create policy leads_delete on public.leads for delete to authenticated
  using (public.has_perm('leads.delete') and public.in_scope(owner_id));

-- reassignment needs leads.assign (or assigning an unowned lead to yourself);
-- stage/owner changes are written to the lead timeline automatically.
create or replace function private.leads_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    if not public.has_perm('leads.assign')
       and not (old.owner_id is null and new.owner_id = auth.uid()) then
      raise exception 'You do not have permission to reassign leads' using errcode = '42501';
    end if;
    insert into public.lead_activities (lead_id, type, body, meta)
    values (new.id, 'assign', 'Lead reassigned',
            jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
    if new.owner_id is not null and new.owner_id is distinct from auth.uid() then
      insert into public.notifications (user_id, title, body, link)
      values (new.owner_id, 'New lead assigned', new.name, '/leads/' || new.id);
    end if;
  end if;
  if new.stage is distinct from old.stage then
    if new.stage <> 'lost' then new.lost_reason := null; end if;
    insert into public.lead_activities (lead_id, type, body, meta)
    values (new.id, 'stage', 'Stage changed',
            jsonb_build_object('from', old.stage, 'to', new.stage, 'reason', new.lost_reason));
  end if;
  new.last_activity_at := now();
  return new;
end $$;
create trigger leads_guard before update on public.leads
  for each row execute function private.leads_guard();

-- ---------- lead activities ----------
-- body_enc is readable only as ciphertext here; notes are decrypted via RPC.
grant select (id, lead_id, type, body, meta, created_by, created_at) on public.lead_activities to authenticated;
create policy activities_read on public.lead_activities for select to authenticated
  using (public.can_see_lead(lead_id));

-- ---------- client profiles (KYC: all ciphertext; access via RPC) ----------
grant select (lead_id, updated_at) on public.client_profiles to authenticated;
create policy client_profiles_read on public.client_profiles for select to authenticated
  using (public.has_perm('clients') and public.can_see_lead(lead_id));

-- ---------- site visits ----------
grant select (id, lead_id, project_id, scheduled_at, executive_id, status, feedback, done_at, created_by, created_at)
  on public.site_visits to authenticated;
grant insert (lead_id, project_id, scheduled_at, executive_id, status) on public.site_visits to authenticated;
grant update (project_id, scheduled_at, executive_id, status, feedback) on public.site_visits to authenticated;
create policy visits_read on public.site_visits for select to authenticated
  using (public.has_perm('visits') and (public.in_scope(executive_id) or created_by = (select auth.uid())));
create policy visits_insert on public.site_visits for insert to authenticated
  with check (public.can_write('visits') and public.can_see_lead(lead_id)
              and (executive_id = (select auth.uid()) or public.in_scope(executive_id) or public.has_perm('leads.assign')));
create policy visits_update on public.site_visits for update to authenticated
  using (public.can_write('visits') and (public.in_scope(executive_id) or created_by = (select auth.uid())))
  with check (public.can_write('visits') and status <> 'done');   -- 'done' only via RPC (captures GPS)

-- ---------- bookings / payments (amounts encrypted; writes via RPC) ----------
grant select (id, lead_id, unit_id, booking_date, closed_by, status, approved_by, approved_at, cancel_reason, created_by, created_at)
  on public.bookings to authenticated;
create policy bookings_read on public.bookings for select to authenticated
  using (public.has_perm('bookings') and (public.in_scope(closed_by) or created_by = (select auth.uid())));

grant select (id, booking_id, label, due_date, received_at, created_at) on public.payment_milestones to authenticated;
create policy milestones_read on public.payment_milestones for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));   -- inherits bookings RLS

-- ---------- documents ----------
-- Uploads go only through the upload-document Edge Function (checks permission,
-- magic bytes, size) — so no insert grant for authenticated here.
grant select on public.documents to authenticated;
create policy documents_read on public.documents for select to authenticated
  using ((public.has_perm('clients') or public.has_perm('bookings')) and public.can_see_lead(lead_id));

-- ---------- tasks ----------
grant select, insert, delete on public.tasks to authenticated;
grant update (title, description, due_at, priority, status, done_at, assigned_to) on public.tasks to authenticated;
create policy tasks_read on public.tasks for select to authenticated
  using (assigned_to = (select auth.uid()) or assigned_by = (select auth.uid())
         or (public.has_perm('tasks') and public.in_scope(assigned_to)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_write('tasks') and assigned_by = (select auth.uid())
              and (assigned_to = (select auth.uid()) or public.in_scope(assigned_to)));
create policy tasks_update on public.tasks for update to authenticated
  using (assigned_to = (select auth.uid()) or assigned_by = (select auth.uid())
         or (public.can_write('tasks') and public.in_scope(assigned_to)))
  with check (assigned_to = (select auth.uid()) or public.in_scope(assigned_to));
create policy tasks_delete on public.tasks for delete to authenticated
  using (assigned_by = (select auth.uid()) or (public.can_write('tasks') and public.in_scope(assigned_to)));

-- ---------- attendance / GPS (locations encrypted; writes + reads of coords via RPC) ----------
grant select (id, user_id, work_date, check_in_at, check_out_at) on public.attendance to authenticated;
create policy attendance_read on public.attendance for select to authenticated
  using (user_id = (select auth.uid()) or (public.has_perm('attendance') and public.in_scope(user_id)));

grant select (id, user_id, accuracy_m, recorded_at) on public.location_pings to authenticated;
create policy pings_read on public.location_pings for select to authenticated
  using (user_id = (select auth.uid()) or (public.has_perm('tracking') and public.in_scope(user_id)));

-- ---------- incentives ----------
grant select on public.incentive_rules to authenticated;
grant insert, update, delete on public.incentive_rules to authenticated;
create policy rules_read  on public.incentive_rules for select to authenticated using (public.has_perm('incentives'));
create policy rules_ins   on public.incentive_rules for insert to authenticated with check (public.can_write('settings'));
create policy rules_upd   on public.incentive_rules for update to authenticated using (public.can_write('settings')) with check (public.can_write('settings'));
create policy rules_del   on public.incentive_rules for delete to authenticated using (public.can_write('settings'));

grant select (id, booking_id, user_id, rule_id, status, approved_by, paid_at, created_at) on public.incentives to authenticated;
create policy incentives_read on public.incentives for select to authenticated
  using (user_id = (select auth.uid()) or (public.has_perm('incentives') and public.in_scope(user_id)));

-- ---------- notifications (own only) ----------
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_upd  on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notif_del  on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- webhooks (secret never readable) / audit ----------
grant select (id, source_name, default_owner_id, default_project_id, active, created_at) on public.lead_webhooks to authenticated;
create policy webhooks_read on public.lead_webhooks for select to authenticated using (public.has_perm('settings'));

grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using (public.has_perm('settings'));

revoke execute on all functions in schema private from public, anon, authenticated;
