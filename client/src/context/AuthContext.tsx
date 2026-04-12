import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { User } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthUser = Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'country'> & {
  leaderId?: string
}

interface AuthState {
  user:            AuthUser | null
  isAuthenticated: boolean
  isLoading:       boolean
  unauthorized:    boolean   // logged in with Google but no profile
}

interface AuthContextValue extends AuthState {
  loginWithGoogle: () => Promise<void>
  logout:          () => Promise<void>
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user:            null,
    isAuthenticated: false,
    isLoading:       true,
    unauthorized:    false,
  })

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, country, leader_id')
      .eq('id', userId)
      .single()

    if (data) {
      setState({
        user: {
          id:       data.id,
          email:    data.email,
          fullName: data.full_name,
          role:     data.role,
          country:  data.country,
          leaderId: data.leader_id ?? undefined,
        },
        isAuthenticated: true,
        isLoading:       false,
        unauthorized:    false,
      })
    } else {
      // Google auth OK pero no tiene perfil en la app — acceso denegado
      await supabase.auth.signOut()
      setState({ user: null, isAuthenticated: false, isLoading: false, unauthorized: true })
    }
  }, [])

  useEffect(() => {
    let initialLoadDone = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      initialLoadDone = true
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setState((s) => ({ ...s, isLoading: false }))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!initialLoadDone || event === 'INITIAL_SESSION') return
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setState((s) => ({ ...s, user: null, isAuthenticated: false, isLoading: false }))
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const loginWithGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    })
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setState({ user: null, isAuthenticated: false, isLoading: false, unauthorized: false })
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
