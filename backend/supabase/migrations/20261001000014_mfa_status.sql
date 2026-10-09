-- =====================================================================
-- 0014 · Tell the app whether an Owner/Admin's two-step verification is valid
--
-- A session can be aal2 yet no longer count — e.g. right after the WhatsApp
-- number was changed (the old factor is removed). my_permissions now reports
-- mfa_ok so the app sends the user to the WhatsApp code screen instead of
-- showing "Access restricted" everywhere.
-- =====================================================================

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
              or (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2' and private.has_whatsapp_factor(me.id)),
    'granted', (select coalesce(jsonb_agg(k order by k), '[]') from keys where public.has_perm(k))
  ) from me $$;

grant execute on function public.my_permissions() to authenticated;
