import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowLeft, User, BarChart3, AlertTriangle, Loader2,
} from 'lucide-react'
import { profilesApi, leadsApi } from '../services/api'
import { cn } from '../utils/cn'
import { STAGE_LABEL, COUNTRY_FLAG } from '../utils/constants'
import type { Country, FunnelStage, LeadSource, Lead, User as UserType } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const FUNNEL_STAGES: FunnelStage[] = [
  'SIN_CONTACTO', 'CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO',
  'EN_GESTION', 'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS',
  'EN_FIRMA', 'OB', 'OK_R2S', 'DESCARTADO',
]

// ─── Source Toggle ────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'SDR' | 'SOB'

function SourceToggle({
  value, onChange,
}: {
  value: SourceFilter; onChange: (v: SourceFilter) => void
}) {
  return (
    <div className="flex bg-white rounded-xl border border-gray-200 p-1 gap-1">
      {(['all', 'SDR', 'SOB'] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            'px-3 py-1 rounded-lg text-xs font-semibold transition-all',
            value === s
              ? 'bg-primary text-white shadow-sm'
              : 'text-gray-500 hover:text-dark',
          )}
        >
          {s === 'all' ? 'Todos' : s}
        </button>
      ))}
    </div>
  )
}

// ─── StageBadge ───────────────────────────────────────────────────────────────

function stageBadgeClass(stage: FunnelStage): string {
  if (stage === 'OK_R2S')            return 'bg-success/10 text-success border-success/20'
  if (stage === 'VENTA')             return 'bg-success/10 text-success border-success/20'
  if (stage === 'PROPUESTA_ENVIADA') return 'bg-teal-50 text-teal-700 border-teal-200'
  if (stage === 'OB')                return 'bg-primary/10 text-primary border-primary/20'
  if (stage === 'CONTACTO_EFECTIVO') return 'bg-info/10 text-info border-info/20'
  if (stage === 'CONTACTO_FALLIDO')  return 'bg-warning/10 text-warning border-warning/20'
  if (stage === 'SIN_CONTACTO')      return 'bg-gray-100 text-gray-500 border-gray-200'
  if (stage === 'ESPERANDO_DOCUMENTOS')
    return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (stage === 'DESCARTADO')
    return 'bg-danger/10 text-danger border-danger/20'
  return 'bg-gray-100 text-gray-500 border-gray-200'
}

function StageBadge({ stage }: { stage: FunnelStage }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-semibold border px-2.5 py-1 text-xs',
      stageBadgeClass(stage),
    )}>
      {STAGE_LABEL[stage] ?? stage}
    </span>
  )
}

// ─── TYC Badge ────────────────────────────────────────────────────────────────

function TycBadge({ tyc }: { tyc?: string }) {
  if (!tyc) return <span className="text-gray-300 text-xs">—</span>
  const isYes = tyc === 'SI' || tyc.toUpperCase() === 'SI' || tyc === '1'
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
      isYes ? 'bg-success/10 text-success border-success/20' : 'bg-warning/10 text-warning border-warning/20',
    )}>
      {isYes ? 'SI' : 'NO'}
    </span>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  highlight,
}: {
  label:      string
  value:      string | number
  sub?:       string
  highlight?: 'success' | 'danger' | 'primary' | 'warning'
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-medium shadow-sm p-4">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={cn(
        'text-2xl font-extrabold tabular-nums mt-1',
        highlight === 'success' ? 'text-success' :
        highlight === 'danger'  ? 'text-danger'  :
        highlight === 'primary' ? 'text-primary'  :
        highlight === 'warning' ? 'text-warning'  :
        'text-dark',
      )}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── HunterDetailPage ─────────────────────────────────────────────────────────

