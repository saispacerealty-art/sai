-- =====================================================================
-- 0018 · Mail: one company mailbox (SMTP) + "email" entries on lead timelines
--
--   * The mailbox password is stored encrypted (private.enc) and is never
--     readable from the browser: only the `mail` Edge Function, running as
--     service_role, can fetch it.
--   * Emails are sent only by the `mail` Edge Function. It checks the caller
--     with can_email_lead() first, then logs the email on the lead's timeline.
--   * Sending is limited to 30 emails per user per hour.
-- =====================================================================

create table public.mail_account (
  id           int primary key default 1 check (id = 1),
  from_name    text not null check (length(from_name) between 1 and 80),
  from_email   text not null check (from_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(from_email) <= 254),
  smtp_host    text not null check (length(smtp_host) between 3 and 253),
  smtp_port    int  not null check (smtp_port in (25, 465, 587, 2525)),
  smtp_user    text not null check (length(smtp_user) between 1 and 254),
  password_enc bytea not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);
alter table public.mail_account enable row level security;
-- no policies and no grants: only SECURITY DEFINER functions below can touch it
create trigger mail_account_touch before update on public.mail_account
  for each row execute function private.touch_updated_at();

alter table public.lead_activities drop constraint if exists lead_activities_type_check;
alter table public.lead_activities add constraint lead_activities_type_check
  check (type in ('note','call','whatsapp','stage','assign','visit','import','booking','system','email'));

-- ---------- who may do what ----------
create or replace function public.can_manage_mail() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write('settings') $$;

create or replace function public.can_email_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write('leads') and public.can_see_lead(p_lead) $$;

-- ---------- settings page: status only, never the password ----------
create or replace function public.get_mail_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.mail_account;
begin
  if not public.can_manage_mail() then perform private.forbid(); end if;
  select * into m from public.mail_account where id = 1;
  if not found then return null; end if;
  return jsonb_build_object('from_name', m.from_name, 'from_email', m.from_email, 'smtp_host', m.smtp_host,
                            'smtp_port', m.smtp_port, 'smtp_user', m.smtp_user, 'updated_at', m.updated_at);
end $$;

-- ---------- called only by the Edge Function (service_role) ----------
create or replace function public.svc_save_mail_account(p_actor uuid, p_from_name text, p_from_email text, p_host text,
                                                         p_port int, p_user text, p_password text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- empty password on an existing account keeps the stored one
  if coalesce(p_password, '') = '' then
    update public.mail_account set from_name = p_from_name, from_email = p_from_email, smtp_host = p_host,
           smtp_port = p_port, smtp_user = p_user, updated_by = p_actor where id = 1;
    if not found then perform private.bad('Enter the mailbox password'); end if;
  else
    insert into public.mail_account (id, from_name, from_email, smtp_host, smtp_port, smtp_user, password_enc, updated_by)
    values (1, p_from_name, p_from_email, p_host, p_port, p_user, private.enc(p_password), p_actor)
    on conflict (id) do update set from_name = excluded.from_name, from_email = excluded.from_email,
      smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_user = excluded.smtp_user,
      password_enc = excluded.password_enc, updated_by = excluded.updated_by;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, 'mail_account_change', 'mail_account', '1', jsonb_build_object('host', p_host, 'from', p_from_email));
end $$;

create or replace function public.svc_mail_credentials() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('from_name', m.from_name, 'from_email', m.from_email, 'host', m.smtp_host,
                            'port', m.smtp_port, 'user', m.smtp_user, 'password', private.dec(m.password_enc))
  from public.mail_account m where m.id = 1 $$;

-- recipient address + first name for one lead (the address is decrypted only here, server-side)
create or replace function public.svc_lead_mail_target(p_lead uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', private.dec(l.email_enc), 'name', l.name)
  from public.leads l where l.id = p_lead and l.anonymized_at is null $$;

-- true = allowed
create or replace function public.svc_mail_allow(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 30 from public.lead_activities a
  where a.type = 'email' and a.created_by = p_actor and a.created_at > now() - interval '1 hour' $$;

create or replace function public.svc_log_email(p_actor uuid, p_lead uuid, p_subject text, p_body text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.lead_activities (lead_id, type, body_enc, meta, created_by)
  values (p_lead, 'email', private.enc(p_subject || E'\n\n' || p_body), jsonb_build_object('direction', 'out'), p_actor);
  update public.leads set last_activity_at = now() where id = p_lead;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, 'email_sent', 'lead', p_lead::text, '{}');
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.svc_save_mail_account(uuid, text, text, text, int, text, text), public.svc_mail_credentials(),
  public.svc_lead_mail_target(uuid), public.svc_mail_allow(uuid), public.svc_log_email(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.svc_save_mail_account(uuid, text, text, text, int, text, text), public.svc_mail_credentials(),
  public.svc_lead_mail_target(uuid), public.svc_mail_allow(uuid), public.svc_log_email(uuid, uuid, text, text)
  to service_role;
grant execute on function public.can_manage_mail(), public.can_email_lead(uuid), public.get_mail_account() to authenticated;
