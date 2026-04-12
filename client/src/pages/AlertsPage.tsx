import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Clock, AlertTriangle, CheckCheck, Check, Eye, BellOff, Loader2,
  UserPlus, TrendingDown, CalendarX, Activity, FileWarning, UserCheck, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { alertsApi, reassignApi, profilesApi } from '../services/api'
import { useAlertCount } from '../hooks/useAlertCount'
import { useAuth } from '../context/AuthContext'
import { cn } from '../utils/cn'
import type { Alert, FunnelStage, User } from '../types'

// ─── Stage badge ──────────────────────────────────────────────────────────────

const STAGE_SHORT: Record<FunnelStage, string> = {
  SIN_CONTACTO:         'Sin Contacto',
  CONTACTO_FALLIDO:     'C. Fallido',
  CONTACTO_EFECTIVO:    'C. Efectivo',
  EN_GESTION:           'En Gestión',
  PROPUESTA_ENVIADA:    'Prop. Enviada',
  ESPERANDO_DOCUMENTOS: 'Esp. Docs',
  EN_FIRMA:             'En Firma',
  OB:                   'OB',
  OK_R2S:               'OK R2S',
  VENTA:                'Venta',
  DESCARTADO:           'Descartado',
}

function stageBadgeClass(stage: FunnelStage): string {
  if (stage === 'OK_R2S')            return 'bg-success/10 text-success'
  if (stage === 'VENTA')             return 'bg-success/10 text-success'
  if (stage === 'OB')                return 'bg-primary/10 text-primary'
  if (stage === 'CONTACTO_EFECTIVO') return 'bg-info/10 text-info'
  if (stage === 'CONTACTO_FALLIDO')  return 'bg-warning/10 text-warning'
  if (stage === 'SIN_CONTACTO')      return 'bg-gray-100 text-gray-500'
  if (stage === 'ESPERANDO_DOCUMENTOS')
    return 'bg-yellow-50 text-yellow-700'
  if (stage === 'DESCARTADO') return 'bg-danger/10 text-danger'
  return 'bg-gray-100 text-gray-500'
}

function StageBadge({ stage }: { stage: FunnelStage }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
      stageBadgeClass(stage),
    )}>
      {STAGE_SHORT[stage]}
    </span>
  )
}

// ─── Alert icon ───────────────────────────────────────────────────────────────

function AlertTypeIcon({ type, unread }: { type: Alert['type']; unread: boolean }) {
  const base = cn(
    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
    !unread && 'opacity-50',
  )
  if (type === 'LEAD_ASIGNADO') {
    return (
      <div className={cn(base, 'bg-info/10')}>
        <UserPlus size={20} className="text-info" />
      </div>
    )
  }
  if (type === 'NO_CONTACT_24H') {
    return (
      <div className={cn(base, 'bg-warning/10')}>
        <Clock size={20} className="text-warning" />
      </div>
    )
  }
  if (type === 'SIN_CONTACTO_48H') {
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <AlertTriangle size={20} className="text-danger" />
      </div>
    )
  }
  if (type === 'BAJA_CONVERSION') {
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <TrendingDown size={20} className="text-danger" />
      </div>
    )
  }
  if (type === 'SIN_PROXIMO_CONTACTO_3D') {
    return (
      <div className={cn(base, 'bg-warning/10')}>
        <CalendarX size={20} className="text-warning" />
      </div>
    )
  }
  if (type === 'SIN_AVANCE_5D') {
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <Activity size={20} className="text-danger" />
      </div>
    )
  }
  if (type === 'ESPERANDO_DOCS_7D') {
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <FileWarning size={20} className="text-danger" />
      </div>
    )
  }
  return (
    <div className={cn(base, 'bg-warning/10')}>
      <AlertTriangle size={20} className="text-warning" />
    </div>
  )
}

// ─── Quick reassign modal ─────────────────────────────────────────────────────

const REASSIGNABLE_TYPES: Alert['type'][] = [
  'SIN_PROXIMO_CONTACTO_3D', 'SIN_AVANCE_5D', 'ESPERANDO_DOCS_7D',
]

