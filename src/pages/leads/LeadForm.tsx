import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { rpc, useCompany, usePeople, useProjects } from '../../lib/data'
import { parseMoney } from '../../lib/format'

export function LeadForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { can, me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const projects = useProjects()
  const people = usePeople()
  const company = useCompany()
  const [f, setF] = useState({ name: '', phone: '', email: '', source: 'Manual', project_id: '', budget_min: '', budget_max: '', config_wanted: '', owner_id: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const phone = f.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
    if (!f.name.trim()) return setError('Enter the lead’s name.')
    if (!/^[6-9]\d{9}$/.test(phone)) return setError('Enter a valid 10-digit mobile number.')
    const min = parseMoney(f.budget_min)
    const max = parseMoney(f.budget_max)
    if (Number.isNaN(min) || Number.isNaN(max)) return setError('Budget: use numbers like 85L, 1.2Cr or 8500000.')
    if (min && max && min > max) return setError('Minimum budget is more than the maximum.')
    setBusy(true)
    try {
      const res = await rpc<{ id: string; duplicate: boolean; visible: boolean }>('create_lead', {
        p: { ...f, phone, budget_min: min ?? '', budget_max: max ?? '', name: f.name.trim() },
      })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      if (res.duplicate) {
        toast(res.visible ? 'This number already exists — opening the existing lead' : 'This number already belongs to a lead owned by someone else. They have been notified.', 'info')
        if (res.visible) onCreated(res.id)
        else onClose()
      } else {
        toast('Lead added', 'ok')
        onCreated(res.id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide title="Add lead" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={set('name')} maxLength={80} autoFocus />}</Field>
          <Field label="Mobile number" hint="Stored encrypted. Duplicates are detected automatically.">
            {(id) => <Input id={id} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" />}
          </Field>
          <Field label="Email (optional)">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Source">
            {(id) => (
              <Select id={id} value={f.source} onChange={set('source')}>
                {(company.data?.lead_sources ?? ['Manual']).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Interested in project">
            {(id) => (
              <Select id={id} value={f.project_id} onChange={set('project_id')}>
                <option value="">— Not decided —</option>
                {(projects.data ?? []).filter((p) => p.status !== 'archived').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Configuration wanted">{(id) => <Input id={id} value={f.config_wanted} onChange={set('config_wanted')} placeholder="2 BHK" maxLength={40} />}</Field>
          <Field label="Budget from" hint="e.g. 70L">{(id) => <Input id={id} value={f.budget_min} onChange={set('budget_min')} placeholder="70L" />}</Field>
          <Field label="Budget up to" hint="e.g. 1.2Cr">{(id) => <Input id={id} value={f.budget_max} onChange={set('budget_max')} placeholder="85L" />}</Field>
          {can('leads.assign') && (
            <Field label="Assign to" className="sm:col-span-2">
              {(id) => (
                <Select id={id} value={f.owner_id} onChange={set('owner_id')}>
                  <option value="">Me ({me?.full_name})</option>
                  {(people.data ?? []).filter((p) => p.is_active && p.id !== me?.user_id).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="First note (optional)" className="sm:col-span-2">
            {(id) => <Textarea id={id} value={f.note} onChange={set('note')} maxLength={2000} placeholder="What did they ask for?" />}
          </Field>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            Save lead
          </Button>
        </div>
      </form>
    </Modal>
  )
}
