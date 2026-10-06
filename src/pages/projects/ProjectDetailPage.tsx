import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Grid3x3, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { cx } from '../../lib/cx'
import { rpc, usePeople, useProjects } from '../../lib/data'
import { fmtDateTime, inr, parseMoney } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { BookingForm } from '../bookings/BookingForm'
import { useLeads } from '../leads/data'

interface Tower { id: string; name: string; floors: number | null }
interface Unit {
  id: string; tower_id: string; unit_no: string; floor: number | null; config: string | null; carpet_sqft: number | null
  price: number | null; status: 'available' | 'hold' | 'booked' | 'blocked'; hold_until: string | null; hold_by: string | null
}
const CELL = {
  available: 'border-ok/40 bg-ok-bg text-ok hover:border-ok',
  hold: 'border-warn/40 bg-warn-bg text-warn hover:border-warn',
  booked: 'border-navy bg-navy text-gold-light',
  blocked: 'border-line bg-col text-ink-faint',
} as const
const LABEL = { available: 'Available', hold: 'On hold', booked: 'Booked', blocked: 'Blocked' } as const

export function ProjectDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const project = useProjects().data?.find((p) => p.id === id)
  const canEdit = can('projects.edit') && !can('read_only')
  const [tower, setTower] = useState<string>('')
  const [picked, setPicked] = useState<Unit | null>(null)
  const [generating, setGenerating] = useState(false)

  const towers = useQuery({
    queryKey: ['towers', id],
    queryFn: async () => unwrap(await supabase.from('towers').select('id, name, floors').eq('project_id', id!).order('name')) as Tower[],
  })
  const units = useQuery({
    queryKey: ['units', id],
    queryFn: async () =>
      unwrap(
        await supabase.from('units').select('id, tower_id, unit_no, floor, config, carpet_sqft, price, status, hold_until, hold_by').eq('project_id', id!).limit(5000),
      ) as Unit[],
  })
  const activeTower = tower || towers.data?.[0]?.id || ''
  const floors = useMemo(() => {
    const m = new Map<number, Unit[]>()
    for (const u of (units.data ?? []).filter((x) => x.tower_id === activeTower)) {
      const f = u.floor ?? 0
      m.set(f, [...(m.get(f) ?? []), u])
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([f, us]) => [f, us.sort((a, b) => a.unit_no.localeCompare(b.unit_no, 'en', { numeric: true }))] as const)
  }, [units.data, activeTower])
  const count = (s: Unit['status']) => (units.data ?? []).filter((u) => u.tower_id === activeTower && u.status === s).length

  async function addTower() {
    const name = window.prompt('Tower name (e.g. Tower A)')?.trim()
    if (!name) return
    try {
      const t = unwrap(await supabase.from('towers').insert({ project_id: id, name }).select('id').single()) as { id: string }
      await qc.invalidateQueries({ queryKey: ['towers', id] })
      setTower(t.id)
    } catch (e) {
      toast(/duplicate key/.test((e as Error).message) ? 'That tower already exists' : (e as Error).message, 'bad')
    }
  }

  if (towers.isLoading || units.isLoading) return <Loading />
  return (
    <>
      <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-gold-dark">
        <ArrowLeft className="size-4" /> All projects
      </Link>
      <PageHeader
        title={project?.name ?? 'Project'}
        sub={[project?.location, project?.config, project?.rera_no && `RERA ${project.rera_no}`].filter(Boolean).join(' · ')}
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={addTower}>
                <Plus className="size-4" /> Tower
              </Button>
              {activeTower && (
                <Button variant="gold" onClick={() => setGenerating(true)}>
                  <Grid3x3 className="size-4" /> Add units
                </Button>
              )}
            </>
          )
        }
      />
      {(towers.data ?? []).length === 0 ? (
        <EmptyState icon={Grid3x3} title="No towers yet" hint={canEdit ? 'Add a tower, then generate its units.' : 'Units have not been added to this project yet.'} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Tabs tabs={towers.data!.map((t) => ({ key: t.id, label: t.name }))} value={activeTower} onChange={setTower} />
            <div className="ml-auto flex flex-wrap gap-3 text-xs text-ink-dim">
              {(['available', 'hold', 'booked', 'blocked'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={cx('size-3 rounded border', CELL[s])} /> {LABEL[s]} <b className="text-ink">{count(s)}</b>
                </span>
              ))}
            </div>
          </div>
          {floors.length === 0 ? (
            <EmptyState icon={Grid3x3} title="No units in this tower" hint={canEdit ? 'Use “Add units” to create a floor range in one go.' : undefined} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-panel p-3">
              {floors.map(([f, us]) => (
                <div key={f} className="flex items-center gap-2 border-b border-line py-1.5 last:border-0">
                  <span className="w-14 shrink-0 text-[11px] font-semibold text-ink-faint">Floor {f}</span>
                  <div className="flex gap-1.5">
                    {us.map((u) => (
                      <button
                        type="button"
                        key={u.id}
                        onClick={() => setPicked(u)}
                        title={`${u.unit_no} · ${LABEL[u.status]}${u.price ? ' · ' + inr(u.price) : ''}`}
                        className={cx('h-10 w-16 shrink-0 rounded-lg border text-xs font-bold transition', CELL[u.status])}
                      >
                        {u.unit_no}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {picked && <UnitModal unit={picked} projectId={id!} canEdit={canEdit} onClose={() => setPicked(null)} />}
      {generating && <GenerateModal towerId={activeTower} projectId={id!} onClose={() => setGenerating(false)} />}
    </>
  )
}

function UnitModal({ unit, projectId, canEdit, onClose }: { unit: Unit; projectId: string; canEdit: boolean; onClose: () => void }) {
  const { can, me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const leads = useLeads()
  const [leadId, setLeadId] = useState('')
  const [booking, setBooking] = useState(false)
  const [price, setPrice] = useState(unit.price ? String(unit.price) : '')
  const canBook = can('bookings') && !can('read_only')
  const mine = unit.hold_by === me?.user_id
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['units'] })
    onClose()
  }
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'ok')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const openLeads = (leads.data ?? []).filter((l) => !['booked', 'lost'].includes(l.stage))
  const lead = openLeads.find((l) => l.id === leadId)
  if (booking && lead) return <BookingForm lead={{ ...lead, project_id: projectId }} unitId={unit.id} onClose={refresh} />

  return (
    <Modal open title={`Unit ${unit.unit_no}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-dim">
          <Badge tone={unit.status === 'available' ? 'ok' : unit.status === 'hold' ? 'warn' : unit.status === 'booked' ? 'navy' : 'neutral'}>{LABEL[unit.status]}</Badge>
          Floor {unit.floor ?? '—'} · {unit.config ?? '—'} · {unit.carpet_sqft ? `${unit.carpet_sqft} sq ft` : '—'} · <b className="text-gold-dark">{inr(unit.price)}</b>
        </div>
        {unit.status === 'hold' && (
          <p className="text-sm text-warn">
            Held by {people.data?.find((p) => p.id === unit.hold_by)?.full_name ?? 'someone'}
            {unit.hold_until ? ` until ${fmtDateTime(unit.hold_until)}` : ' (booking awaiting approval)'}
          </p>
        )}
        {canBook && (unit.status === 'available' || (unit.status === 'hold' && mine && unit.hold_until)) && (
          <div className="rounded-xl border border-line bg-canvas p-3">
            <Field label="Book this unit for a lead">
              {(id) => (
                <Select id={id} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                  <option value="">— Choose a lead —</option>
                  {openLeads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.phone_hint})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="gold" disabled={!leadId} onClick={() => setBooking(true)}>
                Book
              </Button>
              {unit.status === 'available' && (
                <Button variant="outline" onClick={() => act(() => rpc('hold_unit', { p_unit: unit.id }), 'Unit put on hold')}>
                  Hold for a customer
                </Button>
              )}
            </div>
          </div>
        )}
        {unit.status === 'hold' && unit.hold_until && (mine || can('bookings.approve') || canEdit) && (
          <Button variant="outline" onClick={() => act(() => rpc('release_unit', { p_unit: unit.id }), 'Hold released')}>
            Release hold
          </Button>
        )}
        {canEdit && unit.status !== 'booked' && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <Field label="List price" className="flex-1">{(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
            <Button
              variant="outline"
              onClick={() => {
                const n = parseMoney(price)
                if (Number.isNaN(n)) return toast('Enter a valid price', 'bad')
                void act(async () => unwrap(await supabase.from('units').update({ price: n }).eq('id', unit.id).select('id')), 'Price updated')
              }}
            >
              Save price
            </Button>
            {(unit.status === 'available' || unit.status === 'blocked') && (
              <Button
                variant="ghost"
                onClick={() => act(async () => unwrap(await supabase.from('units').update({ status: unit.status === 'blocked' ? 'available' : 'blocked' }).eq('id', unit.id).select('id')), 'Updated')}
              >
                {unit.status === 'blocked' ? 'Unblock' : 'Block (not for sale)'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function GenerateModal({ towerId, projectId, onClose }: { towerId: string; projectId: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ from: '1', to: '10', per: '4', config: '2 BHK', carpet: '', price: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const total = Math.max(0, Number(f.to) - Number(f.from) + 1) * Number(f.per) || 0

  async function run() {
    setError(null)
    const price = parseMoney(f.price)
    if (Number.isNaN(price)) return setError('Enter a valid price, e.g. 85L.')
    setBusy(true)
    try {
      const n = await rpc<number>('generate_units', {
        p_tower: towerId, p_floor_from: Number(f.from), p_floor_to: Number(f.to), p_per_floor: Number(f.per),
        p_config: f.config, p_carpet: f.carpet ? Number(f.carpet) : null, p_price: price,
      })
      void qc.invalidateQueries({ queryKey: ['units'] })
      void qc.invalidateQueries({ queryKey: ['units', projectId] })
      toast(`${n} units added`, 'ok')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Add units" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-dim">Creates units numbered floor + position (e.g. 1204 = floor 12, flat 4). Existing unit numbers are skipped.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From floor">{(id) => <Input id={id} type="number" min={0} max={200} value={f.from} onChange={set('from')} />}</Field>
          <Field label="To floor">{(id) => <Input id={id} type="number" min={0} max={200} value={f.to} onChange={set('to')} />}</Field>
          <Field label="Units per floor">{(id) => <Input id={id} type="number" min={1} max={50} value={f.per} onChange={set('per')} />}</Field>
          <Field label="Configuration">{(id) => <Input id={id} value={f.config} onChange={set('config')} maxLength={30} />}</Field>
          <Field label="Carpet (sq ft)">{(id) => <Input id={id} type="number" min={1} value={f.carpet} onChange={set('carpet')} />}</Field>
          <Field label="List price">{(id) => <Input id={id} value={f.price} onChange={set('price')} placeholder="85L" />}</Field>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} onClick={run}>
            Create {total} units
          </Button>
        </div>
      </div>
    </Modal>
  )
}