function QuickReassignModal({
  alert,
  onClose,
}: {
  alert:   Alert
  onClose: () => void
}) {
  const queryClient          = useQueryClient()
  const { user }             = useAuth()
  const [toUserId, setToUserId] = useState('')
  const [reason, setReason]     = useState('')

  const { data: hunters = [], isLoading: loadingHunters } = useQuery<User[]>({
    queryKey: ['hunters-for-reassign', user?.id],
    queryFn:  () => profilesApi.getHunters({ leaderId: user?.role === 'LIDER' ? user.id : undefined }),
  })

  const mutation = useMutation({
    mutationFn: () => reassignApi.reassignLead(alert.leadId, toUserId, reason || undefined),
    onSuccess: () => {
      toast.success('Lead reasignado correctamente')
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      onClose()
    },
    onError: () => toast.error('Error al reasignar el lead'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <UserCheck size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Reasignar lead</h3>
              {alert.lead?.name && (
                <p className="text-sm text-gray-400 truncate max-w-[240px]">{alert.lead.name}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Hunter picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Asignar a
          </label>
          {loadingHunters ? (
            <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <select
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
            >
              <option value="">Seleccionar hunter...</option>
              {hunters.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.fullName} — {h.country}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Reason */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Motivo <span className="text-gray-400 normal-case font-normal">(opcional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ej: Sin actividad por 5 días, se reasigna para mantener momentum..."
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!toUserId || mutation.isPending}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Reasignar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onMarkRead,
  isMarking,
  onReassign,
}: {
  alert:       Alert
  onMarkRead:  (id: string) => void
  isMarking:   boolean
  onReassign?: (alert: Alert) => void
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const unread   = !alert.isRead
  const canReassign = onReassign
    && REASSIGNABLE_TYPES.includes(alert.type)
    && (user?.role === 'LIDER' || user?.role === 'ADMIN')

  return (
    <div
      className={cn(
        'relative flex items-start gap-4 p-4 rounded-2xl border transition-all',
        unread
          ? 'bg-[#FFF5F3] border-primary/20'
          : 'bg-white border-gray-medium opacity-60 hover:opacity-100',
      )}
      style={unread ? { borderLeft: '3px solid #FF441F' } : undefined}
    >
      <AlertTypeIcon type={alert.type} unread={unread} />

      {/* Center */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className={cn(
          'text-sm leading-snug',
          unread ? 'font-medium text-dark' : 'text-gray-500',
        )}>
          {alert.message}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(parseISO(alert.triggeredAt), { addSuffix: true, locale: es })}
          </span>
          {alert.lead?.name && (
            <>
              <span className="text-gray-300 select-none">·</span>
              <span
                className="text-xs text-gray-500 truncate max-w-[180px]"
                title={alert.lead.name}
              >
                {alert.lead.name}
              </span>
            </>
          )}
          {alert.lead?.currentStage && (
            <>
              <span className="text-gray-300 select-none">·</span>
              <StageBadge stage={alert.lead.currentStage as FunnelStage} />
            </>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        {canReassign && (
          <button
            onClick={() => onReassign!(alert)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary/30 text-primary hover:bg-primary hover:text-white transition-colors whitespace-nowrap"
          >
            <UserCheck size={13} />
            Reasignar
          </button>
        )}
        {alert.lead?.id && (
          <button
            onClick={() => navigate(`/leads/${alert.lead!.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-medium text-gray-500 hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
          >
            <Eye size={13} />
            Ver lead
          </button>
        )}

        {unread && (
          <button
            onClick={() => onMarkRead(alert.id)}
            disabled={isMarking}
            title="Marcar como leída"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-medium text-gray-400 hover:border-success hover:text-success transition-colors disabled:opacity-40"
          >
            {isMarking
              ? <Loader2 size={14} className="animate-spin" />
              : <Check size={14} />
            }
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AlertSkeleton() {
  return (
    <div className="flex items-start gap-4 p-4 rounded-2xl border border-gray-medium bg-white animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-gray-200 shrink-0" />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="h-4 bg-gray-200 rounded-lg w-3/4" />
        <div className="h-3 bg-gray-100 rounded-lg w-1/3" />
      </div>
      <div className="w-20 h-8 bg-gray-100 rounded-lg shrink-0" />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <BellOff size={28} className="text-gray-300" />
      </div>
      <div>
        <p className="text-base font-semibold text-dark">No tienes alertas pendientes</p>
        <p className="text-sm text-gray-400 mt-1">
          Las alertas aparecerán aquí cuando haya leads inbound sin contactar o estancados.
        </p>
      </div>
    </div>
  )
}

// ─── AlertsPage ───────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const queryClient = useQueryClient()
  const [markingId, setMarkingId]         = useState<string | null>(null)
  const [reassignAlert, setReassignAlert] = useState<Alert | null>(null)

  const {
    data: alerts = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn:  () => alertsApi.getAlerts(100),
    refetchInterval: 60_000,
  })

  const unreadCount = useAlertCount()

  const markOneMutation = useMutation({
    mutationFn: (id: string) => alertsApi.markAsRead(id),
    onMutate:   (id) => setMarkingId(id),
    onSettled:  () => setMarkingId(null),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['alerts', 'count'] })
    },
    onError: () => toast.error('No se pudo marcar como leída'),
  })

  const markAllMutation = useMutation({
    mutationFn: alertsApi.markAllAsRead,
    onSuccess:  () => {
      toast.success('Todas las alertas marcadas como leídas')
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['alerts', 'count'] })
    },
    onError: () => toast.error('Error al marcar todas las alertas'),
  })

  const allAlerts = useMemo(() => alerts, [alerts])
  const unread    = useMemo(() => allAlerts.filter((a) => !a.isRead), [allAlerts])
  const read      = useMemo(() => allAlerts.filter((a) =>  a.isRead), [allAlerts])

  const handleMarkOne  = (id: string) => markOneMutation.mutate(id)
  const handleMarkAll  = () => markAllMutation.mutate()
  const handleReassign = (alert: Alert) => setReassignAlert(alert)

  const isEmpty = !isLoading && !isError && allAlerts.length === 0

  return (
    <>
    {reassignAlert && (
      <QuickReassignModal
        alert={reassignAlert}
        onClose={() => setReassignAlert(null)}
      />
    )}
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">
            Alertas Inbound
            {unreadCount > 0 && (
              <span className="ml-2 text-base font-semibold text-primary">
                ({unreadCount} sin leer)
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Actualizadas automáticamente cada 60 segundos
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            disabled={markAllMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-medium text-sm font-semibold text-gray-500 hover:border-success hover:text-success transition-colors disabled:opacity-50"
          >
            {markAllMutation.isPending
              ? <Loader2 size={15} className="animate-spin" />
              : <CheckCheck size={15} />
            }
            Marcar todas como leídas
          </button>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <AlertSkeleton key={i} />)}
        </div>

      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center">
            <AlertTriangle size={26} className="text-danger" />
          </div>
          <div>
            <p className="text-base font-semibold text-dark">No se pudieron cargar las alertas</p>
            <p className="text-sm text-gray-400 mt-1">Revisa tu conexión e intenta de nuevo</p>
          </div>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
          >
            Reintentar
          </button>
        </div>

      ) : isEmpty ? (
        <EmptyState />

      ) : (
        <div className="space-y-8">

          {/* ── Unread section ──────────────────────────────────────────── */}
          {unread.length > 0 && (
            <section>
              <SectionLabel>Sin leer · {unread.length}</SectionLabel>
              <div className="space-y-3">
                {unread.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onMarkRead={handleMarkOne}
                    isMarking={markOneMutation.isPending && markingId === alert.id}
                    onReassign={handleReassign}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Divider ─────────────────────────────────────────────────── */}
          {unread.length > 0 && read.length > 0 && (
            <div className="flex items-center gap-4">
              <div className="flex-1 border-t border-gray-200" />
              <span className="text-xs text-gray-400 font-medium">Historial</span>
              <div className="flex-1 border-t border-gray-200" />
            </div>
          )}

          {/* ── Read section ────────────────────────────────────────────── */}
          {read.length > 0 && (
            <section>
              <SectionLabel>Leídas · {read.length}</SectionLabel>
              <div className="space-y-3">
                {read.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onMarkRead={handleMarkOne}
                    isMarking={false}
                  />
                ))}
              </div>
            </section>
          )}

          {allAlerts.length >= 100 && (
            <p className="text-center text-xs text-gray-400 pb-2">
              — Mostrando las últimas 100 alertas —
            </p>
          )}
        </div>
      )}
    </div>
    </>
  )
}
