import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/api'
import type { RolePreset } from '../../lib/perms'
import { supabase } from '../../lib/supabase'

export interface Employee {
  id: string
  username: string
  full_name: string
  role: RolePreset['role']
  role_label: string
  manager_id: string | null
  scope_override: 'own' | 'team' | 'all' | null
  is_active: boolean
  phone_hint: string | null
  locked: boolean
  must_change_password: boolean
  created_at: string
  overrides: Record<string, boolean>
}

export function useRolePresets() {
  return useQuery({
    queryKey: ['role_presets'],
    queryFn: async () => unwrap(await supabase.from('role_presets').select('*').order('sort')) as RolePreset[],
    staleTime: 5 * 60_000,
  })
}
