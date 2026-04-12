-- ════════════════════════════════════════════════════════════
-- Fix ALTO-12: índices faltantes para performance
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- Leads: queries filtran casi siempre por assigned_to_id + is_deleted
create index if not exists leads_assigned_not_deleted_idx
  on leads(assigned_to_id, is_deleted)
  where is_deleted = false;

-- Kanban: assigned + stage
create index if not exists leads_assigned_stage_idx
  on leads(assigned_to_id, current_stage)
  where is_deleted = false;

-- Reports por período de asignación
create index if not exists leads_assigned_at_idx
  on leads(assigned_at)
  where is_deleted = false;

-- Team summary v5 usa fecha_estado para R2S
create index if not exists leads_fecha_estado_idx
  on leads(fecha_estado)
  where is_deleted = false and negociacion_exitosa = true;

-- Flags usados en count() filter (where ...)
create index if not exists leads_flags_idx
  on leads(tiene_intento_contacto, tiene_contacto_efectivo, bloqueado, negociacion_exitosa)
  where is_deleted = false;

-- Contact attempts por período
create index if not exists contact_attempts_contacted_at_idx
  on contact_attempts(contacted_at);

-- Stage history por período
create index if not exists stage_history_changed_at_idx
  on stage_history(changed_at);
