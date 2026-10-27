// POST { action: 'save' | 'test', from_name, from_email, host, port, user, password? } -> { ok }   (Settings permission)
// POST { action: 'send', lead_id, subject, body }                                      -> { ok }   (leads permission + lead visibility)
// The only code that sees the mailbox password. Checks, in order: caller identity ->
// permission (RLS-aware RPCs as the caller) -> input limits -> rate limit -> SMTP.
import nodemailer from 'npm:nodemailer@6'
import { admin, asCaller, callerId } from '../_shared/clients.ts'
import { guard, json } from '../_shared/http.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PORTS = [25, 465, 587, 2525]

// The admin chooses the SMTP host, so refuse anything that points inside our own network.
function badHost(h: string): boolean {
  if (!/^[a-z0-9.-]+$/i.test(h) || !h.includes('.') || h.length > 253) return true
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h)) return true
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

interface Creds { from_name: string; from_email: string; host: string; port: number; user: string; password: string }

const transport = (c: Creds) =>
  nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    requireTLS: c.port === 587,
    auth: { user: c.user, pass: c.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

const clean = (s: unknown, max: number) => String(s ?? '').replaceAll('\0', '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)

Deno.serve(async (req) => {
  const early = guard(req)
  if (early) return early

  const me = await callerId(req)
  if (!me) return json(req, { error: 'Not signed in' }, 401)

  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return json(req, { error: 'Bad request' }, 400)
  }
  const caller = asCaller(req)

  // ---------- send an email to a lead ----------
  if (b.action === 'send') {
    const leadId = String(b.lead_id ?? '')
    const subject = clean(b.subject, 200)
    const body = String(b.body ?? '').replaceAll('\0', '').trim()
    if (!UUID.test(leadId) || !subject || !body || body.length > 10_000) return json(req, { error: 'Enter a subject and a message (up to 10,000 characters)' }, 400)

    const { data: ok } = await caller.rpc('can_email_lead', { p_lead: leadId })
    if (ok !== true) return json(req, { error: 'You do not have permission to email this lead' }, 403)
    const { data: allowed } = await admin.rpc('svc_mail_allow', { p_actor: me })
    if (allowed !== true) return json(req, { error: 'Email limit reached (30 per hour). Try again later.' }, 429)

    const [{ data: creds }, { data: target }] = await Promise.all([admin.rpc('svc_mail_credentials'), admin.rpc('svc_lead_mail_target', { p_lead: leadId })])
    if (!creds) return json(req, { error: 'Email is not set up yet. Ask an Admin to connect a mailbox in Settings.' }, 409)
    if (!target?.email || !EMAIL.test(target.email)) return json(req, { error: 'This lead has no email address' }, 422)

    try {
      await transport(creds as Creds).sendMail({
        from: { name: (creds as Creds).from_name, address: (creds as Creds).from_email },
        to: target.email,
        subject,
        text: body,
      })
    } catch (e) {
      console.error('mail send failed', (e as Error).message)
      return json(req, { error: 'The mail server rejected the message. Check the mailbox settings.' }, 502)
    }
    await admin.rpc('svc_log_email', { p_actor: me, p_lead: leadId, p_subject: subject, p_body: body })
    return json(req, { ok: true })
  }

  // ---------- connect / test the company mailbox ----------
  if (b.action === 'save' || b.action === 'test') {
    const { data: may } = await caller.rpc('can_manage_mail')
    if (may !== true) return json(req, { error: 'You do not have permission to change mail settings' }, 403)

    const c: Creds = {
      from_name: clean(b.from_name, 80),
      from_email: clean(b.from_email, 254).toLowerCase(),
      host: clean(b.host, 253).toLowerCase(),
      port: Number(b.port),
      user: clean(b.user, 254),
      password: String(b.password ?? ''),
    }
    if (!c.from_name || !EMAIL.test(c.from_email) || !c.user) return json(req, { error: 'Fill in the sender name, sender email and username' }, 400)
    if (badHost(c.host)) return json(req, { error: 'Enter a valid mail server address, for example smtp.gmail.com' }, 400)
    if (!PORTS.includes(c.port)) return json(req, { error: 'Port must be 465, 587, 25 or 2525' }, 400)
    if (c.password.length > 256) return json(req, { error: 'Password is too long' }, 400)

    // leaving the password blank keeps the stored one
    if (!c.password) {
      const { data: stored } = await admin.rpc('svc_mail_credentials')
      if (!stored?.password) return json(req, { error: 'Enter the mailbox password' }, 400)
      c.password = stored.password
      if (b.action === 'save') c.password = ''
    }

    if (b.action === 'test') {
      try {
        await transport(c).verify()
        return json(req, { ok: true })
      } catch (e) {
        console.error('mail verify failed', (e as Error).message)
        return json(req, { error: 'Could not sign in to the mail server. Check the server, port, username and password.' }, 422)
      }
    }
    // save: verify first when a new password was supplied
    if (c.password) {
      try {
        await transport(c).verify()
      } catch (e) {
        console.error('mail verify failed', (e as Error).message)
        return json(req, { error: 'Could not sign in to the mail server. Check the server, port, username and password.' }, 422)
      }
    }
    const { error } = await admin.rpc('svc_save_mail_account', {
      p_actor: me, p_from_name: c.from_name, p_from_email: c.from_email, p_host: c.host, p_port: c.port, p_user: c.user, p_password: c.password,
    })
    if (error) return json(req, { error: error.code === '22023' ? error.message : 'Could not save the mail settings' }, 500)
    return json(req, { ok: true })
  }

  return json(req, { error: 'Bad request' }, 400)
})
