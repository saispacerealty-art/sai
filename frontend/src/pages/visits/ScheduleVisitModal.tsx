import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Field, Input, Modal, Select } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { usePeople, useProjects } from '../../lib/data'
import { toLocalInput } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export function ScheduleVisitModal({ lead, onClose }: { lead: { id: string; name: string; project_id: string | null }; onClose: () => void }) {
  const { me, can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const projects = useProjects()
  const people = usePeople()
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 864e5) // tomorrow, 11:00
    d.setHours(11, 0, 0, 0)
    return toLocalInput(d)
  })
  const [project, setProject] = useState(lead.project_id ?? '')
  const [exec, setExec] = useState(me?.user_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!when) return setError('Choose the date and time.')
    setBusy(true)
    try {
      unwrap(
        await supabase
          .from('site_visits')
          .insert({ lead_id: lead.id, project_id: project || null, scheduled_at: new Date(when).toISOString(), executive_id: exec, status: 'scheduled' })
          .select('id'),
      )
      for (const k of ['visits', 'leads', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
      void qc.invalidateQueries({ queryKey: ['timeline', lead.id] })
      toast('Site visit scheduled', 'ok')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Schedule visit — ${lead.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Date and time">{(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        <Field label="Project">
          {(id) => (
            <Select id={id} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">— Not decided —</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Executive taking the visit">
          {(id) => (
            <Select id={id} value={exec} onChange={(e) => setExec(e.target.value)} disabled={me?.scope === 'own' && !can('leads.assign')}>
              {(people.data ?? []).filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.id === me?.user_id ? ' (me)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  )
}
