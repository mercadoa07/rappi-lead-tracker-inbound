import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Crown, Award, Trophy, Star, Flame, Target, TrendingUp, Percent,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { reportsApi, profilesApi } from '../services/api'
import { cn } from '../utils/cn'
import { COUNTRY_FLAG, COUNTRIES } from '../utils/constants'
import type { LeadSource, Country, HunterStats, TeamSummaryResponse } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'SDR' | 'SOB'
type SortDir      = 'asc' | 'desc'
type PeriodKey    = 'today' | 'this_week' | 'this_month'

const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today',      label: 'Hoy' },
  { id: 'this_week',  label: 'Esta semana' },
  { id: 'this_month', label: 'Este mes' },
]

// ─── StreakBadge (unused but kept for consistency) ────────────────────────────

function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return <span className="text-gray-400 text-sm">—</span>
  const cls =
    streak >= 10 ? 'text-blue-600 bg-blue-50' :
    streak >= 5  ? 'text-red-600 bg-red-50'   :
                   'text-orange-600 bg-orange-50'
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold', cls)}>
      <Flame size={11} />
      {streak}d
    </span>
  )
}

// ─── RankBadge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="flex items-center gap-1 font-extrabold text-yellow-600">
      <Crown size={16} className="text-yellow-500" /> 1
    </span>
  )
  if (rank === 2) return (
    <span className="flex items-center gap-1 font-extrabold text-slate-500">
      <Award size={16} /> 2
    </span>
  )
  if (rank === 3) return (
    <span className="flex items-center gap-1 font-extrabold text-amber-700">
      <Award size={16} /> 3
    </span>
  )
  return <span className="font-semibold text-gray-400 tabular-nums">{rank}</span>
}

// ─── TeamBadge ────────────────────────────────────────────────────────────────

function TeamBadge({ team }: { team: LeadSource }) {
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold',
      team === 'SOB' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700',
    )}>
      {team}
    </span>
  )
}

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

// ─── RankingRow ───────────────────────────────────────────────────────────────

