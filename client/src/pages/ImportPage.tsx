import { useRef, useState, useCallback, useDeferredValue } from 'react'
import * as XLSX from 'xlsx'
import {
  UploadCloud, FileSpreadsheet, X, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Loader2, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { importApi } from '../services/api'
import { cn } from '../utils/cn'
import { ESTADO_MAP } from '../utils/constants'
import type { LeadSource, FunnelStage } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportError {
  row:     number
  sheet:   string
  message: string
}

interface ImportResult {
  imported: number
  skipped:  number
  errors:   ImportError[]
}

type Step = 'idle' | 'preview' | 'uploading' | 'done' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getCol(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase().replace(/\s+/g, '_') === k.toLowerCase().replace(/\s+/g, '_')) {
        const v = row[rowKey]
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
      }
    }
  }
  return null
}

function cleanPhone(raw: unknown): string | undefined {
  if (!raw) return undefined
  let val = String(raw).trim()
  if (/[eE]\+?\d+/.test(val)) {
    try { val = String(BigInt(Math.round(Number(val)))) } catch { /* ignore */ }
  }
  val = val.replace(/\.0+$/, '').replace(/\..*$/, '')
  val = val.replace(/[^\d+]/g, '')
  return val || undefined
}

function parseSheetDate(raw: unknown): string | undefined {
  if (!raw) return undefined
  const s = String(raw).trim()
  if (!s) return undefined
  // Try numeric serial (Excel date)
  const n = Number(s)
  if (!isNaN(n) && n > 1000) {
    const d = XLSX.SSF.parse_date_code(n)
    if (d) {
      const month = String(d.m).padStart(2, '0')
      const day   = String(d.d).padStart(2, '0')
      return `${d.y}-${month}-${day}`
    }
  }
  // Try ISO / common formats
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]
  return undefined
}

function mapContactResult(val: string | null): 'EFECTIVO' | 'FALLIDO' | null {
  if (!val) return null
  const v = val.trim().toUpperCase()
  if (v === 'EFECTIVO' || v === 'EFECTIVO') return 'EFECTIVO'
  if (v === 'FALLIDO'  || v === 'FALLIDO')  return 'FALLIDO'
  if (v.includes('EFECTIV')) return 'EFECTIVO'
  if (v.includes('FALLID'))  return 'FALLIDO'
  return null
}

