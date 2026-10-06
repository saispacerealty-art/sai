# Sai Space Realty CRM — Build Plan (v1)

Status: **Phases 0–8 built and tested locally (30 Sept 2026). Phase 9 (go-live) needs the Owner's Supabase + Vercel accounts — see [docs/DEPLOY.md](docs/DEPLOY.md).** Items marked **[ASSUMED]** were defaults picked because the question was unanswered; they were approved as-is.

## 0. Build status

| Phase | Status | Verified by |
|---|---|---|
| 0 Setup, schema, encryption, access rules | Done | 66 database tests |
| 1 Login, MFA, app shell, employees | Done | End-to-end seed script + browser |
| 2 Leads (Kanban, list, drawer, notes, call/WhatsApp, import, export) | Done | Database tests + browser |
| 3 Projects, towers, unit grid, holds | Done | Database tests + browser |
| 4 Site visits, bookings, approvals, payments, clients, KYC, documents | Done | Database tests + 10 upload/download API tests |
| 5 Attendance, GPS pings, live map, geofence | Done | Database tests + browser |
| 6 Tasks, incentives, notifications (live), reminders | Done | Database tests + browser |
| 7 Dashboard, reports, CSV export | Done | Database tests + browser |
| 8 Settings, lead webhooks, round-robin, PWA config | Done | 11 webhook API tests |
| 9 Deploy | **Waiting on accounts** | Steps in docs/DEPLOY.md |

Test totals: 230 database tests (`npm run test:db`) + 42 API tests (`npm run test:e2e`). Owner/Admin two-step verification: tried WhatsApp, then SMS codes on 1 Oct 2026; settled the same day on free authenticator apps (TOTP), which cost nothing and need no DLT registration (migration 0016).

**Not verifiable on the local test setup — check at go-live (listed in docs/DEPLOY.md §7):**
- CORS response headers on hosted Supabase (the local gateway rewrites them; the functions' own origin check is tested).
- Service worker / "Add to Home Screen" (the headless test browser has no cache storage).
- Real GPS on real phones, and the scheduled jobs firing on their timetable (the jobs themselves are tested).

**Deliberately not built in v1:** channel partners, WhatsApp Business API auto-send, 99acres/MagicBricks direct push (use CSV import), native Android app for background tracking, selfie at check-in.

---

## 1. Decisions so far

| Area | Decision |
|---|---|
| Architecture | Real web app + cloud database |
| Design | Merge: Sample 2 dashboard/Kanban/tracking look + Sample 1 animated skyline login |
| Access | Role presets + per-user overrides, with data scope (own / team / all) |
| Tracking | Real GPS from phone browser while checked in |
| Modules v1 | Leads + follow-ups, Projects/Units, Site Visits, Bookings/Sales, Attendance, Tasks, Incentives, Reports |
| Lead sources | Manual, Excel/CSV import, portal/ad webhooks, WhatsApp + click-to-call |
| Incentives | Admin-configurable rules (% or fixed, per role / user / project) |
| Mobile | Responsive + installable PWA |
| Backend | **[ASSUMED]** Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) |
| Hosting | **[ASSUMED]** Vercel free tier, custom domain later |
| Language | **[ASSUMED]** English only (labels kept in one file so Marathi/Hindi can be added) |
| Admins | **[ASSUMED]** One Owner account; Owner can promote others to Admin. Managers cannot create logins. |
| Seed data | **[ASSUMED]** Empty DB + optional "Load demo data" button for testing |
| Logo | **[ASSUMED]** Extracted from the sample HTML file |
| Encryption | All data encrypted in transit + at rest; sensitive personal fields also encrypted at field level (see section 6A) |
| App security | Strict CSP (no unsafe-inline/eval), CORS allowlist on our APIs, RBAC enforced in DB + API + UI, password/MFA/session policy (see section 6B) |
| Extra modules ("something else") | **[ASSUMED]** Clients (booked customers), Documents (KYC/agreement uploads), Payment milestones. Channel partners → v2 |

---

