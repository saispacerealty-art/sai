# Sai Space Realty CRM

Real-estate CRM: leads, projects and units, site visits, bookings and payments, clients and KYC, tasks, attendance with GPS, live team map, incentives, reports.

React + Vite + TypeScript + Tailwind on the front, Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) behind it.

- **Plan, decisions and build status:** [PLAN.md](PLAN.md)
- **Going live:** [docs/DEPLOY.md](docs/DEPLOY.md) (Vercel) or [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md) (AWS Amplify)

## Two parts, deployed separately

| Folder | What it is | Deployed to | How |
|---|---|---|---|
| `frontend/` | The website staff open (React app) | AWS Amplify or Vercel | `git push` (Amplify builds it) · or `npx vercel deploy --prod` inside `frontend/` |
| `backend/` | Database, logins, files, server functions | Supabase | Inside `backend/`: `npx supabase db push`, `npx supabase functions deploy …` |

Each folder has its own `package.json`. The `package.json` at the top only holds shortcuts, so every `npm run …` below works from the top folder.

## Run it on this computer

Needs Node.js and Docker Desktop (running).

```bash
npm run install:all
```
```bash
npm run db:start
```
Starts the local Supabase stack and applies every migration. Copy the printed `API_URL` and `ANON_KEY` into `frontend/.env.local` (see `frontend/.env.example`), and `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` into `backend/.env.scripts.local`.

```bash
npm run functions
```
Serves the Edge Functions (leave it running).

```bash
npm run db:seed
```
Creates a test team and sample data. Test logins are written to `backend/scripts/.dev-users.json` (git-ignored). The Owner also needs an authenticator-app code: scan the QR code at the first sign-in with Google/Microsoft Authenticator (free).

```bash
npm run dev
```
Open http://localhost:5173.

## Tests

| Command | What it checks | Needs |
|---|---|---|
| `npm run test:db` | 230 database tests: encryption, access rules for every role, the full lead → booking → incentive flow, scheduled jobs, key rotation, authenticator-app sign-in rules | Nothing (runs Postgres in-process) |
| `npm run test:e2e` | 42 API tests: origin allowlist, lead webhook auth + rate limit, document upload/download, live notifications, authenticator-app sign-in | Local stack + functions + seed |
| `npm run lint` · `npm run typecheck` · `npm run build` | Code checks (the linter also blocks XSS-prone patterns) | Nothing |

## Layout

```
frontend/                      WEBSITE → AWS Amplify / Vercel
  src/                         React app (pages/ per module, lib/ shared helpers, auth/ session + permissions)
  public/                      logos, app icons
  scripts/set-csp.mjs          writes the Supabase host into the security headers (vercel.json + ../customHttp.yml)
  vercel.json                  Vercel headers and page-link rule
backend/                       SERVER → Supabase
  supabase/migrations          Database: schema, encryption, access rules, business logic, scheduled jobs
  supabase/functions           login · admin-users · change-password · upload-document · lead-intake
  supabase/config.toml         Auth settings (password rules, two-step verification)
  scripts/                     create-owner.mjs (production), seed-dev.mjs + dev-logins.mjs (local only)
  tests/db · tests/e2e         Database tests (PGlite) · API tests (local stack)
amplify.yml                    AWS Amplify build (monorepo, appRoot: frontend)
customHttp.yml                 AWS Amplify security headers (generated, do not edit)
docs/                          DEPLOY.md (Vercel), DEPLOY-AWS.md, client demo, user-guide decks
```

## Security model in one paragraph

Every table has row-level security and column-level grants: the browser can never read or write an encrypted column. Phones, emails, KYC, amounts, notes and GPS points are encrypted inside Postgres with a key held in Supabase Vault; anything that decrypts goes through a function that checks permission and writes to an append-only audit log. Roles give default permissions, the Admin can adjust them per person, and each account sees its own records, its team's, or everything. Owner and Admin also need the 6-digit code from a free authenticator app; without it the database grants them nothing.
