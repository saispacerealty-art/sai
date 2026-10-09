-- =====================================================================
-- 0016 · Owner/Admin two-step verification: free authenticator apps (TOTP)
--
-- Replaces the SMS/WhatsApp codes of 0013–0015 (those cost money per message
-- and need DLT registration in India). Rules:
--   * Owner/Admin may only register an authenticator app (no phone factors);
--   * Owner/Admin get no permissions until their session is aal2 AND they
--     have a verified authenticator factor.
-- Existing phone factors are removed: each Owner/Admin scans a QR code at
-- their next sign-in.
-- =====================================================================

create or replace function private.has_totp_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f
                 where f.user_id = p_user and f.factor_type = 'totp' and f.status = 'verified') $$;

create or replace function private.mfa_factor_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = new.user_id;
  if v_role in ('owner', 'admin') and new.factor_type <> 'totp' then
    raise exception 'Owner and Admin accounts use an authenticator app for two-step verification' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists crm_mfa_factor_guard on auth.mfa_factors;
create trigger crm_mfa_factor_guard before insert or update of factor_type on auth.mfa_factors
  for each row execute function private.mfa_factor_guard();

delete from auth.mfa_factors f
 using public.profiles p
 where p.id = f.user_id and p.role in ('owner', 'admin') and f.factor_type <> 'totp';

create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when not pr.is_active or (pr.locked_until is not null and pr.locked_until > now()) then false
      when pr.role in ('owner','admin')
           and (coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' or not private.has_totp_factor(pr.id)) then false
      when pr.role = 'owner' then p_key <> 'read_only'
      else coalesce(
        (select o.allowed from public.user_overrides o where o.user_id = pr.id and o.key = p_key),
        p_key = any(rp.modules) or p_key = any(rp.flags))
    end
    from public.profiles pr
    join public.role_presets rp on rp.role = pr.role
    where pr.id = (select auth.uid())
  ), false) $$;

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
    'mfa_ok', me.role not in ('owner','admin')
              or (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2' and private.has_totp_factor(me.id)),
    'granted', (select coalesce(jsonb_agg(k order by k), '[]') from keys where public.has_perm(k))
  ) from me $$;

-- phone numbers stay on profiles (contact info), but no longer drive sign-in
create or replace function public.svc_set_profile_phone(p_user uuid, p_phone text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n text := public.normalize_phone(p_phone);
begin
  update public.profiles set phone_enc = private.enc(n), phone_hint = public.phone_hint(n) where id = p_user;
end $$;
revoke execute on function public.svc_set_profile_phone(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_set_profile_phone(uuid, text) to service_role;

-- remove the SMS-only pieces
drop function if exists private.has_phone_factor(uuid);
drop function if exists public.my_mfa_phone();
drop function if exists public.svc_dev_otp_store(text, text);
drop function if exists public.svc_dev_otp_latest();
drop table if exists private.dev_otp_outbox;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.has_perm(text), public.my_permissions() to authenticated;
