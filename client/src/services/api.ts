/// <reference types="vite/client" />
import { supabase, supabaseAdmin } from '../lib/supabase'
import { STAGE_TRANSITIONS } from '../utils/constants'
import type {
  Lead, ContactAttempt, StageHistory, Alert, FunnelStage,
  ContactResult, Country, LeadSource, User, Reassignment,
  TeamSummaryResponse, ClosedRateEntry, HcSummaryEntry,
} from '../types'

// ─── Phone cleaner ────────────────────────────────────────────────────────────

function cleanPhone(raw: unknown): string | undefined {
  if (!raw) return undefined
  let val = String(raw).trim()
  if (val.startsWith('[')) {
    try {
      const arr = JSON.parse(val) as unknown[]
      val = arr.filter((v) => v && String(v).trim()).map(String).join('') || ''
    } catch {
      val = val.replace(/[\[\]"]/g, '').trim()
    }
  }
  if (/[eE]\+?\d+/.test(val)) {
    val = String(BigInt(Math.round(Number(val))))
  }
  val = val.replace(/\.0+$/, '').replace(/\..*$/, '')
  val = val.replace(/[^\d+]/g, '')
  return val || undefined
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapLead(row: any): Lead {
  return {
    id:                    row.id,
    leadIdExternal:        row.lead_id_external,
    name:                  row.name,
    country:               row.country,
    source:                row.source ?? 'SDR',
    opsZone:               row.ops_zone          ?? undefined,
    entryMethod:           row.entry_method       ?? undefined,
    phone1:                cleanPhone(row.phone1),
    phone2:                cleanPhone(row.phone2),
    informacionLead:       row.informacion_lead   ?? undefined,
    tyc:                   row.tyc                ?? undefined,
    observaciones:         row.observaciones      ?? undefined,
    externalStoreId:       row.external_store_id  ?? undefined,
    assignedToId:          row.assigned_to_id,
    assignedAt:            row.assigned_at,
    currentStage:          row.current_stage,
    stageChangedAt:        row.stage_changed_at,
    fechaEstado:           row.fecha_estado        ?? undefined,
    weekAssigned:          row.week_assigned,
    semanaLead:            row.semana_lead         ?? undefined,
    tieneIntentoContacto:  row.tiene_intento_contacto  ?? false,
    tieneContactoEfectivo: row.tiene_contacto_efectivo ?? false,
    bloqueado:             row.bloqueado           ?? false,
    negociacionExitosa:    row.negociacion_exitosa ?? false,
    ultimaFechaContacto:   row.ultima_fecha_contacto ?? undefined,
    reassignmentCount:     row.reassignment_count   ?? 0,
    isDeleted:             row.is_deleted          ?? false,
    createdAt:             row.created_at,
    updatedAt:             row.updated_at,
    assignedTo: row.profiles ? {
      id:       row.profiles.id,
      fullName: row.profiles.full_name,
      email:    row.profiles.email,
    } : undefined,
    _count: {
      contactAttempts: Array.isArray(row.contact_attempts) ? row.contact_attempts.length : 0,
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapContactAttempt(row: any): ContactAttempt {
  return {
    id:            row.id,
    leadId:        row.lead_id,
    attemptNumber: row.attempt_number,
    contactMethod: row.contact_method ?? 'LLAMADA',
    result:        row.result,
    contactedAt:   row.contacted_at,
    notes:         row.notes ?? undefined,
    createdById:   row.created_by_id,
    createdAt:     row.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapStageHistory(row: any): StageHistory {
  return {
    id:          row.id,
    leadId:      row.lead_id,
    fromStage:   row.from_stage  ?? undefined,
    toStage:     row.to_stage,
    changedAt:   row.changed_at,
    changedById: row.changed_by_id,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAlert(row: any): Alert {
  return {
    id:          row.id,
    userId:      row.user_id,
    leadId:      row.lead_id,
    type:        row.type,
    message:     row.message,
    isRead:      row.is_read,
    triggeredAt: row.triggered_at,
    lead: row.leads ? {
      id:             row.leads.id,
      name:           row.leads.name,
      leadIdExternal: row.leads.lead_id_external,
      currentStage:   row.leads.current_stage,
    } : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProfile(row: any): User {
  return {
    id:          row.id,
    email:       row.email,
    fullName:    row.full_name,
    role:        row.role,
    country:     row.country,
    team:        row.team ?? 'SDR',
    dailyTarget: row.daily_target ?? 4,
    isActive:    row.is_active    ?? true,
    leaderId:    row.leader_id    ?? undefined,
  }
}

// ─── leadsApi ─────────────────────────────────────────────────────────────────

export const leadsApi = {
  getLeads: async (filters: {
    search?:    string
    stage?:     FunnelStage[]
    country?:   Country
    source?:    LeadSource
    opsZone?:   string
    assigned?:  'all' | 'assigned' | 'unassigned'
    dateFrom?:  string
    dateTo?:    string
    page:       number
    limit:      number
    sortBy?:    string
    sortOrder?: 'asc' | 'desc'
  }) => {
    const sortColumn =
      filters.sortBy === 'assignedAt'    ? 'assigned_at'
      : filters.sortBy === 'stageChangedAt' ? 'stage_changed_at'
      : filters.sortBy === 'createdAt'      ? 'created_at'
      : filters.sortBy ?? 'assigned_at'

    let query = supabase
      .from('leads')
      .select('*, profiles!assigned_to_id(id, full_name, email), contact_attempts(id, contacted_at)', { count: 'exact' })
      .eq('is_deleted', false)

    if (filters.search) {
      query = query.or(
        `name.ilike.%${filters.search}%,lead_id_external.ilike.%${filters.search}%`,
      )
    }
    if (filters.stage?.length) query = query.in('current_stage', filters.stage)
    if (filters.country)       query = query.eq('country', filters.country)
    if (filters.source)        query = query.eq('source', filters.source)
    if (filters.opsZone)       query = query.ilike('ops_zone', `%${filters.opsZone}%`)
    if (filters.dateFrom)      query = query.gte('assigned_at', filters.dateFrom)
    if (filters.dateTo)        query = query.lte('assigned_at', filters.dateTo)

    if (filters.assigned === 'unassigned') {
      query = query.is('assigned_to_id', null)
    } else if (filters.assigned === 'assigned') {
      query = query.not('assigned_to_id', 'is', null)
    }

    const from = (filters.page - 1) * filters.limit
    const to   = from + filters.limit - 1

    const { data, count, error } = await query
      .order(sortColumn, { ascending: filters.sortOrder !== 'desc' })
      .range(from, to)

    if (error) throw error

    return {
      data:       (data ?? []).map(mapLead),
      total:      count ?? 0,
      page:       filters.page,
      totalPages: Math.ceil((count ?? 0) / filters.limit),
    }
  },

  getLeadById: async (id: string) => {
    const { data, error } = await supabase
      .from('leads')
      .select(`
        *,
        profiles!assigned_to_id(id, full_name, email),
        contact_attempts(*),
        stage_history(*)
      `)
      .eq('id', id)
      .single()

    if (error) throw error

    return {
      ...mapLead(data),
      contactAttempts: (data.contact_attempts ?? []).map(mapContactAttempt)
        .sort((a: ContactAttempt, b: ContactAttempt) => a.attemptNumber - b.attemptNumber),
      stageHistory: (data.stage_history ?? []).map(mapStageHistory)
        .sort((a: StageHistory, b: StageHistory) =>
          new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()),
      _count: { contactAttempts: (data.contact_attempts ?? []).length },
    }
  },

  updateLead: async (id: string, patch: Record<string, unknown>) => {
    const snakePatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase()
      snakePatch[snake] = v
    }
    const { data, error } = await supabase
      .from('leads')
      .update(snakePatch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return mapLead(data)
  },

  getAvailableTransitions: async (id: string) => {
    const { data, error } = await supabase
      .from('leads')
      .select('current_stage')
      .eq('id', id)
      .single()
    if (error) throw error
    const stage = data.current_stage as FunnelStage
    return {
      currentStage:         stage,
      availableTransitions: STAGE_TRANSITIONS[stage] ?? [],
    }
  },
}

// ─── contactsApi ──────────────────────────────────────────────────────────────

export const contactsApi = {
  // Crea el siguiente intento de contacto (máx 3)
  createContact: async (
    leadId: string,
    body: {
      contactMethod: string
      result:        ContactResult
      notes?:        string
      contactedAt?:  string
    },
  ) => {
    // Verificar cuántos intentos ya existen
    const { data: existing } = await supabase
      .from('contact_attempts')
      .select('attempt_number')
      .eq('lead_id', leadId)
      .order('attempt_number', { ascending: false })
      .limit(1)

    const nextNumber = existing && existing.length > 0
      ? existing[0].attempt_number + 1
      : 1

    if (nextNumber > 3) {
      throw new Error('Ya se alcanzó el máximo de 3 intentos de contacto')
    }

    const { data: session } = await supabase.auth.getUser()
    const userId = session.user?.id
    if (!userId) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('contact_attempts')
      .insert({
        lead_id:        leadId,
        attempt_number: nextNumber,
        contact_method: body.contactMethod,
        result:         body.result,
        notes:          body.notes   ?? null,
        contacted_at:   body.contactedAt ?? new Date().toISOString(),
        created_by_id:  userId,
      })
      .select()
      .single()

    if (error) throw error

    // Actualizar flags en el lead
    const isEfectivo = body.result === 'EFECTIVO'
    await supabase.from('leads').update({
      tiene_intento_contacto:  true,
      tiene_contacto_efectivo: isEfectivo ? true : undefined,
      ultima_fecha_contacto:   body.contactedAt ?? new Date().toISOString(),
      updated_at:              new Date().toISOString(),
    }).eq('id', leadId)

    return mapContactAttempt(data)
  },

  // Actualiza un intento existente
  updateContact: async (
    contactId: string,
    patch: { result?: ContactResult; notes?: string; contactedAt?: string; contactMethod?: string },
  ) => {
    const snakePatch: Record<string, unknown> = {}
    if (patch.result)        snakePatch.result         = patch.result
    if (patch.notes)         snakePatch.notes          = patch.notes
    if (patch.contactedAt)   snakePatch.contacted_at   = patch.contactedAt
    if (patch.contactMethod) snakePatch.contact_method = patch.contactMethod

    const { data, error } = await supabase
      .from('contact_attempts')
      .update(snakePatch)
      .eq('id', contactId)
      .select()
      .single()
    if (error) throw error
    return mapContactAttempt(data)
  },
}

// ─── stageApi ─────────────────────────────────────────────────────────────────

export const stageApi = {
  transitionStage: async (leadId: string, newStage: FunnelStage) => {
    const { data: session } = await supabase.auth.getUser()
    const userId = session.user?.id
    if (!userId) throw new Error('Not authenticated')

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('current_stage')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) throw leadErr ?? new Error('Lead not found')

    const isBloqueado = newStage.startsWith('BLOQUEADO')

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        current_stage:    newStage,
        stage_changed_at: new Date().toISOString(),
        fecha_estado:     new Date().toISOString(),
        bloqueado:        isBloqueado,
        negociacion_exitosa: ['OK_R2S', 'VENTA'].includes(newStage),
      })
      .eq('id', leadId)

    if (updateErr) throw updateErr

    const { error: histErr } = await supabase
      .from('stage_history')
      .insert({
        lead_id:       leadId,
        from_stage:    lead.current_stage,
        to_stage:      newStage,
        changed_at:    new Date().toISOString(),
        changed_by_id: userId,
      })

    if (histErr) console.error('stage_history insert error:', histErr)
  },
}

// ─── alertsApi ────────────────────────────────────────────────────────────────

export const alertsApi = {
  getAlerts: async (limit = 50) => {
    const { data, error } = await supabase
      .from('alerts')
      .select('*, leads(id, name, lead_id_external, current_stage)')
      .order('triggered_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map(mapAlert)
  },

  getUnreadCount: async () => {
    const { count, error } = await supabase
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false)
    if (error) throw error
    return count ?? 0
  },

  markAsRead: async (id: string) => {
    const { error } = await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('id', id)
    if (error) throw error
  },

  markAllAsRead: async () => {
    const { error } = await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('is_read', false)
    if (error) throw error
  },
}

// ─── reportsApi ───────────────────────────────────────────────────────────────

export const reportsApi = {
  getSummary: async (period: string, date: string) => {
    const { data, error } = await supabase.rpc('get_report_summary', {
      p_period: period,
      p_date:   date,
    })
    if (error) throw error
    return data
  },

  getTeamSummary: async (
    period:  string,
    date:    string,
    country?: string,
    source?:  LeadSource,
  ): Promise<TeamSummaryResponse> => {
    const { data, error } = await supabase.rpc('get_team_summary', {
      p_period:  period,
      p_date:    date,
      p_country: country ?? null,
      p_source:  source  ?? null,
    })
    if (error) throw error
    return data as TeamSummaryResponse
  },

  getClosedRateReport: async (
    month:    number,
    year:     number,
    country?: string,
  ): Promise<ClosedRateEntry[]> => {
    const { data, error } = await supabase.rpc('get_closed_rate_report', {
      p_month:   month,
      p_year:    year,
      p_country: country ?? null,
    })
    if (error) throw error
    return (data ?? []) as ClosedRateEntry[]
  },

  getHcSummary: async (source?: LeadSource): Promise<HcSummaryEntry[]> => {
    const { data, error } = await supabase.rpc('get_hc_summary', {
      p_source: source ?? null,
    })
    if (error) throw error
    return (data ?? []) as HcSummaryEntry[]
  },

  getTeamTrends: async (days = 7, source?: LeadSource) => {
    const { data, error } = await supabase.rpc('get_team_trends', {
      p_days:   days,
      p_source: source ?? null,
    })
    if (error) throw error
    return data
  },
}

// ─── reassignApi ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReassignment(row: any): Reassignment {
  return {
    id:             row.id,
    leadId:         row.lead_id,
    fromUserId:     row.from_user_id    ?? undefined,
    fromUserName:   row.from_profile?.full_name ?? undefined,
    toUserId:       row.to_user_id,
    toUserName:     row.to_profile?.full_name   ?? undefined,
    reason:         row.reason          ?? undefined,
    reassignedById: row.reassigned_by_id,
    reassignedAt:   row.reassigned_at,
  }
}

export const reassignApi = {
  reassignLead: async (
    leadId:    string,
    toUserId:  string,
    reason?:   string,
  ): Promise<void> => {
    const { data: session } = await supabase.auth.getUser()
    const userId = session.user?.id
    if (!userId) throw new Error('Not authenticated')

    // Obtener el hunter actual
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('assigned_to_id')
      .eq('id', leadId)
      .single()
    if (leadErr) throw leadErr

    // Actualizar lead
    const { error: updateErr } = await supabase
      .from('leads')
      .update({ assigned_to_id: toUserId, assigned_at: new Date().toISOString() })
      .eq('id', leadId)
    if (updateErr) throw updateErr

    // Registrar en historial de reasignaciones
    const { error: insertErr } = await supabase
      .from('reassignments')
      .insert({
        lead_id:          leadId,
        from_user_id:     lead.assigned_to_id ?? null,
        to_user_id:       toUserId,
        reason:           reason ?? null,
        reassigned_by_id: userId,
        reassigned_at:    new Date().toISOString(),
      })
    if (insertErr) throw insertErr
  },

  getByLead: async (leadId: string): Promise<Reassignment[]> => {
    const { data, error } = await supabase
      .from('reassignments')
      .select(`
        *,
        from_profile:profiles!reassignments_from_user_id_fkey(full_name),
        to_profile:profiles!reassignments_to_user_id_fkey(full_name)
      `)
      .eq('lead_id', leadId)
      .order('reassigned_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapReassignment)
  },
}

// ─── profilesApi ──────────────────────────────────────────────────────────────

export const profilesApi = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return (data ?? []).map(mapProfile)
  },

  getHunters: async (filters?: { country?: Country; source?: LeadSource; leaderId?: string }) => {
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('role', 'HUNTER')
      .eq('is_active', true)
      .order('full_name')

    if (filters?.country)  query = query.eq('country', filters.country)
    if (filters?.source)   query = query.eq('team', filters.source)
    if (filters?.leaderId) query = query.eq('leader_id', filters.leaderId)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapProfile)
  },

  create: async (payload: {
    id:          string
    email:       string
    fullName:    string
    role:        string
    country:     Country
    team:        LeadSource
    dailyTarget: number
    leaderId?:   string
  }) => {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id:           payload.id,
        email:        payload.email,
        full_name:    payload.fullName,
        role:         payload.role,
        country:      payload.country,
        team:         payload.team,
        daily_target: payload.dailyTarget,
        leader_id:    payload.leaderId ?? null,
      })
      .select()
      .single()
    if (error) throw error
    return mapProfile(data)
  },

  update: async (id: string, patch: {
    fullName?:    string
    role?:        string
    country?:     Country
    team?:        LeadSource
    dailyTarget?: number
    leaderId?:    string
    isActive?:    boolean
  }) => {
    const snakePatch: Record<string, unknown> = {}
    if (patch.fullName    !== undefined) snakePatch.full_name    = patch.fullName
    if (patch.role        !== undefined) snakePatch.role         = patch.role
    if (patch.country     !== undefined) snakePatch.country      = patch.country
    if (patch.team        !== undefined) snakePatch.team         = patch.team
    if (patch.dailyTarget !== undefined) snakePatch.daily_target = patch.dailyTarget
    if (patch.leaderId    !== undefined) snakePatch.leader_id    = patch.leaderId
    if (patch.isActive    !== undefined) snakePatch.is_active    = patch.isActive

    const { data, error } = await supabase
      .from('profiles')
      .update(snakePatch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return mapProfile(data)
  },

  // Asignar leads en batch
  assignLeads: async (hunterIds: string[], leadIds: string[]) => {
    if (hunterIds.length === 0 || leadIds.length === 0) return

    const perHunter = Math.ceil(leadIds.length / hunterIds.length)
    const updates: PromiseLike<unknown>[] = []
    let idx = 0

    for (const hunterId of hunterIds) {
      const batch = leadIds.slice(idx, idx + perHunter)
      idx += perHunter
      if (batch.length === 0) break

      updates.push(
        supabase
          .from('leads')
          .update({
            assigned_to_id: hunterId,
            assigned_at:    new Date().toISOString(),
          })
          .in('id', batch)
          .then(() => undefined),
      )
    }

    await Promise.all(updates)
  },
}

// ─── importApi (usa supabaseAdmin para bypassear RLS) ────────────────────────

export const importApi = {
  upsertLeads: async (rows: Record<string, unknown>[]) => {
    const BATCH = 500
    let imported = 0
    let skipped  = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (supabaseAdmin
        .from('leads')
        .upsert(batch, { onConflict: 'lead_id_external', ignoreDuplicates: false }) as any)
      const { error } = result

      if (error) {
        errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`)
        skipped += batch.length
      } else {
        imported += batch.length
      }
    }

    return { imported, skipped, errors }
  },

  upsertProfiles: async (rows: Record<string, unknown>[]) => {
    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert(rows, { onConflict: 'email', ignoreDuplicates: false })
    if (error) throw error
  },
}
