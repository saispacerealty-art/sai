-- =====================================================================
-- 0012 · Encryption key rotation (Phase 9, PLAN.md §6A)
--
-- The active key version is now data (not code), so rotating a key needs
-- no new migration. Procedure — run as the database owner in the SQL editor:
--
--   select private.rotate_data_key();     -- creates crm_data_key_v<N+1>, makes it active,
--                                         -- re-encrypts every encrypted column with it
--
-- Old keys are kept in the Vault (old backups still need them). Every
-- ciphertext starts with its key-version byte, so rows encrypted under any
-- version remain readable throughout a rotation.
-- =====================================================================

create table private.crypto_state (
  id             int primary key default 1 check (id = 1),
  active_version int not null check (active_version between 1 and 255),
  rotated_at     timestamptz
);
insert into private.crypto_state (id, active_version) values (1, 1);

create or replace function private.active_key_version() returns int
language sql stable security definer set search_path = '' as $$
  select active_version from private.crypto_state where id = 1 $$;

-- Every encrypted column in the schema. Keep in sync when adding *_enc columns.
create or replace function private.encrypted_columns() returns table (tbl regclass, col text)
language sql immutable set search_path = '' as $$
  values
    ('public.profiles'::regclass, 'phone_enc'),
    ('public.leads', 'phone_enc'), ('public.leads', 'alt_phone_enc'), ('public.leads', 'email_enc'),
    ('public.lead_activities', 'body_enc'),
    ('public.client_profiles', 'pan_enc'), ('public.client_profiles', 'id_number_enc'), ('public.client_profiles', 'address_enc'),
    ('public.site_visits', 'done_loc_enc'),
    ('public.bookings', 'agreement_value_enc'), ('public.bookings', 'token_amount_enc'),
    ('public.payment_milestones', 'amount_enc'), ('public.payment_milestones', 'received_amount_enc'),
    ('public.attendance', 'check_in_loc_enc'), ('public.attendance', 'check_out_loc_enc'),
    ('public.location_pings', 'loc_enc'),
    ('public.incentives', 'amount_enc'),
    ('public.lead_webhooks', 'secret_enc') $$;

-- Re-encrypts every value that is not already under the active key. Safe to re-run.
create or replace function private.reencrypt_all() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r record; n bigint; total bigint := 0; v int := private.active_key_version(); report jsonb := '{}';
begin
  for r in select * from private.encrypted_columns() loop
    -- triggers are skipped: this changes no business data (and must not touch timestamps,
    -- scores, or the append-only guards)
    execute format('alter table %s disable trigger user', r.tbl);
    execute format('update %s set %I = private.enc(private.dec(%I)) where %I is not null and get_byte(%I, 0) <> $1',
                   r.tbl, r.col, r.col, r.col, r.col) using v;
    get diagnostics n = row_count;
    execute format('alter table %s enable trigger user', r.tbl);
    if n > 0 then report := report || jsonb_build_object(r.tbl::text || '.' || r.col, n); end if;
    total := total + n;
  end loop;
  return jsonb_build_object('key_version', v, 'values_reencrypted', total, 'by_column', report);
end $$;

create or replace function private.rotate_data_key() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v int := private.active_key_version() + 1; res jsonb;
begin
  if not exists (select 1 from vault.secrets where name = 'crm_data_key_v' || v) then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'crm_data_key_v' || v, 'CRM field-encryption key, version ' || v);
  end if;
  update private.crypto_state set active_version = v, rotated_at = now() where id = 1;
  res := private.reencrypt_all();
  insert into public.audit_log (actor_id, action, entity, meta) values (null, 'key_rotation', 'crypto', res);
  return res;
end $$;

revoke all on private.crypto_state from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
