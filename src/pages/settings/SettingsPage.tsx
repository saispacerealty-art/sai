import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, LocateFixed, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Loading, PageHeader, Select, Table, Tabs, Td, Textarea, Th } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { rpc, useCompany, usePeople, useProjects, type CompanySettings } from '../../lib/data'
import { fmtDateTime } from '../../lib/format'
import { getPosition } from '../../lib/geo'
import { FLAGS, MODULES, type PermKey, type RolePreset } from '../../lib/perms'
import { supabase } from '../../lib/supabase'
import { useRolePresets } from '../employees/data'

type Tab = 'company' | 'leads' | 'roles' | 'webhooks' | 'audit'

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('company')
  return (
    <>
      <PageHeader title="Settings" sub="Company details, lead options, role defaults, integrations and the audit log." />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'company', label: 'Company' },
            { key: 'leads', label: 'Lead options' },
            { key: 'roles', label: 'Role defaults' },
            { key: 'webhooks', label: 'Lead webhooks' },
            { key: 'audit', label: 'Audit log' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'company' && <CompanyTab />}
      {tab === 'leads' && <LeadOptionsTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  )
}

function useSaveCompany() {
  const qc = useQueryClient()
  const toast = useToast()
  return async (patch: Partial<CompanySettings>) => {
    try {
      unwrap(await supabase.from('company_settings').update(patch).eq('id', 1).select('id'))
      void qc.invalidateQueries({ queryKey: ['company'] })
      toast('Settings saved', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
}

function CompanyTab() {
  const company = useCompany()
  return company.data ? <CompanyForm initial={company.data} /> : <Loading />
}

function CompanyForm({ initial }: { initial: CompanySettings }) {
  const save = useSaveCompany()
  const toast = useToast()
  const [f, setF] = useState(initial)
  const num = (v: string) => (v === '' ? null : Number(v))

  return (
    <Card className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} />}</Field>
        <Field label="Office address" className="sm:col-span-2">{(id) => <Input id={id} value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} />}</Field>
        <Field label="Default follow-up after (days)" hint="Applied to every new lead">
          {(id) => <Input id={id} type="number" min={0} max={60} value={f.follow_up_default_days} onChange={(e) => setF({ ...f, follow_up_default_days: Number(e.target.value) })} />}
        </Field>
        <Field label="Unit hold lasts (hours)" hint="Holds without a booking are released automatically">
          {(id) => <Input id={id} type="number" min={1} max={720} value={f.hold_hours} onChange={(e) => setF({ ...f, hold_hours: Number(e.target.value) })} />}
        </Field>
      </div>
      <div className="mt-4">
        <Checkbox label="Share imported and webhook leads out automatically to the least-busy sales person" checked={f.round_robin} onChange={(v) => setF({ ...f, round_robin: v })} />
      </div>

      <h3 className="mt-6 mb-2 text-sm font-bold text-navy">Attendance geofence (optional)</h3>
      <p className="mb-3 text-xs text-ink-dim">If a radius is set, staff can only check in within that distance of the office. Leave the radius empty to allow check-in from anywhere.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Office latitude">{(id) => <Input id={id} type="number" step="0.000001" value={f.office_lat ?? ''} onChange={(e) => setF({ ...f, office_lat: num(e.target.value) })} />}</Field>
        <Field label="Office longitude">{(id) => <Input id={id} type="number" step="0.000001" value={f.office_lng ?? ''} onChange={(e) => setF({ ...f, office_lng: num(e.target.value) })} />}</Field>
        <Field label="Radius (metres)">{(id) => <Input id={id} type="number" min={50} max={50000} value={f.geofence_m ?? ''} onChange={(e) => setF({ ...f, geofence_m: num(e.target.value) })} placeholder="No limit" />}</Field>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={async () => {
          try {
            const p = await getPosition()
            setF({ ...f, office_lat: p.lat, office_lng: p.lng })
          } catch (e) {
            toast((e as Error).message, 'bad')
          }
        }}
      >
        <LocateFixed className="size-3.5" /> Use my current location as the office
      </Button>
      <div className="mt-5 flex justify-end">
        <Button
          variant="gold"
          onClick={() =>
            save({ name: f.name, phone: f.phone, address: f.address, follow_up_default_days: f.follow_up_default_days, hold_hours: f.hold_hours, round_robin: f.round_robin, office_lat: f.office_lat, office_lng: f.office_lng, geofence_m: f.geofence_m })
          }
        >
          Save
        </Button>
      </div>
    </Card>
  )
}

function LeadOptionsTab() {
  const company = useCompany()
  return company.data ? <LeadOptionsForm initial={company.data} /> : <Loading />
}

