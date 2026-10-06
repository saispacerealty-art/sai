import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Download, Plus, Search, Upload, UserRound } from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, EmptyState, Field, Loading, Modal, PageHeader, Select, Table, Tabs, Td, Th } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { cx } from '../../lib/cx'
import { rpc, useCompany, usePeople, useProjects } from '../../lib/data'
import { budgetRange, fmtDateTime, isOverdue, STAGES, stageOf, timeAgo, todayStr, type StageKey } from '../../lib/format'
import { initials } from '../../lib/perms'
import { useLeads, useUpdateLead, type Lead } from './data'
import { ImportModal } from './ImportModal'
import { LeadDrawer } from './LeadDrawer'
import { LeadForm } from './LeadForm'

const scoreTone = (s: number) => (s >= 60 ? 'ok' : s >= 35 ? 'warn' : 'bad')

export function LeadsPage() {
  const { can, me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const leads = useLeads()
  const people = usePeople()
  const projects = useProjects()
  const company = useCompany()
  const update = useUpdateLead()

  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [q, setQ] = useState(params.get('q') ?? '')
  const urlQ = params.get('q')
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ)
  if (urlQ !== seenUrlQ) {
    // a new search arrived from the top bar while this page was already open
    setSeenUrlQ(urlQ)
    if (urlQ) setQ(urlQ)
  }
  const [owner, setOwner] = useState('')
  const [source, setSource] = useState('')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [losing, setLosing] = useState<Lead | null>(null)
  const [exporting, setExporting] = useState(false)
  const dueOnly = params.get('due') === '1'
  const openId = params.get('open')

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data])
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const endOfToday = new Date(todayStr() + 'T23:59:59').getTime()
    return (leads.data ?? []).filter(
      (l) =>
        (!needle || l.name.toLowerCase().includes(needle) || (projectName.get(l.project_id ?? '') ?? '').toLowerCase().includes(needle)) &&
        (!owner || l.owner_id === owner) &&
        (!source || l.source === source) &&
        (!dueOnly || (!['booked', 'lost'].includes(l.stage) && !!l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() <= endOfToday)),
    )
  }, [leads.data, q, owner, source, dueOnly, projectName])

  // 10 digits typed into search → exact phone lookup (phones are encrypted, so no partial match)
  const digits = q.replace(/\D/g, '')
  async function phoneSearch() {
    try {
      const id = await rpc<string | null>('find_lead_by_phone', { p_phone: digits })
      if (id) setParam('open', id)
      else toast('No lead you can see has that number', 'info')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  function moveStage(lead: Lead, stage: StageKey) {
    if (lead.stage === stage) return
    if (stage === 'booked') return toast('Use “Book a unit” on the lead to mark it booked', 'info')
    if (stage === 'lost') return setLosing(lead)
    update.mutate({ id: lead.id, patch: { stage } }, { onError: (e) => toast((e as Error).message, 'bad') })
  }

  async function exportCsv() {
    setExporting(true)
    try {
      type Row = { name: string; phone: string; email: string | null; source: string; project: string | null; stage: string; budget_min: number | null; budget_max: number | null; owner: string | null; next_follow_up_at: string | null; created_at: string }
      const rows = await rpc<Row[]>('export_leads')
      downloadCsv(
        `leads-${todayStr()}.csv`,
        ['Name', 'Phone', 'Email', 'Source', 'Project', 'Stage', 'Budget min', 'Budget max', 'Owner', 'Next follow-up', 'Created'],
        rows.map((r) => [r.name, r.phone, r.email, r.source, r.project, stageOf(r.stage).label, r.budget_min, r.budget_max, r.owner, r.next_follow_up_at, r.created_at]),
      )
      toast(`Exported ${rows.length} leads (this export was logged)`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setExporting(false)
    }
  }

  const sources = company.data?.lead_sources ?? []
  const owners = (people.data ?? []).filter((p) => p.is_active)

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Track and progress every prospect through your pipeline"
        actions={
          <>
            {can('leads.export') && (
              <Button variant="outline" loading={exporting} onClick={exportCsv}>
                <Download className="size-4" /> Export
              </Button>
            )}
            {can('leads.import') && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload className="size-4" /> Import
              </Button>
            )}
            {!can('read_only') && (
              <Button variant="gold" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add lead
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-52 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault()
            if (digits.length === 10) void phoneSearch()
          }}
        >
          <Search className="size-4 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, project or full mobile no."
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
            aria-label="Search leads"
          />
        </form>
        {digits.length === 10 && (
          <Button size="sm" variant="outline" onClick={phoneSearch}>
            Find {digits}
          </Button>
        )}
        {me?.scope !== 'own' && (
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="!w-auto !py-2" aria-label="Owner">
            <option value="">All owners</option>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        )}
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="!w-auto !py-2" aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setParam('due', dueOnly ? null : '1')}
          aria-pressed={dueOnly}
          className={cx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold', dueOnly ? 'border-gold bg-gold-tint text-gold-dark' : 'border-line bg-panel text-ink-dim')}
        >
          <CalendarClock className="size-4" /> Due today
        </button>
        <div className="ml-auto">
          <Tabs tabs={[{ key: 'kanban', label: 'Kanban' }, { key: 'list', label: 'List' }]} value={view} onChange={setView} />
        </div>
      </div>

      {leads.isLoading ? (
        <Loading />
      ) : leads.error ? (
        <Alert>{(leads.error as Error).message}</Alert>
      ) : (leads.data ?? []).length === 0 ? (
        <EmptyState icon={UserRound} title="No leads yet" hint="Add your first lead, or import a list from Excel or CSV." />
      ) : view === 'kanban' ? (
        <Kanban leads={filtered} onOpen={(id) => setParam('open', id)} onMove={moveStage} personName={personName} canDrag={!can('read_only')} />
      ) : (
        <Table
          minWidth={900}
          head={
            <tr>
              <Th>Lead</Th>
              <Th>Project</Th>
              <Th>Budget</Th>
              <Th>Source</Th>
              <Th>Stage</Th>
              <Th>Owner</Th>
              <Th>Follow-up</Th>
              <Th right>Score</Th>
            </tr>
          }
        >
          {filtered.map((l) => (
            <tr key={l.id} className="cursor-pointer hover:bg-canvas" onClick={() => setParam('open', l.id)}>
              <Td>
                <div className="font-semibold text-ink">{l.name}</div>
                <div className="text-xs text-ink-faint">{l.phone_hint}</div>
              </Td>
              <Td className="text-ink-dim">{projectName.get(l.project_id ?? '') ?? '—'}</Td>
              <Td className="text-gold-dark">{budgetRange(l.budget_min, l.budget_max)}</Td>
              <Td className="text-ink-dim">{l.source}</Td>
              <Td>
                <Badge tone={stageOf(l.stage).tone}>{stageOf(l.stage).label}</Badge>
              </Td>
              <Td className="text-ink-dim">{personName.get(l.owner_id ?? '') ?? 'Unassigned'}</Td>
              <Td className={isOverdue(l.next_follow_up_at) && !['booked', 'lost'].includes(l.stage) ? 'font-semibold text-bad' : 'text-ink-dim'}>
                {fmtDateTime(l.next_follow_up_at)}
              </Td>
              <Td right>
                <Badge tone={scoreTone(l.score)}>{l.score}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {filtered.length === 0 && (leads.data ?? []).length > 0 && <p className="mt-6 text-center text-sm text-ink-faint">No leads match these filters.</p>}

      {adding && <LeadForm onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setParam('open', id) }} />}
      {importing && <ImportModal onClose={() => { setImporting(false); void qc.invalidateQueries({ queryKey: ['leads'] }) }} />}
      {openId && <LeadDrawer leadId={openId} onClose={() => setParam('open', null)} onLost={(l) => setLosing(l)} />}
      {losing && <LostModal lead={losing} reasons={company.data?.lost_reasons ?? ['Other']} onClose={() => setLosing(null)} />}
    </>
  )
}

function Kanban({ leads, onOpen, onMove, personName, canDrag }: {
  leads: Lead[]
  onOpen: (id: string) => void
  onMove: (lead: Lead, stage: StageKey) => void
  personName: Map<string, string>
  canDrag: boolean
}) {
  const [over, setOver] = useState<StageKey | null>(null)
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads])
  const drop = (e: DragEvent, stage: StageKey) => {
    e.preventDefault()
    setOver(null)
    const lead = byId.get(e.dataTransfer.getData('text/plain'))
    if (lead) onMove(lead, stage)
  }
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {STAGES.map((s) => {
        const col = leads.filter((l) => l.stage === s.key)
        return (
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drop target for dragged cards; stage can also be changed from the lead's Stage menu
          <section
            key={s.key}
            aria-label={s.label}
            onDragOver={(e) => { e.preventDefault(); setOver(s.key) }}
            onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
            onDrop={(e) => drop(e, s.key)}
            className={cx('flex w-64 shrink-0 flex-col rounded-xl bg-col p-2.5', over === s.key && 'outline-2 -outline-offset-2 outline-gold outline-dashed')}
          >
            <header className="flex items-center justify-between px-1.5 pb-2.5">
              <span className="flex items-center gap-2 text-[11.5px] font-bold tracking-wide text-ink-dim uppercase">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="rounded-full border border-line bg-panel px-2 text-[11px] font-semibold text-ink-dim">{col.length}</span>
            </header>
            <div className="flex min-h-10 flex-col gap-2">
              {col.slice(0, 60).map((l) => {
                const overdue = isOverdue(l.next_follow_up_at) && !['booked', 'lost'].includes(l.stage)
                return (
                  <button
                    type="button"
                    key={l.id}
                    draggable={canDrag}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}
                    onClick={() => onOpen(l.id)}
                    className="rounded-lg border border-line bg-panel p-3 text-left transition hover:border-gold/60 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-ink">{l.name}</span>
                      <Badge tone={scoreTone(l.score)}>{l.score}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-dim">{l.phone_hint}</div>
                    <div className="mt-1 text-xs font-semibold text-gold-dark">{budgetRange(l.budget_min, l.budget_max)}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className={overdue ? 'font-semibold text-bad' : 'text-ink-faint'}>
                        {l.next_follow_up_at ? (overdue ? 'Overdue · ' : '') + fmtDateTime(l.next_follow_up_at) : timeAgo(l.last_activity_at)}
                      </span>
                      {l.owner_id && (
                        <span className="grid size-5 place-items-center rounded-full bg-[#F3E3C0] text-[9px] font-bold text-navy" title={personName.get(l.owner_id)}>
                          {initials(personName.get(l.owner_id) ?? '?')}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
              {col.length > 60 && <p className="px-1 text-center text-[11px] text-ink-faint">+{col.length - 60} more — use List view or filters</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function LostModal({ lead, reasons, onClose }: { lead: Lead; reasons: string[]; onClose: () => void }) {
  const update = useUpdateLead()
  const toast = useToast()
  const [reason, setReason] = useState(reasons[0] ?? 'Other')
  return (
    <Modal open title="Mark lead as lost" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-dim">
          Why was <b className="text-ink">{lead.name}</b> lost? This helps the reports show where leads drop off.
        </p>
        <Field label="Reason">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: lead.id, patch: { stage: 'lost', lost_reason: reason } },
                { onSuccess: onClose, onError: (e) => toast((e as Error).message, 'bad') },
              )
            }
          >
            Mark lost
          </Button>
        </div>
      </div>
    </Modal>
  )
}
