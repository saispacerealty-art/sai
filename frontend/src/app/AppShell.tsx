import { Bell, KeyRound, LogOut, Menu, MonitorSmartphone, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { cx } from '../lib/cx'
import { initials } from '../lib/perms'
import { NAV } from './nav'
import { useLocationPinger } from '../pages/attendance/data'
import { NotificationBell } from './NotificationBell'

export function AppShell() {
  const { me, can } = useAuth()
  const [drawer, setDrawer] = useState(false)
  useLocationPinger() // sends a GPS ping every few minutes while checked in
  const items = NAV.filter((n) => can(n.perm))
  const tabs = items.filter((n) => n.mobileTab).slice(0, 5)

  if (!me) return null

  return (
    <div className="flex h-full">
      {/* sidebar (desktop) / drawer (mobile) */}
      <div
        className={cx('fixed inset-0 z-40 bg-navy-dark/60 lg:hidden', drawer ? 'block' : 'hidden')}
        onClick={() => setDrawer(false)}
        aria-hidden="true"
      />
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gradient-to-b from-navy to-navy-dark px-3.5 py-5 transition-transform lg:static lg:translate-x-0',
          drawer ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="mb-3 flex items-center gap-2.5 border-b border-white/10 px-1 pb-5">
          <img src="/logo-mark.png" alt="" className="size-11 shrink-0 rounded-lg bg-white object-contain p-0.5" />
          <div className="leading-tight">
            <div className="text-[12.5px] font-bold tracking-wide text-white">SAI SPACE REALTY</div>
            <div className="text-[9px] font-semibold tracking-[0.12em] text-gold-light uppercase">CRM</div>
          </div>
          <button type="button" className="ml-auto rounded p-1 text-white/70 lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setDrawer(false)}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition-colors',
                  isActive
                    ? 'bg-gradient-to-r from-gold to-gold-light font-bold text-navy-dark shadow-[0_4px_12px_rgba(192,138,37,.35)]'
                    : 'text-white/65 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <Icon className="size-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-3 border-t border-white/10 px-2 pt-4 text-center font-serif text-xs text-gold-light/85 italic">
          “Find your space. Build your future.”
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-15 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 sm:px-6">
          <button type="button" className="rounded-lg p-1.5 text-ink lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu className="size-6" />
          </button>
          {can('leads') && <GlobalSearch />}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">
          <Outlet />
        </main>

        {/* bottom tabs for field staff on phones */}
        {tabs.length > 1 && (
          <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick navigation">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold', isActive ? 'text-gold-dark' : 'text-ink-faint')
                }
              >
                <Icon className="size-5" />
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}

function GlobalSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (q.trim()) navigate(`/leads?q=${encodeURIComponent(q.trim())}`)
    setQ('')
  }
  return (
    <form onSubmit={submit} className="hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-ink-faint sm:flex">
      <Search className="size-4" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        placeholder="Search leads by name, or a full mobile number…"
        aria-label="Search leads"
      />
    </form>
  )
}

function UserMenu() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!me) return null
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-col"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid size-8 place-items-center rounded-full bg-navy text-xs font-bold text-gold-light">{initials(me.full_name)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-semibold text-ink">{me.full_name}</span>
          <span className="block text-[11px] text-ink-faint">{me.role_label}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-xl">
          <MenuItem icon={KeyRound} label="Change password" onClick={() => navigate('/account/password')} />
          <MenuItem icon={MonitorSmartphone} label="Log out all devices" onClick={() => void logout(true)} />
          <MenuItem icon={LogOut} label="Log out" onClick={() => void logout()} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick }: { icon: typeof Bell; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-col">
      <Icon className="size-4 text-ink-dim" />
      {label}
    </button>
  )
}
