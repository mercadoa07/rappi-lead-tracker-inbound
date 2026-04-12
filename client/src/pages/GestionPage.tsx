import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, RefreshCw, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { reportsApi, profilesApi } from '../services/api'
import { cn } from '../utils/cn'
import { COUNTRIES, COUNTRY_FLAG, STAGE_LABEL } from '../utils/constants'
import type {
  Country, LeadSource, HunterStats, TeamSummaryResponse,
  FunnelEntry, StageAdvanceEntry, DiscardReasonEntry,
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom'

const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today',      label: 'Hoy' },
  { id: 'this_week',  label: 'Esta semana' },
  { id: 'last_week',  label: 'Semana pasada' },
  { id: 'this_month', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: 'custom',     label: 'Rango personalizado' },
]

const COUNTRY_NAME: Record<Country, string> = {
  CO: 'Colombia', MX: 'México', AR: 'Argentina',
  PE: 'Perú',     CL: 'Chile',  EC: 'Ecuador',
}

const FUNNEL_ORDER = [
  'SIN_CONTACTO', 'CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO', 'EN_GESTION',
  'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB', 'OK_R2S', 'VENTA',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'

type SortField =
  | 'hunterName' | 'country' | 'totalLeads' | 'leadsWithoutContact'
  | 'leadsWithContactAttempt' | 'leadsWithEffectiveContact'
  | 'obCount' | 'r2sCount' | 'r2sPerDay' | 'closeRate'

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function Kpi({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub: string; color: string
}) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-200">
      <p className="text-xs text-gray-400 uppercase tracking-widest">{label}</p>
      <p className={cn('text-3xl font-extrabold mt-1', color)}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

// ─── Sortable header ──────────────────────────────────────────────────────────

function SortTh({
  label, field, sortBy, sortDir, onClick,
}: {
  label: string; field: string; sortBy: string; sortDir: SortDir; onClick: (f: string) => void
}) {
  const active = sortBy === field
  return (
    <th
      onClick={() => onClick(field)}
      className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap cursor-pointer select-none hover:text-dark transition-colors"
    >
      <span className="flex items-center gap-0.5">
        {label}
        <span className="flex flex-col -space-y-0.5">
          <ChevronUp size={8} className={active && sortDir === 'asc' ? 'text-primary' : 'text-gray-300'} />
          <ChevronDown size={8} className={active && sortDir === 'desc' ? 'text-primary' : 'text-gray-300'} />
        </span>
      </span>
    </th>
  )
}

// ─── Source Toggle ────────────────────────────────────────────────────────────

function SourceToggle({
  value, onChange,
}: {
  value: 'all' | 'SDR' | 'SOB'; onChange: (v: 'all' | 'SDR' | 'SOB') => void
}) {
  return (
    <div className="flex bg-white rounded-xl border border-gray-200 p-1 gap-1">
      {(['all', 'SDR', 'SOB'] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm font-semibold transition-all',
            value === s ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-dark',
          )}
        >
          {s === 'all' ? 'Todos' : s}
        </button>
      ))}
    </div>
  )
}

// ─── Horizontal bar ───────────────────────────────────────────────────────────

