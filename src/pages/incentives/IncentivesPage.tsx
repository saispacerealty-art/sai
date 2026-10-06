import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeIndianRupee, Gift, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Card, EmptyState, Input, Loading, PageHeader, Select, Stat, Table, Tabs, Td, Th } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { rpc, usePeople, useProjects } from '../../lib/data'
import { fmtDate, inr } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useRolePresets } from '../employees/data'

interface Incentive {
  id: string
  user_id: string
  user_name: string
  lead_name: string
  project: string
  unit_no: string
  agreement_value: number
  amount: number
  rule: string | null
  status: 'pending' | 'approved' | 'paid' | 'cancelled'
  created_at: string
  paid_at: string | null
}
interface Rule {
  id: string
  applies_to: 'role' | 'user' | 'project'
  target: string
  calc: 'percent' | 'fixed'
  value: number
  active: boolean
}
const TONE = { pending: 'warn', approved: 'gold', paid: 'ok', cancelled: 'neutral' } as const

export function IncentivesPage() {
  const { can, me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'payouts' | 'rules'>('payouts')
  const list = useQuery({ queryKey: ['incentives'], queryFn: () => rpc<Incentive[]>('list_incentives') })
  const rows = (list.data ?? []).filter((i) => i.status !== 'cancelled')
  const sum = (s: Incentive['status'][]) => rows.filter((i) => s.includes(i.status)).reduce((a, i) => a + Number(i.amount), 0)
  const showWho = rows.some((i) => i.user_id !== me?.user_id)

  async function setStatus(i: Incentive, status: 'approved' | 'paid' | 'cancelled') {
    try {
      await rpc('set_incentive_status', { p_incentive: i.id, p_status: status })
      void qc.invalidateQueries({ queryKey: ['incentives'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <>
      <PageHeader title="Incentives" sub="Commission earned on approved bookings." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat icon={BadgeIndianRupee} label="Awaiting approval" value={inr(sum(['pending']))} />
        <Stat icon={BadgeIndianRupee} label="Approved, to be paid" value={inr(sum(['approved']))} />
        <Stat icon={BadgeIndianRupee} label="Paid" value={inr(sum(['paid']))} />
      </div>
      {can('settings') && (
        <div className="mb-4">
          <Tabs tabs={[{ key: 'payouts', label: 'Payouts' }, { key: 'rules', label: 'Commission rules' }]} value={tab} onChange={setTab} />
        </div>
      )}
      {tab === 'rules' ? (
        <Rules />
      ) : list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <Alert>{(list.error as Error).message}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState icon={Gift} title="No incentives yet" hint="An incentive is created automatically when a booking is approved." />
      ) : (
        <Table
          minWidth={820}
          head={
            <tr>
              {showWho && <Th>Employee</Th>}
              <Th>Booking</Th>
              <Th right>Deal value</Th>
              <Th>Rule</Th>
              <Th right>Incentive</Th>
              <Th>Status</Th>
              {can('incentives.approve') && <Th right>Actions</Th>}
            </tr>
          }
        >
          {rows.map((i) => (
            <tr key={i.id}>
              {showWho && <Td className="font-semibold text-ink">{i.user_name}</Td>}
              <Td>
                <div className="text-ink">{i.lead_name}</div>
                <div className="text-xs text-ink-faint">
                  {i.project} · {i.unit_no} · {fmtDate(i.created_at)}
                </div>
              </Td>
              <Td right className="text-ink-dim">{inr(i.agreement_value)}</Td>
              <Td className="text-ink-dim">{i.rule ?? '—'}</Td>
              <Td right className="font-bold text-navy">{inr(i.amount, { exact: true })}</Td>
              <Td>
                <Badge tone={TONE[i.status]}>{i.status}</Badge>
                {i.paid_at && <div className="mt-0.5 text-[11px] text-ink-faint">{fmtDate(i.paid_at)}</div>}
              </Td>
              {can('incentives.approve') && (
                <Td right>
                  {i.user_id !== me?.user_id && (
                    <div className="flex justify-end gap-1.5">
                      {i.status === 'pending' && <Button size="sm" variant="gold" onClick={() => setStatus(i, 'approved')}>Approve</Button>}
                      {i.status === 'approved' && <Button size="sm" variant="gold" onClick={() => setStatus(i, 'paid')}>Mark paid</Button>}
                      {i.status !== 'paid' && <Button size="sm" variant="ghost" className="text-bad" onClick={() => window.confirm('Cancel this incentive?') && setStatus(i, 'cancelled')}>Cancel</Button>}
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

function Rules() {
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const projects = useProjects()
  const presets = useRolePresets()
  const rules = useQuery({
    queryKey: ['incentive-rules'],
    queryFn: async () => unwrap(await supabase.from('incentive_rules').select('id, applies_to, target, calc, value, active').order('created_at')) as Rule[],
  })
  const [f, setF] = useState({ applies_to: 'role' as Rule['applies_to'], target: 'sales', calc: 'percent' as Rule['calc'], value: '2' })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['incentive-rules'] })

  const targets = useMemo(() => {
    if (f.applies_to === 'role') return (presets.data ?? []).filter((p) => p.role !== 'owner').map((p) => [p.role, p.label] as const)
    if (f.applies_to === 'user') return (people.data ?? []).filter((p) => p.is_active).map((p) => [p.id, p.full_name] as const)
    return (projects.data ?? []).map((p) => [p.id, p.name] as const)
  }, [f.applies_to, presets.data, people.data, projects.data])
  const label = (r: Rule) =>
    r.applies_to === 'role' ? (presets.data?.find((p) => p.role === r.target)?.label ?? r.target)
      : r.applies_to === 'user' ? (people.data?.find((p) => p.id === r.target)?.full_name ?? 'Employee')
        : (projects.data?.find((p) => p.id === r.target)?.name ?? 'Project')

  async function add() {
    const v = Number(f.value)
    if (!f.target || !Number.isFinite(v) || v < 0 || (f.calc === 'percent' && v > 100)) return toast('Enter a valid value', 'bad')
    try {
      unwrap(await supabase.from('incentive_rules').insert({ applies_to: f.applies_to, target: f.target, calc: f.calc, value: v, active: true }).select('id'))
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const mutate = async (fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    try {
      unwrap(await fn())
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <Card>
      <p className="text-sm text-ink-dim">
        When a booking is approved, the closer earns the <b className="text-ink">most specific</b> active rule: a rule for that person beats a rule for the project, which beats a rule for their role.
      </p>
      {rules.isLoading ? (
        <Loading />
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {(rules.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <Badge tone={r.applies_to === 'user' ? 'navy' : r.applies_to === 'project' ? 'gold' : 'neutral'}>{r.applies_to}</Badge>
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{label(r)}</span>
              <span className="text-sm font-bold text-navy">{r.calc === 'percent' ? `${Number(r.value)}% of deal value` : `${inr(r.value, { exact: true })} per booking`}</span>
              <Button size="sm" variant={r.active ? 'outline' : 'ghost'} onClick={() => mutate(() => supabase.from('incentive_rules').update({ active: !r.active }).eq('id', r.id).select('id'))}>
                {r.active ? 'Active' : 'Off'}
              </Button>
              <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-col hover:text-bad" aria-label="Delete rule" onClick={() => window.confirm('Delete this rule?') && mutate(() => supabase.from('incentive_rules').delete().eq('id', r.id).select('id'))}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-2 rounded-xl bg-canvas p-3 sm:grid-cols-[auto_1fr_auto_auto_auto]">
        <Select value={f.applies_to} aria-label="Applies to" onChange={(e) => setF({ ...f, applies_to: e.target.value as Rule['applies_to'], target: '' })}>
          <option value="role">Role</option>
          <option value="user">Person</option>
          <option value="project">Project</option>
        </Select>
        <Select value={f.target} aria-label="Target" onChange={(e) => setF({ ...f, target: e.target.value })}>
          <option value="">— Choose —</option>
          {targets.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={f.calc} aria-label="Type" onChange={(e) => setF({ ...f, calc: e.target.value as Rule['calc'] })}>
          <option value="percent">% of deal</option>
          <option value="fixed">Fixed ₹</option>
        </Select>
        <Input value={f.value} aria-label="Value" onChange={(e) => setF({ ...f, value: e.target.value })} className="sm:!w-28" inputMode="decimal" />
        <Button onClick={add}>
          <Plus className="size-4" /> Add rule
        </Button>
      </div>
    </Card>
  )
}
