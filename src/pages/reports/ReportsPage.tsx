import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Card, Input, Loading, PageHeader, Table, Td, Th } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { rpc } from '../../lib/data'
import { inr, todayStr } from '../../lib/format'

interface SourceRow { source: string; leads: number; visits: number; booked: number; lost: number }
interface TeamRow { user_id: string; full_name: string; role_label: string; leads: number; visits_done: number; bookings: number; revenue: number; days_present: number }
interface MonthRow { month: string; leads: number; bookings: number; revenue: number }

const NAVY = '#0B1F3A'
const GOLD = '#C08A25'
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

export function ReportsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const [from, setFrom] = useState(() => new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10))
  const [to, setTo] = useState(todayStr())
  const args = { p_from: from, p_to: to }
  const sources = useQuery({ queryKey: ['report-sources', from, to], queryFn: () => rpc<SourceRow[]>('report_sources', args) })
  const team = useQuery({ queryKey: ['report-team', from, to], queryFn: () => rpc<TeamRow[]>('report_team', args) })
  const monthly = useQuery({ queryKey: ['report-monthly'], queryFn: () => rpc<MonthRow[]>('report_monthly', { p_months: 6 }) })
  const err = sources.error ?? team.error ?? monthly.error

  async function exportCsv(kind: string, headers: string[], rows: (string | number)[][]) {
    try {
      await rpc('log_export', { p_kind: kind, p_rows: rows.length })
      downloadCsv(`${kind}-${from}-to-${to}.csv`, headers, rows)
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const months = (monthly.data ?? []).map((m) => ({
    name: new Date(m.month).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    Leads: Number(m.leads),
    Bookings: Number(m.bookings),
    revenueLakh: Math.round(Number(m.revenue) / 1e5),
  }))
  const src = (sources.data ?? []).map((s) => ({ ...s, leads: Number(s.leads), visits: Number(s.visits), booked: Number(s.booked), lost: Number(s.lost) }))
  const tot = src.reduce((a, s) => ({ leads: a.leads + s.leads, booked: a.booked + s.booked }), { leads: 0, booked: 0 })

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Figures cover the people and leads your account is allowed to see."
        actions={
          <>
            <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="!w-auto !py-2" aria-label="From date" />
            <span className="text-sm text-ink-faint">to</span>
            <Input type="date" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} className="!w-auto !py-2" aria-label="To date" />
          </>
        }
      />
      {err && <div className="mb-4"><Alert>{(err as Error).message}</Alert></div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-bold text-navy">Sales by month</h2>
          <p className="mb-3 text-xs text-ink-faint">Last 6 months · bars: approved sales value (₹ lakh) · line: bookings</p>
          {monthly.isLoading ? (
            <Loading />
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={months} margin={{ left: -10, right: 0, top: 5 }}>
                  <CartesianGrid stroke="#E7E7EC" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B6B76' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#6B6B76' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B6B76' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v, n) => (n === 'Sales (₹ L)' ? [`₹${v} L`, n] : [v, n])} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="revenueLakh" name="Sales (₹ L)" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={false} />
                  <Line yAxisId="r" dataKey="Bookings" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3.5, fill: GOLD }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-navy">Leads by source</h2>
              <p className="text-xs text-ink-faint">
                {tot.leads} leads · {tot.booked} booked · conversion {pct(tot.booked, tot.leads)}
              </p>
            </div>
            {can('leads.export') && src.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => exportCsv('leads-by-source', ['Source', 'Leads', 'Reached visit', 'Booked', 'Lost'], src.map((s) => [s.source, s.leads, s.visits, s.booked, s.lost]))}>
                <Download className="size-3.5" /> CSV
              </Button>
            )}
          </div>
          {sources.isLoading ? (
            <Loading />
          ) : src.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">No leads in this period.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={src} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid stroke="#E7E7EC" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B6B76' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="source" width={92} tick={{ fontSize: 11, fill: '#1B1B23' }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="leads" name="Leads" fill={NAVY} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
                  <Bar dataKey="booked" name="Booked" fill={GOLD} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-navy">Team performance</h2>
        {can('leads.export') && (team.data ?? []).length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportCsv('team-performance', ['Employee', 'Role', 'Leads', 'Visits done', 'Bookings', 'Sales value', 'Days present'], team.data!.map((t) => [t.full_name, t.role_label, t.leads, t.visits_done, t.bookings, t.revenue, t.days_present]))}
          >
            <Download className="size-3.5" /> CSV
          </Button>
        )}
      </div>
      {team.isLoading ? (
        <Loading />
      ) : (
        <Table
          head={
            <tr>
              <Th>Employee</Th>
              <Th right>Leads</Th>
              <Th right>Visits done</Th>
              <Th right>Bookings</Th>
              <Th right>Conversion</Th>
              <Th right>Sales value</Th>
              <Th right>Days present</Th>
            </tr>
          }
        >
          {(team.data ?? []).map((t) => (
            <tr key={t.user_id}>
              <Td>
                <div className="font-semibold text-ink">{t.full_name}</div>
                <div className="text-xs text-ink-faint">{t.role_label}</div>
              </Td>
              <Td right>{t.leads}</Td>
              <Td right>{t.visits_done}</Td>
              <Td right>{t.bookings}</Td>
              <Td right className="text-ink-dim">{pct(Number(t.bookings), Number(t.leads))}</Td>
              <Td right className="font-semibold text-navy">{inr(t.revenue)}</Td>
              <Td right className="text-ink-dim">{t.days_present}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
