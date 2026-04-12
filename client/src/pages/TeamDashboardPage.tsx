import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Users, ChevronUp, ChevronDown, Eye, RefreshCw, TrendingUp,
  BarChart2, Table2, Building2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { reportsApi, profilesApi } from '../services/api'
import { cn } from '../utils/cn'
import { COUNTRIES, COUNTRY_FLAG } from '../utils/constants'
import type {
  HunterStats, TeamSummaryResponse, ClosedRateEntry, HcSummaryEntry,
  LeadSource, Country,
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

type PeriodKey    = 'today' | 'this_week' | 'this_month' | 'custom'
type SourceFilter = 'all' | 'SDR' | 'SOB'
type SortDir      = 'asc' | 'desc'
type ActiveTab    = 'team' | 'closed_rate' | 'hc_summary'

const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today',      label: 'Hoy' },
  { id: 'this_week',  label: 'Esta semana' },
  { id: 'this_month', label: 'Este mes' },
  { id: 'custom',     label: 'Personalizado' },
]

const COUNTRY_NAME: Record<Country, string> = {
  CO: 'Colombia', MX: 'México', AR: 'Argentina',
  PE: 'Perú',     CL: 'Chile',  EC: 'Ecuador',
}

const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_YEAR  = new Date().getFullYear()

type SortField =
  | 'hunterName' | 'country' | 'team' | 'totalLeads' | 'leadsConTyc' | 'leadsSinTyc'
  | 'leadsWithContactAttempt' | 'leadsWithEffectiveContact' | 'obCount' | 'r2sCount'
  | 'productivity' | 'accumulatedTarget' | 'phasing' | 'gap' | 'contactabilityRate'

// ─── Source Toggle ────────────────────────────────────────────────────────────

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
            'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all',
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

// ─── Phasing bar ──────────────────────────────────────────────────────────────

function PhasingBar({ value }: { value: number }) {
  const pct = Math.min(value, 150)
  const color =
    value >= 100 ? 'bg-success' :
    value >= 60  ? 'bg-warning' :
    'bg-danger'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn(
        'text-sm font-bold tabular-nums w-12 text-right shrink-0',
        value >= 100 ? 'text-success' : value >= 60 ? 'text-warning' : 'text-danger',
      )}>
        {value.toFixed(1)}%
      </span>
    </div>
  )
}

// ─── Sortable TH ──────────────────────────────────────────────────────────────

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

// ─── SOB Métricas de seguimiento ──────────────────────────────────────────────

