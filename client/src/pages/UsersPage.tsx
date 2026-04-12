import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Plus, Pencil, X, Check, Loader2, AlertCircle, Search,
  ToggleLeft, ToggleRight, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { profilesApi } from '../services/api'
import { cn } from '../utils/cn'
import { COUNTRIES, COUNTRY_FLAG } from '../utils/constants'
import type { User, Country, UserRole } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: UserRole[] = ['HUNTER', 'LIDER', 'ADMIN']

const ROLE_LABEL: Record<UserRole, string> = {
  HUNTER: 'Comercial',
  LIDER:  'Supervisor',
  ADMIN:  'Admin',
}

const ROLE_COLOR: Record<UserRole, string> = {
  HUNTER: 'bg-blue-100 text-blue-700',
  LIDER:  'bg-purple-100 text-purple-700',
  ADMIN:  'bg-rose-100 text-rose-700',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditFormState {
  fullName:    string
  role:        UserRole
  country:     Country
  dailyTarget: number
  leaderId:    string
  isActive:    boolean
}

interface CreateFormState {
  uuid:        string
  email:       string
  fullName:    string
  role:        UserRole
  country:     Country
  dailyTarget: number
  leaderId:    string
}

const DEFAULT_CREATE: CreateFormState = {
  uuid:        '',
  email:       '',
  fullName:    '',
  role:        'HUNTER',
  country:     'CO',
  dailyTarget: 4,
  leaderId:    '',
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAllProfiles() {
  return useQuery<User[]>({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { supabase } = await import('../lib/supabase')
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name')
      if (error) throw error
      const { mapProfile } = await import('../services/api')
      return (data ?? []).map(mapProfile)
    },
    staleTime: 30_000,
  })
}

function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof profilesApi.update>[1] }) =>
      profilesApi.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['profiles-all'] })
    },
  })
}