## 2. Tech stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS (navy/gold design tokens), React Router
- **Data:** `@supabase/supabase-js`, TanStack Query for caching, Supabase Realtime for live updates (Kanban, notifications, map)
- **Maps:** Leaflet + OpenStreetMap (free, no API key)
- **Charts:** Recharts
- **Import:** SheetJS (`xlsx`) for Excel/CSV
- **PWA:** `vite-plugin-pwa` (manifest, icons, offline shell)
- **Server logic:** Supabase Edge Functions (create employee logins, lead webhook intake, incentive calculation)
- **Security:** Postgres Row-Level Security (RLS) enforces permissions server-side. The UI hides things too, but the database is the real gate.

---

## 3. Roles & permissions

### 3.1 Modules (the checkbox list)
`dashboard` · `leads` · `projects` · `visits` · `bookings` · `clients` · `tasks` · `attendance` · `tracking` · `employees` · `incentives` · `reports` · `settings`

### 3.2 Action flags
`leads.assign` · `leads.delete` · `leads.import` · `leads.export` · `projects.edit` · `bookings.approve` · `incentives.approve` · `employees.manage`

### 3.3 Data scope
- **own**: only records the user owns or created
- **team**: own + everyone whose `manager_id` = me
- **all**: everything

### 3.4 Default presets (Admin can tick/untick per person)

| Role | Modules | Scope | Notable flags |
|---|---|---|---|
| Owner/Admin | all | all | all |
| Manager | all except settings | team | assign, import, export, projects.edit, bookings.approve |
| Sales Person | dashboard, leads, projects(view), visits, bookings, clients, tasks, attendance, incentives(own) | own | — |
| Telecaller | dashboard, leads, visits, tasks, attendance | own | — |
| Digital Marketing | dashboard, leads, reports | all (leads read) | import |
| Analyst | dashboard, reports, bookings(view), incentives(view) | all (read-only) | export |

Effective permission = role preset → overridden by per-user grants/revokes.

---

## 4. Database (Supabase / Postgres)

```
profiles          id(=auth.users) · full_name · phone · username · role · manager_id · is_active · avatar_url · created_at
role_presets      role · modules[] · flags[] · scope
user_overrides    user_id · key · allowed(bool)           -- key = module or flag

projects          id · name · location · lat · lng · config ("2 & 3 BHK") · price_min · price_max · status · cover_url
towers            id · project_id · name · floors
units             id · tower_id · unit_no · floor · config · carpet_sqft · price · status(available|hold|booked) · hold_until

leads             id · name · phone · alt_phone · email · source · source_ref · project_id · budget_min · budget_max
                  · config_wanted · stage · lost_reason · score · owner_id · created_by · next_follow_up_at · created_at
lead_activities   id · lead_id · type(note|call|whatsapp|stage|assign|visit|import) · body · meta jsonb · created_by · created_at

site_visits       id · lead_id · project_id · scheduled_at · executive_id · status(scheduled|confirmed|done|no_show|cancelled)
                  · feedback · checkin_lat · checkin_lng · done_at
bookings          id · lead_id · unit_id · booking_date · agreement_value · token_amount · closed_by · status(pending|approved|cancelled)
payment_milestones id · booking_id · label · due_date · amount · received_amount · received_at
documents         id · lead_id/booking_id · type(kyc|agreement|receipt|other) · file_path · uploaded_by

tasks             id · title · lead_id? · assigned_to · assigned_by · due_at · priority · status(open|done) · type(follow_up|general)

attendance        id · user_id · date · check_in_at · check_in_lat · check_in_lng · check_out_at · check_out_lat · check_out_lng · selfie_url?
location_pings    id · user_id · lat · lng · accuracy · battery? · recorded_at      -- only while checked in

incentive_rules   id · applies_to(role|user|project) · target · type(percent|fixed) · value · active
incentives        id · booking_id · user_id · rule_id · amount · status(pending|approved|paid) · paid_at

notifications     id · user_id · title · body · link · read_at · created_at
lead_webhooks     id · source_name · secret · default_owner_id · default_project_id · active
audit_log         id · actor_id · action(view_pii|export|download|perm_change|delete|login) · entity · entity_id · meta jsonb · ip · created_at
company_settings  single row · name · phone · address · logo_url · working_hours · follow_up_default_days
```

