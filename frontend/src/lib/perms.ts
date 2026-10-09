// Mirrors role_presets / has_perm() in supabase/migrations. The database is the
// real gate; these are only used to decide what to show.

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'leads', label: 'Leads' },
  { key: 'projects', label: 'Projects' },
  { key: 'visits', label: 'Site Visits' },
  { key: 'bookings', label: 'Bookings & Sales' },
  { key: 'clients', label: 'Clients' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'tracking', label: 'Live Tracking' },
  { key: 'employees', label: 'Employees' },
  { key: 'incentives', label: 'Incentives' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
] as const

export const FLAGS = [
  { key: 'leads.assign', label: 'Assign / reassign leads' },
  { key: 'leads.view_contact', label: 'See full phone numbers' },
  { key: 'leads.import', label: 'Import leads' },
  { key: 'leads.export', label: 'Export data' },
  { key: 'leads.delete', label: 'Delete leads' },
  { key: 'projects.edit', label: 'Edit projects & units' },
  { key: 'bookings.approve', label: 'Approve bookings' },
  { key: 'incentives.approve', label: 'Approve incentives' },
  { key: 'employees.manage', label: 'Manage employee logins' },
  { key: 'read_only', label: 'Read-only account' },
] as const

export type PermKey = (typeof MODULES)[number]['key'] | (typeof FLAGS)[number]['key']

export type Role = 'owner' | 'admin' | 'manager' | 'sales' | 'telecaller' | 'marketing' | 'analyst' | 'team_member'

export interface Me {
  user_id: string
  username: string
  full_name: string
  role: Role
  role_label: string
  scope: 'own' | 'team' | 'all'
  must_change_password: boolean
  mfa_required: boolean
  /** Owner/Admin: session verified with the authenticator app AND that app is still registered */
  mfa_ok: boolean
  aal: 'aal1' | 'aal2'
  granted: PermKey[]
}

export interface RolePreset {
  role: Role
  label: string
  modules: PermKey[]
  flags: PermKey[]
  scope: 'own' | 'team' | 'all'
  sort: number
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