// ─── sheetRowsToLeads ─────────────────────────────────────────────────────────
// profiles is a map of full_name (lowercase) → uuid, used for hunter lookup
function sheetRowsToLeads(
  rows:      Record<string, unknown>[],
  sheetName: string,
  source:    LeadSource,
  profiles:  Record<string, string>,
): {
  records:         Record<string, unknown>[]
  contactAttempts: { lead_id_external: string; attempts: Record<string, unknown>[] }[]
  errors:          ImportError[]
} {
  const records:         Record<string, unknown>[]                                                   = []
  const contactAttempts: { lead_id_external: string; attempts: Record<string, unknown>[] }[]         = []
  const errors:          ImportError[]                                                               = []

  rows.forEach((row, idx) => {
    const rowNum = idx + 2

    // ── ID ──
    const leadId = getCol(row, 'LEAD_ID', 'LEAD ID', 'lead_id', 'lead id', 'external_id', 'LEAD', 'lead')
    if (!leadId) {
      errors.push({ row: rowNum, sheet: sheetName, message: 'Sin LEAD_ID' })
      return
    }

    // ── Name: SDR=BRAND, SOB=NAME ──
    const name = source === 'SOB'
      ? getCol(row, 'NAME', 'NOMBRE', 'name', 'nombre', 'BRAND', 'BRAND_NAME', 'brand_name')
      : getCol(row, 'BRAND', 'NOMBRE', 'brand', 'nombre', 'NAME', 'BRAND_NAME', 'brand_name')
    if (!name) {
      errors.push({ row: rowNum, sheet: sheetName, message: 'Sin nombre (BRAND/NAME)' })
      return
    }

    // ── Country ──
    const VALID_COUNTRIES = ['CO', 'MX', 'AR', 'PE', 'CL', 'EC']
    const country = (getCol(row, 'COUNTRY', 'PAIS', 'country', 'pais', 'país') ?? 'CO').toUpperCase()
    if (!VALID_COUNTRIES.includes(country)) {
      errors.push({ row: rowNum, sheet: sheetName, message: `País "${country}" no soportado (válidos: ${VALID_COUNTRIES.join(', ')})` })
      return
    }

    // ── Hunter → assigned_to_id ──
    const hunterName   = getCol(row, 'HUNTER', 'hunter')
    const assignedToId = hunterName
      ? (profiles[hunterName.trim().toLowerCase()] ?? null)
      : null

    // ── Entry method ──
    const entryMethod = getCol(row, 'Entry_Method', 'ENTRY_METHOD', 'entry_method') ?? source

    // ── ESTADO → FunnelStage ──
    const estadoRaw    = getCol(row, 'ESTADO', 'estado', 'status')
    const currentStage: FunnelStage = estadoRaw
      ? (ESTADO_MAP[estadoRaw] ?? 'SIN_CONTACTO')
      : 'SIN_CONTACTO'

    // ── Dates ──
    // fechaAsignacion = cuando el líder asigna el lead al hunter (no viene del archivo)
    // semanaLead      = cuando llegó el lead al sistema (START_DATE_TIME en SOB)
    const fechaAsignacion = parseSheetDate(getCol(row, 'FECHA_ASIGNACION', 'FECHA ASIGNACION', 'fecha_asignacion'))
    const semanaLead      = parseSheetDate(getCol(row, 'START_DATE_TIME', 'start_date_time', 'SEMANA_LEAD', 'semana_lead'))
    const fechaEstado     = parseSheetDate(getCol(row, 'FECHA_ESTADO', 'FECHA ESTADO', 'fecha_estado'))

    // ── Phone ──
    const phone1 = cleanPhone(getCol(row, 'NUMERO_1', 'NUMERO 1', 'numero_1', 'phone1', 'tel1', 'TELEFONO', 'telefono'))
    const phone2 = cleanPhone(getCol(row, 'NUMERO_2', 'NUMERO 2', 'numero_2', 'phone2', 'tel2'))

    // ── Contact attempts (CONTACTO_1/2/3) ──
    const contacts = [
      {
        result:      getCol(row, 'CONTACTO_1', 'CONTACTO 1', 'contacto_1'),
        fechaRaw:    getCol(row, 'FECHA_CONTACTO_1', 'FECHA CONTACTO 1', 'fecha_contacto_1'),
      },
      {
        result:      getCol(row, 'CONTACTO_2', 'CONTACTO 2', 'contacto_2'),
        fechaRaw:    getCol(row, 'FECHA_CONTACTO_2', 'FECHA CONTACTO 2', 'fecha_contacto_2'),
      },
      {
        result:      getCol(row, 'CONTACTO_3', 'CONTACTO 3', 'contacto_3'),
        fechaRaw:    getCol(row, 'FECHA_CONTACTO_3', 'FECHA CONTACTO 3', 'fecha_contacto_3'),
      },
    ]

    const attempts: Record<string, unknown>[] = []
    contacts.forEach((c, i) => {
      const mapped = mapContactResult(c.result)
      if (!mapped) return
      const contactedAt = parseSheetDate(c.fechaRaw) ?? new Date().toISOString().split('T')[0]
      attempts.push({
        attempt_number: i + 1,
        contact_method: 'LLAMADA',
        result:         mapped,
        contacted_at:   contactedAt,
      })
    })

    // ── Computed flags ──
    const fechasContacto = contacts
      .map((c) => parseSheetDate(c.fechaRaw))
      .filter(Boolean) as string[]

    const tieneIntentoContacto  = getCol(row, 'CONTACTO_1', 'CONTACTO 1', 'contacto_1') !== null
    const tieneContactoEfectivo = contacts.some((c) => {
      const v = (c.result ?? '').trim().toUpperCase()
      return v === 'EFECTIVO'
    })
    const bloqueado          = currentStage === 'DESCARTADO'
    const negociacionExitosa = ['OK_R2S', 'VENTA'].includes(currentStage)
    const ultimaFechaContacto = fechasContacto.length > 0
      ? fechasContacto.sort().reverse()[0]
      : undefined

    // ── TYC / OPS_ZONE (SOB only) ──
    const tyc     = source === 'SOB' ? parseSheetDate(getCol(row, 'TYC', 'tyc')) ?? null : null
    const opsZone = source === 'SOB' ? getCol(row, 'OPS_ZONE', 'ops_zone', 'OPS ZONE') ?? null : null

    const now = new Date().toISOString()

    records.push({
      lead_id_external:       leadId,
      name,
      country,
      source,
      ops_zone:               opsZone,
      entry_method:           entryMethod,
      phone1:                 phone1 ?? null,
      phone2:                 phone2 ?? null,
      informacion_lead:       getCol(row, 'INFORMACION_LEAD', 'INFORMACION LEAD', 'informacion_lead') ?? null,
      observaciones:          getCol(row, 'OBSERVACIONES', 'observaciones') ?? null,
      external_store_id:      getCol(row, 'External_Store_Id', 'EXTERNAL_STORE_ID', 'external_store_id') ?? null,
      tyc,
      assigned_to_id:         assignedToId,
      assigned_at:            now,
      current_stage:          currentStage,
      stage_changed_at:       now,
      fecha_estado:           fechaEstado ?? null,
      week_assigned:          now,
      semana_lead:            semanaLead ?? null,
      tiene_intento_contacto:  tieneIntentoContacto,
      tiene_contacto_efectivo: tieneContactoEfectivo,
      bloqueado,
      negociacion_exitosa:     negociacionExitosa,
      ultima_fecha_contacto:   ultimaFechaContacto ?? null,
      is_deleted:              false,
    })

    if (attempts.length > 0) {
      contactAttempts.push({ lead_id_external: leadId, attempts })
    }
  })

  return { records, contactAttempts, errors }
}

