import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowLeft, ChevronRight, Copy, Check, Phone, Calendar,
  FileText, Clock, CheckCircle2, XCircle, Circle, AlertTriangle,
  ChevronDown, X, Loader2, RefreshCw, Mail,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, contactsApi, stageApi, reassignApi } from '../services/api'
import { cn } from '../utils/cn'
import { STAGE_LABEL, STAGE_COLORS, STAGE_TRANSITIONS, COUNTRY_FLAG, BLOCKED_STAGES } from '../utils/constants'
import { useAuth } from '../context/AuthContext'
import type { Lead, ContactAttempt, StageHistory, FunnelStage, LeadSource, Reassignment } from '../types'
import type { ContactResult, ContactMethod } from '../types'

// ─── Local label helpers ──────────────────────────────────────────────────────

const STAGE_LABEL_FULL: Record<FunnelStage, string> = {
  SIN_CONTACTO:                 'Sin Contacto',
  CONTACTO_FALLIDO:             'Contacto Fallido',
  CONTACTO_EFECTIVO:            'Contacto Efectivo',
  EN_GESTION:                   'En Gestión',
  PROPUESTA_ENVIADA:            'Propuesta Enviada',
  ESPERANDO_DOCUMENTOS:         'Esperando Documentos',
  EN_FIRMA:                     'En Firma',
  OB:                           'OB',
  OK_R2S:                       'OK R2S',
  VENTA:                        'Venta',
  BLOQUEADO_NO_INTERESA:        'Bloq. No Interesa',
  BLOQUEADO_IMPOSIBLE_CONTACTO: 'Bloq. Imposible Contacto',
  BLOQUEADO_FUERA_COBERTURA:    'Bloq. Fuera Cobertura',
  BLOQUEADO_NO_RESTAURANTE:     'Bloq. No Restaurante',
  BLOQUEADO_RESTAURANTE_CERRADO:'Bloq. Rest. Cerrado',
  BLOQUEADO_YA_EN_RAPPI:        'Bloq. Ya en Rappi',
}

const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  LLAMADA:  'Llamada',
  WHATSAPP: 'WhatsApp',
  CORREO:   'Correo',
}

const CONTACT_RESULT_LABEL: Record<ContactResult, string> = {
  EFECTIVO: 'Exitoso',
  FALLIDO:  'Fallido',
  OCUPADO:  'Ocupado',
}

const CONTACT_BLOCKED_STAGES: FunnelStage[] = [
  ...BLOCKED_STAGES, 'OK_R2S', 'VENTA',
]

// ─── Stage badge helpers ──────────────────────────────────────────────────────

function stageBadgeClass(stage: FunnelStage): string {
  if (stage === 'OK_R2S')            return 'bg-green-50 text-green-700 border-green-200'
  if (stage === 'VENTA')             return 'bg-green-50 text-green-700 border-green-200'
  if (stage === 'PROPUESTA_ENVIADA') return 'bg-teal-50 text-teal-700 border-teal-200'
  if (stage === 'OB')                return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (stage === 'CONTACTO_EFECTIVO') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (stage === 'CONTACTO_FALLIDO')  return 'bg-orange-50 text-orange-700 border-orange-200'
  if (stage === 'SIN_CONTACTO')      return 'bg-gray-100 text-gray-500 border-gray-200'
  if (stage === 'EN_GESTION')        return 'bg-cyan-50 text-cyan-700 border-cyan-200'
  if (stage === 'EN_FIRMA')          return 'bg-amber-50 text-amber-700 border-amber-200'
  if (stage === 'ESPERANDO_DOCUMENTOS')
    return 'bg-purple-50 text-purple-700 border-purple-200'
  if ((stage as string).startsWith('BLOQUEADO'))
    return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-100 text-gray-500 border-gray-200'
}

function StageBadge({ stage, size = 'md' }: { stage: FunnelStage; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-semibold border',
      size === 'sm' && 'px-2 py-0.5 text-[11px]',
      size === 'md' && 'px-2.5 py-1 text-xs',
      size === 'lg' && 'px-3.5 py-1.5 text-sm',
      stageBadgeClass(stage),
    )}>
      {STAGE_LABEL[stage]}
    </span>
  )
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-bold border px-2.5 py-1 text-xs',
      source === 'SDR'
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-purple-50 text-purple-700 border-purple-200',
    )}>
      {source}
    </span>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const COUNTRY_DIAL: Record<string, string> = {
  CO: '57', MX: '52', AR: '54', PE: '51', CL: '56', EC: '593',
}

