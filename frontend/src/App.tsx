import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { NAV } from './app/nav'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ToastProvider } from './components/Toast'
import { Loading, Spinner } from './components/ui'
import type { PermKey } from './lib/perms'
import { AttendancePage } from './pages/attendance/AttendancePage'
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { MfaPage } from './pages/auth/MfaPage'
import { BookingsPage } from './pages/bookings/BookingsPage'
import { ClientsPage } from './pages/clients/ClientsPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { EmployeesPage } from './pages/employees/EmployeesPage'
import { IncentivesPage } from './pages/incentives/IncentivesPage'
import { LeadsPage } from './pages/leads/LeadsPage'
import { NotAllowed } from './pages/Placeholders'
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { TasksPage } from './pages/tasks/TasksPage'
import { VisitsPage } from './pages/visits/VisitsPage'

// heavier pages (maps, charts) are loaded only when opened
const TrackingPage = lazy(() => import('./pages/tracking/TrackingPage').then((m) => ({ default: m.TrackingPage })))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 } },
})

const PAGES: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/leads': <LeadsPage />,
  '/projects': <ProjectsPage />,
  '/visits': <VisitsPage />,
  '/bookings': <BookingsPage />,
  '/clients': <ClientsPage />,
  '/tasks': <TasksPage />,
  '/attendance': <AttendancePage />,
  '/tracking': <TrackingPage />,
  '/employees': <EmployeesPage />,
  '/incentives': <IncentivesPage />,
  '/reports': <ReportsPage />,
  '/settings': <SettingsPage />,
}

function Guard({ perm, children }: { perm: PermKey; children: ReactNode }) {
  const { can } = useAuth()
  return can(perm) ? <Suspense fallback={<Loading />}>{children}</Suspense> : <NotAllowed />
}

function FullScreenSpinner() {
  return (
    <div className="grid h-full place-items-center bg-navy text-gold-light">
      <Spinner className="size-8" />
    </div>
  )
}

function Gate() {
  const { session, me, loading } = useAuth()

  if (loading) return <FullScreenSpinner />
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  if (!me) return <FullScreenSpinner />
  // Owner/Admin: authenticator-app code first (the DB grants nothing until it is verified).
  // mfa_ok also catches an old verified session after the number was changed.
  if (me.mfa_required && !me.mfa_ok) return <MfaPage />
  if (me.must_change_password) return <ChangePasswordPage />

  return (
    <Routes>
      <Route element={<AppShell />}>
        {NAV.map((n) => (
          <Route key={n.to} path={n.to === '/' ? undefined : n.to.slice(1)} index={n.to === '/'} element={<Guard perm={n.perm}>{PAGES[n.to]}</Guard>} />
        ))}
        <Route path="projects/:id" element={<Guard perm="projects"><ProjectDetailPage /></Guard>} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
