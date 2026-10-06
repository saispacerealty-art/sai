-- =====================================================================
-- 0001 · Crypto foundation
-- Field-level encryption for personal/sensitive data (PLAN.md §6A).
--
--   * Keys live in Supabase Vault (never in code, never sent to browser).
--   * Cipher: AES-256 in OpenPGP format with integrity check (pgcrypto
--     pgp_sym_encrypt, compression off). Keys are 256-bit random, so the
--     cheap salted S2K mode is used (iteration adds nothing for random keys).
--   * Ciphertext layout: 1 byte key-version || OpenPGP message.
--     That lets us rotate keys: add crm_data_key_v2, bump
--     private.active_key_version(), re-encrypt rows (rotation job: Phase 9).
--   * Blind index: HMAC-SHA256 with a separate key, for exact-match lookups
--     (duplicate phone detection) without decrypting.
--   * Everything lives in schema "private", which is NOT exposed through the
--     Supabase API and whose functions nobody but the owner can execute.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- ---------- keys (created once; re-running the migration is a no-op) ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_data_key_v1') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'crm_data_key_v1', 'CRM field-encryption key, version 1');
  end if;
  if not exists (select 1 from vault.secrets where name = 'crm_index_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'crm_index_key', 'CRM blind-index HMAC key');
  end if;
end $$;

create or replace function private.active_key_version() returns int
language sql immutable as $$ select 1 $$;

create or replace function private.data_key(v int) returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'crm_data_key_v' || v;
  if k is null then raise exception 'encryption key version % not found', v; end if;
  return k;
end $$;

-- ---------- encrypt / decrypt ----------
create or replace function private.enc(p text) returns bytea
language plpgsql volatile security definer set search_path = '' as $$
declare v int := private.active_key_version();
begin
  if p is null or btrim(p) = '' then return null; end if;
  return set_byte('\x00'::bytea, 0, v)
      || extensions.pgp_sym_encrypt(p, private.data_key(v),
                                    'cipher-algo=aes256, compress-algo=0, s2k-mode=1');
end $$;

create or replace function private.dec(c bytea) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if c is null then return null; end if;
  return extensions.pgp_sym_decrypt(substring(c from 2), private.data_key(get_byte(c, 0)));
end $$;

-- numeric helpers (amounts are stored encrypted too)
create or replace function private.enc_num(p numeric) returns bytea
language sql volatile security definer set search_path = '' as $$
  select private.enc(p::text) $$;

create or replace function private.dec_num(c bytea) returns numeric
language sql stable security definer set search_path = '' as $$
  select private.dec(c)::numeric $$;

-- ---------- blind index ----------
create or replace function private.bidx(p text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'crm_index_key';
  return encode(extensions.hmac(p, k, 'sha256'), 'hex');
end $$;

-- ---------- phone helpers (plain, no secrets) ----------
-- Normalises Indian numbers to the last 10 digits: "+91 98765-43210" -> "9876543210"
create or replace function public.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) < 10 then nullif(regexp_replace(p, '\D', '', 'g'), '')
    else right(regexp_replace(p, '\D', '', 'g'), 10)
  end $$;

-- Masked display value stored in plain text: "98••••••10"
create or replace function public.phone_hint(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null
              when length(p) < 5 then '••••'
              else left(p, 2) || repeat('•', length(p) - 4) || right(p, 2) end $$;

-- Only the database owner (and SECURITY DEFINER functions it owns) may call these.
revoke execute on all functions in schema private from public, anon, authenticated;
