import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { differenceInDays, parseISO, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, stageApi } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { cn } from '../utils/cn'
import { STAGE_LABEL, STAGE_COLORS, STAGE_TRANSITIONS } from '../utils/constants'
import type { Lead, FunnelStage, LeadSource } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

// Etapas que se muestran como columnas en el Kanban
// SIN_CONTACTO y OK_R2S se muestran como contadores, no como columnas
const ACTIVE_STAGES: FunnelStage[] = [
  'CONTACTO_FALLIDO',
  'CONTACTO_EFECTIVO',
  'EN_GESTION',
  'PROPUESTA_ENVIADA',
  'ESPERANDO_DOCUMENTOS',
  'EN_FIRMA',
  'OB',
]

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmBlockedDialog({
  fromStage,
  toStage,
  onConfirm,
  onCancel,
}: {
  fromStage: FunnelStage
  toStage:   FunnelStage
  onConfirm: () => void
  onCancel:  () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Confirmar descarte?</h3>
            <p className="text-sm text-gray-400 mt-1">
              Moverás el lead de <span className="font-semibold text-gray-900">{STAGE_LABEL[fromStage]}</span> a{' '}
              <span className="font-semibold text-red-600">{STAGE_LABEL[toStage]}</span>.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 h-10 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Source badge (mini) ──────────────────────────────────────────────────────

function MiniSourceBadge({ source }: { source: LeadSource }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-bold px-1.5 py-0.5 text-[9px] border',
      source === 'SDR'
        ? 'bg-blue-50 text-blue-600 border-blue-200'
        : 'bg-purple-50 text-purple-600 border-purple-200',
    )}>
      {source}
    </span>
  )
}

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({ lead, isDragging = false }: { lead: Lead; isDragging?: boolean }) {
  const navigate    = useNavigate()
  const daysInStage = differenceInDays(new Date(), parseISO(lead.stageChangedAt))
  const stale       = daysInStage > 2

  return (
    <div
      onClick={() => !isDragging && navigate(`/leads/${lead.id}`)}
      className={cn(
        'bg-white rounded-xl border border-gray-200 p-3 cursor-pointer shadow-sm',
        'hover:shadow-md hover:border-gray-300 transition-all duration-150 select-none',
        isDragging && 'opacity-90 shadow-xl rotate-1 scale-105',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="font-semibold text-sm text-gray-900 leading-tight truncate">{lead.name}</p>
        <MiniSourceBadge source={lead.source} />
      </div>
      <p className="text-[11px] text-gray-400 font-mono mt-0.5">{lead.leadIdExternal}</p>

      <div className="flex items-center justify-between mt-2 gap-2">
        {lead.opsZone ? (
          <span className="text-[11px] text-gray-500 truncate">{lead.opsZone}</span>
        ) : (
          <span className="text-[11px] text-gray-300 truncate italic">—</span>
        )}
        {stale && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
            {daysInStage}d
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-1.5 gap-1">
        <p className="text-[11px] text-gray-400">
          {formatDistanceToNow(parseISO(lead.stageChangedAt), { addSuffix: true, locale: es })}
        </p>
        <span className="text-[10px] text-gray-300">
          {lead.country}
        </span>
      </div>
    </div>
  )
}

// ─── Draggable card ───────────────────────────────────────────────────────────

function DraggableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <LeadCard lead={lead} isDragging={isDragging} />
    </div>
  )
}

// ─── Kanban column (desktop) ──────────────────────────────────────────────────

function KanbanColumn({
  stage,
  leads,
  isOver,
  canDrop,
}: {
  stage:   FunnelStage
  leads:   Lead[]
  isOver:  boolean
  canDrop: boolean
}) {
  const { setNodeRef } = useDroppable({ id: stage })
  const colors = STAGE_COLORS[stage]

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-2xl border-2 transition-all duration-150 min-h-[200px] w-[220px] shrink-0',
        isOver && canDrop  && 'border-blue-500 bg-blue-50/50 shadow-lg shadow-blue-100',
        isOver && !canDrop && 'border-red-400 bg-red-50/50',
        !isOver            && `${colors.border} bg-white/60`,
      )}
    >
      {/* Header */}
      <div className={cn('flex items-center justify-between px-3 py-2.5 rounded-t-xl', colors.header)}>
        <span className={cn('text-xs font-bold truncate', colors.text)}>
          {STAGE_LABEL[stage]}
        </span>
        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/70', colors.text)}>
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-gray-300 italic">
            Sin leads
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Mobile accordion column ──────────────────────────────────────────────────

