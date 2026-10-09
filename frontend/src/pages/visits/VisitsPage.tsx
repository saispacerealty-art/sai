import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, MapPinCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, EmptyState, Field, Loading, Modal, PageHeader, Table, Tabs, Td, Textarea, Th } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { rpc, usePeople } from '../../lib/data'
import { fmtDateTime } from '../../lib/format'
import { getPosition } from '../../lib/geo'
import { supabase } from '../../lib/supabase'

interface Visit {
  id: string
  lead_id: string
  scheduled_at: string
  executive_id: string
  status: 'scheduled' | 'confirmed' | 'done' | 'no_show' | 'cancelled'
  feedback: string | null
  done_at: string | null
  leads: { name: string; phone_hint: string | null } | null
  projects: { name: string } | null
}
const TONE = { scheduled: 'gold', confirmed: 'navy', done: 'ok', no_show: 'bad', cancelled: 'neutral' } as const
const LABEL = { scheduled: 'Scheduled', confirmed: 'Confirmed', done: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' } as const

export function VisitsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [closing, setClosing] = useState<Visit | null>(null)
  const [now] = useState(() => Date.now())
  const canWrite = can('visits') && !can('read_only')

  const visits = useQuery({
    queryKey: ['visits'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('site_visits')
          .select('id, lead_id, scheduled_at, executive_id, status, feedback, done_at, leads(name, phone_hint), projects(name)')
          .order('scheduled_at', { ascending: false })
          .limit(500),
      ) as unknown as Visit[],
  })
  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data])
  const open = (v: Visit) => v.status === 'scheduled' || v.status === 'confirmed'
  const list = (visits.data ?? []).filter((v) => (tab === 'upcoming' ? open(v) : !open(v)))
  if (tab === 'upcoming') list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

  async function setStatus(v: Visit, status: Visit['status']) {
    try {
      unwrap(await supabase.from('site_visits').update({ status }).eq('id', v.id).select('id'))
      void qc.invalidateQueries({ queryKey: ['visits'] })
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <>
      <PageHeader title="Site Visits" sub="Schedule visits from a lead, then mark them done on site." />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'upcoming', label: 'Upcoming', count: (visits.data ?? []).filter(open).length },
            { key: 'past', label: 'Completed & closed' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {visits.isLoading ? (
        <Loading />
      ) : visits.error ? (
        <Alert>{(visits.error as Error).message}</Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={MapPin} title={tab === 'upcoming' ? 'No upcoming visits' : 'Nothing here yet'} hint="Open a lead and choose “Schedule visit”." action={<Link to="/leads" className="text-sm font-semibold text-gold-dark">Go to Leads</Link>} />
      ) : (
        <Table
          head={
            <tr>
              <Th>Customer</Th>
              <Th>Project</Th>
              <Th>When</Th>
              <Th>Executive</Th>
              <Th>Status</Th>
              <Th right>{tab === 'upcoming' ? 'Actions' : 'Feedback'}</Th>
            </tr>
          }
        >
          {list.map((v) => {
            const late = open(v) && new Date(v.scheduled_at).getTime() < now - 3600e3
            return (
              <tr key={v.id}>
                <Td>
                  <Link to={`/leads?open=${v.lead_id}`} className="font-semibold text-ink hover:text-gold-dark">
                    {v.leads?.name ?? 'Lead'}
                  </Link>
                  <div className="text-xs text-ink-faint">{v.leads?.phone_hint}</div>
                </Td>
                <Td className="text-ink-dim">{v.projects?.name ?? '—'}</Td>
                <Td className={late ? 'font-semibold text-bad' : 'text-ink-dim'}>{fmtDateTime(v.scheduled_at)}</Td>
                <Td className="text-ink-dim">{personName.get(v.executive_id) ?? '—'}</Td>
                <Td>
                  <Badge tone={TONE[v.status]}>{LABEL[v.status]}</Badge>
                </Td>
                <Td right>
                  {open(v) && canWrite ? (
                    <div className="flex justify-end gap-1.5">
                      {v.status === 'scheduled' && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(v, 'confirmed')}>
                          <Check className="size-3.5" /> Confirm
                        </Button>
                      )}
                      <Button size="sm" variant="gold" onClick={() => setClosing(v)}>
                        <MapPinCheck className="size-3.5" /> Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(v, 'no_show')}>
                        No-show
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-dim">{v.feedback ?? (v.done_at ? fmtDateTime(v.done_at) : '')}</span>
                  )}
                </Td>
              </tr>
            )
          })}
        </Table>
      )}
      {closing && <DoneModal visit={closing} onClose={() => setClosing(null)} />}
    </>
  )
}

function DoneModal({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [noGps, setNoGps] = useState(false)

  async function submit(withGps: boolean) {
    setBusy(true)
    setError(null)
    try {
      const pos = withGps ? await getPosition() : null
      await rpc('mark_visit_done', { p_visit: visit.id, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_feedback: feedback })
      for (const k of ['visits', 'leads', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
      toast('Visit marked done', 'ok')
      onClose()
    } catch (e) {
      setError((e as Error).message)
      if (withGps) setNoGps(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Visit done — ${visit.leads?.name ?? ''}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-dim">Your current location is saved (encrypted) as proof the visit happened on site.</p>
        <Field label="Customer feedback">
          {(id) => <Textarea id={id} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={1000} placeholder="What did they like? Any objections?" />}
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          {noGps && (
            <Button variant="ghost" loading={busy} onClick={() => submit(false)}>
              Save without location
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} onClick={() => submit(true)}>
            <MapPinCheck className="size-4" /> Save with location
          </Button>
        </div>
      </div>
    </Modal>
  )
}