Lead stages: **New → Contacted → Qualified → Visit Scheduled → Visit Done → Negotiation → Booked / Lost** (a Lost reason is required: Budget, Location, Bought elsewhere, Not reachable, Not interested, Other).

---

## 5. Screens

1. **Login**: Sample 1 skyline animation with Sample 2 colours. Username + password. No self-signup.
2. **Shell**: navy gradient sidebar with a gold active item and badge counts (open leads, overdue tasks). The top bar has global search, a notification bell, check-in status and the user menu. On mobile the sidebar becomes a drawer, with a bottom tab bar for field staff.
3. **Dashboard**: role-aware.
   - Admin/Manager: 6 stat cards, pipeline, recent activity, live map, employee performance table, revenue chart, today's visits/follow-ups.
   - Sales/Telecaller: my follow-ups today, my overdue, my visits, my month's bookings + incentive earned.
4. **Leads**: Kanban (drag = stage change + activity log) and a filterable List view. There's also a lead drawer with details, a timeline, notes, call/WhatsApp buttons, schedule visit, add follow-up, reassign and "Convert to booking". Includes bulk assign, CSV import with column mapping + duplicate check (phone), and export.
5. **Projects**: project cards → tower → unit grid coloured by status (available/hold/booked), with a hold timer.
6. **Site Visits**: calendar + list, where the executive marks it "Done" on site (GPS captured) and gives feedback.
7. **Bookings/Sales**: booking form (lead + unit + value), manager approval, payment milestones and document uploads. On approval the unit is marked as booked and incentives are calculated.
8. **Clients**: booked customers with their booking, payments due and documents.
9. **Tasks**: my tasks / team tasks, with overdue highlighting. Follow-ups show up here too.
10. **Attendance**: Check In / Check Out buttons (GPS required), a daily log, a monthly summary and CSV export.
11. **Live Tracking**: Sample 2 layout: employee list + map, a breadcrumb trail for the day, last-seen time and online/idle/offline status.
12. **Employees**: add/edit a user with a role preset and permission checkboxes (Sample 1 style), manager assignment, deactivate and reset password.
13. **Incentives**: rules editor (Admin), per-booking payouts, approve → mark paid, and a "my earnings" view.
14. **Reports**: source-wise leads and conversion, employee performance, stage funnel, visits → bookings ratio, monthly revenue, attendance summary. All exportable.
15. **Settings**: company info, lead sources + webhook URLs/secrets, lost reasons, role presets and the demo-data loader.

---

## 6. Key logic

- **Lead assignment:** manual, or round-robin among active Sales/Telecallers for webhook and imported leads (configurable).
- **Duplicate check:** the phone number is normalised to 10 digits. If it's a duplicate, the activity is attached to the existing lead and the owner is notified instead of creating a new lead.
- **Follow-ups:** each lead has `next_follow_up_at`. Overdue follow-ups appear on the dashboard, add to the sidebar badge and trigger a notification at 9 AM (a scheduled Edge Function).
- **Lead score (simple v1):** points for budget filled, project chosen, visit done, recent contact, and hot sources (referral/walk-in). There's a decay when there's been no activity for 7+ days.
- **Notifications:** new lead assigned to you · a lead added by a telecaller (to their manager) · a visit tomorrow · a follow-up overdue · a booking awaiting approval · an employee not checked in by 10:30 AM (to their manager).
- **GPS tracking:** after check-in, the app sends a location ping every 3 min while it is open. Pings stop at check-out. The status is online (ping < 5 min old), idle (5–20 min) or offline.
  - ⚠️ **Limitation:** phone browsers pause GPS when the app is in the background or the screen is locked. Reliable background tracking needs a native Android app. That's planned for v2, and the PWA is honest about it ("last seen 14 min ago").
