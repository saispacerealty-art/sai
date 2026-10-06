import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Pencil, Plus, Power, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../../components/ui'
import { callFn, unwrap } from '../../lib/api'
import { FLAGS, initials, MODULES } from '../../lib/perms'

const PERM_LABEL = new Map<string, string>([...MODULES, ...FLAGS].map((p) => [p.key, p.label]))
import { supabase } from '../../lib/supabase'
import { useRolePresets, type Employee } from './data'
import { EmployeeForm } from './EmployeeForm'
import { ResetPasswordModal } from './ResetPasswordModal'



export function EmployeesPage() {
  const { me, can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const manage = can('employees.manage')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [resetting, setResetting] = useState<Employee | null>(null)

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: async () => unwrap(await supabase.rpc('list_employees')) as Employee[],
  })
  const presets = useRolePresets()

  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFn('admin-users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
    onError: (e: Error) => toast(e.message, 'bad'),
  })

  const byId = new Map((employees.data ?? []).map((e) => [e.id, e]))
  const canTouch = (e: Employee) =>
    manage && e.id !== me?.user_id && e.role !== 'owner' && (e.role !== 'admin' || me?.role === 'owner')

  return (
    <>
      <PageHeader
        title="Employees"
        sub="Team logins, roles and exactly what each person can access."
        actions={
          manage && (
            <Button variant="gold" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add team member
            </Button>
          )
        }
      />

      {employees.isLoading ? (
        <div className="grid place-items-center py-16 text-navy">
          <Spinner />
        </div>
      ) : employees.error ? (
        <Alert>{(employees.error as Error).message}</Alert>
      ) : employees.data!.length === 0 ? (
        <Card className="py-12 text-center">
          <UserPlus className="mx-auto size-10 text-gold" />
          <p className="mt-3 font-semibold text-navy">No team members yet</p>
          <p className="text-sm text-ink-dim">Add your first employee to give them a login.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-canvas text-[11px] tracking-wide text-ink-faint uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Reports to</th>
                <th className="px-4 py-3 font-semibold">Custom access</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                {manage && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.data!.map((e) => {
                const ov = Object.entries(e.overrides)
                return (
                  <tr key={e.id} className={`border-t border-line ${e.is_active ? '' : 'opacity-55'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#F3E3C0] text-xs font-bold text-navy">
                          {initials(e.full_name)}
                        </span>
                        <div>
                          <div className="font-semibold text-ink">{e.full_name}</div>
                          <div className="text-xs text-ink-faint">
                            @{e.username}
                            {e.phone_hint && ` · ${e.phone_hint}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.role === 'owner' || e.role === 'admin' ? 'navy' : e.role === 'manager' ? 'gold' : 'neutral'}>
                        {e.role_label}
                      </Badge>
                      {e.scope_override && <div className="mt-1 text-[11px] text-ink-faint">sees: {e.scope_override}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-dim">{e.manager_id ? byId.get(e.manager_id)?.full_name ?? '—' : '—'}</td>
                    <td className="px-4 py-3">
                      {ov.length === 0 ? (
                        <span className="text-xs text-ink-faint">Role default</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {ov.map(([k, v]) => (
                            <Badge key={k} tone={v ? 'ok' : 'bad'}>
                              {v ? '+' : '−'} {PERM_LABEL.get(k) ?? k}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {!e.is_active ? (
                          <Badge>Inactive</Badge>
                        ) : e.locked ? (
                          <Badge tone="bad">Locked</Badge>
                        ) : (
                          <Badge tone="ok">Active</Badge>
                        )}
                        {e.is_active && e.must_change_password && <Badge tone="warn">Temp password</Badge>}
                      </div>
                    </td>
                    {manage && (
                      <td className="px-4 py-3">
                        {canTouch(e) && (
                          <div className="flex justify-end gap-1">
                            <IconBtn label="Edit" icon={Pencil} onClick={() => setEditing(e)} />
                            <IconBtn label="Reset password" icon={KeyRound} onClick={() => setResetting(e)} />
                            {e.locked && (
                              <IconBtn
                                label="Unlock"
                                icon={Lock}
                                onClick={() => action.mutate({ action: 'unlock', user_id: e.id }, { onSuccess: () => toast('Account unlocked', 'ok') })}
                              />
                            )}
                            <IconBtn
                              label={e.is_active ? 'Deactivate' : 'Reactivate'}
                              icon={Power}
                              danger={e.is_active}
                              onClick={() => {
                                if (e.is_active && !window.confirm(`Deactivate ${e.full_name}? They will be signed out everywhere immediately.`)) return
                                action.mutate(
                                  { action: 'update', user_id: e.id, is_active: !e.is_active },
                                  { onSuccess: () => toast(e.is_active ? 'Employee deactivated' : 'Employee reactivated', 'ok') },
                                )
                              }}
                            />
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && presets.data && (
        <EmployeeForm
          employee={editing === 'new' ? null : editing}
          presets={presets.data}
          employees={employees.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void qc.invalidateQueries({ queryKey: ['employees'] })
          }}
        />
      )}
      {resetting && <ResetPasswordModal employee={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}

function IconBtn({ label, icon: Icon, onClick, danger }: { label: string; icon: typeof Pencil; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-2 hover:bg-col ${danger ? 'text-bad' : 'text-ink-dim hover:text-navy'}`}
    >
      <Icon className="size-4" />
    </button>
  )
}