function MobileColumn({ stage, leads }: { stage: FunnelStage; leads: Lead[] }) {
  const [open, setOpen] = useState(stage === 'SIN_CONTACTO')
  const colors  = STAGE_COLORS[stage]
  const navigate = useNavigate()

  return (
    <div className={cn('rounded-xl border', colors.border)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn('w-full flex items-center justify-between px-4 py-3 rounded-t-xl', colors.header)}
      >
        <span className={cn('text-sm font-bold', colors.text)}>{STAGE_LABEL[stage]}</span>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full bg-white/70', colors.text)}>
            {leads.length}
          </span>
          {open
            ? <ChevronUp size={14} className={colors.text} />
            : <ChevronDown size={14} className={colors.text} />
          }
        </div>
      </button>

      {open && (
        <div className="p-3 space-y-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="font-semibold text-sm text-gray-900 truncate">{lead.name}</p>
                <MiniSourceBadge source={lead.source} />
              </div>
              <p className="text-[11px] text-gray-400 font-mono">{lead.leadIdExternal}</p>
              <div className="flex items-center justify-between mt-1.5">
                {lead.opsZone && (
                  <span className="text-[11px] text-gray-500">{lead.opsZone}</span>
                )}
                <span className="text-[11px] text-gray-400 ml-auto">
                  {formatDistanceToNow(parseISO(lead.stageChangedAt), { addSuffix: true, locale: es })}
                </span>
              </div>
            </div>
          ))}
          {leads.length === 0 && (
            <p className="text-xs text-gray-400 italic text-center py-3">Sin leads</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── KanbanPage ───────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const { user }    = useAuth()
  const queryClient = useQueryClient()

  // Filters
  const [source,   setSource]   = useState<LeadSource | 'ALL'>('ALL')
  const [search,   setSearch]   = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  // Pending blocked confirm dialog
  const [pendingMove, setPendingMove] = useState<{
    leadId:    string
    fromStage: FunnelStage
    toStage:   FunnelStage
  } | null>(null)

  // For drag-over visual feedback
  const [overStage, setOverStage] = useState<FunnelStage | null>(null)

  // ── Fetch leads ──────────────────────────────────────────────────────────────
  const { data: kanbanData, isLoading } = useQuery({
    queryKey: ['leads-kanban', source, search],
    queryFn:  () =>
      leadsApi.getLeads({
        search:  search || undefined,
        source:  source !== 'ALL' ? source : undefined,
        stage:   ['CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO', 'EN_GESTION',
                  'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB',
                  'OK_R2S', 'DESCARTADO'],
        page:    1,
        limit:   10000,
      }),
    select: (res) => res.data,
  })

  const allLeads: Lead[] = kanbanData ?? []

  // ── Group by stage ───────────────────────────────────────────────────────────
  const byStage = useMemo(() => {
    const map: Record<FunnelStage, Lead[]> = {} as Record<FunnelStage, Lead[]>
    for (const s of [...ACTIVE_STAGES, 'OK_R2S' as FunnelStage, 'DESCARTADO' as FunnelStage]) map[s] = []
    for (const lead of allLeads) {
      if (map[lead.currentStage]) map[lead.currentStage].push(lead)
    }
    return map
  }, [allLeads])

  const descartadoCount = useMemo(() => byStage['DESCARTADO']?.length ?? 0, [byStage])
  const r2sCount        = useMemo(() => byStage['OK_R2S']?.length ?? 0,     [byStage])
  const blockedCount    = descartadoCount

  // ── Active drag lead ─────────────────────────────────────────────────────────
  const activeLead = activeId ? allLeads.find((l) => l.id === activeId) ?? null : null

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    setOverStage(event.over ? (event.over.id as FunnelStage) : null)
  }

  const stageMutation = useMutation({
    mutationFn: ({ leadId, toStage }: { leadId: string; toStage: FunnelStage }) =>
      stageApi.transitionStage(leadId, toStage),
    onSuccess: (_data, { toStage }) => {
      toast.success(`Movido a ${STAGE_LABEL[toStage]}`)
      queryClient.invalidateQueries({ queryKey: ['leads-kanban'] })
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message ?? 'Error al cambiar etapa'
      toast.error(msg)
    },
  })

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    setOverStage(null)
    if (!over || active.id === over.id) return

    const lead    = allLeads.find((l) => l.id === active.id)
    const toStage = over.id as FunnelStage

    if (!lead || lead.currentStage === toStage) return

    const allowed = STAGE_TRANSITIONS[lead.currentStage] ?? []
    if (!allowed.includes(toStage)) {
      toast.error(`Transición no permitida: ${STAGE_LABEL[lead.currentStage]} → ${STAGE_LABEL[toStage]}`)
      return
    }

    // DESCARTADO needs confirmation
    if (toStage === 'DESCARTADO') {
      setPendingMove({ leadId: lead.id, fromStage: lead.currentStage, toStage })
      return
    }

    stageMutation.mutate({ leadId: lead.id, toStage })
  }

  // ── Can drop check ───────────────────────────────────────────────────────────
  const canDropOnOver = useMemo(() => {
    if (!activeLead || !overStage) return false
    const allowed = STAGE_TRANSITIONS[activeLead.currentStage] ?? []
    return allowed.includes(overStage)
  }, [activeLead, overStage])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Pipeline Kanban</h1>
          <p className="text-sm text-gray-400">{allLeads.length} leads activos</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">

          {/* Source toggle — SDR / SOB / Todos */}
          <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden bg-white">
            {(['ALL', 'SDR', 'SOB'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={cn(
                  'px-3 h-9 text-sm font-semibold transition-colors',
                  source === s
                    ? s === 'SDR'
                      ? 'bg-blue-600 text-white'
                      : s === 'SOB'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-50',
                )}
              >
                {s === 'ALL' ? 'Todos' : s}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Buscar restaurante..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 w-48"
          />

          {search && (
            <button
              onClick={() => setSearch('')}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* ── Desktop: horizontal scroll kanban ──────────────────────────── */}
          <div className="hidden md:flex flex-1 overflow-x-auto pb-4 gap-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              {ACTIVE_STAGES.map((stage) => (
                <KanbanColumn
                  key={stage}
                  stage={stage}
                  leads={byStage[stage] ?? []}
                  isOver={overStage === stage}
                  canDrop={canDropOnOver}
                />
              ))}

              <DragOverlay>
                {activeLead && <LeadCard lead={activeLead} isDragging />}
              </DragOverlay>
            </DndContext>
          </div>

          {/* ── Mobile: vertical accordions ─────────────────────────────────── */}
          <div className="md:hidden flex-1 overflow-y-auto space-y-2 pb-4">
            {ACTIVE_STAGES.map((stage) => (
              <MobileColumn
                key={stage}
                stage={stage}
                leads={byStage[stage] ?? []}
              />
            ))}
          </div>

          {/* Counters for non-column stages */}
          {(r2sCount > 0 || descartadoCount > 0) && (
            <div className="shrink-0 mt-3 flex items-center gap-3 flex-wrap border-t border-gray-100 pt-3">
              {r2sCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-semibold">
                  ✓ {r2sCount} OK R2S
                </span>
              )}
              {descartadoCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-600 text-xs font-semibold">
                  <AlertTriangle size={12} />
                  {descartadoCount} descartado{descartadoCount !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-xs text-gray-400">
                (no se muestran como columnas — ver desde lista de leads)
              </span>
            </div>
          )}
        </>
      )}

      {/* Confirm blocked move dialog */}
      {pendingMove && (
        <ConfirmBlockedDialog
          fromStage={pendingMove.fromStage}
          toStage={pendingMove.toStage}
          onConfirm={() => {
            stageMutation.mutate({ leadId: pendingMove.leadId, toStage: pendingMove.toStage })
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </div>
  )
}