- **Incentives:** when a booking is approved, the most specific rule is applied (user → project → role) and a `pending` incentive is created for `closed_by`. The Admin approves it, then marks it paid.
- **Unit hold:** a unit held for a booking-in-progress is automatically released after N hours if no booking is confirmed.
- **WhatsApp/Call:** `tel:` and `wa.me/91XXXXXXXXXX?text=` links with message templates (intro, visit reminder, brochure). Each tap is logged as an activity. WhatsApp Business API auto-send is a v2 paid add-on.
- **Portal/ad capture:** one Edge Function endpoint, `POST /lead-intake/{source}?key=SECRET`, that accepts JSON.
  - Works directly with: website forms, Google Ads lead forms, Zapier/Pabbly/Make.
  - Facebook/Instagram Lead Ads need a Meta app + page token, which is set up once.
  - 99acres/MagicBricks/Housing.com have no public push API for most plans, so the v1 route for them is their CSV export → import, or email-parsing in v2.

---

## 6A. Encryption & data-protection policy

### Layer 1: In transit (always on)
- HTTPS/TLS 1.2+ on every connection: browser ↔ Vercel, browser ↔ Supabase, and webhooks. Plain HTTP is never allowed (HSTS header set).
- Realtime (websocket) connections use WSS.

### Layer 2: At rest (always on)
- The Supabase Postgres disk, backups and Storage files are encrypted with AES-256 by the provider.
- Passwords are never stored by us. Supabase Auth keeps only bcrypt hashes.

### Layer 3: Field-level encryption of sensitive data (our code)
Even someone with raw database access or a leaked backup sees only ciphertext for these fields:

| Encrypted field | Table |
|---|---|
| phone, alt_phone, email | leads, profiles |
| PAN / Aadhaar / ID numbers, address | clients / bookings |
| agreement_value, payment amounts | bookings, payment_milestones **[ASSUMED — confirm]** |
| lat / lng | location_pings, attendance, site_visits |
| note text | lead_activities (type = note) **[ASSUMED — confirm]** |

