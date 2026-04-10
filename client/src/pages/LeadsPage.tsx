import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Search, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Eye, Check, SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { leadsApi } from '../services/api'
import { cn } from '../utils/cn'
import { STAGE_LABEL, STAGE_COLORS, COUNTRY_FLAG, COUNTRIES } from '../utils/constants'
import type { FunnelStage, Country, Lead, LeadSource } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STAGES: FunnelStage[] = [
  'SIN_CONTACTO', 'CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO',
  'EN_GESTION', 'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS',
  'EN_FIRMA', 'OB', 'OK_R2S', 'VENTA', 'DESCARTADO',
]

const COUNTRY_NAME: Record<Country, string> = {
  CO: 'Colombia', MX: 'México', AR: 'Argentina',
  PE: 'Perú',     CL: 'Chile',  EC: 'Ecuador',
}

const PAGE_SIZE = 50

type SortField = 'name' | 'currentStage' | 'assignedAt' | 'source'

// ─── useDebounce ──────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
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

// ─── StageSelect ──────────────────────────────────────────────────────────────

function StageSelect({
  value, onChange,
}: {
  value: FunnelStage[]; onChange: (v: FunnelStage[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (stage: FunnelStage) => {
    onChange(
      value.includes(stage)
        ? value.filter((s) => s !== stage)
        : [...value, stage],
    )
  }

  const label =
    value.length === 0 ? 'Todas las etapas' :
    value.length === 1 ? STAGE_LABEL[value[0]] :
    `${value.length} etapas`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 h-9 px-3 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap',
          open
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400',
        )}
      >
        <SlidersHorizontal size={14} />
        <span>{label}</span>
        {value.length > 0 && (
          <span className="bg-primary text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {value.length}
          </span>
        )}
        <ChevronDown size={14} className={cn('transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 max-h-72 overflow-y-auto">
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left"
            onClick={() => onChange([])}
          >
            <span className={cn(
              'w-4 h-4 rounded border flex items-center justify-center shrink-0',
              value.length === 0 ? 'bg-primary border-primary' : 'border-gray-300',
            )}>
              {value.length === 0 && <Check size={10} className="text-white" />}
            </span>
            <span className="text-gray-700 font-medium">Todas las etapas</span>
          </button>

          <div className="my-1 border-t border-gray-100" />

          {ALL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left"
              onClick={() => toggle(stage)}
            >
              <span className={cn(
                'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                value.includes(stage) ? 'bg-primary border-primary' : 'border-gray-300',
              )}>
                {value.includes(stage) && <Check size={10} className="text-white" />}
              </span>
              <span className={cn(
                'truncate',
                value.includes(stage) ? 'text-primary font-medium' : 'text-gray-700',
              )}>
                {STAGE_LABEL[stage]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SortHeader ───────────────────────────────────────────────────────────────

function SortHeader({
  label, field, sortBy, sortOrder, onClick,
}: {
  label:      string
  field:      SortField
  sortBy?:    SortField
  sortOrder?: 'asc' | 'desc'
  onClick:    (field: SortField) => void
}) {
  const active = sortBy === field
  return (
    <th
      scope="col"
      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 cursor-pointer select-none hover:text-dark transition-colors whitespace-nowrap"
      onClick={() => onClick(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="flex flex-col -space-y-0.5">
          <ChevronUp
            size={10}
            className={cn(active && sortOrder === 'asc' ? 'text-primary' : 'text-gray-300')}
          />
          <ChevronDown
            size={10}
            className={cn(active && sortOrder === 'desc' ? 'text-primary' : 'text-gray-300')}
          />
        </span>
      </span>
    </th>
  )
}

// ─── StageBadge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: FunnelStage }) {
  const colors = STAGE_COLORS[stage]
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap',
      colors.bg, colors.text,
    )}>
      {STAGE_LABEL[stage]}
    </span>
  )
}

// ─── TycBadge ─────────────────────────────────────────────────────────────────

function TycBadge({ tyc }: { tyc?: string }) {
  if (!tyc) return <span className="text-gray-300 text-xs">—</span>
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/10 text-success whitespace-nowrap">
      TYC
    </span>
  )
}

// ─── SourceBadge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap',
      source === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
    )}>
      {source}
    </span>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
      <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
        <rect x="8" y="24" width="104" height="64" rx="8" fill="#F3F4F6" />
        <rect x="8" y="24" width="104" height="16" rx="8" fill="#E5E7EB" />
        <rect x="8" y="32" width="104" height="8" fill="#E5E7EB" />
        <rect x="20" y="50" width="44" height="6" rx="3" fill="#D1D5DB" />
        <rect x="72" y="50" width="24" height="6" rx="3" fill="#D1D5DB" />
        <rect x="20" y="64" width="60" height="6" rx="3" fill="#E5E7EB" />
        <rect x="20" y="78" width="32" height="6" rx="3" fill="#E5E7EB" />
        <circle cx="90" cy="26" r="20" fill="white" stroke="#E5E7EB" strokeWidth="2" />
        <circle cx="90" cy="26" r="13" fill="#F9FAFB" />
        <line x1="84" y1="20" x2="96" y2="32" stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="96" y1="20" x2="84" y2="32" stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <p className="text-base font-semibold text-dark">No se encontraron leads con estos filtros</p>
        <p className="text-sm text-gray-400 mt-1">Intenta ajustar los criterios o borra la búsqueda</p>
      </div>
      <button
        onClick={onClear}
        className="px-4 py-2 text-sm font-semibold text-primary border border-primary rounded-xl hover:bg-primary/5 transition-colors"
      >
        Limpiar filtros
      </button>
    </div>
  )
}

