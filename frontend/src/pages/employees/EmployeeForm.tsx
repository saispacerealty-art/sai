import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Checkbox, Field, Input, Modal, Select } from '../../components/ui'
import { callFn } from '../../lib/api'
import { FLAGS, MODULES, type PermKey, type RolePreset } from '../../lib/perms'
import type { Employee } from './data'
import { TempPasswordBox } from './ResetPasswordModal'
import { generateTempPassword } from './tempPassword'

const SCOPE_LABEL = { own: 'Own records', team: 'Team’s records', all: 'All records' } as const

export function EmployeeForm({
  employee,
  presets,
  employees,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  presets: RolePreset[]
  employees: Employee[]
  onClose: () => void
  onSaved: () => void
}) {
  const { me } = useAuth()
  const toast = useToast()
  const isNew = !employee
  const roleOptions = presets.filter((p) => p.role !== 'owner' && (p.role !== 'admin' || me?.role === 'owner'))

  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [username, setUsername] = useState(employee?.username ?? '')
  const [role, setRole] = useState<RolePreset['role']>(employee?.role ?? 'sales')
  const [managerId, setManagerId] = useState<string>(employee?.manager_id ?? '')
  const [phone, setPhone] = useState('')
  const [scope, setScope] = useState<string>(employee?.scope_override ?? '')
  const [overrides, setOverrides] = useState<Record<string, boolean>>(employee?.overrides ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)

  const preset = presets.find((p) => p.role === role)
  const defaults = useMemo(() => new Set<PermKey>([...(preset?.modules ?? []), ...(preset?.flags ?? [])]), [preset])
  const effective = (k: PermKey) => (k in overrides ? overrides[k] : defaults.has(k))

  function toggle(k: PermKey, v: boolean) {
    setOverrides((o) => {
      const next = { ...o }
      if (v === defaults.has(k)) delete next[k]  // back to role default → no override
      else next[k] = v
      return next
    })
  }

  function changeRole(r: RolePreset['role']) {
    setRole(r)
    setOverrides({}) // new role = start from its defaults
  }

  const managers = employees.filter(
    (e) => e.is_active && e.id !== employee?.id && ['owner', 'admin', 'manager'].includes(e.role),
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (fullName.trim().length < 2) return setError('Enter the full name.')
    if (isNew && !/^[a-z0-9_.]{3,30}$/.test(username.trim().toLowerCase()))
      return setError('Username: 3–30 characters, lowercase letters, digits, _ or . only.')
    if (phone && !/^[+\d\s-]{10,16}$/.test(phone.trim())) return setError('Enter a valid phone number.')

    setBusy(true)
    try {
      if (isNew) {
        const temp = generateTempPassword()
        await callFn('admin-users', {
          action: 'create',
          full_name: fullName.trim(),
          username: username.trim().toLowerCase(),
          role,
          manager_id: managerId || null,
          phone: phone.trim() || null,
          scope_override: scope || null,
          temp_password: temp,
          overrides,
        })
        setCreated({ username: username.trim().toLowerCase(), password: temp })
      } else {
        await callFn('admin-users', {
          action: 'update',
          user_id: employee.id,
          full_name: fullName.trim(),
          role,
          manager_id: managerId || null,
          scope_override: scope || null,
          overrides,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        })
        toast('Employee updated', 'ok')
        onSaved()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal open title="Team member added" onClose={onSaved}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-dim">
            Give these details to <b className="text-ink">{fullName}</b>. They must choose their own password the first time they sign in.
          </p>
          <TempPasswordBox username={created.username} password={created.password} />
          <Button onClick={onSaved}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open wide title={isNew ? 'Add team member' : `Edit ${employee.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />}
          </Field>
          <Field label="Username" hint={isNew ? 'Used to sign in. Cannot be changed later.' : undefined}>
            {(id) => (
              <Input
                id={id}
                value={username}
                disabled={!isNew}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                maxLength={30}
              />
            )}
          </Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => changeRole(e.target.value as RolePreset['role'])}>
                {roleOptions.map((p) => (
                  <option key={p.role} value={p.role}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reports to">
            {(id) => (
              <Select id={id} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">— No manager —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({m.role_label})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Mobile number" hint={employee?.phone_hint ? `Current: ${employee.phone_hint} (stored encrypted)` : 'Stored encrypted'}>
            {(id) => <Input id={id} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />}
          </Field>
          <Field label="Can see records of">
            {(id) => (
              <Select id={id} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Default: {preset ? SCOPE_LABEL[preset.scope] : ''}</option>
                {(['own', 'team', 'all'] as const).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <fieldset className="rounded-xl border border-line bg-canvas p-4">
          <legend className="px-1 text-xs font-semibold text-ink-dim">Pages this person can open</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODULES.map((m) => (
              <Checkbox
                key={m.key}
                label={m.label}
                checked={effective(m.key)}
                onChange={(v) => toggle(m.key, v)}
                note={m.key in overrides ? 'custom' : undefined}
              />
            ))}
          </div>
          <p className="mt-4 mb-2 text-xs font-semibold text-ink-dim">Extra permissions</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FLAGS.map((f) => (
              <Checkbox
                key={f.key}
                label={f.label}
                checked={effective(f.key)}
                onChange={(v) => toggle(f.key, v)}
                note={f.key in overrides ? 'custom' : undefined}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Ticks start from the <b>{preset?.label}</b> role defaults; anything you change is marked “custom”.
          </p>
        </fieldset>

        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" loading={busy}>
            {isNew ? 'Create login' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
