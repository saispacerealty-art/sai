import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, CalendarPlus, Eye, Handshake, MapPin, MessageCircle, Phone, PhoneCall, StickyNote, UserRoundCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Badge, Button, Drawer, Field, Input, Loading, Select, Textarea } from '../../components/ui'
import { rpc, usePeople, useProjects } from '../../lib/data'
import { budgetRange, fmtDateTime, STAGES, stageOf, timeAgo, toLocalInput, type StageKey } from '../../lib/format'
import { BookingForm } from '../bookings/BookingForm'
import { ScheduleVisitModal } from '../visits/ScheduleVisitModal'
import { revealContact, useLeads, useTimeline, useUpdateLead, type Contact, type Lead, type TimelineItem } from './data'

const ICONS: Record<TimelineItem['type'], typeof Phone> = {
  note: StickyNote, call: PhoneCall, whatsapp: MessageCircle, stage: ArrowRightLeft, assign: UserRoundCheck,
  visit: MapPin, import: ArrowRightLeft, booking: Handshake, system: ArrowRightLeft,
}

function describe(a: TimelineItem, personName: Map<string, string>): string {
  const m = a.meta as Record<string, string | null>
  if (a.type === 'stage') return `Stage: ${stageOf(m.from ?? '').label} → ${stageOf(m.to ?? '').label}${m.reason ? ` (${m.reason})` : ''}`
  if (a.type === 'assign') return `Reassigned to ${personName.get(m.to ?? '') ?? 'nobody'}`
  if (a.type === 'visit' && m.at) return `${a.body} for ${fmtDateTime(m.at)}`
  if (a.type === 'booking' && m.unit) return `${a.body} · Unit ${m.unit}`
  if (a.type === 'system' && m.source) return `${a.body} · ${m.source}`
  return a.body ?? ''
}

