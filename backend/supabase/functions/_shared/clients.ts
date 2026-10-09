import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

// Full-access client. Server-side only; bypasses RLS, so every use must be
// preceded by an explicit permission check.
export const admin: SupabaseClient = createClient(url, serviceKey, noSession)

// Anonymous client (used only to verify a password).
export const anon = () => createClient(url, anonKey, noSession)

// Client acting as the caller: RLS and has_perm() apply exactly as in the browser.
export function asCaller(req: Request): SupabaseClient {
  return createClient(url, anonKey, {
    ...noSession,
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
}

// Resolves the caller from their JWT; null if the token is missing/invalid.
export async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error || !data.user ? null : data.user.id
}
