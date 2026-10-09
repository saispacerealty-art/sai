import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { callFn } from '../lib/api'
import type { Me, PermKey } from '../lib/perms'
import { supabase } from '../lib/supabase'

const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000 // PLAN.md §6B-3: idle logout after 8 hours
const ACTIVITY_KEY = 'crm.lastActivity'

interface AuthState {
  session: Session | null
  me: Me | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: (everywhere?: boolean) => Promise<void>
  refreshMe: () => Promise<void>
  can: (key: PermKey) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

// Only a timestamp is stored — never tokens or personal data (Supabase keeps its own session).
function readActivity(): number | null {
  try {
    // oxlint-disable-next-line no-restricted-globals -- non-sensitive idle timestamp
    const v = Number(localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function writeActivity(ts: number) {
  try {
    // oxlint-disable-next-line no-restricted-globals -- non-sensitive idle timestamp
    localStorage.setItem(ACTIVITY_KEY, String(ts))
  } catch {
    /* storage unavailable: idle check falls back to in-memory only */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const lastActivity = useRef(0)

  const loadMe = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_permissions')
    if (error || !data) {
      setMe(null)
      return
    }
    setMe(data as Me)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      const prev = readActivity()
      if (data.session && prev && Date.now() - prev > IDLE_LIMIT_MS) {
        await supabase.auth.signOut({ scope: 'local' })
        setSession(null)
      } else {
        setSession(data.session)
        if (data.session) await loadMe()
      }
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (!s) setMe(null)
      else if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        // defer: never await Supabase calls inside this callback
        setTimeout(() => void loadMe(), 0)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadMe])

  // idle logout
  useEffect(() => {
    if (!session) return
    const mark = () => {
      const now = Date.now()
      if (now - lastActivity.current > 30_000) writeActivity(now)
      lastActivity.current = now
    }
    mark()
    writeActivity(Date.now())
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_LIMIT_MS) void supabase.auth.signOut({ scope: 'local' })
    }, 60_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark))
      window.clearInterval(timer)
    }
  }, [session])

  const login = useCallback(async (username: string, password: string) => {
    const res = await callFn<{ session: { access_token: string; refresh_token: string } }>('login', { username, password })
    const { error } = await supabase.auth.setSession(res.session)
    if (error) throw new Error('Sign-in failed. Please try again.')
    writeActivity(Date.now())
  }, [])

  const logout = useCallback(async (everywhere = false) => {
    await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' })
    setMe(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      me,
      loading,
      login,
      logout,
      refreshMe: loadMe,
      can: (key) => !!me?.granted.includes(key),
    }),
    [session, me, loading, login, logout, loadMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
