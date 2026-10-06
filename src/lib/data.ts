// Shared lookups used across modules (people, projects, company settings).
import { useQuery } from '@tanstack/react-query'
import { unwrap } from './api'
import { supabase } from './supabase'

export interface Person {
  id: string
  full_name: string
  role: string
  manager_id: string | null
  is_active: boolean
}
export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: async () =>
      unwrap(await supabase.from('profiles').select('id, full_name, role, manager_id, is_active').order('full_name')) as Person[],
    staleTime: 5 * 60_000,
  })
}

export interface Project {
  id: string
  name: string
  location: string | null
  config: string | null
  price_min: number | null
  price_max: number | null
  rera_no: string | null
  status: 'upcoming' | 'active' | 'sold_out' | 'archived'
}
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      unwrap(await supabase.from('projects').select('id, name, location, config, price_min, price_max, rera_no, status').order('name')) as Project[],
    staleTime: 60_000,
  })
}

export interface CompanySettings {
  name: string
  phone: string | null
  address: string | null
  follow_up_default_days: number
  hold_hours: number
  round_robin: boolean
  office_lat: number | null
  office_lng: number | null
  geofence_m: number | null
  lead_sources: string[]
  lost_reasons: string[]
}
export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    queryFn: async () => unwrap(await supabase.from('company_settings').select('*').eq('id', 1).single()) as CompanySettings,
    staleTime: 5 * 60_000,
  })
}

/** Runs an RPC and throws a readable error. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return unwrap(await supabase.rpc(fn, args)) as T
}
