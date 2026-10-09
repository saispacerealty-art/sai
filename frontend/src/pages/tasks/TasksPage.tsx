import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { usePeople } from '../../lib/data'
import { fmtDateTime, toLocalInput } from '../../lib/format'
import { supabase } from '../../lib/supabase'

interface Task {
  id: string
  title: string
  description: string | null
  lead_id: string | null
  assigned_to: string
  assigned_by: string | null
  due_at: string | null
  priority: 'low' | 'normal' | 'high'
  type: 'follow_up' | 'general'
  status: 'open' | 'done'
  done_at: string | null
  leads: { name: string } | null
}
type Tab = 'mine' | 'given' | 'team' | 'done'

export function TasksPage() {
  const { me, can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const [tab, setTab] = useState<Tab>('mine')
  const [adding, setAdding] = useState(false)
  const [now] = useState(() => Date.now())
  const canWrite = !can('read_only')
  const uid = me!.user_id

  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('tasks')
          .select('id, title, description, lead_id, assigned_to, assigned_by, due_at, priority, type, status, done_at, leads(name)')
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(1000),
      ) as unknown as Task[],
  })
  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data])
  const all = tasks.data ?? []
  const groups: Record<Tab, Task[]> = {
    mine: all.filter((t) => t.status === 'open' && t.assigned_to === uid),
    given: all.filter((t) => t.status === 'open' && t.assigned_by === uid && t.assigned_to !== uid),
    team: all.filter((t) => t.status === 'open' && t.assigned_to !== uid && t.assigned_by !== uid),
    done: all.filter((t) => t.status === 'done').sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')),
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function toggle(t: Task) {
    try {
      unwrap(await supabase.from('tasks').update({ status: t.status === 'open' ? 'done' : 'open' }).eq('id', t.id).select('id'))
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function remove(t: Task) {
    if (!window.confirm(`Delete the task “${t.title}”?`)) return
    try {
      unwrap(await supabase.from('tasks').delete().eq('id', t.id).select('id'))
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'mine', label: 'My tasks', count: groups.mine.length },
    { key: 'given', label: 'Assigned by me', count: groups.given.length },
    ...(me?.scope !== 'own' ? [{ key: 'team' as Tab, label: 'Team', count: groups.team.length }] : []),
    { key: 'done', label: 'Done' },
  ]
  const list = groups[tab]

  return (
    <>
      <PageHeader
        title="Tasks"
        sub="Things to do, with due dates. Overdue tasks are shown in red."
        actions={
          canWrite && (
            <Button variant="gold" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> New task
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>
      {tasks.isLoading ? (
        <Loading />
      ) : tasks.error ? (
        <Alert>{(tasks.error as Error).message}</Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={CheckSquare} title={tab === 'done' ? 'No completed tasks yet' : 'Nothing to do here'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((t) => {
            const overdue = t.status === 'open' && t.due_at && new Date(t.due_at).getTime() < now
            return (
              <li key={t.id} className="flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4.5 accent-navy"
                  checked={t.status === 'done'}
                  onChange={() => toggle(t)}
                  aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</p>
                  {t.description && <p className="text-xs whitespace-pre-wrap text-ink-dim">{t.description}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                    {t.due_at && <span className={overdue ? 'font-semibold text-bad' : ''}>{overdue ? 'Overdue · ' : 'Due '}{fmtDateTime(t.due_at)}</span>}
                    {t.assigned_to !== uid && <span>· for {personName.get(t.assigned_to) ?? '—'}</span>}
                    {t.assigned_by && t.assigned_by !== uid && <span>· from {personName.get(t.assigned_by) ?? '—'}</span>}
                    {t.lead_id && (
                      <Link to={`/leads?open=${t.lead_id}`} className="font-semibold text-gold-dark">
                        · {t.leads?.name ?? 'Lead'}
                      </Link>
                    )}
                  </p>
                </div>
                {t.priority !== 'normal' && <Badge tone={t.priority === 'high' ? 'bad' : 'neutral'}>{t.priority}</Badge>}
                {canWrite && t.assigned_by === uid && (
                  <button type="button" onClick={() => remove(t)} className="rounded-lg p-1.5 text-ink-faint hover:bg-col hover:text-bad" aria-label={`Delete ${t.title}`}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {adding && <TaskForm onClose={() => setAdding(false)} onSaved={refresh} />}
    </>
  )
}

function TaskForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth()
  const people = usePeople()
  const [f, setF] = useState(() => {
    const d = new Date(Date.now() + 864e5) // tomorrow, 10:00
    d.setHours(10, 0, 0, 0)
    return { title: '', description: '', assigned_to: me!.user_id, due_at: toLocalInput(d), priority: 'normal' }
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  // people I may assign to: myself, or my team / everyone depending on my data scope
  const assignable = (people.data ?? []).filter((p) => p.is_active && (p.id === me!.user_id || me!.scope === 'all' || (me!.scope === 'team' && p.manager_id === me!.user_id)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return setError('Enter what needs to be done.')
    setBusy(true)
    setError(null)
    try {
      unwrap(
        await supabase
          .from('tasks')
          .insert({ title: f.title.trim(), description: f.description.trim() || null, lead_id: null, assigned_to: f.assigned_to, assigned_by: me!.user_id, due_at: f.due_at ? new Date(f.due_at).toISOString() : null, priority: f.priority, type: 'general' })
          .select('id'),
      )
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="New task" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Task">{(id) => <Input id={id} value={f.title} onChange={set('title')} maxLength={200} autoFocus />}</Field>
        <Field label="Details (optional)">{(id) => <Textarea id={id} value={f.description} onChange={set('description')} maxLength={1000} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to">
            {(id) => (
              <Select id={id} value={f.assigned_to} onChange={set('assigned_to')}>
                {assignable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.id === me!.user_id ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={f.priority} onChange={set('priority')}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Due">{(id) => <Input id={id} type="datetime-local" value={f.due_at} onChange={set('due_at')} />}</Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            Add task
          </Button>
        </div>
      </form>
    </Modal>
  )
}
