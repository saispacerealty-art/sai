import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useToast } from '../components/Toast'
import { unwrap } from '../lib/api'
import { timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Notification {
  id: number
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export function NotificationBell() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { me } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('notifications')
          .select('id, title, body, link, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(30),
      ) as Notification[],
    refetchInterval: 5 * 60_000, // safety net; new ones arrive instantly over realtime (below)
  })
  const unread = data.filter((n) => !n.read_at).length

  const markAll = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // live push: the database only sends a user their own rows (RLS applies to realtime too)
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel(`notifications-${me.user_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.user_id}` }, (payload) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] })
        const title = (payload.new as { title?: string }).title
        if (title) toast(title, 'info')
      })
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [me, qc, toast])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-full border border-line text-ink-dim hover:bg-col"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-panel bg-bad px-1 text-[9.5px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" className="text-xs font-semibold text-gold-dark" onClick={() => markAll.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-faint">No notifications yet</p>
            ) : (
              data.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => {
                    setOpen(false)
                    if (n.link) navigate(n.link)
                  }}
                  className={`flex w-full gap-2.5 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-col ${n.read_at ? '' : 'bg-gold-tint/40'}`}
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-gold'}`} />
                  <span>
                    <span className="block text-[13px] font-semibold text-ink">{n.title}</span>
                    {n.body && <span className="block text-xs text-ink-dim">{n.body}</span>}
                    <span className="block text-[11px] text-ink-faint">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