- **Method:** AES-256 in OpenPGP format with an integrity check (tampering is detected), done inside Postgres via `pgcrypto`. (Earlier drafts said AES-GCM, but pgcrypto doesn't offer GCM. The OpenPGP mode gives the same practical guarantees here.) The encryption key lives in **Supabase Vault** and is never sent to the browser or stored in the code.
- **Access:** encrypted columns are read only through `SECURITY DEFINER` functions/views, which check the caller's permission (RLS + scope) before decrypting. No permission means no plaintext.
- **Searching / duplicate check:** a keyed hash (HMAC-SHA256 "blind index") of the normalised phone number is stored next to the ciphertext. That allows an exact match ("does 98765 43210 already exist?") without decrypting. Partial search ("9876…") on encrypted fields is **not possible**, so search works on name, project and stage, plus an exact phone match.
- **Masking:** telecallers see `98XXXXXX10` with a Call/WhatsApp button, and the full number is decrypted only at the moment of dialing (the dial is logged).
- **Key rotation:** a versioned key id is stored with each value, and an Admin-run rotation job re-encrypts the data.

### Layer 4: Files / documents
- KYC, agreement and receipt files go in a **private** Storage bucket, never a public one.
- Files are accessed via signed URLs that expire in 5 minutes, issued only after a permission check.
- File uploads are limited to PDF, JPG and PNG, max 10 MB.

### Layer 5: Access & audit
- RLS on every table, deny-by-default.
- Each **audit_log** entry records: who viewed/decrypted a phone number, exported data, downloaded a document, changed permissions, or deleted a record.
- Exports (CSV) require the `export` flag and are logged. Exported files are plaintext by nature, and the UI warns about this.
- Sessions time out after 8 hours idle. Password policy: at least 8 characters. **[ASSUMED]** 2FA (authenticator app) is optional for staff and **required for Admin**.
- Deactivating an employee revokes their sessions immediately.

### Layer 6: Retention (India DPDP Act 2023 friendly)
- GPS pings are auto-deleted after **90 days [ASSUMED]**. Attendance summary rows are kept.
- Lost leads are anonymised after **2 years [ASSUMED]** (encrypted fields wiped, stats kept).
- Employees must give location consent on first check-in, and the consent is logged.

### Trade-offs to know
- Field-level encryption makes reports on encrypted numbers (e.g. revenue totals) slower, because they're computed server-side in secure functions. That's fine at this scale (thousands of leads).
- If the Vault key is lost, the encrypted data is unrecoverable. The key is backed up offline by the Owner (instructions provided at deploy).

---

## 6B. Application security policy (CSP · CORS · Auth/RBAC)

### 1. Content Security Policy (blocks XSS / injected scripts)
Set as an HTTP response header from `vercel.json` (not a `<meta>` tag, so `frame-ancestors` works):

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob: https://*.tile.openstreetmap.org https://<project>.supabase.co;
font-src 'self';
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
worker-src 'self';
manifest-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
```
- **No `'unsafe-inline'` and no `'unsafe-eval'`.** All JS and CSS are bundled files, and Tailwind compiles to a stylesheet. No CDN scripts: Leaflet, Recharts and the other libraries are bundled from npm.
- Fonts are self-hosted, so no Google Fonts domain is needed.
- Map markers use CSS classes instead of inline `style="..."` HTML (which the samples used), so they don't need `'unsafe-inline'`.
- First deploy uses `Content-Security-Policy-Report-Only` for a few days to catch anything missed, then switches to enforcing.
- **Code rules:** React escapes output by default. `dangerouslySetInnerHTML` and `innerHTML` are banned by a lint rule. Both samples build HTML with `innerHTML` from lead names and notification text, which is exactly the XSS hole CSP and React close. Any rich text (e.g. notes) is shown as plain text.

**Other security headers** (also in `vercel.json`):
| Header | Value |
|---|---|
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` (legacy backup for frame-ancestors) |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `geolocation=(self), camera=(self), microphone=(), payment=(), usb=()` |
| Cross-Origin-Opener-Policy | `same-origin` |

### 2. Cross-Origin Resource Sharing
| Endpoint | CORS policy |
|---|---|
| **Our Edge Functions** (create employee, decrypt phone, export, approve booking…) | `Access-Control-Allow-Origin` = **only** `https://crm.<yourdomain>` (+ `http://localhost:5173` in dev only). No wildcard. Methods `POST, OPTIONS`. Headers `authorization, content-type, apikey`. Origins from other sites are rejected with a 403. |
| **Lead webhook** `/lead-intake` | Server-to-server, so no CORS at all (browsers can't call it). Protected by a per-source secret + HMAC signature check + rate limit (60/min/source). |
| **Supabase data API** (REST/Realtime) | ⚠️ Supabase's hosted API **cannot be restricted by origin**, and the public `anon` key is visible in the browser by design. So this layer relies on **RLS + JWT**: without a valid logged-in token, every table returns nothing, and with one you only get what your role/scope allows. |

Important: CORS only stops *browsers* on other sites. It doesn't stop scripts, Postman or curl. That's why every endpoint also checks authentication and permissions server-side; CORS is an extra layer, not the lock.

### 3. Authentication & password policy
- **No self-signup:** public signup is disabled in Supabase. Accounts are created only by an Admin through an Edge Function.
- **Username login:** the username maps internally to a private auth identity, so no real emails are needed for staff.
- **Password rules:**
  - at least 10 characters, with upper, lower and a digit
  - can't match the username
  - checked against a common/leaked-password list
  - the first login forces a password change, since the Admin sets a temporary one
- **Brute-force protection:** Supabase auth rate limiting, plus lock the account for 15 min after 5 failed attempts (tracked in `audit_log`).
- **MFA:** TOTP (authenticator app), required for Owner/Admin and optional for others.
- **Sessions:**
  - access token lasts 1 hour, with refresh-token rotation
  - idle logout after 8 hours: enforced in the app (activity timer). The server-side inactivity timeout and Supabase's built-in leaked-password check are **Supabase Pro plan** features, so on the free plan the leaked-password check runs in our own login Edge Function instead.
  - "log out all devices" in settings
  - deactivating an employee revokes their sessions immediately
- **Secrets:** the `service_role` key and the encryption key exist **only** in Edge Functions / Vault, never in frontend code or git. `.env` is gitignored.
- **CSRF:** tokens travel in the `Authorization` header (not cookies), so classic CSRF doesn't apply.

### 4. Role-Based Access Control (enforced in 3 places)
1. **Database (the real gate):** RLS policies on every table call `has_perm(module, action)` and `in_scope(owner_id)`, and deny by default.
2. **Edge Functions:** each function verifies the JWT, loads the caller's effective permissions and rejects the request if a flag is missing (e.g. `employees.manage`, `leads.export`).
3. **UI:** hides menus and buttons the user can't use. This is for convenience only; it is never trusted.

- A user can **never** edit their own role or permissions (enforced in RLS).
- Every permission change is written to `audit_log`.

### 5. Other hardening
- **Input validation:** every form and Edge Function payload is validated with `zod` (types, lengths, phone format), on both client and server.
- **Uploads:** file type is checked by MIME + magic bytes, with a 10 MB size cap and random file names.
- **Dependencies:** `npm audit` + Dependabot, and versions locked with a lockfile.
- **Errors:** no stack traces or SQL errors are shown to users; details go only to the server logs.
- **Pre-launch check:** Supabase Security Advisor (RLS lint), Mozilla Observatory / securityheaders.com (target grade A), and a manual role-by-role access test.

---

## 7. Build phases

| # | Phase | Output |
|---|---|---|
| 0 | Setup | Vite project, Tailwind theme, Supabase project, schema + RLS migrations, Vault key + encrypt/decrypt functions + blind index, audit_log, logo extracted |
| 1 | Auth & shell | Login, sidebar/topbar, permission engine, Employees page (create logins via Edge Function) |
| 2 | Leads | Kanban + list, lead drawer, activities, follow-ups, call/WhatsApp, import/export |
| 3 | Projects & units | Project/tower/unit CRUD, unit grid, holds |
| 4 | Visits, bookings, clients | Visit scheduling + GPS done, booking + approval, payments, documents |
| 5 | Attendance & tracking | Check-in/out, location pings, live map, trail |
| 6 | Tasks, incentives, notifications | Tasks, incentive rules + payouts, notification bell + realtime + scheduled reminders |
| 7 | Dashboard & reports | Role-aware dashboards, reports + export |
| 8 | Integrations & PWA | Webhook intake, round-robin, PWA install, offline shell |
| 9 | Deploy & security review | Vercel deploy with CSP/security headers (report-only → enforce), CORS allowlist, env vars, domain, MFA for Owner, Security Advisor + headers scan + role-by-role access test, owner account handover |

Each phase ends with a working demo you can click through before the next one starts.

---

## 8. What you need to provide / do

1. Create free accounts: **Supabase** and **Vercel**. (I'll give step-by-step instructions; you keep the passwords, and I never enter them.)
2. Real project list: names, locations, towers, unit numbers, sizes and prices. An Excel file is fine.
3. Employee list: name, role, phone, manager.
4. Commission rules (if not the default of 2% of agreement value to the closer).
5. Domain name, if you want `crm.yourdomain.com`.

---

## 9. Open questions

- [ ] Confirm the **[ASSUMED]** items in section 1
- [ ] Should Managers be able to create employee logins?
- [ ] Selfie on check-in, yes/no?
- [ ] Office geofence: should check-in be allowed only within X metres of the office or a project site?
- [ ] Should telecallers see the lead phone numbers in full, or masked (click-to-call only)? (Plan currently: masked)
- [ ] Encrypt deal amounts and note text too, or only contact/ID/location data?
- [ ] 2FA required for Admin only, or for everyone?
- [ ] Retention periods: GPS 90 days, lost leads 2 years — OK?
