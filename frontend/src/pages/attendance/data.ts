import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { unwrap } from '../../lib/api'
import { rpc } from '../../lib/data'
import { getPosition } from '../../lib/geo'
import { supabase } from '../../lib/supabase'

export interface AttendanceRow {
  id: string
  user_id: string
  work_date: string
  check_in_at: string
  check_out_at: string | null
}

/** Today's date in India, as YYYY-MM-DD (attendance days are IST days). */
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export function useMyAttendanceToday() {
  const { me, can } = useAuth()
  return useQuery({
    queryKey: ['attendance-today', me?.user_id],
    enabled: !!me && can('attendance'),
    queryFn: async () =>
      (unwrap(
        await supabase.from('attendance').select('id, user_id, work_date, check_in_at, check_out_at').eq('user_id', me!.user_id).eq('work_date', todayIST()).maybeSingle(),
      ) as AttendanceRow | null) ?? null,
    staleTime: 60_000,
  })
}

const PING_EVERY_MS = 3 * 60_000

/**
 * While the user is checked in (and the app is open), send a location ping every
 * 3 minutes. Phone browsers pause this when the app is in the background — the
 * map then shows "last seen", which is the honest state.
 */
export function useLocationPinger() {
  const today = useMyAttendanceToday()
  const active = !!today.data && !today.data.check_out_at
  useEffect(() => {
    if (!active) return
    let stopped = false
    const ping = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const p = await getPosition(20000)
        await rpc('record_ping', { p_lat: p.lat, p_lng: p.lng, p_accuracy: p.accuracy })
      } catch {
        /* no GPS right now: try again on the next tick */
      }
    }
    const timer = window.setInterval(ping, PING_EVERY_MS)
    const onVisible = () => document.visibilityState === 'visible' && void ping()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}
