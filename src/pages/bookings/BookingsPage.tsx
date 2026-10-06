import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Handshake, IndianRupee, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Drawer, EmptyState, Field, Input, Loading, Modal, PageHeader, Stat, Table, Tabs, Td, Textarea, Th } from '../../components/ui'
import { rpc } from '../../lib/data'
import { fmtDate, inr, parseMoney } from '../../lib/format'
import { useBookings, type Booking } from './data'

interface Milestone {
  id: string
  label: string
  due_date: string | null
  amount: number
  received_amount: number
  received_at: string | null
}
const TONE = { pending: 'warn', approved: 'ok', cancelled: 'neutral' } as const

export function BookingsPage() {
  const { can, me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const bookings = useBookings()
  const [tab, setTab] = useState<Booking['status']>('approved')
  const [open, setOpen] = useState<Booking | null>(null)
  const [cancelling, setCancelling] = useState<Booking | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const all = bookings.data ?? []
  const list = all.filter((b) => b.status === tab)
  const approved = all.filter((b) => b.status === 'approved')
  const refresh = () => ['bookings', 'leads', 'units', 'dashboard', 'incentives', 'clients'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))

  async function approve(b: Booking) {
    setBusyId(b.id)
    try {
      await rpc('approve_booking', { p_booking: b.id })
      toast('Booking approved — unit marked booked and incentive created', 'ok')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader title="Bookings & Sales" sub="Confirmed deals, approvals and payment collection." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat icon={Handshake} label="Approved bookings" value={approved.length} />
        <Stat icon={IndianRupee} label="Sales value" value={inr(approved.reduce((s, b) => s + Number(b.agreement_value), 0))} />
        <Stat icon={IndianRupee} label="Collected so far" value={inr(approved.reduce((s, b) => s + Number(b.received), 0))} />
      </div>
      <div className="mb-4">
        <Tabs
          tabs={(['approved', 'pending', 'cancelled'] as const).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), count: all.filter((b) => b.status === k).length }))}
          value={tab}
          onChange={setTab}
        />
      </div>
      {bookings.isLoading ? (
        <Loading />
      ) : bookings.error ? (
        <Alert>{(bookings.error as Error).message}</Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={Handshake} title={`No ${tab} bookings`} hint="Open a lead and choose “Book a unit” to create one." action={<Link to="/leads" className="text-sm font-semibold text-gold-dark">Go to Leads</Link>} />
      ) : (
        <Table
          minWidth={860}
          head={
            <tr>
              <Th>Customer</Th>
              <Th>Unit</Th>
              <Th>Date</Th>
              <Th right>Value</Th>
              <Th right>Collected</Th>
              <Th>Closed by</Th>
              <Th>Status</Th>
              <Th right>Actions</Th>
            </tr>
          }
        >
          {list.map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-canvas" onClick={() => setOpen(b)}>
              <Td className="font-semibold text-ink">{b.lead_name}</Td>
              <Td className="text-ink-dim">
                {b.project}
                <div className="text-xs text-ink-faint">
                  {b.tower} · {b.unit_no}
                </div>
              </Td>
              <Td className="text-ink-dim">{fmtDate(b.booking_date)}</Td>
              <Td right className="font-semibold text-navy">
                {inr(b.agreement_value)}
              </Td>
              <Td right className="text-ink-dim">
                {inr(b.received)}
              </Td>
              <Td className="text-ink-dim">{b.closed_by_name}</Td>
              <Td>
                <Badge tone={TONE[b.status]}>{b.status}</Badge>
              </Td>
              <Td right>
                <div className="flex justify-end gap-1.5">
                  {b.status === 'pending' && can('bookings.approve') && (
                    <Button size="sm" variant="gold" loading={busyId === b.id} onClick={(e) => { e.stopPropagation(); void approve(b) }}>
                      <Check className="size-3.5" /> Approve
                    </Button>
                  )}
                  {b.status !== 'cancelled' && (can('bookings.approve') || (b.status === 'pending' && b.closed_by === me?.user_id)) && (
                    <Button size="sm" variant="ghost" className="text-bad" onClick={(e) => { e.stopPropagation(); setCancelling(b) }}>
                      Cancel
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {open && <BookingDrawer booking={open} onClose={() => setOpen(null)} />}
      {cancelling && <CancelModal booking={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />}
    </>
  )
}

function CancelModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open title="Cancel booking" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-dim">
          Cancelling frees unit <b className="text-ink">{booking.unit_no}</b> and cancels any unpaid incentive for this booking.
        </p>
        <Field label="Reason">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await rpc('cancel_booking', { p_booking: booking.id, p_reason: reason })
                onDone()
                onClose()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Cancel booking
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function BookingDrawer({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const canWrite = can('bookings') && !can('read_only') && booking.status !== 'cancelled'
  const ms = useQuery({ queryKey: ['milestones', booking.id], queryFn: () => rpc<Milestone[]>('list_milestones', { p_booking: booking.id }) })
  const [label, setLabel] = useState('')
  const [due, setDue] = useState('')
  const [amount, setAmount] = useState('')
  const [paying, setPaying] = useState<Milestone | null>(null)
  const [paid, setPaid] = useState('')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['milestones', booking.id] })
    void qc.invalidateQueries({ queryKey: ['bookings'] })
    void qc.invalidateQueries({ queryKey: ['clients'] })
  }
  const planned = (ms.data ?? []).reduce((s, m) => s + Number(m.amount), 0)
  const received = (ms.data ?? []).reduce((s, m) => s + Number(m.received_amount), 0)

  async function add() {
    const n = parseMoney(amount)
    if (!label.trim() || !n || Number.isNaN(n)) return toast('Enter a label and an amount (e.g. 18.4L)', 'bad')
    try {
      await rpc('add_milestone', { p_booking: booking.id, p_label: label, p_due: due || null, p_amount: n })
      setLabel('')
      setDue('')
      setAmount('')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function pay() {
    const n = parseMoney(paid)
    if (n === null || Number.isNaN(n)) return toast('Enter the amount received', 'bad')
    try {
      await rpc('record_payment', { p_milestone: paying!.id, p_amount: n })
      setPaying(null)
      setPaid('')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={booking.lead_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[booking.status]}>{booking.status}</Badge>
          {booking.project} · {booking.tower} · Unit {booking.unit_no}
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ['Agreement value', inr(booking.agreement_value, { exact: true })],
          ['Token', inr(booking.token_amount, { exact: true })],
          ['Booking date', fmtDate(booking.booking_date)],
          ['Closed by', booking.closed_by_name],
          ['Planned in milestones', inr(planned, { exact: true })],
          ['Received', inr(received, { exact: true })],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-canvas px-3 py-2">
            <dt className="text-[11px] font-semibold text-ink-faint">{k}</dt>
            <dd className="font-semibold text-navy">{v}</dd>
          </div>
        ))}
      </dl>
      {booking.cancel_reason && <p className="mt-3 text-sm text-bad">Cancelled: {booking.cancel_reason}</p>}

      <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-ink-faint uppercase">Payment milestones</h3>
      {ms.isLoading ? (
        <Loading />
      ) : (ms.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-dim">No milestones yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ms.data!.map((m) => {
            const full = Number(m.received_amount) >= Number(m.amount)
            const overdue = !full && m.due_date && new Date(m.due_date) < new Date()
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">{m.label}</div>
                  <div className={`text-xs ${overdue ? 'font-semibold text-bad' : 'text-ink-faint'}`}>
                    {m.due_date ? `Due ${fmtDate(m.due_date)}` : 'No due date'} · {inr(m.received_amount)} of {inr(m.amount)}
                  </div>
                </div>
                <Badge tone={full ? 'ok' : Number(m.received_amount) > 0 ? 'warn' : overdue ? 'bad' : 'neutral'}>{full ? 'Paid' : Number(m.received_amount) > 0 ? 'Part paid' : overdue ? 'Overdue' : 'Due'}</Badge>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={() => { setPaying(m); setPaid(String(m.amount)) }}>
                    Record
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && (
        <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
          <p className="mb-2 text-xs font-semibold text-ink-dim">Add milestone</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="On agreement (20%)" aria-label="Label" maxLength={80} />
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="sm:!w-40" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="18.4L" aria-label="Amount" className="sm:!w-28" />
            <Button onClick={add}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
      )}

      {paying && (
        <Modal open title={`Payment — ${paying.label}`} onClose={() => setPaying(null)}>
          <div className="flex flex-col gap-4">
            <Field label="Total received for this milestone" hint={`Milestone amount ${inr(paying.amount, { exact: true })}`}>
              {(id) => <Input id={id} value={paid} onChange={(e) => setPaid(e.target.value)} autoFocus />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaying(null)}>
                Cancel
              </Button>
              <Button variant="gold" onClick={pay}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Drawer>
  )
}
