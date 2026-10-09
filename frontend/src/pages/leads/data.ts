import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/api'
import { rpc } from '../../lib/data'
import type { StageKey } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export interface Lead {
  id: string
  name: string
  phone_hint: string | null
  source: string
  project_id: string | null
  budget_min: number | null
  budget_max: number | null
  config_wanted: string | null
  stage: StageKey
  lost_reason: string | null
  score: number
  owner_id: string | null
  created_by: string | null
  next_follow_up_at: string | null
  last_activity_at: string
  created_at: string
}

// Only the columns the database lets a browser read (no ciphertext).
const COLS =
  'id, name, phone_hint, source, project_id, budget_min, budget_max, config_wanted, stage, lost_reason, score, owner_id, created_by, next_follow_up_at, last_activity_at, created_at'

export function useLeads() {
  return useQuery({
    queryKey: ['leads'],
    queryFn: async () =>
      unwrap(
        await supabase.from('leads').select(COLS).is('anonymized_at', null).order('last_activity_at', { ascending: false }).limit(2000),
      ) as unknown as Lead[],
  })
}

export interface TimelineItem {
  id: number
  type: 'note' | 'call' | 'whatsapp' | 'stage' | 'assign' | 'visit' | 'import' | 'booking' | 'system'
  body: string | null
  meta: Record<string, unknown>
  created_by: string | null
  created_by_name: string | null
  created_at: string
}
export function useTimeline(leadId: string | null) {
  return useQuery({
    queryKey: ['timeline', leadId],
    enabled: !!leadId,
    queryFn: () => rpc<TimelineItem[]>('lead_timeline', { p_lead: leadId }),
  })
}

/** Patch non-sensitive lead fields (stage, owner, follow-up, project, budget…). */
export function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Lead> }) =>
      unwrap(await supabase.from('leads').update(patch).eq('id', id).select('id')),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['leads'] })
      const prev = qc.getQueryData<Lead[]>(['leads'])
      qc.setQueryData<Lead[]>(['leads'], (old) => old?.map((l) => (l.id === id ? { ...l, ...patch } : l)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['leads'], ctx.prev),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['timeline', v.id] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export type Contact = { phone: string | null; alt_phone: string | null; email: string | null }
export const revealContact = (leadId: string, purpose: 'view' | 'call' | 'whatsapp') =>
  rpc<Contact>('reveal_lead_contact', { p_lead: leadId, p_purpose: purpose })
