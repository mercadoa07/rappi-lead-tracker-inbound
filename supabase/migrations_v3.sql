-- ════════════════════════════════════════════════════════════
-- Migration v3 — Tabla reassignments + alertas por rol
-- ════════════════════════════════════════════════════════════

-- ─── 1. Tabla reassignments ──────────────────────────────────────────────────

create table if not exists reassignments (
  id               uuid default uuid_generate_v4() primary key,
  lead_id          uuid references leads(id)    not null,
  from_user_id     uuid references profiles(id),           -- null si no tenia asignado
  to_user_id       uuid references profiles(id) not null,
  reason           text,
  reassigned_by_id uuid references profiles(id) not null,
  reassigned_at    timestamptz default now()
);

create index if not exists on reassignments(lead_id);
create index if not exists on reassignments(to_user_id);
create index if not exists on reassignments(from_user_id);

-- ─── 2. Campo reassignment_count en leads ────────────────────────────────────

alter table leads add column if not exists reassignment_count int not null default 0;

-- Trigger para mantener el conteo actualizado automáticamente
create or replace function inc_reassignment_count()
returns trigger as $$
begin
  update leads set reassignment_count = reassignment_count + 1
  where id = new.lead_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_inc_reassignment_count on reassignments;
create trigger trg_inc_reassignment_count
  after insert on reassignments
  for each row execute function inc_reassignment_count();

-- ─── 3. RLS para reassignments ───────────────────────────────────────────────

alter table reassignments enable row level security;

-- Leer: LIDER ve reasignaciones de su equipo; ADMIN ve todo; HUNTER ve las de sus leads
create policy "reassignments_select"
  on reassignments for select
  using (
    (select role from profiles where id = auth.uid()) = 'ADMIN'
    or reassigned_by_id = auth.uid()
    or to_user_id       = auth.uid()
    or from_user_id     = auth.uid()
    or lead_id in (
      select id from leads where assigned_to_id = auth.uid()
    )
    or lead_id in (
      select l.id from leads l
      join profiles p on p.id = l.assigned_to_id
      where p.leader_id = auth.uid()
    )
  );

-- Insertar: LIDER para su equipo; ADMIN para todos
create policy "reassignments_insert"
  on reassignments for insert
  with check (
    (select role from profiles where id = auth.uid()) in ('LIDER', 'ADMIN')
  );

-- ─── 4. generate_alerts — version con logica por rol ─────────────────────────
-- Hunter: aviso PREVENTIVO (antes de que se cumpla el plazo)
-- Lider : alerta DE ACCION (ya se cumplio el plazo, debe reasignar)

create or replace function generate_alerts()
returns void as $$
declare
  rec record;