function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Parameters<typeof profilesApi.create>[0]) =>
      profilesApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['profiles-all'] })
    },
  })
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  user, leaders, onClose,
}: {
  user:    User
  leaders: User[]
  onClose: () => void
}) {
  const [form, setForm] = useState<EditFormState>({
    fullName:    user.fullName,
    role:        user.role,
    country:     user.country,
    dailyTarget: user.dailyTarget,
    leaderId:    user.leaderId ?? '',
    isActive:    user.isActive,
  })
  const mutation = useUpdateProfile()

  const set = <K extends keyof EditFormState>(key: K, val: EditFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await mutation.mutateAsync({
        id:    user.id,
        patch: {
          fullName:    form.fullName    || undefined,
          role:        form.role,
          country:     form.country,
          dailyTarget: form.dailyTarget,
          leaderId:    form.leaderId    || undefined,
          isActive:    form.isActive,
        },
      })
      toast.success('Perfil actualizado correctamente')
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Error al actualizar perfil')
    }
  }

  const availableLeaders = leaders.filter((l) => l.role === 'LIDER' || l.role === 'ADMIN')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-dark flex items-center gap-2">
            <Pencil size={15} className="text-primary" />
            Editar usuario
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-dark hover:bg-gray-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Nombre */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Nombre completo
            </label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Rol */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Rol
            </label>
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value as UserRole)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {/* País */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              País
            </label>
            <select
              value={form.country}
              onChange={(e) => set('country', e.target.value as Country)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{COUNTRY_FLAG[c]} {c}</option>
              ))}
            </select>
          </div>

          {/* Meta diaria */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Meta diaria (R2S)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.dailyTarget}
              onChange={(e) => set('dailyTarget', Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Supervisor */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Supervisor (opcional)
            </label>
            <select
              value={form.leaderId}
              onChange={(e) => set('leaderId', e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Sin supervisor</option>
              {availableLeaders.map((l) => (
                <option key={l.id} value={l.id}>{l.fullName} ({l.country})</option>
              ))}
            </select>
          </div>

          {/* Activo */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-dark">Activo</span>
            <button
              type="button"
              onClick={() => set('isActive', !form.isActive)}
              className={cn(
                'flex items-center gap-1.5 text-sm font-semibold transition-colors',
                form.isActive ? 'text-success' : 'text-gray-400',
              )}
            >
              {form.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
              {form.isActive ? 'Activo' : 'Inactivo'}
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-medium text-sm font-semibold text-gray-500 hover:border-gray-400 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({
  leaders, onClose,
}: {
  leaders: User[]
  onClose: () => void
}) {
  const [form, setForm] = useState<CreateFormState>(DEFAULT_CREATE)
  const mutation = useCreateProfile()

  const set = <K extends keyof CreateFormState>(key: K, val: CreateFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.uuid.trim())     { toast.error('Ingresa el UUID del usuario de Supabase Auth'); return }
    if (!form.email.trim())    { toast.error('Ingresa el email del usuario'); return }
    if (!form.fullName.trim()) { toast.error('Ingresa el nombre completo'); return }
    try {
      await mutation.mutateAsync({
        id:          form.uuid.trim(),
        email:       form.email.trim(),
        fullName:    form.fullName.trim(),
        role:        form.role,
        country:     form.country,
        dailyTarget: form.dailyTarget,
        leaderId:    form.leaderId || undefined,
      })
      toast.success('Perfil creado correctamente')
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Error al crear perfil')
    }
  }

  const availableLeaders = leaders.filter((l) => l.role === 'LIDER' || l.role === 'ADMIN')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-bold text-dark flex items-center gap-2">
            <Plus size={15} className="text-primary" />
            Crear nuevo usuario
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-dark hover:bg-gray-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-start gap-2 shrink-0">
          <Info size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            El usuario debe existir en <strong>Supabase Auth</strong> antes de crear su perfil aquí.
            Crea el usuario en <strong>Supabase Dashboard → Authentication → Users</strong>,
            luego copia el UUID y pégalo abajo.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* UUID */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              UUID de Supabase Auth <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.uuid}
              onChange={(e) => set('uuid', e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Email */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Email <span className="text-danger">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="usuario@rappi.com"
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Nombre */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Nombre completo <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              placeholder="Juan Pérez"
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Rol */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Rol
            </label>
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value as UserRole)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {/* País */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              País
            </label>
            <select
              value={form.country}
              onChange={(e) => set('country', e.target.value as Country)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{COUNTRY_FLAG[c]} {c}</option>
              ))}
            </select>
          </div>

          {/* Meta diaria */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Meta diaria (R2S)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.dailyTarget}
              onChange={(e) => set('dailyTarget', Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>

          {/* Supervisor */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
              Supervisor (opcional)
            </label>
            <select
              value={form.leaderId}
              onChange={(e) => set('leaderId', e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Sin supervisor</option>
              {availableLeaders.map((l) => (
                <option key={l.id} value={l.id}>{l.fullName} ({l.country})</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-medium text-sm font-semibold text-gray-500 hover:border-gray-400 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crear usuario
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── UsersPage ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const { data: allUsers = [], isLoading, error } = useAllProfiles()
  const updateMutation = useUpdateProfile()

  const [search,        setSearch]        = useState('')
  const [roleFilter,    setRoleFilter]    = useState<UserRole | ''>('')
  const [countryFilter, setCountryFilter] = useState<Country | ''>('')
  const [editingUser,   setEditingUser]   = useState<User | null>(null)
  const [showCreate,    setShowCreate]    = useState(false)

  const isAdmin = currentUser?.role === 'ADMIN'

  const filtered = allUsers.filter((u) => {
    if (roleFilter    && u.role    !== roleFilter)    return false
    if (countryFilter && u.country !== countryFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!u.fullName.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
    }
    return true
  })

  const toggleActive = async (u: User) => {
    try {
      await updateMutation.mutateAsync({ id: u.id, patch: { isActive: !u.isActive } })
      toast.success(u.isActive ? `${u.fullName} desactivado` : `${u.fullName} activado`)
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Error al actualizar')
    }
  }

  const leaderMap = Object.fromEntries(allUsers.map((u) => [u.id, u.fullName]))

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-start gap-3 p-5 rounded-2xl bg-danger/5 border border-danger/20">
          <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-danger">Acceso restringido</p>
            <p className="text-sm text-gray-600 mt-0.5">Solo los administradores pueden gestionar usuarios.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-dark flex items-center gap-2">
            <Users size={22} className="text-primary" />
            Gestión de Usuarios
            <span className="text-base font-semibold text-gray-400">
              ({filtered.length}{filtered.length !== allUsers.length ? ` de ${allUsers.length}` : ''})
            </span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Administra perfiles, roles y metas del equipo Inbound
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          <Plus size={16} />
          Crear usuario
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-gray-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-dark"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Todos los roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>

        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value as Country | '')}
          className="h-9 px-3 rounded-xl border border-gray-medium text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Todos los países</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>{COUNTRY_FLAG[c]} {c}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger/5 border border-danger/20">
          <AlertCircle size={18} className="text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-danger">{(error as Error)?.message ?? 'Error al cargar usuarios'}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-medium shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Nombre</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Email</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Rol</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">País</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Meta</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Supervisor</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Activo</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100 animate-pulse">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-gray-200 rounded w-full" />
                      </td>
                    ))}
                  </tr>
                ))
                : filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">
                      No se encontraron usuarios
                    </td>
                  </tr>
                )
                : filtered.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'border-b border-gray-100 hover:bg-gray-50 transition-colors',
                      !u.isActive && 'opacity-60',
                    )}
                  >
                    <td className="px-4 py-3 font-semibold text-dark">{u.fullName}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold', ROLE_COLOR[u.role])}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{COUNTRY_FLAG[u.country]} {u.country}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 font-mono">{u.dailyTarget}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[130px] truncate">
                      {u.leaderId ? (leaderMap[u.leaderId] ?? '—') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={updateMutation.isPending}
                        title={u.isActive ? 'Desactivar' : 'Activar'}
                        className={cn(
                          'transition-colors disabled:opacity-40',
                          u.isActive ? 'text-success hover:text-success/70' : 'text-gray-300 hover:text-gray-500',
                        )}
                      >
                        {u.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditingUser(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 border border-gray-medium hover:border-primary hover:text-primary transition-colors"
                      >
                        <Pencil size={12} />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <EditModal
          user={editingUser}
          leaders={allUsers}
          onClose={() => setEditingUser(null)}
        />
      )}

      {showCreate && (
        <CreateModal
          leaders={allUsers}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}
