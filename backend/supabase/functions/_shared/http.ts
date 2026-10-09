// Shared HTTP helpers for all browser-facing Edge Functions.
// CORS: exact-match allowlist from the ALLOWED_ORIGINS secret — never "*" (PLAN.md §6B-2).

const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req.headers.get('origin')),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// Returns a response for preflight / disallowed origins, or null to continue.
export function guard(req: Request): Response | null {
  const origin = req.headers.get('origin')
  if (origin && !allowed.includes(origin)) return json(req, { error: 'Origin not allowed' }, 403)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
  return null
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}

// Internal auth identity for a username. Staff never see or use this address.
export const usernameToEmail = (u: string) => `${u.toLowerCase()}@staff.saispace-crm.local`

export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/

// Password policy (PLAN.md §6B-3). Returns an error message or null.
export async function checkPassword(pw: string, username: string): Promise<string | null> {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.'
  if (pw.length > 72) return 'Password must be at most 72 characters.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw))
    return 'Password needs an uppercase letter, a lowercase letter and a digit.'
  if (pw.toLowerCase().includes(username.toLowerCase())) return 'Password must not contain the username.'
  if (await isPwned(pw)) return 'This password has appeared in a data breach. Choose a different one.'
  return null
}

// Have I Been Pwned k-anonymity check: only the first 5 hex chars of the
// SHA-1 hash leave the server; the password itself is never sent.
async function isPwned(pw: string): Promise<boolean> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw))
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return false
    const suffix = hex.slice(5)
    return (await res.text()).split('\n').some((line) => {
      const [s, count] = line.trim().split(':')
      return s === suffix && Number(count) > 0
    })
  } catch {
    return false // service unreachable: don't block the user; the other rules still apply
  }
}