function LeadOptionsForm({ initial }: { initial: CompanySettings }) {
  const save = useSaveCompany()
  const [sources, setSources] = useState(initial.lead_sources.join('\n'))
  const [reasons, setReasons] = useState(initial.lost_reasons.join('\n'))
  const lines = (s: string) => [...new Set(s.split('\n').map((x) => x.trim().slice(0, 40)).filter(Boolean))]
  return (
    <Card className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lead sources" hint="One per line. Shown when adding a lead.">{(id) => <Textarea id={id} rows={11} value={sources} onChange={(e) => setSources(e.target.value)} />}</Field>
        <Field label="Reasons a lead is lost" hint="One per line. Asked when a lead is marked lost.">{(id) => <Textarea id={id} rows={11} value={reasons} onChange={(e) => setReasons(e.target.value)} />}</Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="gold" disabled={!lines(sources).length || !lines(reasons).length} onClick={() => save({ lead_sources: lines(sources), lost_reasons: lines(reasons) })}>
          Save
        </Button>
      </div>
    </Card>
  )
}

function RolesTab() {
  const presets = useRolePresets()
  const [role, setRole] = useState<string>('sales')
  const editable = (presets.data ?? []).filter((p) => p.role !== 'owner' && p.role !== 'admin')
  const current = editable.find((p) => p.role === role)
  // keyed by role: picking another role remounts the form with that role's saved defaults
  return current ? <RoleForm key={current.role} initial={current} editable={editable} onPick={setRole} /> : <Loading />
}