export default function HunterDetailPage() {
  const { hunterId } = useParams<{ hunterId: string }>()
  const navigate     = useNavigate()
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  // Fetch hunter profile
  const { data: hunter, isLoading: hunterLoading, isError: hunterError } = useQuery<UserType>({
    queryKey: ['hunter-profile', hunterId],
    queryFn:  async () => {
      const hunters = await profilesApi.getAll()
      const found   = hunters.find((h) => h.id === hunterId)
      if (!found) throw new Error('Hunter no encontrado')
      return found
    },
    enabled: !!hunterId,
    staleTime: 60_000,
  })

  // Fetch leads for this hunter
  const sourceParam = sourceFilter === 'all' ? undefined : sourceFilter as LeadSource

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['hunter-leads', hunterId, sourceFilter],
    queryFn:  () => leadsApi.getLeads({
      page:    1,
      limit:   200,
      source:  sourceParam,
      sortBy:  'assignedAt',
      sortOrder: 'desc',
    }),
    enabled: !!hunterId,
    staleTime: 60_000,
    select: (data) => ({
      ...data,
      data: data.data.filter((l: Lead) => l.assignedToId === hunterId),
    }),
  })

  const leads: Lead[] = useMemo(
    () => leadsData?.data ?? [],
    [leadsData],
  )

  // Derived metrics
  const metrics = useMemo(() => {
    const total           = leads.length
    const obCount         = leads.filter((l) => l.currentStage === 'OB').length
    const r2sCount        = leads.filter((l) => l.currentStage === 'OK_R2S').length
    const productivity    = obCount + r2sCount
    const blockedCount    = leads.filter((l) => l.bloqueado).length
    const gestionados     = leads.filter((l) => l.tieneIntentoContacto).length
    const efectivos       = leads.filter((l) => l.tieneContactoEfectivo).length
    const conTyc          = leads.filter((l) => l.tyc === 'SI').length
    const sinTyc          = leads.filter((l) => l.tyc === 'NO' || (!l.tyc && l.source === 'SOB')).length

    const lastContact     = leads
      .filter((l) => l.ultimaFechaContacto)
      .sort((a, b) => new Date(b.ultimaFechaContacto!).getTime() - new Date(a.ultimaFechaContacto!).getTime())[0]
      ?.ultimaFechaContacto ?? null

    const byStage: Record<string, number> = {}
    for (const l of leads) {
      byStage[l.currentStage] = (byStage[l.currentStage] ?? 0) + 1
    }

    return { total, obCount, r2sCount, productivity, blockedCount, gestionados, efectivos, conTyc, sinTyc, lastContact, byStage }
  }, [leads])

  const isLoading = hunterLoading || leadsLoading
  const isError   = hunterError

  const showTyc = sourceFilter === 'SOB' || (sourceFilter === 'all' && hunter?.team === 'SOB')

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-60">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !hunter) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 h-80 text-center">
        <AlertTriangle size={40} className="text-warning" />
        <div>
          <p className="font-semibold text-dark">No se pudo cargar el hunter</p>
          <p className="text-sm text-gray-400 mt-1">No existe o no tienes permisos</p>
        </div>
        <button
          onClick={() => navigate('/team-dashboard')}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          Volver al equipo
        </button>
      </div>
    )
  }

  const lastContactLabel = metrics.lastContact
    ? formatDistanceToNow(parseISO(metrics.lastContact), { addSuffix: true, locale: es })
    : 'Sin contactos'

  const stagesWithData = FUNNEL_STAGES.filter((s) => (metrics.byStage[s] ?? 0) > 0)
  const maxStageCount  = Math.max(...stagesWithData.map((s) => metrics.byStage[s] ?? 0), 1)

  // Recent leads (last 10 from filtered list)
  const recentLeads = leads.slice(0, 10)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Back button ───────────────────────────────────────────────── */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-dark transition-colors"
      >
        <ArrowLeft size={14} />
        Volver
      </button>

      {/* ── Hunter header ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-medium shadow-sm px-6 py-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-lg shrink-0">
              <User size={22} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-dark leading-tight">{hunter.fullName}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{hunter.email}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {COUNTRY_FLAG[hunter.country] ?? ''} {hunter.country}
                </span>
                <span className={cn(
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  hunter.team === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
                )}>
                  {hunter.team}
                </span>
                <span className={cn(
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  hunter.isActive
                    ? 'bg-success/10 text-success'
                    : 'bg-gray-100 text-gray-400',
                )}>
                  {hunter.isActive ? 'Activo' : 'Inactivo'}
                </span>
                {hunter.dailyTarget > 0 && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    Meta diaria: {hunter.dailyTarget}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Source filter */}
          <SourceToggle value={sourceFilter} onChange={setSourceFilter} />
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Leads"
          value={metrics.total}
          sub={sourceFilter !== 'all' ? `Filtrado: ${sourceFilter}` : 'todos los fuentes'}
        />
        <SummaryCard
          label="Productividad"
          value={metrics.productivity}
          sub={`OB: ${metrics.obCount} · R2S: ${metrics.r2sCount}`}
          highlight="success"
        />
        <SummaryCard
          label="Gestionados"
          value={metrics.gestionados}
          sub={`${metrics.efectivos} contactos efectivos`}
          highlight="primary"
        />
        <SummaryCard
          label="Bloqueados"
          value={metrics.blockedCount}
          highlight="danger"
        />
      </div>

      {/* ── TYC metrics (shown when SOB or all with SOB team) ──────────── */}
      {showTyc && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Con TYC"
            value={metrics.conTyc}
            sub="términos aceptados"
            highlight="success"
          />
          <SummaryCard
            label="Sin TYC"
            value={metrics.sinTyc}
            sub="sin términos"
            highlight="warning"
          />
          <SummaryCard
            label="Efect. TYC"
            value={`${metrics.conTyc > 0 ? ((metrics.productivity / metrics.conTyc) * 100).toFixed(1) : '0.0'}%`}
            sub="(OB+R2S) / con TYC"
            highlight="primary"
          />
          <SummaryCard
            label="Último contacto"
            value={lastContactLabel}
            highlight="primary"
          />
        </div>
      )}

      {!showTyc && (
        <div className="grid grid-cols-2 gap-4 lg:hidden">
          <SummaryCard
            label="Último contacto"
            value={lastContactLabel}
            highlight="primary"
          />
        </div>
      )}

      {/* ── Stage distribution ───────────────────────────────────────── */}
      {stagesWithData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-medium shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-primary" />
            <p className="text-sm font-bold text-dark">Distribución por etapa</p>
            {sourceFilter !== 'all' && (
              <span className={cn(
                'ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold',
                sourceFilter === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
              )}>
                {sourceFilter}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {stagesWithData.map((stage) => {
              const count = metrics.byStage[stage] ?? 0
              const pct   = Math.round((count / maxStageCount) * 100)
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <span className="text-xs text-gray-500">{STAGE_LABEL[stage] ?? stage}</span>
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={cn(
                        'h-2 rounded-full transition-all',
                        (stage === 'OK_R2S' || stage === 'VENTA') ? 'bg-success' :
                        stage === 'OB' ? 'bg-indigo-500' :
                        stage === 'DESCARTADO' ? 'bg-danger' :
                        'bg-primary',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-dark w-8 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Recent leads ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-medium shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-bold text-dark">
            Últimos 10 leads asignados
            {sourceFilter !== 'all' && (
              <span className={cn(
                'ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold',
                sourceFilter === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
              )}>
                {sourceFilter}
              </span>
            )}
          </p>
          <span className="text-xs text-gray-400">{leads.length} leads total</span>
        </div>

        {recentLeads.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">Sin leads asignados</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Lead ID</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Nombre</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Fuente</th>
                  {showTyc && (
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">TYC</th>
                  )}
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Etapa actual</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Último cambio</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">Contactos</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-primary">{lead.leadIdExternal}</span>
                    </td>
                    <td className="px-4 py-2.5 max-w-[160px]">
                      <span className="font-medium text-dark truncate block">{lead.name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                        lead.source === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
                      )}>
                        {lead.source}
                      </span>
                    </td>
                    {showTyc && (
                      <td className="px-4 py-2.5">
                        <TycBadge tyc={lead.tyc} />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <StageBadge stage={lead.currentStage} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                      {lead.stageChangedAt
                        ? formatDistanceToNow(parseISO(lead.stageChangedAt), { addSuffix: true, locale: es })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        'text-sm font-semibold',
                        lead.tieneContactoEfectivo ? 'text-success' :
                        lead.tieneIntentoContacto  ? 'text-warning' : 'text-gray-400',
                      )}>
                        {lead._count?.contactAttempts ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
