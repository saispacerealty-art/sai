-- =====================================================================
-- 0013 · WhatsApp two-step verification for Owner/Admin
--
-- Supabase generates and checks the 6-digit code (phone MFA factor); our
-- send-otp Edge Function delivers it on WhatsApp. This migration makes the
-- database enforce the rules:
--   * an Owner/Admin may only enrol the WhatsApp number on file in their
--     profile (so a stolen password cannot attach the thief's phone);
--   * Owner/Admin cannot use authenticator apps any more (WhatsApp only);
--   * Owner/Admin get no permissions until their session is aal2 AND they
--     have a verified WhatsApp factor.
-- =====================================================================

-- ---------- the number on file (decrypted only here, server-side) ----------
create or replace function private.profile_phone(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.dec(phone_enc) from public.profiles where id = p_user $$;

-- Called by the sign-in screen to enrol WhatsApp with the number on file.
-- Only Owner/Admin, only their own number.
create or replace function public.my_mfa_phone() returns text
language sql stable security definer set search_path = '' as $$
  select case when p.role in ('owner', 'admin') then private.dec(p.phone_enc) end
  from public.profiles p where p.id = (select auth.uid()) $$;
grant execute on function public.my_mfa_phone() to authenticated;

-- ---------- guard on the auth factor table ----------
create or replace function private.mfa_factor_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_phone text;
begin
  select role into v_role from public.profiles where id = new.user_id;
  if v_role not in ('owner', 'admin') then return new; end if;
  if new.factor_type <> 'phone' then
    raise exception 'Owner and Admin accounts use WhatsApp for two-step verification' using errcode = '42501';
  end if;
  v_phone := private.profile_phone(new.user_id);
  if v_phone is null then
    raise exception 'No WhatsApp number is on file for this account' using errcode = '42501';
  end if;
  if public.normalize_phone(new.phone) is distinct from v_phone then
    raise exception 'Use the WhatsApp number registered for this account' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists crm_mfa_factor_guard on auth.mfa_factors;
create trigger crm_mfa_factor_guard before insert or update of phone, factor_type on auth.mfa_factors
  for each row execute function private.mfa_factor_guard();

-- existing authenticator-app factors of Owner/Admin stop counting (they re-enrol on WhatsApp)
delete from auth.mfa_factors f
 using public.profiles p
 where p.id = f.user_id and p.role in ('owner', 'admin') and f.factor_type <> 'phone';

-- ---------- permission engine: Owner/Admin need a WhatsApp-verified session ----------
create or replace function private.has_whatsapp_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f
                 where f.user_id = p_user and f.factor_type = 'phone' and f.status = 'verified') $$;

create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when not pr.is_active or (pr.locked_until is not null and pr.locked_until > now()) then false
      when pr.role in ('owner','admin')
           and (coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' or not private.has_whatsapp_factor(pr.id)) then false
      when pr.role = 'owner' then p_key <> 'read_only'
      else coalesce(
        (select o.allowed from public.user_overrides o where o.user_id = pr.id and o.key = p_key),
        p_key = any(rp.modules) or p_key = any(rp.flags))
    end
    from public.profiles pr
    join public.role_presets rp on rp.role = pr.role
    where pr.id = (select auth.uid())
  ), false) $$;
grant execute on function public.has_perm(text) to authenticated;

-- ---------- local development outbox (codes shown in the terminal instead of WhatsApp) ----------
-- Written only by send-otp when DEV_OTP_OUTBOX=true, which the function refuses
-- to honour unless it is running against a local Supabase.
create table private.dev_otp_outbox (
  id         bigint generated always as identity primary key,
  phone      text not null,
  code       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.svc_dev_otp_store(p_phone text, p_code text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from private.dev_otp_outbox where created_at < now() - interval '10 minutes';
  insert into private.dev_otp_outbox (phone, code) values (public.normalize_phone(p_phone), p_code) $$;

create or replace function public.svc_dev_otp_latest() returns table (phone text, code text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.phone, o.code, o.created_at from private.dev_otp_outbox o
  where o.created_at > now() - interval '10 minutes'
  order by o.created_at desc limit 5 $$;

revoke execute on function public.svc_dev_otp_store(text, text), public.svc_dev_otp_latest() from public, anon, authenticated;
grant execute on function public.svc_dev_otp_store(text, text), public.svc_dev_otp_latest() to service_role;

-- Changing an Owner/Admin's number must also drop their old WhatsApp factor (they re-verify the new one).
create or replace function public.svc_set_profile_phone(p_user uuid, p_phone text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n text := public.normalize_phone(p_phone); v_old text;
begin
  v_old := private.profile_phone(p_user);
  update public.profiles set phone_enc = private.enc(n), phone_hint = public.phone_hint(n) where id = p_user;
  if v_old is distinct from n then
    delete from auth.mfa_factors where user_id = p_user and factor_type = 'phone';
  end if;
end $$;
revoke execute on function public.svc_set_profile_phone(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_set_profile_phone(uuid, text) to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
