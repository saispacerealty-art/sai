-- =====================================================================
-- 0006 · Server-only helpers for the admin-users / change-password
--        Edge Functions (service_role only — never callable from browsers)
-- =====================================================================

-- store an employee's phone encrypted (+ masked hint)
create or replace function public.svc_set_profile_phone(p_user uuid, p_phone text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n text := public.normalize_phone(p_phone);
begin
  update public.profiles
     set phone_enc = private.enc(n), phone_hint = public.phone_hint(n)
   where id = p_user;
end $$;

-- kill every session/refresh token of a user (deactivation, password reset)
create or replace function public.svc_revoke_sessions(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from auth.sessions where user_id = p_user;
  delete from auth.refresh_tokens where user_id = p_user::text;
end $$;

-- write an audit entry on behalf of an actor
create or replace function public.svc_audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_meta jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb)) $$;

revoke execute on function public.svc_set_profile_phone(uuid, text), public.svc_revoke_sessions(uuid),
                           public.svc_audit(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.svc_set_profile_phone(uuid, text), public.svc_revoke_sessions(uuid),
                          public.svc_audit(uuid, text, text, text, jsonb)
  to service_role;

-- Employees page: list with lock status (needs the `employees` module)
create or replace function public.list_employees() returns table (
  id uuid, username text, full_name text, role text, role_label text, manager_id uuid,
  scope_override text, is_active boolean, phone_hint text, locked boolean,
  must_change_password boolean, created_at timestamptz, overrides jsonb)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.full_name, p.role, rp.label, p.manager_id, p.scope_override, p.is_active,
         p.phone_hint, coalesce(p.locked_until > now(), false), p.must_change_password, p.created_at,
         coalesce((select jsonb_object_agg(o.key, o.allowed) from public.user_overrides o where o.user_id = p.id), '{}')
  from public.profiles p join public.role_presets rp on rp.role = p.role
  where public.has_perm('employees')
    and (public.my_scope() = 'all' or p.id = (select auth.uid()) or p.manager_id = (select auth.uid()))
  order by p.is_active desc, rp.sort, p.full_name $$;
grant execute on function public.list_employees() to authenticated;