// ─── SkeletonRow ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      {[28, 40, 16, 20, 28, 24, 32, 20].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 bg-gray-200 rounded-lg w-${w}`} />
        </td>
      ))}
    </tr>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page, totalPages, total, onPage,
}: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to   = Math.min(page * PAGE_SIZE, total)

  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
      <span className="text-sm text-gray-400">
        Mostrando {from}–{to} de <span className="font-semibold text-dark">{total}</span> leads
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-1 text-gray-400 text-sm select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors',
                p === page
                  ? 'bg-primary text-white'
                  : 'border border-gray-200 text-gray-500 hover:bg-gray-50',
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages || totalPages === 0}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── LeadTableRow ─────────────────────────────────────────────────────────────

function LeadTableRow({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors group"
    >
      {/* Lead ID */}
      <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
        {lead.leadIdExternal}
      </td>

      {/* Nombre */}
      <td className="px-4 py-3 max-w-[200px]">
        <span className="block font-semibold text-dark text-sm truncate" title={lead.name}>
          {lead.name}
        </span>
      </td>

      {/* País */}
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
        {COUNTRY_FLAG[lead.country]} {lead.country}
      </td>

      {/* Source */}
      <td className="px-4 py-3 whitespace-nowrap">
        <SourceBadge source={lead.source} />
      </td>

      {/* Etapa */}
      <td className="px-4 py-3 whitespace-nowrap">
        <StageBadge stage={lead.currentStage} />
      </td>

      {/* Hunter */}
      <td className="px-4 py-3 whitespace-nowrap">
        {lead.assignedTo ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 truncate max-w-[130px]">
            {lead.assignedTo.fullName}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">
            NO ASIGNADO
          </span>
        )}
      </td>

      {/* Asignado el */}
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
        {lead.assignedAt ? format(parseISO(lead.assignedAt), 'dd/MM/yyyy') : '—'}
      </td>

      {/* TYC */}
      <td className="px-4 py-3 whitespace-nowrap">
        <TycBadge tyc={lead.tyc} />
      </td>

      {/* Acciones */}
      <td
        className="px-4 py-3 text-right whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-500 hover:border-primary hover:text-primary group-hover:border-primary group-hover:text-primary transition-colors"
        >
          <Eye size={13} />
          Ver
        </button>
      </td>
    </tr>
  )
}

