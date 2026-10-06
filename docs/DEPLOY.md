# Going live — Sai Space Realty CRM

Everything here needs **your** Supabase and Vercel accounts. Passwords and secret keys are typed by you, in your own terminal or dashboard; never paste the `service_role` key or the database password into a chat.

Time needed: about 45 minutes.

## 0. What you need

- A Supabase account (free plan works) and a Vercel account (free plan works)
- Node.js (already installed on this PC)
- Optional: a domain such as `crm.saispacerealty.com`

## 1. Create the Supabase project

1. supabase.com → **New project** → name `sai-space-crm` → region **Mumbai (ap-south-1)**.
2. Set a strong database password and store it in a password manager.
3. From Project Settings → API, note the **Project ref**, **Project URL** and **anon / publishable key** (all three are public values).

## 2. Link and push the database

```bash
npx supabase login
```
```bash
npx supabase link --project-ref <project-ref>
```
```bash
npx supabase db push
```
This applies all the migrations: schema, encryption keys (created inside Supabase Vault), access rules, scheduled jobs.

```bash
npx supabase config push
```
This applies the auth settings from `supabase/config.toml`: no public sign-up, password rules, authenticator-app two-step verification for Owner/Admin.

Check in the dashboard → Authentication → Sign In / Providers that **"Allow new users to sign up" is OFF** and **Email provider is ON**.

## 3. Deploy the server functions

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://<your-crm-domain>
```
Use the exact address staff will open (e.g. `https://crm.saispacerealty.com` or `https://sai-space-crm.vercel.app`). Several addresses can be listed, separated by commas. No trailing slash.

```bash
npx supabase functions deploy login admin-users change-password upload-document lead-intake
```

## 3a. Two-step verification for Owner and Admin (free)

Owner and Admin accounts use a free **authenticator app** (Google Authenticator or Microsoft Authenticator). Supabase includes this on every plan at no extra cost; there are no SMS/WhatsApp charges and no DLT registration.

Nothing to configure beyond step 2: `npx supabase config push` turns authenticator apps on and SMS codes off. Check it in the dashboard → Authentication → Multi-Factor: **Authenticator app (TOTP)** on, **Phone** off.

## 4. Back up the encryption key (do this now)

In the Supabase dashboard → SQL Editor, run:

```sql
select name, decrypted_secret from vault.decrypted_secrets where name like 'crm_%';
```

Copy the two values (`crm_data_key_v1`, `crm_index_key`) into your password manager or a printed sheet kept in a safe. **If these are lost, encrypted phone numbers, KYC data and amounts cannot be recovered — not by anyone.** Do not store them in email, chat or the code.

## 5. Create the Owner login

In the dashboard → Project Settings → API, reveal the `service_role` key, then in this folder run (PowerShell):

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY = "<paste service_role key>"; node scripts/create-owner.mjs
```

It asks for a username, your name, your mobile number (optional) and a password. Close that terminal afterwards so the key is not left in its history.

## 6. Deploy the website (Vercel)

1. Put the Supabase host into the security headers:
   ```bash
   node scripts/set-csp.mjs <project-ref>
   ```
2. Push this folder to a **private** GitHub repository and import it in Vercel (framework: Vite).
3. In Vercel → Project → Settings → Environment Variables add:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key
4. Deploy. Add your custom domain in Vercel → Domains if you have one, and make sure that exact address is in `ALLOWED_ORIGINS` (step 3).

## 7. First sign-in and go-live checks

1. Open the site, sign in as the Owner, scan the QR code with Google or Microsoft Authenticator and type the code it shows.
2. Settings → Company: check details; set the office location and geofence if wanted.
3. Projects: add projects, towers and units. Employees: add your team.
4. Run these checks (they could not be verified on the local test setup):

| Check | How | Expected |
|---|---|---|
| Security headers | securityheaders.com → enter your address | Grade A; CSP shown as report-only for now |
| CORS allowlist | see command below | No `Access-Control-Allow-Origin` header for a foreign origin, status 403 |
| Installable app | Android Chrome → menu → **Add to Home screen** | Opens full-screen with the SR icon |
| GPS | A staff phone: Attendance → Check in | Appears on Live Tracking within a minute |
| Database advisors | Supabase dashboard → Advisors → Security | No errors |

```bash
curl -i -X POST https://<project-ref>.supabase.co/functions/v1/login -H "Origin: https://evil.example" -H "Content-Type: application/json" -d "{}"
```

5. After 3–5 days with no CSP reports in the browser console of normal use, enforce the policy and redeploy:
   ```bash
   node scripts/set-csp.mjs <project-ref> --enforce
   ```

## 8. Connecting lead sources

Settings → Lead webhooks → Create. Give the address and secret to the tool that will send leads:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/lead-intake?id=<webhook-id>" -H "Content-Type: application/json" -H "X-Webhook-Secret: <secret>" -d "{\"name\":\"Amit Sharma\",\"phone\":\"9876543210\",\"note\":\"2 BHK enquiry\"}"
```

- **Website form / Google Ads lead form / Zapier / Make / Pabbly**: use the address + `X-Webhook-Secret` header.
- **Facebook / Instagram Lead Ads**: connect through Zapier, Make or Pabbly (Meta → webhook step).
- **99acres / MagicBricks / Housing.com**: export their leads as CSV/Excel and use Leads → Import.

## 9. Plan limits to know (Supabase free plan)

- The project **pauses after 7 days without activity**; a daily-used CRM will not pause, but a long holiday might. The Pro plan removes this.
- Server-side session idle timeout and Supabase's own leaked-password check are Pro features. The app enforces an 8-hour idle logout itself and checks leaked passwords in its own functions, so both are covered on the free plan.
- Backups: free plan keeps no downloadable backups. Before storing real customer data, either upgrade to Pro (daily backups) or schedule `npx supabase db dump` weekly to an encrypted drive.

## 10. Maintenance

| Task | How |
|---|---|
| Rotate the encryption key (yearly, or if a leak is suspected) | SQL Editor: `select private.rotate_data_key();` then back up the new `crm_data_key_v<N>` as in step 4 |
| Owner/Admin lost or changed their phone | Dashboard → Authentication → Users → the user → remove their MFA factor. At the next sign-in they scan a new QR code with the new phone. (Ask them to set it up again straight away.) |
| Update the app | Pull the new code, `npx supabase db push`, `npx supabase functions deploy …`, redeploy on Vercel |
| Run the tests | `npm run test:db` (no setup needed) · local stack: `npm run db:start`, `npm run functions`, `npm run db:seed`, `npm run test:e2e` |
