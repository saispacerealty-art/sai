import { useQuery } from '@tanstack/react-query'
import { AlarmClock, BadgeIndianRupee, CalendarCheck, CheckSquare, Handshake, IndianRupee, MapPin, UserRound, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, Badge, Card, Loading, PageHeader, Stat } from '../../components/ui'
import { rpc } from '../../lib/data'
import { fmtDateTime, inr, isOverdue, stageOf, STAGES } from '../../lib/format'

interface Stats {
  leads_total?: number
  leads_new_7d?: number
  leads_open?: number
  followups_today?: number
  followups_overdue?: number
  pipeline?: { stage: string; count: number }[]
  due_leads?: { id: string; name: string; phone_hint: string | null; stage: string; next_follow_up_at: string }[]
  visits_upcoming?: number
  visits_done_30d?: number
  upcoming_visits?: { id: string; lead_name: string; project: string | null; scheduled_at: string; status: string; executive: string }[]
  bookings_30d?: number
  bookings_pending?: number
  revenue_30d?: number
  my_incentive_pending?: number
  my_incentive_paid?: number
  tasks_open: number
  tasks_overdue: number
  checked_in: boolean
}

export function DashboardPage() {
  const { me, can } = useAuth()
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => rpc<Stats>('dashboard_stats'), refetchInterval: 5 * 60_000 })
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const s = stats.data
  const scopeNote = me?.scope === 'all' ? 'the whole company' : me?.scope === 'team' ? 'you and your team' : 'your own work'
  const pipeMax = Math.max(1, ...(s?.pipeline ?? []).map((p) => Number(p.count)))

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me?.full_name.split(' ')[0]}!`}
        sub={`${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })} · showing ${scopeNote}`}
        actions={
          can('attendance') && s && !s.checked_in ? (
            <Link to="/attendance" className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-navy-dark hover:bg-gold-dark hover:text-white">
              <CalendarCheck className="size-4" /> Check in
            </Link>
          ) : undefined
        }
      />
      {stats.isLoading ? (
        <Loading />
      ) : stats.error || !s ? (
        <Alert>{(stats.error as Error)?.message ?? 'Could not load the dashboard.'}</Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            {s.leads_total !== undefined && <Stat icon={UserRound} label="Open leads" value={s.leads_open} sub={`+${s.leads_new_7d} new this week`} />}
            {s.followups_today !== undefined && (
              <Stat icon={AlarmClock} label="Follow-ups today" value={s.followups_today} sub={s.followups_overdue ? `${s.followups_overdue} overdue` : 'none overdue'} tone={s.followups_overdue ? 'bad' : undefined} />
            )}
            {s.visits_upcoming !== undefined && <Stat icon={MapPin} label="Upcoming visits" value={s.visits_upcoming} sub={`${s.visits_done_30d} done in 30 days`} />}
            {s.bookings_30d !== undefined && <Stat icon={Handshake} label="Bookings (30 days)" value={s.bookings_30d} sub={s.bookings_pending ? `${s.bookings_pending} awaiting approval` : 'none pending'} />}
            {s.revenue_30d !== undefined && <Stat icon={IndianRupee} label="Sales (30 days)" value={inr(s.revenue_30d)} />}
            {s.my_incentive_pending !== undefined && me?.scope === 'own' && <Stat icon={BadgeIndianRupee} label="My incentive due" value={inr(s.my_incentive_pending)} sub={`${inr(s.my_incentive_paid)} paid`} />}
            <Stat icon={CheckSquare} label="My open tasks" value={s.tasks_open} sub={s.tasks_overdue ? `${s.tasks_overdue} overdue` : 'on track'} tone={s.tasks_overdue ? 'bad' : undefined} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {s.pipeline && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-navy">Lead pipeline</h2>
                  <Link to="/leads" className="text-xs font-semibold text-gold-dark">
                    Open leads →
                  </Link>
                </div>
                <ul className="flex flex-col gap-2">
                  {STAGES.map((st) => {
                    const n = Number(s.pipeline!.find((p) => p.stage === st.key)?.count ?? 0)
                    return (
                      <li key={st.key} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-[12.5px]">
                        <span className="truncate text-ink-dim">{st.label}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-col">
                          <span className="block h-full rounded-full" style={{ width: `${(n / pipeMax) * 100}%`, background: st.color }} />
                        </span>
                        <span className="text-right font-bold text-navy">{n}</span>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}

            {s.due_leads && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-navy">My follow-ups due</h2>
                  <Link to="/leads?due=1" className="text-xs font-semibold text-gold-dark">
                    View all →
                  </Link>
                </div>
                {s.due_leads.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">Nothing due. Nicely done.</p>
                ) : (
                  <ul className="flex flex-col">
                    {s.due_leads.map((l) => (
                      <li key={l.id}>
                        <Link to={`/leads?open=${l.id}`} className="flex items-center gap-3 border-b border-line py-2 last:border-0 hover:bg-canvas">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-ink">{l.name}</span>
                            <span className={`block text-[11.5px] ${isOverdue(l.next_follow_up_at) ? 'font-semibold text-bad' : 'text-ink-faint'}`}>{fmtDateTime(l.next_follow_up_at)}</span>
                          </span>
                          <Badge tone={stageOf(l.stage).tone}>{stageOf(l.stage).label}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {s.upcoming_visits && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-navy">Upcoming site visits</h2>
                  <Link to="/visits" className="text-xs font-semibold text-gold-dark">
                    View all →
                  </Link>
                </div>
                {s.upcoming_visits.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">No visits scheduled.</p>
                ) : (
                  <ul className="flex flex-col">
                    {s.upcoming_visits.map((v) => (
                      <li key={v.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-tint text-gold-dark">
                          <MapPin className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-ink">{v.lead_name}</span>
                          <span className="block truncate text-[11.5px] text-ink-faint">
                            {fmtDateTime(v.scheduled_at)} · {v.project ?? 'Project TBD'}
                            {me?.scope !== 'own' && ` · ${v.executive}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          {can('tracking') && (
            <Link to="/tracking" className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-panel p-4 hover:border-gold">
              <span className="grid size-10 place-items-center rounded-lg bg-navy text-gold-light">
                <Users className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-bold text-navy">Live team map</span>
                <span className="block text-xs text-ink-dim">See who is checked in and where they are right now</span>
              </span>
            </Link>
          )}
        </>
      )}
    </>
  )
}