function RankingRow({
  entry, rank, isCurrent,
}: {
  entry: HunterStats; rank: number; isCurrent: boolean
}) {
  const rowClass =
    rank === 1 ? 'bg-yellow-50/60 border-b border-yellow-100' :
    rank === 2 ? 'bg-slate-50/60 border-b border-slate-100'   :
    rank === 3 ? 'bg-amber-50/40 border-b border-amber-100'   :
    'border-b border-gray-100 hover:bg-gray-50'

  const initials = entry.hunterName.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('')

  return (
    <tr className={cn('transition-colors', rowClass, isCurrent && 'ring-2 ring-inset ring-primary/40')}>
      <td className="px-4 py-3 w-12 whitespace-nowrap">
        <RankBadge rank={rank} />
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dark truncate flex items-center gap-1.5">
              {entry.hunterName}
              {isCurrent && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                  Tú
                </span>
              )}
            </p>
            <p className="text-xs text-gray-400 truncate">{entry.hunterEmail}</p>
          </div>
        </div>
      </td>

      {/* Country */}
      <td className="px-4 py-3 text-center whitespace-nowrap text-sm text-gray-500">
        {COUNTRY_FLAG[entry.country as Country] ?? ''} {entry.country}
      </td>

      {/* Productivity (OB + R2S) */}
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <span className={cn(
          'text-xl font-extrabold tabular-nums',
          rank === 1 ? 'text-yellow-600' :
          rank === 2 ? 'text-slate-500'  :
          rank === 3 ? 'text-amber-700'  : 'text-dark',
        )}>
          {entry.productivity}
        </span>
        <p className="text-[10px] text-gray-400">OB: {entry.obCount} · R2S: {entry.r2sCount}</p>
      </td>

      {/* Contactability */}
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <span className={cn(
          'text-sm font-bold tabular-nums',
          entry.contactabilityRate >= 80 ? 'text-success' :
          entry.contactabilityRate >= 50 ? 'text-warning'  : 'text-danger',
        )}>
          {entry.contactabilityRate.toFixed(1)}%
        </span>
      </td>

      {/* Total leads */}
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <span className="text-sm font-medium text-gray-500 tabular-nums">{entry.totalLeads}</span>
      </td>
    </tr>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      {[48, 200, 64, 64, 64, 64, 48].map((w, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-4 bg-gray-200 rounded-lg" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

// ─── PodiumCard ───────────────────────────────────────────────────────────────

const PODIUM_STYLES = {
  1: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: Crown, iconCls: 'text-yellow-500', tagline: '¡Campeón!',  lift: true  },
  2: { bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-600',  icon: Award, iconCls: 'text-slate-400',  tagline: 'Plata',       lift: false },
  3: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  icon: Award, iconCls: 'text-amber-500',  tagline: 'Bronce',      lift: false },
} as const

function PodiumCard({ entry, rank, isCurrent }: { entry: HunterStats; rank: number; isCurrent: boolean }) {
  const s     = PODIUM_STYLES[rank as 1 | 2 | 3]
  const Icon  = s.icon
  const inits = entry.hunterName.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('')

  return (
    <div className={cn(
      'rounded-2xl border-2 p-4 flex flex-col items-center gap-2 text-center',
      s.bg, s.border,
      s.lift && 'sm:-mt-3 shadow-lg',
      isCurrent && 'ring-2 ring-primary/50',
    )}>
      <Icon size={26} className={s.iconCls} />
      <p className={cn('text-[10px] font-extrabold uppercase tracking-widest', s.text)}>{s.tagline}</p>
      <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center">
        <span className="text-sm font-extrabold text-dark">{inits}</span>
      </div>
      <p className="font-bold text-dark text-sm truncate w-full">
        {entry.hunterName}
        {isCurrent && <span className="ml-1 text-[10px] text-primary font-bold">(Tú)</span>}
      </p>
      <p className={cn('text-3xl font-extrabold', s.text)}>{entry.productivity}</p>
      <p className="text-[10px] text-gray-400">productividad (OB+R2S)</p>
    </div>
  )
}

// ─── RankingPage ──────────────────────────────────────────────────────────────

export default function RankingPage() {
  const { user }                        = useAuth()
  const [source, setSource]             = useState<SourceFilter>('all')
  const [period, setPeriod]             = useState<PeriodKey>('this_week')
  const [sortBy, setSortBy]             = useState('productivity')
  const [sortDir, setSortDir]           = useState<SortDir>('desc')

  const refDate    = new Date().toISOString().slice(0, 10)
  const sourceParam = source === 'all' ? undefined : source as LeadSource

  const handleSort = (field: string) => {
    setSortBy((prev) => {
      if (prev === field) { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return field }
      setSortDir('desc'); return field
    })
  }

  const { data: summary, isLoading } = useQuery<TeamSummaryResponse>({
    queryKey: ['ranking-summary', period, source, user?.country],
    queryFn:  () => reportsApi.getTeamSummary(
      period,
      refDate,
      user?.role !== 'ADMIN' ? (user?.country ?? undefined) : undefined,
      sourceParam,
    ),
    staleTime: 60_000,
  })

  const sortedRanking = useMemo((): (HunterStats & { _rank: number })[] => {
    if (!summary?.team) return []
    const key = sortBy as keyof HunterStats

    return [...summary.team]
      .sort((a, b) => {
        const av = a[key] ?? 0, bv = b[key] ?? 0
        if (typeof av === 'string' && typeof bv === 'string')
          return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
      .map((e, i) => ({ ...e, _rank: i + 1 }))
  }, [summary, sortBy, sortDir])

  // Always sorted by productivity for podium
  const byProductivity = useMemo((): HunterStats[] => {
    if (!summary?.team) return []
    return [...summary.team].sort((a, b) => b.productivity - a.productivity)
  }, [summary])

  const top3      = byProductivity.slice(0, 3)
  const myEntry   = byProductivity.find((e) => e.hunterId === user?.id)
  const myRank    = myEntry ? byProductivity.indexOf(myEntry) + 1 : null

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-dark flex items-center gap-2">
            <Trophy size={24} className="text-yellow-500" />
            Ranking Inbound
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Productividad del equipo (OB + R2S)</p>
        </div>

        {myEntry && myRank && (
          <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-2xl px-4 py-2">
            <Crown size={16} className="text-primary" />
            <div>
              <p className="text-[10px] text-gray-400">Tu posición</p>
              <p className="text-lg font-extrabold text-primary">#{myRank}</p>
            </div>
            <div className="border-l border-primary/20 pl-3">
              <p className="text-[10px] text-gray-400">Productividad</p>
              <p className="text-lg font-extrabold text-dark">{myEntry.productivity}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <SourceToggle value={source} onChange={setSource} />
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          className="h-9 px-3 rounded-xl border border-gray-medium text-sm bg-white cursor-pointer font-semibold w-fit"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* ── Podium (top 3) ────────────────────────────────────────────────── */}
      {!isLoading && top3.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-w-xl mx-auto">
          {/* Order: 2nd | 1st | 3rd for visual podium */}
          {([2, 1, 3] as const).map((rank) => {
            const e = top3[rank - 1]
            if (!e) return <div key={rank} />
            return (
              <PodiumCard
                key={rank}
                entry={e}
                rank={rank}
                isCurrent={e.hunterId === user?.id}
              />
            )
          })}
        </div>
      )}

      {/* ── Full ranking table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-medium overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 w-12">#</th>
                <th
                  onClick={() => handleSort('hunterName')}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 cursor-pointer hover:text-dark"
                >
                  Hunter
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                  País
                </th>
                <th
                  onClick={() => handleSort('productivity')}
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400 cursor-pointer hover:text-dark"
                >
                  <span className="inline-flex items-center gap-1"><TrendingUp size={11} />Productividad</span>
                </th>
                <th
                  onClick={() => handleSort('contactabilityRate')}
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400 cursor-pointer hover:text-dark"
                >
                  <span className="inline-flex items-center gap-1"><Percent size={11} />Contactabilidad</span>
                </th>
                <th
                  onClick={() => handleSort('totalLeads')}
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400 cursor-pointer hover:text-dark"
                >
                  Leads
                </th>
              </tr>
            </thead>

            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : !sortedRanking.length
                ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-sm text-gray-400">
                      No hay datos de ranking para este período
                    </td>
                  </tr>
                )
                : sortedRanking.map((e) => (
                  <RankingRow
                    key={e.hunterId}
                    entry={e}
                    rank={e._rank}
                    isCurrent={e.hunterId === user?.id}
                  />
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-medium p-5">
        <div className="flex items-center gap-2 mb-3">
          <Star size={16} className="text-yellow-500" />
          <h2 className="text-sm font-bold text-dark">Cómo se calcula la productividad</h2>
        </div>
        <p className="text-sm text-gray-500">
          La productividad Inbound = <span className="font-semibold text-indigo-600">OB</span> +{' '}
          <span className="font-semibold text-success">OK R2S</span>. Refleja los leads que
          avanzaron a etapas clave del funnel en el período seleccionado.
        </p>
        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-400 inline-block" />
            <span className="text-xs text-gray-500">SOB</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-400 inline-block" />
            <span className="text-xs text-gray-500">SDR</span>
          </div>
        </div>
      </div>

    </div>
  )
}