function SobMetricsPanel({ totals }: { totals: TeamSummaryResponse['totals'] | undefined }) {
  if (!totals) return null

  const efectividadTotal =
    totals.totalLeads > 0
      ? ((totals.obCount + totals.r2sCount) / totals.totalLeads) * 100
      : 0

  const efectividadTyc =
    totals.leadsConTyc > 0
      ? ((totals.obCount + totals.r2sCount) / totals.leadsConTyc) * 100
      : 0

  return (
    <div className="bg-white rounded-2xl border border-purple-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={16} className="text-purple-600" />
        <p className="text-sm font-bold text-dark">Métricas de seguimiento SOB</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Eficiencia panel */}
        <div className="space-y-3">
          <div className="p-3 bg-gray-50 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Efectividad Total</span>
              <span className={cn(
                'text-lg font-extrabold',
                efectividadTotal >= 50 ? 'text-success' :
                efectividadTotal >= 25 ? 'text-warning' : 'text-danger',
              )}>
                {efectividadTotal.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">(OB+R2S) / Asignados</p>
            <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', efectividadTotal >= 50 ? 'bg-success' : efectividadTotal >= 25 ? 'bg-warning' : 'bg-danger')}
                style={{ width: `${Math.min(efectividadTotal, 100)}%` }}
              />
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Efectividad TYC</span>
              <span className={cn(
                'text-lg font-extrabold',
                efectividadTyc >= 50 ? 'text-success' :
                efectividadTyc >= 25 ? 'text-warning' : 'text-danger',
              )}>
                {efectividadTyc.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">(OB+R2S) / Leads con TYC</p>
            <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', efectividadTyc >= 50 ? 'bg-success' : efectividadTyc >= 25 ? 'bg-warning' : 'bg-danger')}
                style={{ width: `${Math.min(efectividadTyc, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* TYC Distribution */}
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Con TYC</span>
              <span className="font-semibold text-dark">
                {totals.leadsConTyc}{' '}
                <span className="text-gray-400 font-normal">
                  ({totals.totalLeads > 0 ? ((totals.leadsConTyc / totals.totalLeads) * 100).toFixed(0) : 0}%)
                </span>
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${totals.totalLeads > 0 ? (totals.leadsConTyc / totals.totalLeads) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Sin TYC</span>
              <span className="font-semibold text-dark">
                {totals.leadsSinTyc}{' '}
                <span className="text-gray-400 font-normal">
                  ({totals.totalLeads > 0 ? ((totals.leadsSinTyc / totals.totalLeads) * 100).toFixed(0) : 0}%)
                </span>
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-warning"
                style={{ width: `${totals.totalLeads > 0 ? (totals.leadsSinTyc / totals.totalLeads) * 100 : 0}%` }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Closed Rate Tab ──────────────────────────────────────────────────────────

function ClosedRateTab({ country }: { country: Country | '' }) {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [year,  setYear]  = useState(CURRENT_YEAR)

  const { data: entries = [], isLoading } = useQuery<ClosedRateEntry[]>({
    queryKey: ['closed-rate', month, year, country],
    queryFn:  () => reportsApi.getClosedRateReport(month, year, country || undefined),
    staleTime: 120_000,
  })

  const months = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
  ]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
        >
          {months.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
        >
          {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-sm font-bold text-dark">Reporte Closed Rate — {months[month - 1]} {year}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Hunter', 'Líder', 'País', 'TYC', 'Leads', 'Leads RTS', 'Closed Rate%'].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-gray-200 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-gray-400">
                    Sin datos para este período
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={`${e.hunterId}-${e.tieneTyc}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-sm font-medium text-dark truncate max-w-[140px]">
                      {e.hunterName}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-500 truncate max-w-[120px]">
                      {e.liderName}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-500">
                      {COUNTRY_FLAG[e.country]} {e.country}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold',
                        e.tieneTyc === 'SI' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                      )}>
                        {e.tieneTyc}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-dark tabular-nums">
                      {e.leads}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-dark tabular-nums">
                      {e.leadsRts}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        'text-sm font-bold tabular-nums',
                        e.closedRate >= 30 ? 'text-success' :
                        e.closedRate >= 15 ? 'text-warning' : 'text-danger',
                      )}>
                        {e.closedRate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── HC Summary Tab ───────────────────────────────────────────────────────────

function HcSummaryTab({ source }: { source: SourceFilter }) {
  const sourceParam = source === 'all' ? undefined : source as LeadSource

  const { data: entries = [], isLoading } = useQuery<HcSummaryEntry[]>({
    queryKey: ['hc-summary', source],
    queryFn:  () => reportsApi.getHcSummary(sourceParam),
    staleTime: 300_000,
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-bold text-dark">HC Summary — Capacidad del equipo</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['País', 'Team', 'Hunters', 'Total Leads', 'Leads Semana', 'Leads/Hunter'].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-4 bg-gray-200 rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                  Sin datos
                </td>
              </tr>
            ) : (
              entries.map((e, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 text-sm text-gray-600">
                    {COUNTRY_FLAG[e.country]} {e.country}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold',
                      e.source === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
                    )}>
                      {e.source}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm font-semibold text-dark tabular-nums">
                    {e.hunters}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-semibold text-dark tabular-nums">
                    {e.totalLeads}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-semibold text-primary tabular-nums">
                    {e.leadsThisWeek}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn(
                      'text-sm font-bold tabular-nums',
                      e.leadsPerHunter >= 80 ? 'text-success' :
                      e.leadsPerHunter >= 50 ? 'text-warning' : 'text-danger',
                    )}>
                      {e.leadsPerHunter.toFixed(1)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── TeamDashboardPage ────────────────────────────────────────────────────────

export default function TeamDashboardPage() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const isAdmin   = user?.role === 'ADMIN'
  const isLider   = user?.role === 'LIDER'

  // ── Filter state ────────────────────────────────────────────────────────────
  const [source,    setSource]    = useState<SourceFilter>('all')
  const [periodKey, setPeriodKey] = useState<PeriodKey>('this_month')
  const [country,   setCountry]   = useState<Country | ''>('')
  const [dateFrom,  setDateFrom]  = useState(format(new Date(), 'yyyy-MM-01'))
  const [dateTo,    setDateTo]    = useState(format(new Date(), 'yyyy-MM-dd'))
  const [sortBy,    setSortBy]    = useState<SortField>('productivity')
  const [sortDir,   setSortDir]   = useState<SortDir>('desc')
  const [activeTab, setActiveTab] = useState<ActiveTab>('team')

  const refDate    = new Date().toISOString().slice(0, 10)
  const sourceParam = source === 'all' ? undefined : source as LeadSource

  // When using custom period, pass from/to as range string
  const effectivePeriod = periodKey === 'custom' ? 'custom' : periodKey
  const effectiveDate   = periodKey === 'custom' ? dateTo : refDate

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: summary, isLoading, isFetching, refetch } = useQuery<TeamSummaryResponse>({
    queryKey: ['team-dashboard-summary', effectivePeriod, effectiveDate, country, source, dateFrom],
    queryFn:  () => reportsApi.getTeamSummary(
      effectivePeriod,
      effectiveDate,
      country || undefined,
      sourceParam,
    ),
    staleTime: 120_000,
    refetchInterval: 300_000,
  })

  const { data: hunters = [] } = useQuery({
    queryKey: ['hunters', country, source],
    queryFn:  () => profilesApi.getHunters({
      country:  (country as Country) || undefined,
      leaderId: isLider ? user?.id : undefined,
    }),
    staleTime: 300_000,
  })

  // ── Sort handler ────────────────────────────────────────────────────────────
  const handleSort = useCallback((field: string) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
        return prev as SortField
      }
      setSortDir('desc')
      return field as SortField
    })
  }, [])

  // ── Derived data ────────────────────────────────────────────────────────────
  const teamRows = useMemo((): HunterStats[] => {
    if (!summary?.team) return []
    let rows = summary.team

    if (isLider) {
      const myHunterIds = new Set(hunters.map((h) => h.id))
      rows = rows.filter((r) => myHunterIds.has(r.hunterId))
    }

    return [...rows].sort((a, b) => {
      const av = a[sortBy as keyof HunterStats]
      const bv = b[sortBy as keyof HunterStats]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc'
        ? Number(av ?? 0) - Number(bv ?? 0)
        : Number(bv ?? 0) - Number(av ?? 0)
    })
  }, [summary, isLider, hunters, sortBy, sortDir])

  const totals  = summary?.totals
  const showTyc = source === 'SOB'
  const showSob = source === 'SOB'

  // ── Table columns ───────────────────────────────────────────────────────────
  const baseCols: { label: string; field: SortField }[] = [
    { label: 'Nombre',        field: 'hunterName' },
    { label: 'País',          field: 'country' },
    { label: 'Team',          field: 'team' },
    { label: 'Asignados',     field: 'totalLeads' },
    ...(showTyc ? [
      { label: 'Con TYC',    field: 'leadsConTyc'   as SortField },
      { label: 'Sin TYC',    field: 'leadsSinTyc'   as SortField },
    ] : []),
    { label: 'Gestionados',   field: 'leadsWithContactAttempt' },
    { label: 'C.Efectivos',   field: 'leadsWithEffectiveContact' },
    { label: 'OB',            field: 'obCount' },
    { label: 'R2S',           field: 'r2sCount' },
    { label: 'Productividad', field: 'productivity' },
    { label: 'Meta',          field: 'accumulatedTarget' },
    { label: 'Gap',           field: 'gap' },
    { label: 'Phasing%',      field: 'phasing' },
  ]

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="h-8 bg-gray-200 rounded w-64 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 border border-gray-200 animate-pulse space-y-2">
              <div className="h-3 bg-gray-200 rounded w-20" />
              <div className="h-8 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
        <div className="h-60 bg-gray-100 rounded-2xl animate-pulse" />
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
              <Users size={22} className="text-primary" />
              Team Dashboard Inbound
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {teamRows.length} hunters · período: {summary?.from ? format(new Date(summary.from), 'dd/MM/yy') : '—'} → {summary?.to ? format(new Date(summary.to), 'dd/MM/yy') : '—'}
            </p>
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

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          <SourceToggle value={source} onChange={setSource} />

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
              <span className="text-gray-400 text-xs">—</span>
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
              onChange={(e) => setCountry(e.target.value as Country | '')}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs bg-white cursor-pointer"
            >
              <option value="">Todos los países</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{COUNTRY_FLAG[c]} {COUNTRY_NAME[c]}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('team')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            activeTab === 'team'
              ? 'bg-white text-dark shadow-sm'
              : 'text-gray-500 hover:text-dark',
          )}
        >
          <Table2 size={14} />
          Equipo
        </button>
        <button
          onClick={() => setActiveTab('closed_rate')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            activeTab === 'closed_rate'
              ? 'bg-white text-dark shadow-sm'
              : 'text-gray-500 hover:text-dark',
          )}
        >
          <BarChart2 size={14} />
          Closed Rate
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('hc_summary')}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              activeTab === 'hc_summary'
                ? 'bg-white text-dark shadow-sm'
                : 'text-gray-500 hover:text-dark',
            )}
          >
            <Building2 size={14} />
            HC Summary
          </button>
        )}
      </div>

      {/* ── TEAM TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <>
          {/* ── KPI Summary Cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi
              label="Total asignados"
              value={totals?.totalLeads ?? 0}
              sub="leads en el periodo"
              color="text-dark"
            />

            {showTyc ? (
              <>
                <Kpi
                  label="Con TYC"
                  value={totals?.leadsConTyc ?? 0}
                  sub="términos aceptados"
                  color="text-success"
                />
                <Kpi
                  label="Sin TYC"
                  value={totals?.leadsSinTyc ?? 0}
                  sub="sin términos"
                  color="text-warning"
                />
              </>
            ) : (
              <Kpi
                label="Gestionados"
                value={totals?.leadsWithContactAttempt ?? 0}
                sub="con intento de contacto"
                color="text-info"
              />
            )}

            <Kpi
              label="Productividad"
              value={(totals?.obCount ?? 0) + (totals?.r2sCount ?? 0)}
              sub={`OB: ${totals?.obCount ?? 0} · R2S: ${totals?.r2sCount ?? 0}`}
              color="text-success"
            />

            <Kpi
              label="Tasa Contactabilidad"
              value={`${totals?.contactabilityRate?.toFixed(1) ?? '0.0'}%`}
              sub="contactos efectivos / asignados"
              color={
                (totals?.contactabilityRate ?? 0) >= 60 ? 'text-success' :
                (totals?.contactabilityRate ?? 0) >= 40 ? 'text-warning' : 'text-danger'
              }
            />
          </div>

          {/* ── SOB Tracking metrics ─────────────────────────────────────────── */}
          {showSob && <SobMetricsPanel totals={totals} />}

          {/* ── Hunter Stats Table ───────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-bold text-dark">
                Rendimiento por hunter ({teamRows.length})
                {source !== 'all' && (
                  <span className={cn(
                    'ml-2 px-2 py-0.5 rounded-full text-xs font-semibold',
                    source === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
                  )}>
                    {source}
                  </span>
                )}
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
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Acción
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {teamRows.length === 0 ? (
                    <tr>
                      <td colSpan={baseCols.length + 1} className="py-8 text-center text-sm text-gray-400">
                        Sin datos para este período
                      </td>
                    </tr>
                  ) : (
                    teamRows.map((h) => (
                      <tr key={h.hunterId} className="hover:bg-gray-50 transition-colors">
                        {/* Nombre */}
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

                        {/* Con TYC / Sin TYC (SOB only) */}
                        {showTyc && (
                          <>
                            <td className="px-3 py-2.5">
                              <span className={cn(
                                'text-sm font-bold tabular-nums',
                                h.leadsConTyc > 0 ? 'text-success' : 'text-gray-400',
                              )}>
                                {h.leadsConTyc}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={cn(
                                'text-sm font-bold tabular-nums',
                                h.leadsSinTyc > 0 ? 'text-warning' : 'text-gray-400',
                              )}>
                                {h.leadsSinTyc}
                              </span>
                            </td>
                          </>
                        )}

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
                          <span className={cn(
                            'text-sm font-bold tabular-nums',
                            h.obCount > 0 ? 'text-indigo-600' : 'text-gray-400',
                          )}>
                            {h.obCount}
                          </span>
                        </td>

                        {/* R2S */}
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            'text-sm font-bold tabular-nums',
                            h.r2sCount > 0 ? 'text-success' : 'text-gray-400',
                          )}>
                            {h.r2sCount}
                          </span>
                        </td>

                        {/* Productividad */}
                        <td className="px-3 py-2.5 text-sm font-bold text-primary tabular-nums">
                          {h.obCount + h.r2sCount}
                        </td>

                        {/* Action */}
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => navigate(`/hunters/${h.hunterId}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-500 hover:border-primary hover:text-primary transition-colors"
                          >
                            <Eye size={11} /> Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* Totals footer */}
                {teamRows.length > 1 && totals && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td className="px-3 py-3 text-xs font-bold text-gray-500 uppercase" colSpan={3}>
                        Total
                      </td>
                      <td className="px-3 py-3 text-sm font-bold text-dark tabular-nums">{totals.totalLeads}</td>
                      {showTyc && (
                        <>
                          <td className="px-3 py-3 text-sm font-bold text-success tabular-nums">{totals.leadsConTyc}</td>
                          <td className="px-3 py-3 text-sm font-bold text-warning tabular-nums">{totals.leadsSinTyc}</td>
                        </>
                      )}
                      <td className="px-3 py-3 text-sm font-bold text-info tabular-nums">{totals.leadsWithContactAttempt}</td>
                      <td className="px-3 py-3 text-sm font-bold text-primary tabular-nums">{totals.leadsWithEffectiveContact}</td>
                      <td className="px-3 py-3 text-sm font-bold text-indigo-600 tabular-nums">{totals.obCount}</td>
                      <td className="px-3 py-3 text-sm font-bold text-success tabular-nums">{totals.r2sCount}</td>
                      <td className="px-3 py-3 text-sm font-bold text-primary tabular-nums">{totals.obCount + totals.r2sCount}</td>
                      <td className="px-3 py-3 text-sm text-gray-400">—</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── CLOSED RATE TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'closed_rate' && (
        <ClosedRateTab country={country} />
      )}

      {/* ── HC SUMMARY TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'hc_summary' && isAdmin && (
        <HcSummaryTab source={source} />
      )}

    </div>
  )
}