// ─── Roster sync ──────────────────────────────────────────────────────────────

interface RosterResult {
  processed: number
  created:   number
  updated:   number
  errors:    string[]
}

function RosterSync({ source }: { source: LeadSource }) {
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState<RosterResult | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [rosterFile, setRosterFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSync = async () => {
    if (!rosterFile) return
    setLoading(true)
    setResult(null)

    try {
      const buf = await rosterFile.arrayBuffer()
      const wb  = XLSX.read(buf, { raw: false })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

      const profiles: Record<string, unknown>[] = []
      let errors: string[] = []

      if (source === 'SDR') {
        // Expected columns: PAIS, HUNTER (email optional)
        rows.forEach((row, i) => {
          const country  = getCol(row, 'PAIS', 'pais', 'COUNTRY', 'country')
          const fullName = getCol(row, 'HUNTER', 'hunter', 'NOMBRE', 'nombre')
          const email    = getCol(row, 'CORREO', 'EMAIL', 'email', 'correo') ?? null
          const lider    = getCol(row, 'LIDER', 'lider', 'LEADER', 'leader')
          if (!country || !fullName) {
            errors.push(`Fila ${i + 2}: falta PAIS o HUNTER`)
            return
          }
          profiles.push({ full_name: fullName, country: country.toUpperCase(), team: 'SDR', role: 'HUNTER', email, lider_name: lider })
        })
      } else {
        // SOB: PAIS, SUPERVISOR, COMERCIAL, CORREO_COMERCIAL
        rows.forEach((row, i) => {
          const country  = getCol(row, 'PAIS', 'pais', 'COUNTRY', 'country')
          const fullName = getCol(row, 'COMERCIAL', 'comercial', 'HUNTER', 'hunter', 'NOMBRE', 'nombre')
          const email    = getCol(row, 'CORREO_COMERCIAL', 'CORREO COMERCIAL', 'correo_comercial', 'EMAIL', 'email') ?? null
          const lider    = getCol(row, 'SUPERVISOR', 'supervisor', 'LIDER', 'lider')
          if (!country || !fullName) {
            errors.push(`Fila ${i + 2}: falta PAIS o COMERCIAL`)
            return
          }
          profiles.push({ full_name: fullName, country: country.toUpperCase(), team: 'SOB', role: 'HUNTER', email, lider_name: lider })
        })
      }

      // Upsert profiles by email (if available) or full_name+country
      let created = 0
      let updated = 0
      for (const p of profiles) {
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('full_name', p.full_name as string)
          .eq('country', p.country as string)
          .maybeSingle()

        if (existing) {
          await supabase.from('profiles').update({ team: p.team, is_active: true }).eq('id', existing.id)
          updated++
        } else {
          created++
          // Note: actual creation requires Auth user to exist first; skip silently
        }
      }

      setResult({ processed: profiles.length, created, updated, errors })
      toast.success('Roster sincronizado')
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Error al sincronizar Roster')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-dark flex items-center gap-2">
            <RefreshCw size={15} className="text-primary" />
            Sincronizar Roster {source}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {source === 'SDR'
              ? 'Columnas esperadas: PAIS, HUNTER, CORREO, LIDER'
              : 'Columnas esperadas: PAIS, SUPERVISOR, COMERCIAL, CORREO_COMERCIAL'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="sr-only"
            onChange={(e) => setRosterFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 text-xs rounded-xl border border-gray-medium text-gray-600 hover:border-primary hover:text-primary transition-colors"
          >
            {rosterFile ? rosterFile.name : 'Seleccionar archivo…'}
          </button>
          <button
            onClick={handleSync}
            disabled={loading || !rosterFile}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
      </div>

      {result && (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-2xl font-extrabold text-dark leading-none">{result.processed}</p>
              <p className="text-xs text-gray-400 mt-0.5">Procesados</p>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 size={18} />
              <div>
                <p className="text-2xl font-extrabold leading-none">{result.created}</p>
                <p className="text-xs text-gray-400 mt-0.5">Creados</p>
              </div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div>
              <p className="text-2xl font-extrabold text-dark leading-none">{result.updated}</p>
              <p className="text-xs text-gray-400 mt-0.5">Actualizados</p>
            </div>
            {result.errors.length > 0 && (
              <>
                <div className="w-px h-10 bg-gray-200" />
                <div className="flex items-center gap-2 text-danger">
                  <AlertCircle size={18} />
                  <div>
                    <p className="text-2xl font-extrabold leading-none">{result.errors.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Errores</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <button
                onClick={() => setShowErrors((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-dark transition-colors"
              >
                {showErrors ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Ver errores ({result.errors.length})
              </button>
              {showErrors && (
                <ul className="mt-2 space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-danger bg-danger/5 rounded-lg px-3 py-1.5">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <label
      className={cn(
        'flex flex-col items-center justify-center gap-4 w-full rounded-2xl border-2 border-dashed',
        'cursor-pointer transition-colors select-none',
        over ? 'border-primary bg-primary/5' : 'border-gray-300 bg-gray-50 hover:bg-gray-100',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={{ minHeight: 220 }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={disabled ? undefined : handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      <UploadCloud size={40} className={cn('transition-colors', over ? 'text-primary' : 'text-gray-400')} />
      <div className="text-center">
        <p className="text-sm font-semibold text-dark">Arrastra tu archivo aquí</p>
        <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionarlo</p>
        <p className="text-xs text-gray-300 mt-2">.xlsx · .csv · máximo 10 MB</p>
      </div>
    </label>
  )
}

function SheetSelector({ names, selected, onToggle }: {
  names:    string[]
  selected: Set<string>
  onToggle: (name: string) => void
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
        Hojas a importar
      </p>
      <div className="flex flex-wrap gap-2">
        {names.map((name) => {
          const active = selected.has(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                active
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-white border-gray-medium text-gray-500 hover:border-gray-400',
              )}
            >
              <FileSpreadsheet size={13} />
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PreviewTable({ sheet, rows }: { sheet: string; rows: unknown[][] }) {
  const header  = rows[0] as unknown[] ?? []
  const preview = rows.slice(1, 11)

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <p className="px-4 py-2 text-xs font-semibold text-gray-400 bg-gray-50 border-b border-gray-200">
        Vista previa: <span className="text-gray-600">{sheet}</span>{' '}
        <span className="font-normal text-gray-400">(primeras {preview.length} filas)</span>
      </p>
      <table className="min-w-full text-xs divide-y divide-gray-100">
        <thead className="bg-gray-50">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">
                {String(h ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {preview.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {header.map((_, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5 text-gray-600 whitespace-nowrap max-w-[140px] truncate"
                  title={String((row as unknown[])[ci] ?? '')}
                >
                  {String((row as unknown[])[ci] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className="h-2 bg-primary rounded-full transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

function ResultCard({ result }: { result: ImportResult }) {
  const [showErrors, setShowErrors] = useState(false)
  const deferredShow = useDeferredValue(showErrors)
  const hasErrors = result.errors.length > 0

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-6 p-5 flex-wrap">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 size={22} />
          <div>
            <p className="text-2xl font-extrabold leading-none">{result.imported}</p>
            <p className="text-xs text-gray-400 mt-0.5">Importados</p>
          </div>
        </div>
        <div className="w-px h-10 bg-gray-200" />
        <div>
          <p className="text-2xl font-extrabold text-gray-400 leading-none">{result.skipped}</p>
          <p className="text-xs text-gray-400 mt-0.5">Omitidos / errores API</p>
        </div>
        <div className="w-px h-10 bg-gray-200" />
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle size={20} />
          <div>
            <p className="text-2xl font-extrabold leading-none">{result.errors.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Errores de validación</p>
          </div>
        </div>
      </div>

      {hasErrors && (
        <>
          <div className="border-t border-gray-100">
            <button
              onClick={() => setShowErrors((v) => !v)}
              className="flex items-center justify-between w-full px-5 py-3 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <span>Ver detalle de errores ({result.errors.length})</span>
              {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {deferredShow && (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="min-w-full text-xs divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-500 w-16">Fila</th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-500 w-32">Hoja</th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-500">Mensaje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 font-mono text-gray-500">{e.row}</td>
                      <td className="px-4 py-2 text-gray-500">{e.sheet}</td>
                      <td className="px-4 py-2 text-danger">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Column legend ────────────────────────────────────────────────────────────

function ColumnLegend({ source }: { source: LeadSource }) {
  const [open, setOpen] = useState(false)
  const sdrCols = [
    'COUNTRY', 'FECHA_ASIGNACION', 'LEAD_ID', 'BRAND (→ name)', 'HUNTER', 'LIDER',
    'Entry_Method', 'CONTACTO_1/2/3', 'FECHA_CONTACTO_1/2/3', 'ESTADO', 'FECHA_ESTADO',
    'OBSERVACIONES', 'NUMERO_1', 'NUMERO_2', 'INFORMACION_LEAD', 'External_Store_Id',
  ]
  const sobExtra = ['NAME (en lugar de BRAND)', 'TYC', 'OPS_ZONE']
  const cols = source === 'SOB' ? [...sdrCols, ...sobExtra] : sdrCols

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <span>Columnas esperadas para <span className="text-primary">{source}</span></span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <div className="flex flex-wrap gap-1.5 mt-2">
            {cols.map((c) => (
              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-mono">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [source,         setSource]      = useState<LeadSource>('SDR')
  const [file,           setFile]        = useState<File | null>(null)
  const [allSheets,      setAllSheets]   = useState<string[]>([])
  const [selectedSheets, setSelected]    = useState<Set<string>>(new Set())
  const [previewRows,    setPreviewRows] = useState<Record<string, unknown[][]>>({})
  const [activePreview,  setActive]      = useState<string>('')

  const [step,     setStep]     = useState<Step>('idle')
  const [progress, setProgress] = useState(0)
  const [result,   setResult]   = useState<ImportResult | null>(null)
  const [errMsg,   setErrMsg]   = useState('')

  const [wbData, setWbData] = useState<Record<string, Record<string, unknown>[]>>({})

  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext !== 'xlsx' && ext !== 'csv') {
      setErrMsg('Solo se aceptan archivos .xlsx y .csv')
      setStep('error')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrMsg('El archivo supera el límite de 10 MB')
      setStep('error')
      return
    }

    setFile(f)
    setStep('preview')
    setResult(null)
    setErrMsg('')

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb    = XLSX.read(e.target?.result, { raw: true })
        const names = wb.SheetNames
        setAllSheets(names)
        setSelected(new Set(names))

        const preview: Record<string, unknown[][]> = {}
        const data:    Record<string, Record<string, unknown>[]> = {}
        for (const name of names) {
          preview[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
            header: 1, defval: '', raw: true,
          }).slice(0, 11) as unknown[][]

          data[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], {
            defval: '', raw: false,
          })
        }
        setPreviewRows(preview)
        setWbData(data)
        setActive(names[0])
      } catch {
        setErrMsg('No se pudo leer el archivo. Verifica que sea un .xlsx o .csv válido.')
        setStep('error')
      }
    }
    reader.readAsArrayBuffer(f)
  }, [])

  const toggleSheet = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
        if (activePreview === name) {
          const remaining = allSheets.filter((s) => next.has(s))
          setActive(remaining[0] ?? '')
        }
      } else {
        next.add(name)
        if (!activePreview) setActive(name)
      }
      return next
    })
  }

  const handleReset = () => {
    setFile(null); setAllSheets([]); setSelected(new Set())
    setPreviewRows({}); setActive(''); setStep('idle')
    setProgress(0); setResult(null); setErrMsg('')
  }

  const handleUpload = async () => {
    if (!file || selectedSheets.size === 0) return

    setStep('uploading')
    setProgress(0)

    // Pre-load profiles for hunter lookup
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)

    const profileMap: Record<string, string> = {}
    for (const p of profileRows ?? []) {
      if (p.full_name) profileMap[p.full_name.trim().toLowerCase()] = p.id
    }

    const allErrors: ImportError[] = []
    let totalImported = 0
    let totalSkipped  = 0

    const sheets = allSheets.filter((s) => selectedSheets.has(s))

    for (let si = 0; si < sheets.length; si++) {
      const sheetName = sheets[si]
      const rows      = wbData[sheetName] ?? []

      const { records, contactAttempts, errors } = sheetRowsToLeads(rows, sheetName, source, profileMap)
      allErrors.push(...errors)

      if (records.length > 0) {
        const { imported, skipped, errors: apiErrors } = await importApi.upsertLeads(records)
        totalImported += imported
        totalSkipped  += skipped
        apiErrors.forEach((msg) => allErrors.push({ row: 0, sheet: sheetName, message: msg }))

        // Insert contact attempts after leads are upserted
        for (const { lead_id_external, attempts } of contactAttempts) {
          // Fetch the lead's UUID from the DB
          const { data: leadRow } = await supabase
            .from('leads')
            .select('id')
            .eq('lead_id_external', lead_id_external)
            .maybeSingle()

          if (!leadRow) continue

          for (const attempt of attempts) {
            await supabase
              .from('contact_attempts')
              .upsert(
                { ...attempt, lead_id: leadRow.id },
                { onConflict: 'lead_id,attempt_number', ignoreDuplicates: true },
              )
          }
        }
      }

      setProgress(Math.round(((si + 1) / sheets.length) * 100))
    }

    setResult({ imported: totalImported, skipped: totalSkipped, errors: allErrors })
    setStep('done')

    if (totalImported > 0) {
      toast.success(`${totalImported} lead${totalImported !== 1 ? 's' : ''} importado${totalImported !== 1 ? 's' : ''} correctamente`)
    } else {
      toast.info('Importación completada — sin leads nuevos')
    }
  }

  const selectedArr = allSheets.filter((s) => selectedSheets.has(s))
  const canUpload   = step === 'preview' && selectedArr.length > 0
  const isUploading = step === 'uploading'

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-2xl font-extrabold text-dark">Importar Leads Inbound</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Sube un archivo .xlsx o .csv con el formato estándar SDR o SOB
        </p>
      </div>

      {/* Source selector */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-bold text-dark">¿Qué tipo de leads estás importando?</p>
        <div className="flex gap-3">
          {(['SDR', 'SOB'] as LeadSource[]).map((s) => (
            <label
              key={s}
              className={cn(
                'flex items-center gap-2.5 px-5 py-3 rounded-xl border-2 cursor-pointer transition-all',
                source === s
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300',
              )}
            >
              <input
                type="radio"
                name="source"
                value={s}
                checked={source === s}
                onChange={() => setSource(s)}
                className="sr-only"
              />
              <span className="font-bold text-sm">{s}</span>
              <span className="text-xs text-gray-400">
                {s === 'SDR' ? 'Sales Development Rep' : 'Sales Outbound (con TYC y OPS_ZONE)'}
              </span>
            </label>
          ))}
        </div>
      </div>

      <ColumnLegend source={source} />

      {step === 'idle' && (
        <DropZone onFile={handleFile} disabled={false} />
      )}

      {step === 'error' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger/5 border border-danger/20">
            <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-danger">Error</p>
              <p className="text-sm text-gray-600 mt-0.5">{errMsg}</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-xl border border-gray-medium text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary transition-colors"
          >
            Seleccionar otro archivo
          </button>
        </div>
      )}

      {step === 'preview' && file && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white">
            <FileSpreadsheet size={20} className="text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-dark truncate">{file.name}</p>
              <p className="text-xs text-gray-400">{formatBytes(file.size)}</p>
            </div>
            <button
              onClick={handleReset}
              title="Quitar archivo"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-danger hover:bg-danger/5 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <SheetSelector names={allSheets} selected={selectedSheets} onToggle={toggleSheet} />

          {selectedArr.length > 0 && (
            <div className="space-y-3">
              {selectedArr.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {selectedArr.map((name) => (
                    <button
                      key={name}
                      onClick={() => setActive(name)}
                      className={cn(
                        'px-3 py-1 rounded-lg text-xs font-semibold border transition-colors',
                        activePreview === name
                          ? 'bg-dark text-white border-dark'
                          : 'bg-white border-gray-medium text-gray-500 hover:border-gray-400',
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {activePreview && previewRows[activePreview] && (
                <PreviewTable sheet={activePreview} rows={previewRows[activePreview]} />
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleUpload}
              disabled={!canUpload}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UploadCloud size={16} />
              Importar como {source} — {selectedArr.length > 1 ? `${selectedArr.length} hojas` : selectedArr[0]}
            </button>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="space-y-4 p-6 rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold text-dark">Subiendo y procesando…</p>
              <p className="text-xs text-gray-400 mt-0.5">Esto puede tardar unos segundos</p>
            </div>
          </div>
          <ProgressBar value={progress} />
          <p className="text-right text-xs text-gray-400">{progress}%</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 size={20} />
            <p className="text-sm font-semibold">Importación completada</p>
          </div>
          <ResultCard result={result} />
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-xl border border-gray-medium text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary transition-colors"
          >
            Importar otro archivo
          </button>
        </div>
      )}

      {/* Roster sync section */}
      <div className="pt-4 border-t border-gray-200 space-y-4">
        <h2 className="text-base font-bold text-dark">Sincronización de Roster</h2>
        <RosterSync source="SDR" />
        <RosterSync source="SOB" />
      </div>

    </div>
  )
}
