-- =====================================================================
-- 0019 · Mail: a personal mailbox per user
--
--   * Each staff member can connect their own SMTP account. Emails they send to
--     leads then go out from their own address. With no personal mailbox the
--     company mailbox (0018) is used, as before.
--   * Same protections as the company mailbox: password stored encrypted, never
--     readable from the browser, only the `mail` Edge Function (service_role)
--     can fetch it.
-- =====================================================================

create table public.user_mailbox (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  from_name    text not null check (length(from_name) between 1 and 80),
  from_email   text not null check (from_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(from_email) <= 254),
  smtp_host    text not null check (length(smtp_host) between 3 and 253),
  smtp_port    int  not null check (smtp_port in (25, 465, 587, 2525)),
  smtp_user    text not null check (length(smtp_user) between 1 and 254),
  password_enc bytea not null,
  updated_at   timestamptz not null default now()
);
alter table public.user_mailbox enable row level security;
-- no policies and no grants: only the SECURITY DEFINER functions below can touch it
create trigger user_mailbox_touch before update on public.user_mailbox
  for each row execute function private.touch_updated_at();

-- people who may email leads may connect a personal mailbox
create or replace function public.can_use_mailbox() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write('leads') $$;

-- my own mailbox, status only, never the password
create or replace function public.get_my_mailbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.user_mailbox;
begin
  if not public.can_use_mailbox() then perform private.forbid(); end if;
  select * into m from public.user_mailbox where user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('from_name', m.from_name, 'from_email', m.from_email, 'smtp_host', m.smtp_host,
                            'smtp_port', m.smtp_port, 'smtp_user', m.smtp_user, 'updated_at', m.updated_at);
end $$;

-- which address will my emails go out from? (for the compose window)
create or replace function public.mail_sender() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_email text; v_src text;
begin
  if not public.can_use_mailbox() then perform private.forbid(); end if;
  select from_email, 'personal' into v_email, v_src from public.user_mailbox where user_id = auth.uid();
  if not found then
    select from_email, 'company' into v_email, v_src from public.mail_account where id = 1;
  end if;
  if v_email is null then return null; end if;
  return jsonb_build_object('from_email', v_email, 'source', v_src);
end $$;

-- ---------- called only by the Edge Function (service_role) ----------
create or replace function public.svc_save_user_mailbox(p_actor uuid, p_from_name text, p_from_email text, p_host text,
                                                         p_port int, p_user text, p_password text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- empty password on an existing mailbox keeps the stored one
  if coalesce(p_password, '') = '' then
    update public.user_mailbox set from_name = p_from_name, from_email = p_from_email, smtp_host = p_host,
           smtp_port = p_port, smtp_user = p_user where user_id = p_actor;
    if not found then perform private.bad('Enter the mailbox password'); end if;
  else
    insert into public.user_mailbox (user_id, from_name, from_email, smtp_host, smtp_port, smtp_user, password_enc)
    values (p_actor, p_from_name, p_from_email, p_host, p_port, p_user, private.enc(p_password))
    on conflict (user_id) do update set from_name = excluded.from_name, from_email = excluded.from_email,
      smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_user = excluded.smtp_user,
      password_enc = excluded.password_enc;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, 'user_mailbox_change', 'user_mailbox', p_actor::text, jsonb_build_object('host', p_host, 'from', p_from_email));
end $$;

create or replace function public.svc_user_mail_credentials(p_actor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('from_name', m.from_name, 'from_email', m.from_email, 'host', m.smtp_host,
                            'port', m.smtp_port, 'user', m.smtp_user, 'password', private.dec(m.password_enc))
  from public.user_mailbox m where m.user_id = p_actor $$;

create or replace function public.svc_delete_user_mailbox(p_actor uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.user_mailbox where user_id = p_actor;
  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (p_actor, 'user_mailbox_remove', 'user_mailbox', p_actor::text, '{}');
  end if;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.svc_save_user_mailbox(uuid, text, text, text, int, text, text), public.svc_user_mail_credentials(uuid),
  public.svc_delete_user_mailbox(uuid)
  from public, anon, authenticated;
grant execute on function
  public.svc_save_user_mailbox(uuid, text, text, text, int, text, text), public.svc_user_mail_credentials(uuid),
  public.svc_delete_user_mailbox(uuid)
  to service_role;
grant execute on function public.can_use_mailbox(), public.get_my_mailbox(), public.mail_sender() to authenticated;
