-- =====================================================================
-- 0015 · Owner/Admin two-step codes are sent by SMS instead of WhatsApp
-- Same rules as 0013 (number on file only, no authenticator apps, nothing
-- until verified); only the wording and helper names change.
-- =====================================================================

create or replace function private.has_phone_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f
                 where f.user_id = p_user and f.factor_type = 'phone' and f.status = 'verified') $$;

create or replace function private.mfa_factor_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_phone text;
begin
  select role into v_role from public.profiles where id = new.user_id;
  if v_role not in ('owner', 'admin') then return new; end if;
  if new.factor_type <> 'phone' then
    raise exception 'Owner and Admin accounts use an SMS code for two-step verification' using errcode = '42501';
  end if;
  v_phone := private.profile_phone(new.user_id);
  if v_phone is null then
    raise exception 'No mobile number is on file for this account' using errcode = '42501';
  end if;
  if public.normalize_phone(new.phone) is distinct from v_phone then
    raise exception 'Use the mobile number registered for this account' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when not pr.is_active or (pr.locked_until is not null and pr.locked_until > now()) then false
      when pr.role in ('owner','admin')
           and (coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' or not private.has_phone_factor(pr.id)) then false
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
              or (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2' and private.has_phone_factor(me.id)),
    'granted', (select coalesce(jsonb_agg(k order by k), '[]') from keys where public.has_perm(k))
  ) from me $$;

drop function if exists private.has_whatsapp_factor(uuid);

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.has_perm(text), public.my_permissions() to authenticated;