function RoleForm({ initial, editable, onPick }: { initial: RolePreset; editable: RolePreset[]; onPick: (role: string) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const role = initial.role
  const setRole = onPick
  const [draft, setDraft] = useState<RolePreset>({ ...initial, modules: [...initial.modules], flags: [...initial.flags] })
  const [busy, setBusy] = useState(false)
  const toggle = (list: 'modules' | 'flags', k: PermKey, v: boolean) => setDraft({ ...draft, [list]: v ? [...draft[list], k] : draft[list].filter((x) => x !== k) })

  async function save() {
    setBusy(true)
    try {
      await rpc('update_role_preset', { p_role: draft.role, p_modules: draft.modules, p_flags: draft.flags, p_scope: draft.scope })
      void qc.invalidateQueries({ queryKey: ['role_presets'] })
      toast(`${draft.label} defaults saved — applies to everyone with that role`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="max-w-3xl">
      <p className="mb-4 text-sm text-ink-dim">
        These are the starting permissions for each role. Changes apply immediately to everyone with that role, except where a person has a custom tick on the Employees page. Owner and Admin cannot be changed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              {editable.map((p) => (
                <option key={p.role} value={p.role}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Sees records of">
          {(id) => (
            <Select id={id} value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as RolePreset['scope'] })}>
              <option value="own">Own records only</option>
              <option value="team">Own + their team’s</option>
              <option value="all">Everyone’s</option>
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="mt-4 rounded-xl border border-line bg-canvas p-4">
        <legend className="px-1 text-xs font-semibold text-ink-dim">Pages</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODULES.map((m) => (
            <Checkbox key={m.key} label={m.label} checked={draft.modules.includes(m.key)} disabled={m.key === 'dashboard'} onChange={(v) => toggle('modules', m.key, v)} />
          ))}
        </div>
        <p className="mt-4 mb-2 text-xs font-semibold text-ink-dim">Extra permissions</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FLAGS.map((fl) => (
            <Checkbox key={fl.key} label={fl.label} checked={draft.flags.includes(fl.key)} onChange={(v) => toggle('flags', fl.key, v)} />
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex justify-end">
        <Button variant="gold" loading={busy} onClick={save}>
          Save {draft.label} defaults
        </Button>
      </div>
    </Card>
  )
}

interface Hook { id: string; source_name: string; default_owner_id: string | null; default_project_id: string | null; active: boolean; created_at: string }

function WebhooksTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const people = usePeople()
  const projects = useProjects()
  const hooks = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => unwrap(await supabase.from('lead_webhooks').select('id, source_name, default_owner_id, default_project_id, active, created_at').order('created_at')) as Hook[],
  })
  const [f, setF] = useState({ source: '', owner: '', project: '' })
  const [fresh, setFresh] = useState<{ id: string; secret: string } | null>(null)
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lead-intake`
  const refresh = () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  const copy = async (t: string) => {
    await navigator.clipboard.writeText(t)
    toast('Copied', 'ok')
  }

  async function create() {
    try {
      setFresh(await rpc<{ id: string; secret: string }>('create_webhook', { p_source: f.source, p_owner: f.owner || null, p_project: f.project || null }))
      setF({ source: '', owner: '', project: '' })
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const act = async (id: string, active: boolean, del = false) => {
    try {
      await rpc('set_webhook', { p_id: id, p_active: active, p_delete: del })
      refresh()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <p className="text-sm text-ink-dim">
          A webhook lets your website form, Google Ads lead form, or a tool like Zapier, Make or Pabbly send new leads straight into the CRM. Each source gets its own address and secret.
          Duplicate phone numbers are logged on the existing lead instead of creating a second one.
        </p>
        {fresh && (
          <div className="mt-4 rounded-xl border border-gold/40 bg-gold-tint p-4 text-sm">
            <p className="text-xs font-bold text-gold-dark uppercase">Copy these now — the secret is shown only once</p>
            <dl className="mt-2 flex flex-col gap-2">
              {[['Address (POST)', `${base}?id=${fresh.id}`], ['Header X-Webhook-Secret', fresh.secret]].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-dim">{k}</dt>
                  <dd className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded bg-white px-2 py-1 font-mono text-xs break-all select-all">{v}</code>
                    <button type="button" onClick={() => copy(v)} className="rounded p-1.5 text-gold-dark hover:bg-white" aria-label={`Copy ${k}`}>
                      <Copy className="size-4" />
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-ink-dim">
              Send JSON such as <code className="font-mono">{'{"name":"Amit Sharma","phone":"9876543210","note":"2 BHK enquiry"}'}</code>
            </p>
            <Button size="sm" className="mt-3" onClick={() => setFresh(null)}>
              I have saved them
            </Button>
          </div>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Source name, e.g. Website" aria-label="Source name" maxLength={40} />
          <Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} aria-label="Assign to">
            <option value="">Assign automatically</option>
            {(people.data ?? []).filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
          <Select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} aria-label="Default project">
            <option value="">No default project</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button onClick={create} disabled={f.source.trim().length < 2}>
            <Plus className="size-4" /> Create
          </Button>
        </div>
      </Card>
      {hooks.isLoading ? (
        <Loading />
      ) : hooks.error ? (
        <Alert>{(hooks.error as Error).message}</Alert>
      ) : (
        (hooks.data ?? []).map((h) => (
          <Card key={h.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-navy">{h.source_name}</p>
              <p className="truncate font-mono text-[11px] text-ink-faint">{base}?id={h.id}</p>
            </div>
            <Badge tone={h.active ? 'ok' : 'neutral'}>{h.active ? 'Active' : 'Off'}</Badge>
            <Button size="sm" variant="outline" onClick={() => copy(`${base}?id=${h.id}`)}>
              <Copy className="size-3.5" /> Address
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act(h.id, !h.active)}>
              {h.active ? 'Switch off' : 'Switch on'}
            </Button>
            <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-col hover:text-bad" aria-label={`Delete ${h.source_name}`} onClick={() => window.confirm(`Delete the ${h.source_name} webhook? Its secret stops working immediately.`) && act(h.id, false, true)}>
              <Trash2 className="size-4" />
            </button>
          </Card>
        ))
      )}
    </div>
  )
}

interface AuditRow { id: number; actor: string | null; action: string; entity: string | null; entity_id: string | null; meta: Record<string, unknown>; created_at: string }
const ACTION_LABEL: Record<string, string> = {
  login: 'Signed in', account_locked: 'Account locked', view_pii: 'Viewed contact / KYC', edit_pii: 'Edited contact / KYC', export: 'Exported data',
  import: 'Imported leads', download: 'Downloaded document', document_upload: 'Uploaded document', perm_change: 'Changed permissions',
  employee_create: 'Created employee', employee_update: 'Updated employee', password_reset: 'Reset a password', password_change: 'Changed own password',
  account_unlock: 'Unlocked account', booking_approve: 'Approved booking', booking_cancel: 'Cancelled booking', payment_record: 'Recorded payment',
  view_location_trail: 'Viewed location trail', webhook_create: 'Created webhook', webhook_update: 'Updated webhook', webhook_delete: 'Deleted webhook',
  incentive_approved: 'Approved incentive', incentive_paid: 'Paid incentive', incentive_cancelled: 'Cancelled incentive',
}

function AuditTab() {
  const feed = useQuery({ queryKey: ['audit'], queryFn: () => rpc<AuditRow[]>('audit_feed', { p_limit: 200 }) })
  if (feed.isLoading) return <Loading />
  if (feed.error) return <Alert>{(feed.error as Error).message}</Alert>
  return (
    <>
      <p className="mb-3 text-sm text-ink-dim">The 200 most recent sensitive actions. This log cannot be edited or deleted by anyone.</p>
      <Table
        head={
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Details</Th>
          </tr>
        }
      >
        {(feed.data ?? []).map((a) => {
          const details = Object.entries(a.meta ?? {}).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
          return (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-ink-dim">{fmtDateTime(a.created_at)}</Td>
              <Td className="font-semibold text-ink">{a.actor ?? 'System'}</Td>
              <Td>{ACTION_LABEL[a.action] ?? a.action}</Td>
              <Td className="text-xs text-ink-dim">{[a.entity, details].filter(Boolean).join(' · ')}</Td>
            </tr>
          )
        })}
      </Table>
    </>
  )
}
