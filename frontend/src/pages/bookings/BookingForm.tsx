import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Field, Input, Modal, Select } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { rpc, useProjects } from '../../lib/data'
import { inr, parseMoney, todayStr } from '../../lib/format'
import { supabase } from '../../lib/supabase'

interface UnitOpt {
  id: string
  unit_no: string
  floor: number | null
  config: string | null
  price: number | null
  status: string
  hold_by: string | null
  towers: { name: string } | null
}

export function BookingForm({ lead, unitId, onClose }: { lead: { id: string; name: string; project_id: string | null }; unitId?: string; onClose: () => void }) {
  const { me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const projects = useProjects()
  const [project, setProject] = useState(lead.project_id ?? '')
  const [unit, setUnit] = useState(unitId ?? '')
  const [value, setValue] = useState('')
  const [token, setToken] = useState('')
  const [date, setDate] = useState(todayStr())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const units = useQuery({
    queryKey: ['units-bookable', project],
    enabled: !!project,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('units')
          .select('id, unit_no, floor, config, price, status, hold_by, towers(name)')
          .eq('project_id', project)
          .in('status', ['available', 'hold'])
          .order('unit_no'),
      ) as unknown as UnitOpt[],
  })
  const bookable = (units.data ?? []).filter((u) => u.status === 'available' || u.hold_by === me?.user_id)
  const chosen = bookable.find((u) => u.id === unit)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const v = parseMoney(value)
    const t = parseMoney(token)
    if (!unit) return setError('Choose a unit.')
    if (!v || Number.isNaN(v)) return setError('Enter the agreement value, e.g. 92L or 1.05Cr.')
    if (Number.isNaN(t)) return setError('Token amount is not a valid number.')
    setBusy(true)
    try {
      await rpc('create_booking', { p: { lead_id: lead.id, unit_id: unit, agreement_value: v, token_amount: t ?? '', booking_date: date } })
      for (const k of ['bookings', 'leads', 'units', 'units-bookable', 'dashboard', 'clients']) void qc.invalidateQueries({ queryKey: [k] })
      void qc.invalidateQueries({ queryKey: ['timeline', lead.id] })
      toast('Booking submitted for approval', 'ok')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Book a unit — ${lead.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Project">
          {(id) => (
            <Select id={id} value={project} onChange={(e) => { setProject(e.target.value); setUnit('') }}>
              <option value="">— Choose —</option>
              {(projects.data ?? []).filter((p) => p.status !== 'archived').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unit" hint={project && !units.isLoading && bookable.length === 0 ? 'No units are available in this project.' : 'Only available units, or ones you are holding, are listed.'}>
          {(id) => (
            <Select id={id} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!project}>
              <option value="">— Choose —</option>
              {bookable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.towers?.name} · {u.unit_no} · {u.config ?? ''} · {inr(u.price)}
                  {u.status === 'hold' ? ' (held by you)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agreement value" hint={chosen?.price ? `List price ${inr(chosen.price)}` : 'e.g. 92L'}>
            {(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="92L" />}
          </Field>
          <Field label="Token received (optional)">{(id) => <Input id={id} value={token} onChange={(e) => setToken(e.target.value)} placeholder="2L" />}</Field>
        </div>
        <Field label="Booking date">{(id) => <Input id={id} type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />}</Field>
        <p className="text-xs text-ink-faint">Amounts are stored encrypted. The unit is held until a manager approves or cancels the booking.</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            Submit for approval
          </Button>
        </div>
      </form>
    </Modal>
  )
}