export function LeadDrawer({ leadId, onClose, onLost }: { leadId: string; onClose: () => void; onLost: (l: Lead) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const leads = useLeads()
  const people = usePeople()
  const projects = useProjects()
  const timeline = useTimeline(leadId)
  const update = useUpdateLead()
  const lead = leads.data?.find((l) => l.id === leadId)
  const [contact, setContact] = useState<Contact | null>(null)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [visiting, setVisiting] = useState(false)
  const [booking, setBooking] = useState(false)
  const readOnly = can('read_only')
  const personName = new Map((people.data ?? []).map((p) => [p.id, p.full_name]))

  if (!lead) {
    return (
      <Drawer open title="Lead" onClose={onClose}>
        {leads.isLoading ? <Loading /> : <p className="text-sm text-ink-dim">This lead is not available to your account.</p>}
      </Drawer>
    )
  }
  const closed = lead.stage === 'booked' || lead.stage === 'lost'
  const patch = (p: Partial<Lead>) => update.mutate({ id: lead.id, patch: p }, { onError: (e) => toast((e as Error).message, 'bad') })

  // The number is decrypted on the server only at this moment, and the action is logged.
  async function dial(kind: 'call' | 'whatsapp') {
    try {
      const c = await revealContact(lead!.id, kind)
      void qc.invalidateQueries({ queryKey: ['timeline', lead!.id] })
      if (!c.phone) return toast('No phone number on this lead', 'bad')
      if (kind === 'call') window.location.assign(`tel:+91${c.phone}`)
      else window.open(`https://wa.me/91${c.phone}?text=${encodeURIComponent(`Hello ${lead!.name.split(' ')[0]}, this is Sai Space Realty.`)}`, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function show() {
    try {
      setContact(await revealContact(lead!.id, 'view'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function saveNote() {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      await rpc('add_lead_note', { p_lead: lead!.id, p_text: note.trim() })
      setNote('')
      void qc.invalidateQueries({ queryKey: ['timeline', lead!.id] })
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={lead.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={stageOf(lead.stage).tone}>{stageOf(lead.stage).label}</Badge>
            <span>Score {lead.score}</span>
            <span>· {lead.source}</span>
            <span>· added {timeAgo(lead.created_at)}</span>
          </span>
        }
      >
        {/* contact */}
        <div className="rounded-xl border border-line bg-canvas p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-ink">{contact?.phone ? `+91 ${contact.phone}` : lead.phone_hint}</span>
            {!contact && can('leads.view_contact') && (
              <Button size="sm" variant="ghost" onClick={show}>
                <Eye className="size-3.5" /> Show
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="primary" onClick={() => dial('call')}>
                <Phone className="size-3.5" /> Call
              </Button>
              <Button size="sm" variant="outline" onClick={() => dial('whatsapp')}>
                <MessageCircle className="size-3.5" /> WhatsApp
              </Button>
            </div>
          </div>
          {contact && (contact.alt_phone || contact.email) && (
            <p className="mt-1.5 text-xs text-ink-dim">
              {contact.alt_phone && <>Alt: +91 {contact.alt_phone} </>}
              {contact.email && <>· {contact.email}</>}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-faint">Viewing or dialling a number is logged.</p>
        </div>

        {/* details */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Stage">
            {(id) => (
              <Select
                id={id}
                value={lead.stage}
                disabled={readOnly}
                onChange={(e) => {
                  const s = e.target.value as StageKey
                  if (s === 'lost') onLost(lead)
                  else if (s === 'booked') toast('Use “Book a unit” below', 'info')
                  else patch({ stage: s })
                }}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Next follow-up">
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                disabled={readOnly || closed}
                value={toLocalInput(lead.next_follow_up_at)}
                onChange={(e) => patch({ next_follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            )}
          </Field>
          <Field label="Project">
            {(id) => (
              <Select id={id} value={lead.project_id ?? ''} disabled={readOnly} onChange={(e) => patch({ project_id: e.target.value || null })}>
                <option value="">— Not decided —</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Owner">
            {(id) => (
              <Select id={id} value={lead.owner_id ?? ''} disabled={!can('leads.assign')} onChange={(e) => patch({ owner_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {(people.data ?? []).filter((p) => p.is_active || p.id === lead.owner_id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="mt-3 text-sm text-ink-dim">
          Budget <b className="text-gold-dark">{budgetRange(lead.budget_min, lead.budget_max)}</b>
          {lead.config_wanted && <> · wants <b className="text-ink">{lead.config_wanted}</b></>}
          {lead.lost_reason && <> · lost: <b className="text-bad">{lead.lost_reason}</b></>}
        </p>

        {/* actions */}
        {!readOnly && (
          <div className="mt-4 flex flex-wrap gap-2">
            {can('visits') && !closed && (
              <Button size="sm" variant="outline" onClick={() => setVisiting(true)}>
                <CalendarPlus className="size-3.5" /> Schedule visit
              </Button>
            )}
            {can('bookings') && lead.stage !== 'booked' && lead.stage !== 'lost' && (
              <Button size="sm" variant="outline" onClick={() => setBooking(true)}>
                <Handshake className="size-3.5" /> Book a unit
              </Button>
            )}
            {!closed && (
              <Button size="sm" variant="ghost" className="text-bad" onClick={() => onLost(lead)}>
                <XCircle className="size-3.5" /> Mark lost
              </Button>
            )}
          </div>
        )}

        {/* notes + timeline */}
        {!readOnly && (
          <div className="mt-5">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (stored encrypted)…" maxLength={4000} aria-label="New note" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={savingNote} disabled={!note.trim()} onClick={saveNote}>
                Save note
              </Button>
            </div>
          </div>
        )}
        <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-ink-faint uppercase">Timeline</h3>
        {timeline.isLoading ? (
          <Loading />
        ) : (
          <ol className="flex flex-col">
            {(timeline.data ?? []).map((a) => {
              const Icon = ICONS[a.type] ?? ArrowRightLeft
              return (
                <li key={a.id} className="flex gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gold-tint text-gold-dark">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm break-words whitespace-pre-wrap ${a.type === 'note' ? 'text-ink' : 'text-ink-dim'}`}>{describe(a, personName)}</p>
                    <p className="text-[11px] text-ink-faint">
                      {a.created_by_name ?? 'System'} · {fmtDateTime(a.created_at)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Drawer>
      {visiting && <ScheduleVisitModal lead={lead} onClose={() => setVisiting(false)} />}
      {booking && <BookingForm lead={lead} onClose={() => setBooking(false)} />}
    </>
  )
}