function buildWhatsAppUrl(raw: string, country: string): string {
  let num = raw
  if (/[eE]\+?\d+/.test(num)) {
    num = String(BigInt(Math.round(Number(num))))
  }
  num = num.replace(/[\s\-.()\u00A0]+/g, '').replace(/\.0+$/, '').replace(/\..*$/, '')
  if (num.startsWith('+')) num = num.slice(1)
  num = num.replace(/^0+/, '')
  const knownPrefixes = ['593', '57', '52', '54', '51', '56']
  const hasPrefix = knownPrefixes.some((p) => num.startsWith(p))
  if (!hasPrefix) {
    const dialCode = COUNTRY_DIAL[country] ?? '57'
    num = dialCode + num
  }
  const msg = encodeURIComponent('Hola, te contacto de parte de Rappi')
  return `https://wa.me/${num}?text=${msg}`
}

function WhatsAppButton({ phone, country }: { phone: string; country: string }) {
  return (
    <a
      href={buildWhatsAppUrl(phone, country)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-lg text-white text-xs font-semibold transition-opacity hover:opacity-80"
      style={{ backgroundColor: '#25D366' }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
      WhatsApp
    </a>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="ml-1.5 text-gray-400 hover:text-blue-600 transition-colors"
      title="Copiar"
    >
      {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
    </button>
  )
}

function EditablePhone({
  leadId, field, label, value, country, onSaved,
}: {
  leadId: string; field: 'phone1' | 'phone2'; label: string;
  value?: string; country: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone]     = useState(value ?? '')
  const [saving, setSaving]   = useState(false)

  const save = async () => {
    if (!phone.trim()) return
    setSaving(true)
    try {
      await leadsApi.updateLead(leadId, { [field]: phone.trim() })
      toast.success('Telefono guardado')
      setEditing(false)
      onSaved()
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-100">
        <span className="text-xs text-gray-400 font-medium w-36 shrink-0 mt-2">{label}</span>
        <div className="flex items-center gap-2 flex-1">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ej: 3001234567"
            className="flex-1 h-8 px-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
            autoFocus
          />
          <button
            onClick={save}
            disabled={saving || !phone.trim()}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Guardar'}
          </button>
          <button
            onClick={() => { setEditing(false); setPhone(value ?? '') }}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-700"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  if (value) {
    return (
      <div className="flex items-start gap-3 py-2.5 border-b border-gray-100">
        <span className="text-xs text-gray-400 font-medium w-36 shrink-0 mt-0.5">{label}</span>
        <span className="text-sm text-gray-800 flex-1">
          <span className="flex items-center flex-wrap gap-y-1">
            <Phone size={13} className="text-gray-400 mr-1.5 shrink-0" />
            <span className="font-mono text-sm">{value}</span>
            <CopyButton value={value} />
            <WhatsAppButton phone={value} country={country} />
            <button
              onClick={() => setEditing(true)}
              className="ml-2 text-xs text-gray-400 hover:text-blue-600 transition-colors"
              title="Editar telefono"
            >
              Editar
            </button>
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100">
      <span className="text-xs text-gray-400 font-medium w-36 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
        >
          <Phone size={12} />
          + Agregar telefono
        </button>
      </span>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 font-medium w-36 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1 break-words">{children}</span>
    </div>
  )
}

function fmtDate(iso: string, pattern = "d 'de' MMMM 'de' yyyy") {
  return format(parseISO(iso), pattern, { locale: es })
}

// ─── Contact Modal (inline) ───────────────────────────────────────────────────

function ContactModal({
  leadId,
  contactNumber,
  onClose,
  onSuccess,
}: {
  leadId:        string
  contactNumber: number
  onClose:       () => void
  onSuccess:     () => void
}) {
  const queryClient = useQueryClient()
  const [method,      setMethod]      = useState<ContactMethod>('LLAMADA')
  const [result,      setResult]      = useState<ContactResult>('EFECTIVO')
  const [notes,       setNotes]       = useState('')
  const [contactedAt, setContactedAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"))

  const mutation = useMutation({
    mutationFn: () =>
      contactsApi.createContact(leadId, {
        contactMethod: method,
        result,
        notes:       notes.trim() || undefined,
        contactedAt: new Date(contactedAt).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] })
      toast.success(`Contacto ${contactNumber} registrado`)
      onSuccess()
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message ?? 'Error al registrar contacto'
      toast.error(msg)
    },
  })

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">Registrar Contacto {contactNumber}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Intento {contactNumber} de 3</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Contact method */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Medio de contacto
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['LLAMADA', 'WHATSAPP', 'CORREO'] as ContactMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  'flex items-center justify-center gap-1.5 p-3 rounded-xl border-2 text-sm font-semibold transition-all',
                  method === m
                    ? 'border-blue-500 bg-blue-50 text-blue-600'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300',
                )}
              >
                {m === 'LLAMADA'   && <Phone size={14} />}
                {m === 'WHATSAPP'  && (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                )}
                {m === 'CORREO'    && <Mail size={14} />}
                {CONTACT_METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Result */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Resultado
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['EFECTIVO', 'FALLIDO', 'OCUPADO'] as ContactResult[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setResult(r)}
                className={cn(
                  'flex items-center gap-1.5 justify-center p-3 rounded-xl border-2 text-sm font-semibold transition-all',
                  result === r && r === 'EFECTIVO' && 'border-green-500 bg-green-50 text-green-600',
                  result === r && r === 'FALLIDO'  && 'border-red-500 bg-red-50 text-red-600',
                  result === r && r === 'OCUPADO'  && 'border-orange-400 bg-orange-50 text-orange-600',
                  result !== r && 'border-gray-200 text-gray-500 hover:border-gray-300',
                )}
              >
                {r === 'EFECTIVO' && <CheckCircle2 size={14} />}
                {r === 'FALLIDO'  && <XCircle size={14} />}
                {r === 'OCUPADO'  && <Clock size={14} />}
                {CONTACT_RESULT_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {/* Datetime */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
            Fecha y hora
          </label>
          <input
            type="datetime-local"
            value={contactedAt}
            max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => setContactedAt(e.target.value)}
            className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5 block">
            Notas <span className="text-gray-400 normal-case font-normal">(opcional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Observaciones del intento de contacto..."
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition"
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
            disabled={mutation.isPending}
            className="flex-1 h-10 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  stage,
  onConfirm,
  onCancel,
  isPending,
}: {
  stage:     FunnelStage
  onConfirm: () => void
  onCancel:  () => void
  isPending: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-orange-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Confirmar cambio de etapa?</h3>
            <p className="text-sm text-gray-400 mt-1">
              Vas a mover el lead a <span className="font-semibold text-gray-900">{STAGE_LABEL_FULL[stage]}</span>.
              Esta accion puede ser dificil de revertir.
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
            disabled={isPending}
            className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Lead detail type (includes nested data) ──────────────────────────────────

type LeadDetail = Lead & {
  contactAttempts: ContactAttempt[]
  stageHistory:    StageHistory[]
}

// ─── Info card ────────────────────────────────────────────────────────────────

function InfoCard({
  lead,
  onRefresh,
}: {
  lead:      LeadDetail
  onRefresh: () => void
}) {
  const queryClient = useQueryClient()
  const [obs,   setObs]   = useState(lead.observaciones ?? '')
  const [dirty, setDirty] = useState(false)

  const obsMutation = useMutation({
    mutationFn: (value: string) =>
      leadsApi.updateLead(lead.id, { observaciones: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] })
      toast.success('Observaciones guardadas')
      setDirty(false)
    },
    onError: () => toast.error('Error al guardar observaciones'),
  })

  const handleObsChange = (v: string) => {
    setObs(v)
    setDirty(v !== (lead.observaciones ?? ''))
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <FileText size={15} className="text-gray-400" />
          Informacion del Lead
        </h2>
      </div>

      <div className="px-5 py-3">
        <InfoRow label="Lead ID">
          <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
            {lead.leadIdExternal}
          </span>
        </InfoRow>

        <InfoRow label="Fuente">
          <SourceBadge source={lead.source} />
        </InfoRow>

        <InfoRow label="Pais">
          <span className="flex items-center gap-1.5">
            {COUNTRY_FLAG[lead.country] ?? ''} {lead.country}
          </span>
        </InfoRow>

        {lead.opsZone && (
          <InfoRow label="Zona operativa">
            {lead.opsZone}
          </InfoRow>
        )}

        {lead.externalStoreId && (
          <InfoRow label="Store ID Externo">
            <span className="font-mono text-xs">{lead.externalStoreId}</span>
          </InfoRow>
        )}

        {lead.informacionLead && (
          <InfoRow label="Informacion Lead">
            <span className="text-xs">{lead.informacionLead}</span>
          </InfoRow>
        )}

        {lead.source === 'SOB' && lead.tyc && (
          <InfoRow label="TyC">
            <span className="flex items-center gap-1.5">
              <Calendar size={13} className="text-gray-400 shrink-0" />
              {fmtDate(lead.tyc)}
            </span>
          </InfoRow>
        )}

        <InfoRow label="Asignado a">
          {lead.assignedTo?.fullName ?? '---'}
        </InfoRow>

        <InfoRow label="Fecha asignacion">
          <span className="flex items-center gap-1.5">
            <Calendar size={13} className="text-gray-400 shrink-0" />
            {fmtDate(lead.assignedAt)}
          </span>
        </InfoRow>

        {lead.ultimaFechaContacto && (
          <InfoRow label="Ultimo contacto">
            <span className="flex items-center gap-1.5">
              <Clock size={13} className="text-gray-400 shrink-0" />
              {fmtDate(lead.ultimaFechaContacto, "d MMM yyyy, HH:mm")}
            </span>
          </InfoRow>
        )}

        <EditablePhone
          leadId={lead.id}
          field="phone1"
          label="Telefono 1"
          value={lead.phone1}
          country={lead.country}
          onSaved={onRefresh}
        />
        <EditablePhone
          leadId={lead.id}
          field="phone2"
          label="Telefono 2"
          value={lead.phone2}
          country={lead.country}
          onSaved={onRefresh}
        />

        {/* Status flags */}
        <div className="flex items-start gap-3 py-2.5 border-b border-gray-100">
          <span className="text-xs text-gray-400 font-medium w-36 shrink-0 mt-0.5">Estado</span>
          <div className="flex flex-wrap gap-1.5">
            {lead.tieneIntentoContacto && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Contactado
              </span>
            )}
            {lead.tieneContactoEfectivo && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                C. Efectivo
              </span>
            )}
            {lead.bloqueado && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                Bloqueado
              </span>
            )}
            {lead.negociacionExitosa && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                Negociacion Exitosa
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Observations */}
      <div className="px-5 pb-5 pt-2">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2 block">
          Observaciones
        </label>
        <textarea
          value={obs}
          onChange={(e) => handleObsChange(e.target.value)}
          rows={4}
          placeholder="Sin observaciones..."
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition"
        />
        {dirty && (
          <div className="flex justify-end mt-2">
            <button
              onClick={() => obsMutation.mutate(obs)}
              disabled={obsMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {obsMutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Contact timeline ─────────────────────────────────────────────────────────

function ContactTimeline({ lead }: { lead: LeadDetail }) {
  const [modalSlot, setModalSlot] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const attempts = lead.contactAttempts
  const count    = attempts.length
  // Max 3 contacts
  const canRegisterMore = count < 3 && !CONTACT_BLOCKED_STAGES.includes(lead.currentStage)

  const resultBadgeClass = (r: ContactResult) => {
    if (r === 'EFECTIVO') return 'bg-green-100 text-green-700 border border-green-200'
    if (r === 'OCUPADO')  return 'bg-gray-100 text-gray-600 border border-gray-200'
    return 'bg-orange-100 text-orange-700 border border-orange-200'
  }

  const resultIcon = (r: ContactResult) => {
    if (r === 'EFECTIVO') return <CheckCircle2 size={28} className="text-green-500 bg-white rounded-full" />
    if (r === 'OCUPADO')  return <Clock size={28} className="text-gray-400 bg-white rounded-full" />
    return <XCircle size={28} className="text-orange-500 bg-white rounded-full" />
  }

  const methodBadge = (method: string) => {
    const cls =
      method === 'WHATSAPP' ? 'bg-green-100 text-green-700' :
      method === 'CORREO'   ? 'bg-blue-100 text-blue-700'   :
                              'bg-gray-100 text-gray-600'
    return (
      <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold', cls)}>
        {method === 'LLAMADA'   && <Phone size={10} />}
        {method === 'WHATSAPP'  && <span className="text-[9px]">WA</span>}
        {method === 'CORREO'    && <Mail size={10} />}
        {CONTACT_METHOD_LABEL[method as ContactMethod] ?? method}
      </span>
    )
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Phone size={15} className="text-gray-400" />
            Intentos de Contacto
            <span className="text-xs font-normal text-gray-400">({count}/3)</span>
          </h2>
        </div>

        <div className="px-5 py-4">
          <div className="relative">
            <div className="absolute left-[14px] top-4 bottom-4 w-px bg-gray-200" />
            <div className="space-y-5">
              {[1, 2, 3].map((slot) => {
                const attempt = attempts.find((a) => a.attemptNumber === slot)
                const isNext  = slot === count + 1

                return (
                  <div key={slot} className="flex gap-4 relative">
                    <div className="shrink-0 z-10">
                      {attempt
                        ? resultIcon(attempt.result)
                        : <Circle size={28} className="text-gray-300 bg-white rounded-full" strokeDasharray="4 2" />
                      }
                    </div>

                    <div className="flex-1 pb-1">
                      <p className="text-xs font-semibold text-gray-400 mb-1">Contacto {slot}</p>
                      {attempt ? (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', resultBadgeClass(attempt.result))}>
                              {CONTACT_RESULT_LABEL[attempt.result]}
                            </span>
                            {methodBadge(attempt.contactMethod)}
                            <span className="text-xs text-gray-400">
                              {formatDistanceToNow(parseISO(attempt.contactedAt), { addSuffix: true, locale: es })}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {fmtDate(attempt.contactedAt, "d MMM yyyy, HH:mm")}
                          </p>
                          {attempt.notes && (
                            <p className="mt-1.5 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                              {attempt.notes}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 h-7">
                          {canRegisterMore && isNext ? (
                            <button
                              onClick={() => setModalSlot(slot)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            >
                              + Registrar contacto {slot}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-300 italic">pendiente</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {count >= 3 && (
            <p className="text-xs text-center text-gray-400 mt-4 pt-4 border-t border-gray-100">
              Maximo de contactos alcanzado
            </p>
          )}
          {CONTACT_BLOCKED_STAGES.includes(lead.currentStage) && count < 3 && (
            <p className="text-xs text-center text-gray-400 mt-4 pt-4 border-t border-gray-100">
              No se pueden registrar contactos en etapa {STAGE_LABEL[lead.currentStage]}
            </p>
          )}
        </div>
      </div>

      {modalSlot !== null && (
        <ContactModal
          leadId={lead.id}
          contactNumber={modalSlot}
          onClose={() => setModalSlot(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['lead', lead.id] })}
        />
      )}
    </>
  )
}

// ─── Stage card ───────────────────────────────────────────────────────────────

function StageCard({
  lead,
}: {
  lead: LeadDetail
}) {
  const queryClient           = useQueryClient()
  const [selected, setSelected] = useState<FunnelStage | ''>('')
  const [confirm,  setConfirm]  = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const currentStage = lead.currentStage
  const transitions  = STAGE_TRANSITIONS[currentStage] ?? []
  const isTerminal   = transitions.length === 0

  const mutation = useMutation({
    mutationFn: (newStage: FunnelStage) => stageApi.transitionStage(lead.id, newStage),
    onSuccess: (_data, newStage) => {
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] })
      queryClient.invalidateQueries({ queryKey: ['leads-kanban'] })
      toast.success(`Etapa cambiada a ${STAGE_LABEL_FULL[newStage]}`)
      setSelected('')
      setConfirm(false)
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message ?? 'Error al cambiar etapa'
      toast.error(msg)
      setSelected('')
      setConfirm(false)
    },
  })

  useEffect(() => {
    if (!dropOpen) return
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  const handleSelect = (stage: FunnelStage) => {
    setSelected(stage)
    setDropOpen(false)
    if (BLOCKED_STAGES.includes(stage)) {
      setConfirm(true)
    } else {
      mutation.mutate(stage)
    }
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm relative z-[100]">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <RefreshCw size={15} className="text-gray-400" />
            Etapa del Funnel
          </h2>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <p className="text-xs text-gray-400 mb-2">Etapa actual</p>
            <StageBadge stage={currentStage} size="lg" />
          </div>

          {isTerminal ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">
              <Check size={14} className="text-green-500 shrink-0" />
              Etapa final --- no se puede modificar
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-400 mb-2">Cambiar etapa a</p>
              <div ref={dropRef} className="relative">
                <button
                  type="button"
                  onClick={() => setDropOpen((v) => !v)}
                  disabled={mutation.isPending}
                  className={cn(
                    'w-full flex items-center justify-between h-10 px-3.5 rounded-xl border text-sm transition-colors',
                    dropOpen
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 text-gray-500 hover:border-gray-400',
                    mutation.isPending && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  <span>Seleccionar nueva etapa...</span>
                  {mutation.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <ChevronDown size={14} className={cn('transition-transform', dropOpen && 'rotate-180')} />
                  }
                </button>

                {dropOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl z-[9999] py-1 max-h-72 overflow-y-auto">
                    {transitions.map((stage) => {
                      const isBlocked = BLOCKED_STAGES.includes(stage)
                      return (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => handleSelect(stage)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className={cn(isBlocked ? 'text-red-600' : 'text-gray-900')}>
                            {STAGE_LABEL_FULL[stage]}
                          </span>
                          {isBlocked && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                              Bloqueado
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {confirm && selected && (
        <ConfirmDialog
          stage={selected as FunnelStage}
          onConfirm={() => mutation.mutate(selected as FunnelStage)}
          onCancel={() => { setConfirm(false); setSelected('') }}
          isPending={mutation.isPending}
        />
      )}
    </>
  )
}

// ─── Stage history card ───────────────────────────────────────────────────────

function HistoryCard({ lead }: { lead: LeadDetail }) {
  const [showAll, setShowAll] = useState(false)
  const history = lead.stageHistory
  const visible = showAll ? history : history.slice(0, 10)
  const hasMore = history.length > 10

  function resolveChanger(changedById: string): string {
    if (changedById === lead.assignedTo?.id) return lead.assignedTo?.fullName ?? 'Hunter'
    return 'Supervisor'
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Clock size={15} className="text-gray-400" />
          Historial de Etapas
          <span className="text-xs font-normal text-gray-400">({history.length})</span>
        </h2>
      </div>

      {history.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          Sin historial de etapas
        </div>
      ) : (
        <div className="px-5 py-4">
          <div className="relative">
            <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gray-100" />
            <div className="space-y-4">
              {visible.map((entry, i) => (
                <div key={entry.id} className="flex gap-4 relative">
                  <div className={cn(
                    'w-[30px] h-[30px] shrink-0 z-10 rounded-full flex items-center justify-center text-[10px] font-bold',
                    i === 0
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-400 border border-gray-200',
                  )}>
                    {history.length - i}
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {entry.fromStage ? (
                        <>
                          <StageBadge stage={entry.fromStage as FunnelStage} size="sm" />
                          <ChevronRight size={12} className="text-gray-400" />
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Inicio</span>
                      )}
                      <StageBadge stage={entry.toStage as FunnelStage} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <p className="text-xs text-gray-400">
                        {fmtDate(entry.changedAt, "d MMM yyyy, HH:mm")}
                      </p>
                      <span className="text-gray-300">.</span>
                      <p className="text-xs text-gray-400">
                        {resolveChanger(entry.changedById)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full mt-4 pt-4 border-t border-gray-100 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              {showAll ? 'Ver menos' : `Ver ${history.length - 10} mas`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Reassignment history card ────────────────────────────────────────────────

function ReassignmentCard({ leadId }: { leadId: string }) {
  const { data: history = [], isLoading } = useQuery<Reassignment[]>({
    queryKey: ['reassignments', leadId],
    queryFn:  () => reassignApi.getByLead(leadId),
  })

  const fmtDate = (d: string) => {
    try { return format(parseISO(d), "d MMM yyyy, HH:mm", { locale: es }) }
    catch { return d }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <RefreshCw size={15} className="text-gray-400" />
          Historial de Reasignaciones
          {history.length > 0 && (
            <span className="text-xs font-normal text-gray-400">({history.length})</span>
          )}
        </h2>
        {history.length > 0 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
            {history.length}x reasignado
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 py-4 space-y-3 animate-pulse">
          {[1, 2].map((i) => <div key={i} className="h-12 bg-gray-100 rounded-xl" />)}
        </div>
      ) : history.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          Sin reasignaciones — lead asignado desde el inicio
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3">
          {history.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <RefreshCw size={13} className="text-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap text-sm">
                  <span className="font-medium text-gray-700 truncate">
                    {r.fromUserName ?? 'Sin asignar'}
                  </span>
                  <ChevronRight size={12} className="text-gray-400 shrink-0" />
                  <span className="font-semibold text-gray-900 truncate">
                    {r.toUserName ?? r.toUserId}
                  </span>
                </div>
                {r.reason && (
                  <p className="text-xs text-gray-400 mt-0.5 italic truncate" title={r.reason}>
                    "{r.reason}"
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">{fmtDate(r.reassignedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page skeleton ────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-48" />
      <div className="bg-white rounded-2xl p-6 border border-gray-200 space-y-3">
        <div className="h-8 bg-gray-200 rounded w-72" />
        <div className="h-5 bg-gray-100 rounded w-24" />
        <div className="h-4 bg-gray-100 rounded w-56" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <div className="h-5 bg-gray-200 rounded w-36" />
            <div className="h-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── LeadDetailPage ───────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const { user }   = useAuth()

  const { data: lead, isLoading, isError, refetch } = useQuery<LeadDetail>({
    queryKey: ['lead', id],
    queryFn:  () => leadsApi.getLeadById(id!) as Promise<LeadDetail>,
    enabled:  !!id,
  })

  if (isLoading) return <PageSkeleton />

  if (isError || !lead) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 h-80 text-center">
        <AlertTriangle size={40} className="text-orange-400" />
        <div>
          <p className="font-semibold text-gray-900">No se pudo cargar el lead</p>
          <p className="text-sm text-gray-400 mt-1">
            El lead no existe o no tienes permisos para verlo
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="px-4 py-2 text-sm font-semibold border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Reintentar
          </button>
          <button
            onClick={() => navigate('/leads')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            Volver a leads
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Back + Breadcrumb ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <button
          onClick={() => navigate('/leads')}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} />
          Volver a leads
        </button>
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link to="/leads" className="hover:text-gray-800 transition-colors">Leads</Link>
          <ChevronRight size={13} />
          <span className="font-mono text-gray-900">{lead.leadIdExternal}</span>
        </nav>
      </div>

      {/* ── Lead header ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">
                {lead.name}
              </h1>
              <SourceBadge source={lead.source} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StageBadge stage={lead.currentStage} size="md" />
            </div>
            <p className="text-sm text-gray-400 flex items-center gap-3 flex-wrap mt-1">
              <span>
                {COUNTRY_FLAG[lead.country] ?? ''} {lead.country}
              </span>
              {lead.opsZone && (
                <span className="flex items-center gap-1">
                  {lead.opsZone}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar size={13} />
                Asignado el {fmtDate(lead.assignedAt)}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── 2-column grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left column */}
        <div className="space-y-6">
          <InfoCard lead={lead} onRefresh={() => refetch()} />
          <ContactTimeline lead={lead} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <StageCard lead={lead} />
          <HistoryCard lead={lead} />
          <ReassignmentCard leadId={lead.id} />
        </div>

      </div>
    </div>
  )
}
