import { useState, useEffect, useCallback } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Users, Bell, BarChart3, Upload, LogOut, Menu, X,
  ChevronLeft, ChevronRight, Search, Columns3, Trophy,
  UserCheck, MessageSquarePlus, TrendingUp, UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useAlertCount } from '../hooks/useAlertCount'
import { cn } from '../utils/cn'
import { COUNTRY_FLAG } from '../utils/constants'

// ─── Page titles ──────────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  '/gestion':        'Gestión',
  '/leads':          'Mis Leads',
  '/pipeline':       'Pipeline',
  '/ranking':        'Ranking',
  '/alerts':         'Alertas',
  '/team-dashboard': 'Mi Equipo',
  '/assign':         'Asignar Leads',
  '/admin/import':   'Importar Leads',
  '/admin/users':    'Gestión de Usuarios',
  '/feedback':       'Sugerencias',
}

function usePageTitle() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/leads/'))   return 'Detalle de Lead'
  if (pathname.startsWith('/hunters/')) return 'Detalle Hunter'
  return PAGE_TITLES[pathname] ?? 'Rappi Lead Tracker'
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

interface NavItem {
  to:       string
  label:    string
  Icon:     React.ElementType
  badge?:   number
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div
      className="rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}

// ─── Sidebar item ─────────────────────────────────────────────────────────────

function SidebarItem({
  item, collapsed, onClick,
}: {
  item:      NavItem
  collapsed: boolean
  onClick?:  () => void
}) {
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-xl transition-all duration-150 group',
          collapsed ? 'justify-center px-0 py-3' : 'px-3 py-2.5',
          isActive
            ? 'bg-white/10 text-primary'
            : 'text-[#A0A0B0] hover:bg-white/5 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 inset-y-1 w-[3px] rounded-r-full bg-primary" />
          )}

          <item.Icon
            size={20}
            className={cn('shrink-0', isActive ? 'text-primary' : '')}
          />

          {!collapsed && (
            <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
          )}

          {item.badge != null && item.badge > 0 && (
            <span
              className={cn(
                'flex items-center justify-center rounded-full bg-danger text-white font-bold text-[10px] leading-none shrink-0',
                collapsed ? 'absolute top-1.5 right-1.5 w-4 h-4' : 'w-5 h-5',
              )}
            >
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}

          {collapsed && (
            <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-dark border border-white/10 px-3 py-1.5 text-xs text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 z-50">
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-[10px]">
                  {item.badge}
                </span>
              )}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const alertCount       = useAlertCount()

  const navItems: NavItem[] = [
    ...(user?.role === 'LIDER' || user?.role === 'ADMIN'
      ? [{ to: '/gestion', label: 'Gestión', Icon: TrendingUp }]
      : []),
    { to: '/leads',    label: 'Mis Leads',   Icon: Users      },
    { to: '/pipeline', label: 'Pipeline',    Icon: Columns3   },
    { to: '/ranking',  label: 'Ranking',     Icon: Trophy     },
    { to: '/alerts',   label: 'Alertas',     Icon: Bell, badge: alertCount },
    ...(user?.role === 'LIDER' || user?.role === 'ADMIN'
      ? [
          { to: '/team-dashboard', label: 'Mi equipo',     Icon: BarChart3 },
          { to: '/assign',         label: 'Asignar Leads', Icon: UserCheck },
        ]
      : []),
    ...(user?.role === 'ADMIN'
      ? [
          { to: '/admin/import', label: 'Importar',  Icon: Upload   },
          { to: '/admin/users',  label: 'Usuarios',  Icon: UserCog  },
        ]
      : []),
    { to: '/feedback', label: 'Sugerencias', Icon: MessageSquarePlus },
  ]

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      toast.error('Error al cerrar sesión')
    }
  }

  const sidebarWidth = collapsed ? 72 : 260

  return (
    <aside
      className="flex flex-col h-full bg-dark transition-all duration-300 ease-in-out overflow-hidden hidden md:flex"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center h-16 shrink-0 border-b border-white/10',
          collapsed ? 'justify-center px-0' : 'justify-between px-5',
        )}
      >
        {!collapsed && (
          <div className="flex flex-col leading-none">
            <span className="text-primary font-black text-2xl tracking-tight">rappi</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/30 uppercase tracking-widest">Lead Tracker</span>
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-info/20 text-info tracking-wide">
                INBOUND
              </span>
              {user?.role && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary tracking-wide">
                  {user.role}
                </span>
              )}
            </div>
          </div>
        )}

        <button
          onClick={onToggle}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition-colors shrink-0"
          title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Nav */}
      <nav
        className={cn(
          'flex-1 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden',
          collapsed ? 'px-2' : 'px-3',
        )}
      >
        {navItems.map((item) => (
          <SidebarItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* User footer */}
      <div
        className={cn(
          'shrink-0 border-t border-white/10 py-4',
          collapsed ? 'px-2' : 'px-4',
        )}
      >
        {collapsed ? (
          <button
            onClick={handleLogout}
            className="w-full flex justify-center py-2 text-[#A0A0B0] hover:text-danger transition-colors"
            title="Cerrar sesión"
          >
            <LogOut size={18} />
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar name={user?.fullName ?? '?'} size={34} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate leading-tight">
                {user?.fullName}
              </p>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-white/40 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 text-white/30 hover:text-danger transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const alertCount       = useAlertCount()

  const navItems: NavItem[] = [
    ...(user?.role === 'LIDER' || user?.role === 'ADMIN'
      ? [{ to: '/gestion', label: 'Gestión', Icon: TrendingUp }]
      : []),
    { to: '/leads',    label: 'Mis Leads',   Icon: Users      },
    { to: '/pipeline', label: 'Pipeline',    Icon: Columns3   },
    { to: '/ranking',  label: 'Ranking',     Icon: Trophy     },
    { to: '/alerts',   label: 'Alertas',     Icon: Bell, badge: alertCount },
    ...(user?.role === 'LIDER' || user?.role === 'ADMIN'
      ? [
          { to: '/team-dashboard', label: 'Mi equipo',     Icon: BarChart3 },
          { to: '/assign',         label: 'Asignar Leads', Icon: UserCheck },
        ]
      : []),
    ...(user?.role === 'ADMIN'
      ? [
          { to: '/admin/import', label: 'Importar', Icon: Upload  },
          { to: '/admin/users',  label: 'Usuarios', Icon: UserCog },
        ]
      : []),
    { to: '/feedback', label: 'Sugerencias', Icon: MessageSquarePlus },
  ]

  const handleLogout = async () => {
    try { await logout(); navigate('/login', { replace: true }) }
    catch { toast.error('Error al cerrar sesión') }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-[260px] bg-dark z-50 flex flex-col md:hidden',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between h-16 px-5 border-b border-white/10 shrink-0">
          <div className="flex flex-col leading-none">
            <span className="text-primary font-black text-2xl tracking-tight">rappi</span>
            <span className="text-[10px] text-white/30 uppercase tracking-widest">Lead Tracker Inbound</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <SidebarItem key={item.to} item={item} collapsed={false} onClick={onClose} />
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={user?.fullName ?? '?'} size={34} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate leading-tight">{user?.fullName}</p>
              <p className="text-xs text-white/40 truncate">{user?.email}</p>
            </div>
            <button onClick={handleLogout} className="shrink-0 text-white/30 hover:text-danger transition-colors" title="Cerrar sesión">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ onMobileMenuClick }: { onMobileMenuClick: () => void }) {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const pageTitle  = usePageTitle()
  const alertCount = useAlertCount()

  return (
    <header className="h-16 bg-white border-b border-gray-medium flex items-center justify-between px-4 md:px-6 shrink-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-light transition-colors shrink-0"
          onClick={onMobileMenuClick}
          aria-label="Abrir menú"
        >
          <Menu size={22} />
        </button>
        <h1 className="text-base md:text-lg font-semibold text-dark truncate">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => navigate('/alerts')}
          className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-light hover:text-dark transition-colors"
          aria-label={`${alertCount} alertas`}
        >
          <Bell size={20} />
          {alertCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {alertCount > 99 ? '99+' : alertCount}
            </span>
          )}
        </button>

        <div className="hidden sm:flex items-center gap-2">
          {user?.role && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {user.role}
            </span>
          )}
          {user?.country && (
            <span
              className="text-[11px] font-medium text-gray-500 bg-gray-light rounded-full px-2.5 py-1 border border-gray-medium"
              title={user.country}
            >
              {COUNTRY_FLAG[user.country] ?? ''} {user.country}
            </span>
          )}
          <span className="text-sm font-medium text-dark hidden md:block max-w-[120px] truncate">
            {user?.fullName}
          </span>
        </div>

        <div className="rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold select-none" style={{ width: 34, height: 34, fontSize: 12 }}>
          {(user?.fullName ?? '?').split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
        </div>
      </div>
    </header>
  )
}

// ─── Search placeholder (simplificado) ────────────────────────────────────────

// Esto es funcional con la barra de búsqueda del header. Se puede expandir con GlobalSearch.

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen,       setMobileOpen]       = useState(false)

  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), [])
  const closeMobile   = useCallback(() => setMobileOpen(false), [])
  const openMobile    = useCallback(() => setMobileOpen(true),  [])

  const { pathname } = useLocation()
  useEffect(() => { setMobileOpen(false) }, [pathname])

  return (
    <div className="flex h-screen bg-gray-light overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <MobileDrawer open={mobileOpen} onClose={closeMobile} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMobileMenuClick={openMobile} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
