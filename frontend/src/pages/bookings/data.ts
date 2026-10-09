import { useQuery } from '@tanstack/react-query'
import { rpc } from '../../lib/data'

export interface Booking {
  id: string
  lead_id: string
  lead_name: string
  unit_no: string
  tower: string
  project: string
  booking_date: string
  agreement_value: number
  token_amount: number | null
  received: number
  closed_by: string
  closed_by_name: string
  status: 'pending' | 'approved' | 'cancelled'
  approved_at: string | null
  cancel_reason: string | null
}

export function useBookings() {
  return useQuery({ queryKey: ['bookings'], queryFn: () => rpc<Booking[]>('list_bookings') })
}
