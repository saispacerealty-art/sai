-- =====================================================================
-- 0011 · Rate limit for the lead-intake webhook (60 requests / minute / source)
-- Kept in the database so it holds across Edge Function instances.
-- =====================================================================

create table private.webhook_hits (
  webhook_id uuid not null,
  at         timestamptz not null default now()
);
create index on private.webhook_hits (webhook_id, at desc);

-- true = allowed (and counted); false = over the limit
create or replace function public.svc_webhook_allow(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select count(*) from private.webhook_hits where webhook_id = p_id and at > now() - interval '1 minute') >= 60 then
    return false;
  end if;
  insert into private.webhook_hits (webhook_id) values (p_id);
  return true;
end $$;
revoke execute on function public.svc_webhook_allow(uuid) from public, anon, authenticated;
grant execute on function public.svc_webhook_allow(uuid) to service_role;

create or replace function private.purge_webhook_hits() returns void
language sql security definer set search_path = '' as $$
  delete from private.webhook_hits where at < now() - interval '1 hour' $$;
revoke execute on function private.purge_webhook_hits() from public, anon, authenticated;
select cron.schedule('crm-purge-webhook-hits', '*/30 * * * *', $$select private.purge_webhook_hits()$$);
