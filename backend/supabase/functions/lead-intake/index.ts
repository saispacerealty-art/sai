// POST /functions/v1/lead-intake?id=<webhook id>
// Server-to-server lead capture (website forms, Google Ads lead forms, Zapier/Make/Pabbly…).
//
// Auth — either header works:
//   X-Webhook-Secret: <secret>                         (simple tools)
//   X-Signature: hex(HMAC-SHA256(raw body, secret))    (preferred: the secret never travels)
//
// Body (JSON): { name, phone, email?, note?, budget_min?, budget_max?, config_wanted?, source_ref? }
//   aliases accepted: full_name, mobile, phone_number, message
//
// Not for browsers: requests carrying an Origin header are refused, and no CORS
// headers are ever sent (PLAN.md §6B-2). Deployed with verify_jwt = false.
import { admin } from '../_shared/clients.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

// constant-time string comparison
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const str = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '')

Deno.serve(async (req) => {
  if (req.headers.get('origin')) return reply({ error: 'This endpoint is not for browsers' }, 403)
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return reply({ error: 'Unknown webhook' }, 404)

  const raw = await req.text()
  if (raw.length > 20_000) return reply({ error: 'Payload too large' }, 413)

  const { data: hook } = await admin.rpc('svc_webhook_secret', { p_id: id })
  // same answer for "no such webhook" and "wrong secret", so ids can't be probed
  const secret: string = hook?.secret ?? crypto.randomUUID()
  const given = req.headers.get('x-webhook-secret') ?? ''
  const signature = (req.headers.get('x-signature') ?? '').toLowerCase().replace(/^sha256=/, '')
  const authed = (given && same(given, secret)) || (signature && same(signature, await hmacHex(secret, raw)))
  if (!hook || !authed) return reply({ error: 'Unauthorized' }, 401)
  if (!hook.active) return reply({ error: 'This webhook is switched off' }, 403)

  const { data: allowed } = await admin.rpc('svc_webhook_allow', { p_id: id })
  if (allowed !== true) return reply({ error: 'Too many requests' }, 429)

  let p: Record<string, unknown>
  try {
    p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error()
  } catch {
    return reply({ error: 'Body must be a JSON object' }, 400)
  }

  const { data, error } = await admin.rpc('svc_intake_lead', {
    p_id: id,
    p: {
      name: str(p.name ?? p.full_name, 80),
      phone: str(p.phone ?? p.mobile ?? p.phone_number, 20),
      email: str(p.email, 120),
      note: str(p.note ?? p.message, 2000),
      budget_min: str(p.budget_min, 15),
      budget_max: str(p.budget_max, 15),
      config_wanted: str(p.config_wanted, 40),
      source_ref: str(p.source_ref, 200),
    },
  })
  if (error) return reply({ error: error.code === '22023' ? error.message : 'Could not save the lead' }, error.code === '22023' ? 422 : 500)
  return reply({ ok: true, duplicate: data.duplicate === true })
})
