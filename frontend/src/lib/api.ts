import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Calls an Edge Function and returns its JSON, throwing an Error with the server's message. */
export async function callFn<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = 'Something went wrong. Please try again.'
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      if (payload?.error) message = payload.error
    } else if (error.name === 'FunctionsFetchError') {
      message = 'Cannot reach the server. Check your internet connection.'
    }
    throw new Error(message)
  }
  return data as T
}

/** Throws a readable Error for a failed PostgREST call. */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    // our own functions raise readable messages; raw Postgres denials are replaced with a plain one
    if (/permission denied|row-level security/i.test(res.error.message)) throw new Error('You do not have permission to do that.')
    throw new Error(res.error.message)
  }
  return res.data as T
}
