-- ════════════════════════════════════════════════════════════
-- Migration v2 — Nuevos stages + alertas automáticas
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- ─── 1. Nuevos valores en enums ──────────────────────────────────────────────

alter type funnel_stage add value if not exists 'EN_GESTION'  after 'CONTACTO_EFECTIVO';
alter type funnel_stage add value if not exists 'EN_FIRMA'    after 'ESPERANDO_DOCUMENTOS';

alter type alert_type   add value if not exists 'SIN_PROXIMO_CONTACTO_3D';
alter type alert_type   add value if not exists 'SIN_AVANCE_5D';
alter type alert_type   add value if not exists 'ESPERANDO_DOCS_7D';

-- ─── 2. Función generate_alerts ──────────────────────────────────────────────
-- Genera alertas automáticas basadas en inactividad:
--   • SIN_PROXIMO_CONTACTO_3D : 3+ días sin intento de contacto
--   • SIN_AVANCE_5D            : 5+ días sin cambio de stage (activos)
--   • ESPERANDO_DOCS_7D        : 7+ días en ESPERANDO_DOCUMENTOS → alerta al líder

create or replace function generate_alerts()
returns void as $$
declare
  rec record;
begin

  -- ── SIN_PROXIMO_CONTACTO_3D ──────────────────────────────────────────────
  -- Leads asignados, no bloqueados, sin intento de contacto en 3+ días
  for rec in
    select
      l.id          as lead_id,
      l.assigned_to_id,
      p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted = false
      and l.bloqueado  = false
      and l.current_stage not in ('OK_R2S', 'VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and (
        l.ultima_fecha_contacto is null
        or l.ultima_fecha_contacto < now() - interval '3 days'
      )
      -- Evitar duplicar alertas del mismo tipo en las últimas 24h
      and not exists (
        select 1 from alerts a
        where a.lead_id  = l.id
          and a.type     = 'SIN_PROXIMO_CONTACTO_3D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    -- Alerta al hunter
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id,
      rec.lead_id,
      'SIN_PROXIMO_CONTACTO_3D',
      'Este lead lleva 3 días sin contacto. Programa el próximo intento.'
    );
  end loop;

  -- ── SIN_AVANCE_5D ────────────────────────────────────────────────────────
  -- Leads sin cambio de stage en 5+ días (activos, no bloqueados)
  for rec in
    select
      l.id          as lead_id,
      l.assigned_to_id,
      p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted = false
      and l.bloqueado  = false
      and l.current_stage not in ('OK_R2S', 'VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and l.stage_changed_at < now() - interval '5 days'
      and not exists (
        select 1 from alerts a
        where a.lead_id  = l.id
          and a.type     = 'SIN_AVANCE_5D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    -- Alerta al hunter
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id,
      rec.lead_id,
      'SIN_AVANCE_5D',
      'Este lead lleva 5 días sin avance en el pipeline. Revisa el seguimiento.'
    );
    -- Alerta al líder (si tiene)
    if rec.leader_id is not null then
      insert into alerts (user_id, lead_id, type, message)
      values (
        rec.leader_id,
        rec.lead_id,
        'SIN_AVANCE_5D',
        'Un lead de tu equipo lleva 5 días sin avance. Considera reasignarlo.'
      );
    end if;
  end loop;

  -- ── ESPERANDO_DOCS_7D ────────────────────────────────────────────────────
  -- Leads en ESPERANDO_DOCUMENTOS por 7+ días → alerta al líder
  for rec in
    select
      l.id          as lead_id,
      l.assigned_to_id,
      p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted      = false
      and l.current_stage   = 'ESPERANDO_DOCUMENTOS'
      and l.stage_changed_at < now() - interval '7 days'
      and not exists (
        select 1 from alerts a
        where a.lead_id  = l.id
          and a.type     = 'ESPERANDO_DOCS_7D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    -- Alerta al líder para reasignación
    if rec.leader_id is not null then
      insert into alerts (user_id, lead_id, type, message)
      values (
        rec.leader_id,
        rec.lead_id,
        'ESPERANDO_DOCS_7D',
        'Este lead lleva 7 días esperando documentos. Considera reasignarlo.'
      );
    end if;
    -- También avisa al hunter
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id,
      rec.lead_id,
      'ESPERANDO_DOCS_7D',
      'Llevas 7 días esperando documentos de este lead. Gestiona el cierre o escala.'
    );
  end loop;

end;
$$ language plpgsql security definer;

-- ─── 3. pg_cron — ejecutar generate_alerts cada día a las 8am UTC ────────────
-- IMPORTANTE: Habilitar pg_cron en Supabase:
--   Dashboard → Database → Extensions → buscar "pg_cron" → Enable
-- Luego correr:

select cron.schedule(
  'generate-alerts-daily',
  '0 8 * * *',
  $$ select generate_alerts(); $$
);
