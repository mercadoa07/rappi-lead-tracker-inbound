// ─── Enums ────────────────────────────────────────────────────────────────────

export type Country        = 'CO' | 'MX' | 'AR' | 'PE' | 'CL' | 'EC'
export type UserRole       = 'HUNTER' | 'LIDER' | 'ADMIN'
export type LeadSource     = 'SDR' | 'SOB'
export type ContactResult  = 'EFECTIVO' | 'FALLIDO' | 'OCUPADO'
export type ContactMethod  = 'LLAMADA' | 'WHATSAPP' | 'CORREO'
export type AlertType      = 'NO_CONTACT_24H' | 'SAME_STAGE_48H' | 'LEAD_ASIGNADO' | 'SIN_CONTACTO_48H' | 'BAJA_CONVERSION' | 'SIN_PROXIMO_CONTACTO_3D' | 'SIN_AVANCE_5D' | 'ESPERANDO_DOCS_7D'

export type FunnelStage =
  | 'SIN_CONTACTO'
  | 'CONTACTO_FALLIDO'
  | 'CONTACTO_EFECTIVO'
  | 'EN_GESTION'
  | 'PROPUESTA_ENVIADA'
  | 'ESPERANDO_DOCUMENTOS'
  | 'EN_FIRMA'
  | 'OB'
  | 'OK_R2S'
  | 'VENTA'
  | 'BLOQUEADO_NO_INTERESA'
  | 'BLOQUEADO_IMPOSIBLE_CONTACTO'
  | 'BLOQUEADO_FUERA_COBERTURA'
  | 'BLOQUEADO_NO_RESTAURANTE'
  | 'BLOQUEADO_RESTAURANTE_CERRADO'
  | 'BLOQUEADO_YA_EN_RAPPI'

// ─── Models ───────────────────────────────────────────────────────────────────

export interface User {
  id:          string
  email:       string
  fullName:    string
  role:        UserRole
  country:     Country
  team:        LeadSource
  dailyTarget: number
  isActive:    boolean
  leaderId?:   string
}

export interface Lead {
  id:                     string
  leadIdExternal:         string
  name:                   string
  country:                Country
  source:                 LeadSource
  opsZone?:               string
  entryMethod?:           string
  phone1?:                string
  phone2?:                string
  informacionLead?:       string
  tyc?:                   string
  observaciones?:         string
  externalStoreId?:       string
  assignedToId:           string
  assignedAt:             string
  currentStage:           FunnelStage
  stageChangedAt:         string
  fechaEstado?:           string
  weekAssigned:           string
  semanaLead?:            string
  tieneIntentoContacto:   boolean
  tieneContactoEfectivo:  boolean
  bloqueado:              boolean
  negociacionExitosa:     boolean
  ultimaFechaContacto?:   string
  isDeleted:              boolean
  createdAt:              string
  updatedAt:              string
  assignedTo?: Pick<User, 'id' | 'fullName' | 'email'>
  _count?: { contactAttempts: number }
}

export interface ContactAttempt {
  id:            string
  leadId:        string
  attemptNumber: number
  contactMethod: ContactMethod
  result:        ContactResult
  contactedAt:   string
  notes?:        string
  createdById:   string
  createdAt:     string
}

export interface StageHistory {
  id:          string
  leadId:      string
  fromStage?:  FunnelStage
  toStage:     FunnelStage
  changedAt:   string
  changedById: string
}

export interface Alert {
  id:          string
  userId:      string
  leadId:      string
  type:        AlertType
  message:     string
  isRead:      boolean
  triggeredAt: string
  lead?: Pick<Lead, 'id' | 'name' | 'leadIdExternal' | 'currentStage'>
}

export interface RankingEntry {
  rank:           number
  userId:         string
  fullName:       string
  email:          string
  productivity:   number
  closedRate:     number
  contactability: number
  totalLeads:     number
  isTopThree:     boolean
}

// ─── Team summary types ───────────────────────────────────────────────────────

export interface HunterStats {
  hunterId:                  string
  hunterName:                string
  hunterEmail:               string
  country:                   Country
  team:                      LeadSource
  ranking:                   number
  totalLeads:                number
  leadsConTyc:               number
  leadsSinTyc:               number
  leadsWithContactAttempt:   number
  leadsWithEffectiveContact: number
  contactabilityRate:        number
  productivity:              number
  obCount:                   number
  r2sCount:                  number
  accumulatedTarget:         number
  gap:                       number
  phasing:                   number
}

export interface TeamSummaryTotals {
  totalLeads:                number
  leadsConTyc:               number
  leadsSinTyc:               number
  leadsWithContactAttempt:   number
  leadsWithEffectiveContact: number
  productivity:              number
  obCount:                   number
  r2sCount:                  number
  accumulatedTarget:         number
  contactabilityRate:        number
  gap:                       number
}

export interface TeamSummaryResponse {
  period:  string
  from:    string
  to:      string
  totals:  TeamSummaryTotals
  team:    HunterStats[]
}

// ─── Closed rate report ───────────────────────────────────────────────────────

export interface ClosedRateEntry {
  hunterId:   string
  hunterName: string
  liderName:  string
  country:    Country
  tieneTyc:   'SI' | 'NO'
  leads:      number
  leadsRts:   number
  closedRate: number
}

// ─── HC Summary ──────────────────────────────────────────────────────────────

export interface HcSummaryEntry {
  country:        Country
  source:         LeadSource
  hunters:        number
  totalLeads:     number
  leadsThisWeek:  number
  leadsPerHunter: number
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data:       T[]
  total:      number
  page:       number
  totalPages: number
}