// ─── LeadsPage ────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const [searchParams] = useSearchParams()

  const initialStage  = searchParams.get('stage') as FunnelStage | null
  const initialSource = searchParams.get('source') as LeadSource | null

  // ── Filter state ──────────────────────────────────────────────────────────
  const [sourceFilter,  setSourceFilter]  = useState<'all' | 'SDR' | 'SOB'>(
    initialSource === 'SDR' || initialSource === 'SOB' ? initialSource : 'all',
  )
  const [searchInput,   setSearchInput]   = useState('')
  const [stages,        setStages]        = useState<FunnelStage[]>(initialStage ? [initialStage] : [])
  const [country,       setCountry]       = useState<Country | ''>('')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [page,          setPage]          = useState(1)
  const [sortBy,        setSortBy]        = useState<SortField | undefined>()
  const [sortOrder,     setSortOrder]     = useState<'asc' | 'desc'>('desc')

  const search = useDebounce(searchInput, 300)

  // Reset page on filter changes
  useEffect(() => { setPage(1) }, [search, stages, country, sourceFilter, dateFrom, dateTo])

  const sourceParam = sourceFilter === 'all' ? undefined : sourceFilter as LeadSource

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['leads', search, stages, country, sourceFilter, dateFrom, dateTo, page, sortBy, sortOrder],
    queryFn:  () => leadsApi.getLeads({
      search:    search    || undefined,
      stage:     stages.length ? stages : undefined,
      country:   (country as Country) || undefined,
      source:    sourceParam,
      dateFrom:  dateFrom  || undefined,
      dateTo:    dateTo    || undefined,
      page,
      limit:     PAGE_SIZE,
      sortBy,
      sortOrder: sortBy ? sortOrder : undefined,
    }),
    staleTime: 30_000,
  })

  const hasActiveFilters =
    !!search || stages.length > 0 || !!country || sourceFilter !== 'all' || !!dateFrom || !!dateTo

  const clearFilters = useCallback(() => {
    setSearchInput('')
    setStages([])
    setCountry('')
    setSourceFilter('all')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }, [])

  const handleSort = useCallback((field: SortField) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return field
      }
      setSortOrder('desc')
      return field
    })
    setPage(1)
  }, [])

  const leads      = data?.data       ?? []
  const total      = data?.total      ?? 0
  const totalPages = data?.totalPages ?? 1

  const showCountry = user?.role === 'LIDER' || user?.role === 'ADMIN'

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky filter bar ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 md:px-6 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto space-y-2">

          {/* Row 1: source toggle + count + search + stage + country + clear */}
          <div className="flex flex-wrap items-center gap-2">

            {/* Source toggle */}
            <SourceToggle value={sourceFilter} onChange={setSourceFilter} />

            {/* Lead count badge */}
            <span className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary/10 text-primary text-sm font-bold whitespace-nowrap">
              {total} leads
            </span>

            {/* Search input */}
            <div className="relative flex-1 min-w-[160px]">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                placeholder="Buscar por nombre o ID..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-200 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-dark transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Stage multi-select */}
            <StageSelect value={stages} onChange={setStages} />

            {/* Country — LIDER / ADMIN only */}
            {showCountry && (
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value as Country | '')}
                className="h-9 px-3 rounded-xl border border-gray-200 text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition cursor-pointer"
              >
                <option value="">Todos los países</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{COUNTRY_FLAG[c]} {COUNTRY_NAME[c]}</option>
                ))}
              </select>
            )}

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:text-danger hover:border-danger transition-colors whitespace-nowrap"
              >
                <X size={13} />
                Limpiar
              </button>
            )}
          </div>

          {/* Row 2: date range filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 whitespace-nowrap">Asignado:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              title="Fecha desde"
            />
            <span className="text-gray-400 text-xs">–</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 px-2 rounded-xl border border-gray-200 text-xs text-dark bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              title="Fecha hasta"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-xs text-gray-400 hover:text-danger transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ── Table container ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">

            {/* Refetch progress bar */}
            {isFetching && !isLoading && (
              <div className="h-0.5 bg-primary/20 overflow-hidden">
                <div className="h-full w-1/2 bg-primary origin-left animate-pulse" />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
                    >
                      Lead ID
                    </th>
                    <SortHeader
                      label="Nombre"
                      field="name"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onClick={handleSort}
                    />
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
                    >
                      País
                    </th>
                    <SortHeader
                      label="Source"
                      field="source"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onClick={handleSort}
                    />
                    <SortHeader
                      label="Etapa"
                      field="currentStage"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onClick={handleSort}
                    />
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
                    >
                      Hunter
                    </th>
                    <SortHeader
                      label="Asignado el"
                      field="assignedAt"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onClick={handleSort}
                    />
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
                    >
                      TYC
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState onClear={clearFilters} />
                      </td>
                    </tr>
                  ) : (
                    leads.map((lead) => (
                      <LeadTableRow
                        key={lead.id}
                        lead={lead}
                        onClick={() => navigate(`/leads/${lead.id}`)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!isLoading && leads.length > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPage={setPage}
              />
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
