import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Download, LogIn, LogOut, MapPin } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Card, EmptyState, Input, Loading, PageHeader, Table, Td, Th } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { downloadCsv } from '../../lib/csv'
import { rpc, usePeople } from '../../lib/data'
import { fmtDate, fmtTime } from '../../lib/format'
import { getPosition } from '../../lib/geo'
import { supabase } from '../../lib/supabase'
import { todayIST, useMyAttendanceToday, type AttendanceRow } from './data'

const hours = (a: AttendanceRow) => {
  const end = a.check_out_at ? new Date(a.check_out_at).getTime() : a.work_date === todayIST() ? Date.now() : null
  if (!end) return '—'
  const h = (end - new Date(a.check_in_at).getTime()) / 3600e3
  return `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`
}

export function AttendancePage() {
  const { me, can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const today = useMyAttendanceToday()
  const [month, setMonth] = useState(todayIST().slice(0, 7))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const log = useQuery({
    queryKey: ['attendance', month],
    queryFn: async () => {
      const [y, m] = month.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      return unwrap(
        await supabase
          .from('attendance')
          .select('id, user_id, work_date, check_in_at, check_out_at')
          .gte('work_date', `${month}-01`)
          .lte('work_date', `${month}-${String(last).padStart(2, '0')}`)
          .order('work_date', { ascending: false })
          .limit(5000),
      ) as AttendanceRow[]
    },
  })
  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data])
  const showNames = me?.scope !== 'own'
  const rows = log.data ?? []
  const mine = rows.filter((r) => r.user_id === me?.user_id)

  async function punch(kind: 'in' | 'out') {
    setBusy(true)
    setError(null)
    try {
      const p = await getPosition()
      if (kind === 'in') await rpc('check_in', { p_lat: p.lat, p_lng: p.lng, p_accuracy: p.accuracy, p_consent: true })
      else await rpc('check_out', { p_lat: p.lat, p_lng: p.lng })
      for (const k of ['attendance-today', 'attendance', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
      toast(kind === 'in' ? 'Checked in. Have a good day!' : 'Checked out', 'ok')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    try {
      await rpc('log_export', { p_kind: 'attendance', p_rows: rows.length })
      downloadCsv(
        `attendance-${month}.csv`,
        ['Employee', 'Date', 'Check in', 'Check out', 'Hours'],
        rows.map((r) => [personName.get(r.user_id) ?? '', r.work_date, fmtTime(r.check_in_at), r.check_out_at ? fmtTime(r.check_out_at) : '', hours(r)]),
      )
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  const t = today.data
  return (
    <>
      <PageHeader title="Attendance" sub="Check in when you start and check out when you finish. Your location is recorded at both." />
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className={`grid size-12 place-items-center rounded-full ${t && !t.check_out_at ? 'bg-ok-bg text-ok' : 'bg-col text-ink-dim'}`}>
            <MapPin className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-navy">
              {today.isLoading ? 'Checking…' : !t ? 'You have not checked in today' : t.check_out_at ? 'Done for today' : 'You are checked in'}
            </p>
            <p className="text-sm text-ink-dim">
              {t ? `In at ${fmtTime(t.check_in_at)}${t.check_out_at ? ` · out at ${fmtTime(t.check_out_at)}` : ''} · ${hours(t)}` : fmtDate(new Date())}
            </p>
          </div>
          {!today.isLoading && !t && (
            <Button variant="gold" loading={busy} onClick={() => punch('in')}>
              <LogIn className="size-4" /> Check in
            </Button>
          )}
          {t && !t.check_out_at && (
            <Button variant="primary" loading={busy} onClick={() => punch('out')}>
              <LogOut className="size-4" /> Check out
            </Button>
          )}
        </div>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        {!t && (
          <p className="mt-3 text-xs text-ink-faint">
            By checking in you agree that your location is recorded now and every few minutes while you stay checked in and the CRM is open. It is stored encrypted, visible only to
            your manager and Admin, and deleted after 90 days. Tracking stops when you check out.
          </p>
        )}
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-navy">{showNames ? 'Team log' : 'My log'}</h2>
        <Input type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="!w-auto !py-1.5" aria-label="Month" />
        <Badge tone="gold">{mine.length} days present (me)</Badge>
        {can('leads.export') && rows.length > 0 && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
            <Download className="size-3.5" /> Export
          </Button>
        )}
      </div>
      {log.isLoading ? (
        <Loading />
      ) : log.error ? (
        <Alert>{(log.error as Error).message}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No attendance in this month" />
      ) : (
        <Table
          minWidth={560}
          head={
            <tr>
              {showNames && <Th>Employee</Th>}
              <Th>Date</Th>
              <Th>Check in</Th>
              <Th>Check out</Th>
              <Th right>Hours</Th>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.id}>
              {showNames && <Td className="font-semibold text-ink">{personName.get(r.user_id) ?? '—'}</Td>}
              <Td className="text-ink-dim">{fmtDate(r.work_date + 'T12:00:00+05:30')}</Td>
              <Td className="text-ink-dim">{fmtTime(r.check_in_at)}</Td>
              <Td className="text-ink-dim">{r.check_out_at ? fmtTime(r.check_out_at) : <Badge tone={r.work_date === todayIST() ? 'ok' : 'warn'}>{r.work_date === todayIST() ? 'Working' : 'No check-out'}</Badge>}</Td>
              <Td right className="font-semibold text-navy">{hours(r)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
