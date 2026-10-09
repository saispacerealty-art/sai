-- =====================================================================
-- 0002 · Core schema
-- Columns ending in _enc are ciphertext from private.enc() — never write
-- them from the client; they are filled only by SECURITY DEFINER RPCs.
-- Columns ending in _bidx are HMAC blind indexes for exact-match lookup.
-- =====================================================================

-- ---------- shared trigger: updated_at ----------
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- roles & people ----------
create table public.role_presets (
  role     text primary key check (role ~ '^[a-z_]{2,30}$'),
  label    text not null,
  modules  text[] not null default '{}',
  flags    text[] not null default '{}',
  scope    text not null default 'own' check (scope in ('own','team','all')),
  sort     int  not null default 100
);

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  username             text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  full_name            text not null check (length(full_name) between 2 and 80),
  role                 text not null references public.role_presets(role),
  scope_override       text check (scope_override in ('own','team','all')),
  manager_id           uuid references public.profiles(id) on delete set null,
  phone_enc            bytea,
  phone_hint           text,
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  failed_logins        int not null default 0,
  locked_until         timestamptz,
  location_consent_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (manager_id is distinct from id)
);
create index on public.profiles (manager_id);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- per-user grant (allowed=true) or revoke (allowed=false) of a module / flag
create table public.user_overrides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key     text not null check (key ~ '^[a-z_]+(\.[a-z_]+)?$'),
  allowed boolean not null,
  primary key (user_id, key)
);

-- ---------- company settings (single row) ----------
create table public.company_settings (
  id                     int primary key default 1 check (id = 1),
  name                   text not null default 'Sai Space Realty Pvt Ltd',
  phone                  text,
  address                text,
  follow_up_default_days int  not null default 2 check (follow_up_default_days between 0 and 60),
  hold_hours             int  not null default 48 check (hold_hours between 1 and 720),
  round_robin            boolean not null default true,
  office_lat             numeric(9,6),
  office_lng             numeric(9,6),
  geofence_m             int check (geofence_m is null or geofence_m between 50 and 50000),
  lead_sources           text[] not null default array['Manual','Walk-in','Referral','Website','Facebook','Instagram','Google Ads','99acres','MagicBricks','Housing.com','Import'],
  lost_reasons           text[] not null default array['Budget','Location','Bought elsewhere','Not reachable','Not interested','Other'],
  updated_at             timestamptz not null default now()
);
insert into public.company_settings (id, phone, address)
values (1, '9322323054', 'Office No-117, 1st Floor, Vision 9 Mall, Pimple Saudagar, Pune-411027');
create trigger company_settings_touch before update on public.company_settings
  for each row execute function private.touch_updated_at();

-- ---------- inventory ----------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(name) between 2 and 80),
  location   text,
  lat        numeric(9,6),
  lng        numeric(9,6),
  config     text,
  price_min  numeric(14,2) check (price_min >= 0),
  price_max  numeric(14,2) check (price_max >= 0),
  rera_no    text,
  status     text not null default 'active' check (status in ('upcoming','active','sold_out','archived')),
  cover_path text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_touch before update on public.projects
  for each row execute function private.touch_updated_at();

create table public.towers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  floors     int check (floors between 1 and 200),
  unique (project_id, name)
);

create table public.units (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  tower_id    uuid not null references public.towers(id) on delete cascade,
  unit_no     text not null,
  floor       int,
  config      text,
  carpet_sqft numeric(8,2) check (carpet_sqft > 0),
  price       numeric(14,2) check (price >= 0),
  status      text not null default 'available' check (status in ('available','hold','booked','blocked')),
  hold_until  timestamptz,
  hold_by     uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (tower_id, unit_no)
);
create index on public.units (project_id, status);
create trigger units_touch before update on public.units
  for each row execute function private.touch_updated_at();

-- ---------- leads ----------
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(name) between 1 and 80),
  phone_enc         bytea,
  phone_hint        text,
  phone_bidx        text unique,              -- null once anonymised
  alt_phone_enc     bytea,
  email_enc         bytea,
  source            text not null default 'Manual',
  source_ref        text,
  project_id        uuid references public.projects(id) on delete set null,
  budget_min        numeric(14,2) check (budget_min >= 0),
  budget_max        numeric(14,2) check (budget_max >= 0),
  config_wanted     text,
  stage             text not null default 'new'
                    check (stage in ('new','contacted','qualified','visit_scheduled','visit_done','negotiation','booked','lost')),
  lost_reason       text,
  score             int not null default 0 check (score between 0 and 100),
  owner_id          uuid references public.profiles(id) on delete set null,
  created_by        uuid default auth.uid() references public.profiles(id) on delete set null,
  next_follow_up_at timestamptz,
  last_activity_at  timestamptz not null default now(),
  anonymized_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (stage <> 'lost' or lost_reason is not null)
);
create index on public.leads (owner_id, stage);
create index on public.leads (created_by);
create index on public.leads (next_follow_up_at) where stage not in ('booked','lost');
create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

