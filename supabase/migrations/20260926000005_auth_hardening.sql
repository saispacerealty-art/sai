-- =====================================================================
-- 0005 · Login hardening + MFA enforcement (PLAN.md §6B-3)
--
-- All sign-ins go through the `login` Edge Function, which records every
-- attempt here and refuses when:
--   * the username has 5 failures in 15 min  (account lock, 15 min)
--   * the client IP has 30 failures in 15 min (IP block)
-- Messages to the client stay generic, so usernames can't be enumerated.
-- =====================================================================

create table private.login_attempts (
  id         bigint generated always as identity primary key,
  username   text not null,
  ip         text,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index on private.login_attempts (username, created_at desc);
create index on private.login_attempts (ip, created_at desc);

-- Called by the login Edge Function (service role) before checking the password.
create or replace function public.login_gate(p_username text, p_ip text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare u public.profiles;
begin
  if (select count(*) from private.login_attempts
      where ip = p_ip and not success and created_at > now() - interval '15 minutes') >= 30 then
    return 'ip_blocked';
  end if;
  select * into u from public.profiles where username = lower(p_username);
  if not found then return 'ok'; end if;                      -- password check will fail normally
  if not u.is_active then return 'inactive'; end if;
  if u.locked_until is not null and u.locked_until > now() then return 'locked'; end if;
  return 'ok';
end $$;

create or replace function public.login_record(p_username text, p_ip text, p_success boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid; fails int;
begin
  insert into private.login_attempts (username, ip, success) values (lower(p_username), p_ip, p_success);
  select id into uid from public.profiles where username = lower(p_username);
  if uid is null then return; end if;
  if p_success then
    update public.profiles set failed_logins = 0, locked_until = null where id = uid;
    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
      values (uid, 'login', 'profile', uid::text, jsonb_build_object('ip', p_ip));
  else
    update public.profiles set failed_logins = failed_logins + 1 where id = uid returning failed_logins into fails;
    if fails >= 5 then
      update public.profiles set locked_until = now() + interval '15 minutes', failed_logins = 0 where id = uid;
      insert into public.audit_log (actor_id, action, entity, entity_id, meta)
        values (null, 'account_locked', 'profile', uid::text, jsonb_build_object('ip', p_ip));
    end if;
  end if;
end $$;

-- Only the service role (Edge Functions) may call these.
revoke execute on function public.login_gate(text, text), public.login_record(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.login_gate(text, text), public.login_record(text, text, boolean)
  to service_role;

-- keep 30 days of raw attempts
create or replace function private.purge_login_attempts() returns void
language sql security definer set search_path = '' as $$
  delete from private.login_attempts where created_at < now() - interval '30 days' $$;
revoke execute on function private.purge_login_attempts() from public, anon, authenticated;
select cron.schedule('crm-purge-login-attempts', '0 21 * * *', $$select private.purge_login_attempts()$$);

-- ---------- MFA is mandatory for Owner/Admin: enforced in the permission engine ----------
-- Without an aal2 (TOTP-verified) session, an owner/admin has NO permissions at all,
-- so a stolen password alone cannot reach admin data.
create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when not pr.is_active or (pr.locked_until is not null and pr.locked_until > now()) then false
      when pr.role in ('owner','admin') and coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then false
      when pr.role = 'owner' then p_key <> 'read_only'
      else coalesce(
        (select o.allowed from public.user_overrides o where o.user_id = pr.id and o.key = p_key),
        p_key = any(rp.modules) or p_key = any(rp.flags))
    end
    from public.profiles pr
    join public.role_presets rp on rp.role = pr.role
    where pr.id = (select auth.uid())
  ), false) $$;

-- my_permissions also reports whether MFA is still required, so the UI can route to enrolment
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
    'mfa_required', me.role in ('owner','admin'),
    'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'granted', (select coalesce(jsonb_agg(k order by k), '[]') from keys where public.has_perm(k))
  ) from me $$;

grant execute on function public.has_perm(text), public.my_permissions() to authenticated;
