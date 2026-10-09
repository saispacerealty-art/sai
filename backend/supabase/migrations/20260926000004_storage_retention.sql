-- =====================================================================
-- 0004 · Private document storage + scheduled retention jobs (PLAN.md §6A)
-- =====================================================================

-- ---------- private bucket for KYC / agreements / receipts ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Read (and so create a short-lived signed URL) only if the matching
-- public.documents row is visible to the caller under its own RLS.
-- No insert/update/delete policies: uploads go through the Edge Function
-- (service role), so the browser can never write to the bucket directly.
create policy "documents_read_if_record_visible" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents'
         and exists (select 1 from public.documents d where d.file_path = storage.objects.name));

-- ---------- scheduled jobs ----------
create extension if not exists pg_cron;

-- GPS pings older than 90 days are deleted (attendance rows are kept)
create or replace function private.purge_old_pings() returns void
language sql security definer set search_path = '' as $$
  delete from public.location_pings where recorded_at < now() - interval '90 days' $$;

-- Lost leads with no activity for 2 years: wipe personal data, keep stats
create or replace function private.anonymize_stale_lost_leads() returns void
language plpgsql security definer set search_path = '' as $$
begin
  with stale as (
    select id from public.leads
    where stage = 'lost' and anonymized_at is null
      and last_activity_at < now() - interval '2 years'
  ), wiped as (
    update public.leads l
       set name = 'Anonymised lead', phone_enc = null, phone_hint = null, phone_bidx = null,
           alt_phone_enc = null, email_enc = null, source_ref = null, anonymized_at = now()
      from stale where l.id = stale.id
    returning l.id
  )
  update public.lead_activities a set body_enc = null
    from wiped where a.lead_id = wiped.id;
end $$;

-- Unit holds that were never converted into a booking are released
create or replace function private.release_expired_holds() returns void
language sql security definer set search_path = '' as $$
  update public.units set status = 'available', hold_until = null, hold_by = null
   where status = 'hold' and hold_until is not null and hold_until < now() $$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- times are UTC: 20:30 UTC = 02:00 IST
select cron.schedule('crm-purge-old-pings',        '30 20 * * *',  $$select private.purge_old_pings()$$);
select cron.schedule('crm-anonymize-lost-leads',   '45 20 * * 0',  $$select private.anonymize_stale_lost_leads()$$);
select cron.schedule('crm-release-expired-holds',  '*/15 * * * *', $$select private.release_expired_holds()$$);