create table public.lead_activities (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  type       text not null check (type in ('note','call','whatsapp','stage','assign','visit','import','booking','system')),
  body       text,        -- system-generated, non-sensitive text
  body_enc   bytea,       -- user-written notes (encrypted)
  meta       jsonb not null default '{}',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.lead_activities (lead_id, created_at desc);

-- KYC / address for customers who book (all encrypted)
create table public.client_profiles (
  lead_id           uuid primary key references public.leads(id) on delete cascade,
  pan_enc           bytea,
  id_number_enc     bytea,   -- Aadhaar / passport etc.
  address_enc       bytea,
  updated_at        timestamptz not null default now()
);

-- ---------- visits, bookings, payments, documents ----------
create table public.site_visits (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  scheduled_at    timestamptz not null,
  executive_id    uuid not null references public.profiles(id),
  status          text not null default 'scheduled'
                  check (status in ('scheduled','confirmed','done','no_show','cancelled')),
  feedback        text,
  done_loc_enc    bytea,    -- "lat,lng" captured when marked done
  done_at         timestamptz,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.site_visits (executive_id, scheduled_at);
create index on public.site_visits (lead_id);

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.leads(id),
  unit_id             uuid not null references public.units(id),
  booking_date        date not null default ((now() at time zone 'Asia/Kolkata')::date),
  agreement_value_enc bytea not null,
  token_amount_enc    bytea,
  closed_by           uuid not null references public.profiles(id),
  status              text not null default 'pending' check (status in ('pending','approved','cancelled')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  cancel_reason       text,
  created_by          uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
create unique index bookings_one_active_per_unit on public.bookings (unit_id) where status <> 'cancelled';
create index on public.bookings (closed_by);

create table public.payment_milestones (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id) on delete cascade,
  label               text not null,
  due_date            date,
  amount_enc          bytea not null,
  received_amount_enc bytea,
  received_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index on public.payment_milestones (booking_id);

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete set null,
  type        text not null check (type in ('kyc','agreement','receipt','other')),
  file_path   text not null unique,     -- storage path: <lead_id>/<uuid>.<ext>
  file_name   text not null,
  mime        text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  size_bytes  int  not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------- tasks ----------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 200),
  description text,
  lead_id     uuid references public.leads(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid default auth.uid() references public.profiles(id) on delete set null,
  due_at      timestamptz,
  priority    text not null default 'normal' check (priority in ('low','normal','high')),
  type        text not null default 'general' check (type in ('follow_up','general')),
  status      text not null default 'open' check (status in ('open','done')),
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.tasks (assigned_to, status, due_at);

-- ---------- attendance & GPS ----------
create table public.attendance (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  work_date        date not null default ((now() at time zone 'Asia/Kolkata')::date),
  check_in_at      timestamptz not null default now(),
  check_in_loc_enc bytea not null,
  check_out_at     timestamptz,
  check_out_loc_enc bytea,
  unique (user_id, work_date)
);

create table public.location_pings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  loc_enc     bytea not null,        -- "lat,lng"
  accuracy_m  real,
  recorded_at timestamptz not null default now()
);
create index on public.location_pings (user_id, recorded_at desc);

-- ---------- incentives ----------
create table public.incentive_rules (
  id         uuid primary key default gen_random_uuid(),
  applies_to text not null check (applies_to in ('role','user','project')),
  target     text not null,                       -- role key, user uuid or project uuid
  calc       text not null check (calc in ('percent','fixed')),
  value      numeric(14,4) not null check (value >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (calc <> 'percent' or value <= 100)
);
insert into public.incentive_rules (applies_to, target, calc, value) values
  ('role','sales','percent',2), ('role','manager','percent',1);

create table public.incentives (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  user_id     uuid not null references public.profiles(id),
  rule_id     uuid references public.incentive_rules(id) on delete set null,
  amount_enc  bytea not null,
  status      text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  approved_by uuid references public.profiles(id),
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (booking_id, user_id)
);

-- ---------- notifications, webhooks, audit ----------
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text,
  link       text check (link is null or link ~ '^/[A-Za-z0-9/_?=&-]*$'),   -- in-app paths only
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.lead_webhooks (
  id                 uuid primary key default gen_random_uuid(),
  source_name        text not null unique,
  secret_enc         bytea not null,
  default_owner_id   uuid references public.profiles(id) on delete set null,
  default_project_id uuid references public.projects(id) on delete set null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,     -- view_pii | export | download | perm_change | delete | login | login_failed | ...
  entity     text,
  entity_id  text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);
create index on public.audit_log (actor_id, created_at desc);

create or replace function private.audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}')
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb)) $$;

-- audit_log is append-only, even for the table owner acting through the API
create or replace function private.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

revoke execute on all functions in schema private from public, anon, authenticated;