function HBar({
  label, value, max, color = 'bg-primary',
}: {
  label: string; value: number; max: number; color?: string
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-gray-500 truncate text-right shrink-0" title={label}>{label}</div>
      <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color)}
          style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%` }}
        />
      </div>
      <div className="w-10 text-xs font-bold text-gray-700 tabular-nums text-right">{value}</div>
    </div>
  )
}

// ─── GestionPage ──────────────────────────────────────────────────────────────

export default function GestionPage() {
  const { user }  = useAuth()
  const isAdmin   = user?.role === 'ADMIN'
  const isLider   = user?.role === 'LIDER'

  // ── Filter state ────────────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<'all' | 'SDR' | 'SOB'>('all')
  const [periodKey,    setPeriodKey]    = useState<PeriodKey>('this_month')
  const [country,      setCountry]      = useState<Country | ''>('')
  const [liderId,      setLiderId]      = useState('')
  const [hunterId,     setHunterId]     = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [sortBy,       setSortBy]       = useState<SortField>('r2sCount')
  const [sortDir,      setSortDir]      = useState<SortDir>('desc')

  const refDate     = new Date().toISOString().slice(0, 10)
  const sourceParam = sourceFilter === 'all' ? undefined : sourceFilter as LeadSource

  const filterParams = {
    country:   country   || undefined,
    source:    sourceParam,
    hunterId:  hunterId  || undefined,
    leaderId:  liderId   || undefined,
    dateFrom:  periodKey === 'custom' ? (dateFrom || undefined) : undefined,
    dateTo:    periodKey === 'custom' ? (dateTo   || undefined) : undefined,
  }

  const qk = [periodKey, country || null, sourceFilter, liderId || null, hunterId || null, dateFrom || null, dateTo || null] as const

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: summary, isLoading, isFetching, refetch } = useQuery<TeamSummaryResponse>({
    queryKey: ['team-summary', ...qk],
    queryFn:  () => reportsApi.getTeamSummary(
      periodKey, refDate,
      filterParams.country, filterParams.source,
      filterParams.hunterId, filterParams.leaderId,
      filterParams.dateFrom, filterParams.dateTo,
    ),
    staleTime:       120_000,
    refetchInterval: 300_000,
  })

  const { data: funnel = [] } = useQuery<FunnelEntry[]>({
    queryKey: ['funnel', country || null, sourceFilter, liderId || null, hunterId || null],
    queryFn:  () => reportsApi.getFunnelDistribution(
      filterParams.country, filterParams.source,
      filterParams.hunterId, filterParams.leaderId,
    ),
    staleTime: 120_000,
  })

  const { data: stageAdvances = [] } = useQuery<StageAdvanceEntry[]>({
    queryKey: ['stage-advances', ...qk],
    queryFn:  () => reportsApi.getStageAdvances(
      periodKey, refDate,
      filterParams.country, filterParams.source,
      filterParams.hunterId, filterParams.leaderId,
      filterParams.dateFrom, filterParams.dateTo,
    ),
    staleTime: 120_000,
  })

  const { data: discardReasons = [] } = useQuery<DiscardReasonEntry[]>({
    queryKey: ['discard-reasons', ...qk],
    queryFn:  () => reportsApi.getDiscardReasons(
      periodKey, refDate,
      filterParams.country, filterParams.source,
      filterParams.hunterId, filterParams.leaderId,
      filterParams.dateFrom, filterParams.dateTo,
    ),
    staleTime: 120_000,
  })

  const { data: liders = [] } = useQuery({
    queryKey: ['liders', country || null],
    queryFn:  () => profilesApi.getLiders(country as Country || undefined),
    enabled:  isAdmin,
    staleTime: 300_000,
  })

  const { data: hunters = [] } = useQuery({
    queryKey: ['hunters-filter', country || null, liderId || null],
    queryFn:  () => profilesApi.getHunters({
      country:  country as Country || undefined,
      leaderId: isLider ? user?.id : (liderId || undefined),
    }),
    enabled:  isAdmin || isLider,
    staleTime: 300_000,
  })

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSort = useCallback((field: string) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev as SortField
      }
      setSortDir('desc')
      return field as SortField
    })
  }, [])

  const clearFilters = useCallback(() => {
    setCountry(''); setLiderId(''); setHunterId('')
    setDateFrom(''); setDateTo('')
    setPeriodKey('this_month'); setSourceFilter('all')
  }, [])

  const hasActiveFilters = !!(
    country || liderId || hunterId || sourceFilter !== 'all' ||
    (periodKey === 'custom' && (dateFrom || dateTo))
  )

  // ── Derived data ────────────────────────────────────────────────────────────
  const teamRows = useMemo((): HunterStats[] => {
    if (!summary?.team) return []
    return [...summary.team].sort((a, b) => {
      const av = a[sortBy as keyof HunterStats]
      const bv = b[sortBy as keyof HunterStats]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc'
        ? Number(av ?? 0) - Number(bv ?? 0)
        : Number(bv ?? 0) - Number(av ?? 0)
    })
  }, [summary, sortBy, sortDir])

  const totals = summary?.totals

  // ── Chart data ──────────────────────────────────────────────────────────────
  const funnelActive  = funnel.filter(e => e.stage !== 'DESCARTADO')
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.stage) - FUNNEL_ORDER.indexOf(b.stage))
  const funnelBlocked = funnel.filter(e => e.stage === 'DESCARTADO')

  const stageAdvancesOrdered = [...stageAdvances]
    .filter(e => e.stage !== 'DESCARTADO')
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.stage) - FUNNEL_ORDER.indexOf(b.stage))

  const maxFunnel   = Math.max(...funnelActive.map(e => e.count),  1)
  const maxAdvances = Math.max(...stageAdvancesOrdered.map(e => e.count), 1)
  const maxDiscard  = Math.max(...discardReasons.map(e => e.count), 1)
  const totalDiscard = discardReasons.reduce((s, e) => s + e.count, 0)

  const showTyc = sourceFilter === 'SOB'

  // ── Table columns ────────────────────────────────────────────────────────────
  const baseCols: { label: string; field: SortField }[] = [
    { label: 'Comercial',     field: 'hunterName' },
    { label: 'País',          field: 'country' },
    { label: 'Asignados',     field: 'totalLeads' },
    { label: 'Sin contactar', field: 'leadsWithoutContact' },
    { label: 'Gestionados',   field: 'leadsWithContactAttempt' },
    { label: 'C.Efectivos',   field: 'leadsWithEffectiveContact' },
    { label: 'OB',            field: 'obCount' },
    { label: 'R2S',           field: 'r2sCount' },
    { label: 'R2S/día',       field: 'r2sPerDay' },
    { label: 'Close rate',    field: 'closeRate' },
  ]

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="h-8 bg-gray-200 rounded w-64 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-4 border border-gray-200 animate-pulse space-y-2">
              <div className="h-3 bg-gray-200 rounded w-20" />
              <div className="h-8 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-dark flex items-center gap-2">
              <TrendingUp size={22} className="text-primary" />
              Gestión Comercial
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">Rendimiento del equipo Inbound</p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:text-primary hover:border-primary transition-colors disabled:opacity-50 self-end"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle value={sourceFilter} onChange={setSourceFilter} />

          <select
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}
            className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer font-semibold"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>

          {periodKey === 'custom' && (
            <>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
              />
            </>
          )}

          {isAdmin && (
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value as Country | '')
                setLiderId('')
                setHunterId('')
              }}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
            >
              <option value="">Todos los países</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{COUNTRY_FLAG[c]} {COUNTRY_NAME[c]}</option>
              ))}
            </select>
          )}

          {isAdmin && (
            <select
              value={liderId}
              onChange={(e) => { setLiderId(e.target.value); setHunterId('') }}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
            >
              <option value="">Todos los supervisores</option>
              {liders.map((l) => (
                <option key={l.id} value={l.id}>{l.fullName}</option>
              ))}
            </select>
          )}

          {(isAdmin || isLider) && (
            <select
              value={hunterId}
              onChange={(e) => setHunterId(e.target.value)}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
            >
              <option value="">Todos los comerciales</option>
              {hunters.map((h) => (
                <option key={h.id} value={h.id}>{h.fullName}</option>
              ))}
            </select>
          )}

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="h-8 flex items-center gap-1 px-2 rounded-xl border border-gray-200 text-xs text-gray-400 hover:text-danger hover:border-danger transition-colors"
            >
              <X size={12} /> Limpiar
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="Asignados"
          value={totals?.totalLeads ?? 0}
          sub="leads en el periodo"
          color="text-dark"
        />
        <Kpi
          label="Sin contactar"
          value={totals?.leadsWithoutContact ?? 0}
          sub={
            (totals?.totalLeads ?? 0) > 0
              ? `${(((totals?.leadsWithoutContact ?? 0) / (totals?.totalLeads ?? 1)) * 100).toFixed(0)}% sin gestión`
              : 'del periodo'
          }
          color="text-danger"
        />
        <Kpi
          label="Gestionados"
          value={totals?.leadsWithContactAttempt ?? 0}
          sub="con intento de contacto"
          color="text-info"
        />
        <Kpi
          label="C. Efectivos"
          value={totals?.leadsWithEffectiveContact ?? 0}
          sub={`${totals?.contactabilityRate?.toFixed(1) ?? '0.0'}% contactabilidad`}
          color="text-primary"
        />
        <Kpi
          label="Close rate"
          value={`${totals?.closeRate?.toFixed(1) ?? '0.0'}%`}
          sub={`${totals?.r2sCount ?? 0} R2S totales`}
          color="text-success"
        />
        <Kpi
          label="R2S/día (prom.)"
          value={totals?.teamR2sPerDay?.toFixed(2) ?? '0.00'}
          sub="promedio por comercial"
          color="text-primary"
        />
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Distribución del funnel */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-bold text-dark mb-1">Distribución del funnel</p>
          <p className="text-xs text-gray-400 mb-4">Estado actual de todos los leads</p>
          {funnelActive.length === 0 && funnelBlocked.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin datos</p>
          ) : (
            <div className="space-y-2">
              {funnelActive.map((e) => (
                <HBar
                  key={e.stage}
                  label={STAGE_LABEL[e.stage as keyof typeof STAGE_LABEL] ?? e.stage}
                  value={e.count}
                  max={maxFunnel}
                  color="bg-primary"
                />
              ))}
              {funnelBlocked.length > 0 && (
                <>
                  <div className="border-t border-gray-100 pt-2 mt-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Bloqueados</p>
                  </div>
                  {funnelBlocked.map((e) => (
                    <HBar
                      key={e.stage}
                      label={STAGE_LABEL[e.stage as keyof typeof STAGE_LABEL] ?? e.stage}
                      value={e.count}
                      max={maxFunnel}
                      color="bg-red-400"
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Causales de descarte */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-bold text-dark mb-1">Causales de descarte</p>
          <p className="text-xs text-gray-400 mb-4">Leads descartados en el periodo</p>
          {discardReasons.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin descartados en el periodo</p>
          ) : (
            <div className="space-y-2">
              {discardReasons.map((e) => (
                <HBar
                  key={e.reason}
                  label={STAGE_LABEL[e.reason as keyof typeof STAGE_LABEL] ?? e.reason}
                  value={e.count}
                  max={maxDiscard}
                  color="bg-red-400"
                />
              ))}
              <div className="border-t border-gray-100 pt-2 flex justify-between text-xs text-gray-500 mt-1">
                <span className="font-medium">Total descartados</span>
                <span className="font-bold text-red-500">{totalDiscard}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Avances por etapa en el periodo */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <p className="text-sm font-bold text-dark mb-1">Avances por etapa en el periodo</p>
        <p className="text-xs text-gray-400 mb-4">
          Leads que ingresaron a cada etapa durante el periodo filtrado
        </p>
        {stageAdvancesOrdered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin movimientos en el periodo</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-2">
            {stageAdvancesOrdered.map((e) => (
              <HBar
                key={e.stage}
                label={STAGE_LABEL[e.stage as keyof typeof STAGE_LABEL] ?? e.stage}
                value={e.count}
                max={maxAdvances}
                color={
                  e.stage === 'OK_R2S' || e.stage === 'VENTA' ? 'bg-success' :
                  e.stage === 'OB'     ? 'bg-indigo-500' :
                  'bg-primary'
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── TYC panel (SOB only) ─────────────────────────────────────────────── */}
      {showTyc && totals && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-dark mb-3">Distribución TYC (SOB)</p>
            {(() => {
              const conTyc = totals.leadsConTyc
              const sinTyc = totals.leadsSinTyc
              const total  = conTyc + sinTyc
              const pctCon = total > 0 ? (conTyc / total) * 100 : 0
              const pctSin = total > 0 ? (sinTyc / total) * 100 : 0
              return (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Con TYC</span>
                      <span className="font-semibold text-dark">{conTyc} <span className="text-gray-400 font-normal">({pctCon.toFixed(0)}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-success" style={{ width: `${pctCon}%` }} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Sin TYC</span>
                      <span className="font-semibold text-dark">{sinTyc} <span className="text-gray-400 font-normal">({pctSin.toFixed(0)}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-warning" style={{ width: `${pctSin}%` }} />
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-dark mb-3">Productividad SOB</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">OB</span>
                <span className="text-2xl font-extrabold text-indigo-600">{totals.obCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">R2S</span>
                <span className="text-2xl font-extrabold text-success">{totals.r2sCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hunter table ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-sm font-bold text-dark">
            Rendimiento por comercial ({teamRows.length})
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {baseCols.map((col) => (
                  <SortTh
                    key={col.field}
                    label={col.label}
                    field={col.field}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={handleSort}
                  />
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {teamRows.length === 0 ? (
                <tr>
                  <td colSpan={baseCols.length} className="py-8 text-center text-sm text-gray-400">
                    Sin datos para este periodo
                  </td>
                </tr>
              ) : (
                teamRows.map((h) => (
                  <tr key={h.hunterId} className="hover:bg-gray-50 transition-colors">
                    {/* Comercial */}
                    <td className="px-3 py-2.5">
                      <p className="text-sm font-medium text-dark truncate max-w-[150px]">{h.hunterName}</p>
                      <p className="text-[11px] text-gray-400 truncate max-w-[150px]">{h.hunterEmail}</p>
                    </td>
                    {/* País */}
                    <td className="px-3 py-2.5 text-sm text-gray-500 whitespace-nowrap">
                      {COUNTRY_FLAG[h.country as Country]} {h.country}
                    </td>
                    {/* Asignados */}
                    <td className="px-3 py-2.5 text-sm font-semibold text-dark tabular-nums">
                      {h.totalLeads}
                    </td>
                    {/* Sin contactar */}
                    <td className="px-3 py-2.5">
                      <span className={cn('text-sm font-bold tabular-nums', h.leadsWithoutContact > 0 ? 'text-danger' : 'text-gray-400')}>
                        {h.leadsWithoutContact}
                      </span>
                    </td>
                    {/* Gestionados */}
                    <td className="px-3 py-2.5 text-sm font-semibold text-info tabular-nums">
                      {h.leadsWithContactAttempt}
                    </td>
                    {/* C. Efectivos */}
                    <td className="px-3 py-2.5 text-sm font-semibold text-primary tabular-nums">
                      {h.leadsWithEffectiveContact}
                    </td>
                    {/* OB */}
                    <td className="px-3 py-2.5">
                      <span className={cn('text-sm font-bold tabular-nums', h.obCount > 0 ? 'text-indigo-600' : 'text-gray-400')}>
                        {h.obCount}
                      </span>
                    </td>
                    {/* R2S */}
                    <td className="px-3 py-2.5">
                      <span className={cn('text-sm font-bold tabular-nums', h.r2sCount > 0 ? 'text-success' : 'text-gray-400')}>
                        {h.r2sCount}
                      </span>
                    </td>
                    {/* R2S/día */}
                    <td className="px-3 py-2.5 text-sm font-bold text-primary tabular-nums">
                      {(h.r2sPerDay ?? 0).toFixed(2)}
                    </td>
                    {/* Close rate */}
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        'text-sm font-bold tabular-nums',
                        (h.closeRate ?? 0) >= 20 ? 'text-success' :
                        (h.closeRate ?? 0) >= 10 ? 'text-warning' :
                        (h.closeRate ?? 0) > 0   ? 'text-gray-600' : 'text-gray-400',
                      )}>
                        {(h.closeRate ?? 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {teamRows.length > 1 && totals && (
              <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                <tr>
                  <td className="px-3 py-3 text-xs font-bold text-gray-500 uppercase" colSpan={2}>Total</td>
                  <td className="px-3 py-3 text-sm font-bold text-dark tabular-nums">{totals.totalLeads}</td>
                  <td className="px-3 py-3 text-sm font-bold text-danger tabular-nums">{totals.leadsWithoutContact}</td>
                  <td className="px-3 py-3 text-sm font-bold text-info tabular-nums">{totals.leadsWithContactAttempt}</td>
                  <td className="px-3 py-3 text-sm font-bold text-primary tabular-nums">{totals.leadsWithEffectiveContact}</td>
                  <td className="px-3 py-3 text-sm font-bold text-indigo-600 tabular-nums">{totals.obCount}</td>
                  <td className="px-3 py-3 text-sm font-bold text-success tabular-nums">{totals.r2sCount}</td>
                  <td className="px-3 py-3 text-sm font-bold text-gray-500 tabular-nums">—</td>
                  <td className="px-3 py-3 text-sm font-bold text-success tabular-nums">{(totals.closeRate ?? 0).toFixed(1)}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  )
}
