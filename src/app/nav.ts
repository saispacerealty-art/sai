import {
  BarChart3,
  Building2,
  CalendarCheck,
  CheckSquare,
  Gift,
  Handshake,
  LayoutDashboard,
  MapPin,
  Navigation,
  Settings,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { PermKey } from '../lib/perms'

export interface NavItem {
  to: string
  label: string
  perm: PermKey
  icon: LucideIcon
  mobileTab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', perm: 'dashboard', icon: LayoutDashboard, mobileTab: true },
  { to: '/leads', label: 'Leads', perm: 'leads', icon: UserRound, mobileTab: true },
  { to: '/projects', label: 'Projects', perm: 'projects', icon: Building2 },
  { to: '/visits', label: 'Site Visits', perm: 'visits', icon: MapPin, mobileTab: true },
  { to: '/bookings', label: 'Bookings', perm: 'bookings', icon: Handshake },
  { to: '/clients', label: 'Clients', perm: 'clients', icon: UsersRound },
  { to: '/tasks', label: 'Tasks', perm: 'tasks', icon: CheckSquare, mobileTab: true },
  { to: '/attendance', label: 'Attendance', perm: 'attendance', icon: CalendarCheck, mobileTab: true },
  { to: '/tracking', label: 'Live Tracking', perm: 'tracking', icon: Navigation },
  { to: '/employees', label: 'Employees', perm: 'employees', icon: Users },
  { to: '/incentives', label: 'Incentives', perm: 'incentives', icon: Gift },
  { to: '/reports', label: 'Reports', perm: 'reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', perm: 'settings', icon: Settings },
]
