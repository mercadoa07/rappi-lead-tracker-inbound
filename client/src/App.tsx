import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'

// ─── Lazy pages ───────────────────────────────────────────────────────────────

const LoginPage         = lazy(() => import('./pages/LoginPage'))
const GestionPage       = lazy(() => import('./pages/GestionPage'))
const LeadsPage         = lazy(() => import('./pages/LeadsPage'))
const LeadDetailPage    = lazy(() => import('./pages/LeadDetailPage'))
const KanbanPage        = lazy(() => import('./pages/KanbanPage'))
const RankingPage       = lazy(() => import('./pages/RankingPage'))
const AlertsPage        = lazy(() => import('./pages/AlertsPage'))
const TeamDashboardPage = lazy(() => import('./pages/TeamDashboardPage'))
const HunterDetailPage  = lazy(() => import('./pages/HunterDetailPage'))
const AssignPage        = lazy(() => import('./pages/AssignPage'))
const ImportPage        = lazy(() => import('./pages/ImportPage'))
const UsersPage         = lazy(() => import('./pages/UsersPage'))
const FeedbackPage      = lazy(() => import('./pages/FeedbackPage'))
const AuthCallbackPage  = lazy(() => import('./pages/AuthCallbackPage'))

// ─── QueryClient ──────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:                1,
      staleTime:            30_000,
      refetchOnWindowFocus: false,
    },
  },
})

// ─── Loading bar ──────────────────────────────────────────────────────────────

function GlobalLoadingBar() {
  const isFetching = useIsFetching()
  if (!isFetching) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-primary/20 overflow-hidden">
      <div
        className="h-full bg-primary rounded-r-full animate-[loading_1.5s_ease-in-out_infinite]"
        style={{ width: '40%' }}
      />
    </div>
  )
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Cargando...</p>
      </div>
    </div>
  )
}

// ─── Protected route ──────────────────────────────────────────────────────────

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-light">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/gestion" replace />
  }

  return <>{children}</>
}

// ─── Routes ───────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { isAuthenticated, user } = useAuth()
  const defaultPath = (user?.role === 'HUNTER') ? '/leads' : '/gestion'

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public */}
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to={defaultPath} replace /> : <LoginPage />}
        />

        {/* Dashboard — solo LIDER / ADMIN */}
        <Route
          path="/gestion"
          element={
            <ProtectedRoute roles={['LIDER', 'ADMIN']}>
              <Layout><GestionPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Leads */}
        <Route
          path="/leads"
          element={
            <ProtectedRoute>
              <Layout><LeadsPage /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/leads/:id"
          element={
            <ProtectedRoute>
              <Layout><LeadDetailPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Pipeline */}
        <Route
          path="/pipeline"
          element={
            <ProtectedRoute>
              <Layout><KanbanPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Ranking */}
        <Route
          path="/ranking"
          element={
            <ProtectedRoute>
              <Layout><RankingPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Alertas */}
        <Route
          path="/alerts"
          element={
            <ProtectedRoute>
              <Layout><AlertsPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Equipo — LIDER/ADMIN */}
        <Route
          path="/team-dashboard"
          element={
            <ProtectedRoute roles={['LIDER', 'ADMIN']}>
              <Layout><TeamDashboardPage /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/hunters/:hunterId"
          element={
            <ProtectedRoute roles={['LIDER', 'ADMIN']}>
              <Layout><HunterDetailPage /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assign"
          element={
            <ProtectedRoute roles={['LIDER', 'ADMIN']}>
              <Layout><AssignPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Admin only */}
        <Route
          path="/admin/import"
          element={
            <ProtectedRoute roles={['ADMIN']}>
              <Layout><ImportPage /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={['ADMIN']}>
              <Layout><UsersPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Feedback */}
        <Route
          path="/feedback"
          element={
            <ProtectedRoute>
              <Layout><FeedbackPage /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Defaults */}
        <Route path="/" element={<Navigate to={defaultPath} replace />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Suspense>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <GlobalLoadingBar />
          <AppRoutes />
          <Toaster
            position="top-right"
            toastOptions={{
              style: { fontFamily: '"Plus Jakarta Sans", sans-serif' },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