begin

  -- ════════════════════════════════════════════════════════
  -- SIN_PROXIMO_CONTACTO_3D
  -- Hunter: avisa al dia 2 (un dia antes del limite de 3)
  -- Lider : avisa al dia 3+ (listo para reasignar)
  -- ════════════════════════════════════════════════════════

  -- Aviso preventivo al HUNTER (dia 2 sin contacto)
  for rec in
    select l.id as lead_id, l.assigned_to_id
    from leads l
    where l.is_deleted  = false
      and l.bloqueado   = false
      and l.current_stage not in ('OK_R2S','VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and (
        l.ultima_fecha_contacto is null
        or l.ultima_fecha_contacto < now() - interval '2 days'
      )
      and (
        l.ultima_fecha_contacto is null
        or l.ultima_fecha_contacto >= now() - interval '3 days'
      )
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'SIN_PROXIMO_CONTACTO_3D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id, rec.lead_id,
      'SIN_PROXIMO_CONTACTO_3D',
      'Llevas 2 días sin contactar este lead. Manana se cumple el plazo de 3 días.'
    );
  end loop;

  -- Alerta de accion al LIDER (dia 3+ sin contacto)
  for rec in
    select l.id as lead_id, l.assigned_to_id, p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted  = false
      and l.bloqueado   = false
      and l.current_stage not in ('OK_R2S','VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and (
        l.ultima_fecha_contacto is null
        or l.ultima_fecha_contacto < now() - interval '3 days'
      )
      and p.leader_id is not null
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'SIN_PROXIMO_CONTACTO_3D'
          and a.user_id = p.leader_id
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.leader_id, rec.lead_id,
      'SIN_PROXIMO_CONTACTO_3D',
      'Este lead lleva 3+ días sin contacto. Considera reasignarlo a otro hunter.'
    );
  end loop;

  -- ════════════════════════════════════════════════════════
  -- SIN_AVANCE_5D
  -- Hunter: avisa al dia 4 (un dia antes)
  -- Lider : avisa al dia 5+ (listo para reasignar)
  -- ════════════════════════════════════════════════════════

  -- Aviso preventivo al HUNTER (dia 4 sin avance)
  for rec in
    select l.id as lead_id, l.assigned_to_id
    from leads l
    where l.is_deleted  = false
      and l.bloqueado   = false
      and l.current_stage not in ('OK_R2S','VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and l.stage_changed_at < now() - interval '4 days'
      and l.stage_changed_at >= now() - interval '5 days'
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'SIN_AVANCE_5D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id, rec.lead_id,
      'SIN_AVANCE_5D',
      'Este lead lleva 4 días sin avance en el pipeline. Manana se cumple el plazo.'
    );
  end loop;

  -- Alerta de accion al LIDER (dia 5+ sin avance)
  for rec in
    select l.id as lead_id, l.assigned_to_id, p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted  = false
      and l.bloqueado   = false
      and l.current_stage not in ('OK_R2S','VENTA')
      and l.current_stage not like 'BLOQUEADO%'
      and l.stage_changed_at < now() - interval '5 days'
      and p.leader_id is not null
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'SIN_AVANCE_5D'
          and a.user_id = p.leader_id
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.leader_id, rec.lead_id,
      'SIN_AVANCE_5D',
      'Un lead de tu equipo lleva 5+ días sin avance. Está listo para reasignar.'
    );
  end loop;

  -- ════════════════════════════════════════════════════════
  -- ESPERANDO_DOCS_7D
  -- Hunter: avisa al dia 6 (un dia antes)
  -- Lider : avisa al dia 7+ (listo para reasignar)
  -- ════════════════════════════════════════════════════════

  -- Aviso preventivo al HUNTER (dia 6 en esperando docs)
  for rec in
    select l.id as lead_id, l.assigned_to_id
    from leads l
    where l.is_deleted    = false
      and l.current_stage = 'ESPERANDO_DOCUMENTOS'
      and l.stage_changed_at < now() - interval '6 days'
      and l.stage_changed_at >= now() - interval '7 days'
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'ESPERANDO_DOCS_7D'
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.assigned_to_id, rec.lead_id,
      'ESPERANDO_DOCS_7D',
      'Llevas 6 días esperando documentos. Manana se cumple el plazo — gestiona el cierre.'
    );
  end loop;

  -- Alerta de accion al LIDER (dia 7+ esperando docs)
  for rec in
    select l.id as lead_id, l.assigned_to_id, p.leader_id
    from leads l
    join profiles p on p.id = l.assigned_to_id
    where l.is_deleted    = false
      and l.current_stage = 'ESPERANDO_DOCUMENTOS'
      and l.stage_changed_at < now() - interval '7 days'
      and p.leader_id is not null
      and not exists (
        select 1 from alerts a
        where a.lead_id = l.id
          and a.type    = 'ESPERANDO_DOCS_7D'
          and a.user_id = p.leader_id
          and a.triggered_at > now() - interval '24 hours'
      )
  loop
    insert into alerts (user_id, lead_id, type, message)
    values (
      rec.leader_id, rec.lead_id,
      'ESPERANDO_DOCS_7D',
      'Un lead lleva 7+ días esperando documentos. Está listo para reasignar.'
    );
  end loop;

end;
$$ language plpgsql security definer;
