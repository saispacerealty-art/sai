import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, MapPin, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { useProjects, type Project } from '../../lib/data'
import { inr, parseMoney } from '../../lib/format'
import { supabase } from '../../lib/supabase'

const STATUS_TONE = { upcoming: 'gold', active: 'ok', sold_out: 'navy', archived: 'neutral' } as const
const STATUS_LABEL = { upcoming: 'Upcoming', active: 'Active', sold_out: 'Sold out', archived: 'Archived' } as const

export function ProjectsPage() {
  const { can } = useAuth()
  const projects = useProjects()
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const counts = useQuery({
    queryKey: ['units', 'counts'],
    queryFn: async () => unwrap(await supabase.from('units').select('project_id, status').limit(20000)) as { project_id: string; status: string }[],
  })
  const byProject = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const u of counts.data ?? []) {
      const c = m.get(u.project_id) ?? {}
      c[u.status] = (c[u.status] ?? 0) + 1
      m.set(u.project_id, c)
    }
    return m
  }, [counts.data])
  const canEdit = can('projects.edit') && !can('read_only')

  return (
    <>
      <PageHeader
        title="Projects"
        sub="Projects, towers and unit availability."
        actions={
          canEdit && (
            <Button variant="gold" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add project
            </Button>
          )
        }
      />
      {projects.isLoading ? (
        <Loading />
      ) : projects.error ? (
        <Alert>{(projects.error as Error).message}</Alert>
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState icon={Building2} title="No projects yet" hint="Add a project, then its towers and units." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.data!.map((p) => {
            const c = byProject.get(p.id) ?? {}
            const total = Object.values(c).reduce((a, b) => a + b, 0)
            const sold = c.booked ?? 0
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="group overflow-hidden rounded-xl border border-line bg-panel transition hover:border-gold hover:shadow-md">
                <div className="flex h-24 items-end justify-between bg-gradient-to-br from-navy to-navy-soft p-4">
                  <Building2 className="size-9 text-gold-light/80" />
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                </div>
                <div className="p-4">
                  <h2 className="text-base font-bold text-navy group-hover:text-gold-dark">{p.name}</h2>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-dim">
                    <MapPin className="size-3.5" /> {p.location ?? '—'} {p.config && <>· {p.config}</>}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-gold-dark">
                    {p.price_min || p.price_max ? `${inr(p.price_min)} – ${inr(p.price_max)}` : 'Price on request'}
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-col">
                    <div className="h-full rounded-full bg-ok" style={{ width: total ? `${(sold / total) * 100}%` : '0%' }} />
                  </div>
                  <p className="mt-1.5 text-xs text-ink-dim">
                    <b className="text-ok">{c.available ?? 0}</b> available · <b className="text-warn">{c.hold ?? 0}</b> on hold · <b className="text-navy">{sold}</b> booked · {total} units
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-gold-dark"
                      onClick={(e) => {
                        e.preventDefault()
                        setEditing(p)
                      }}
                    >
                      Edit details
                    </button>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      {editing && <ProjectForm project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({
    name: project?.name ?? '', location: project?.location ?? '', config: project?.config ?? '', rera_no: project?.rera_no ?? '',
    price_min: project?.price_min ? String(project.price_min) : '', price_max: project?.price_max ? String(project.price_max) : '',
    status: project?.status ?? 'active',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const lo = parseMoney(f.price_min)
    const hi = parseMoney(f.price_max)
    if (f.name.trim().length < 2) return setError('Enter the project name.')
    if (Number.isNaN(lo) || Number.isNaN(hi)) return setError('Prices: use numbers like 78L or 1.25Cr.')
    const row = { name: f.name.trim(), location: f.location.trim() || null, config: f.config.trim() || null, rera_no: f.rera_no.trim() || null, price_min: lo, price_max: hi, status: f.status }
    setBusy(true)
    try {
      unwrap(project ? await supabase.from('projects').update(row).eq('id', project.id).select('id') : await supabase.from('projects').insert(row).select('id'))
      void qc.invalidateQueries({ queryKey: ['projects'] })
      toast(project ? 'Project updated' : 'Project added', 'ok')
      onClose()
    } catch (err) {
      setError(/duplicate key/.test((err as Error).message) ? 'A project with that name already exists.' : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide title={project ? `Edit ${project.name}` : 'Add project'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name">{(id) => <Input id={id} value={f.name} onChange={set('name')} maxLength={80} />}</Field>
          <Field label="Location">{(id) => <Input id={id} value={f.location} onChange={set('location')} placeholder="Pimple Saudagar" maxLength={80} />}</Field>
          <Field label="Configurations">{(id) => <Input id={id} value={f.config} onChange={set('config')} placeholder="2 & 3 BHK" maxLength={60} />}</Field>
          <Field label="RERA number">{(id) => <Input id={id} value={f.rera_no} onChange={set('rera_no')} maxLength={40} />}</Field>
          <Field label="Price from">{(id) => <Input id={id} value={f.price_min} onChange={set('price_min')} placeholder="78L" />}</Field>
          <Field label="Price up to">{(id) => <Input id={id} value={f.price_max} onChange={set('price_max')} placeholder="1.25Cr" />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={f.status} onChange={set('status')}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
