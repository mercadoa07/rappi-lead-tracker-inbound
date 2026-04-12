-- migrations_v5.sql
-- Corrige funciones de Gestion para usar campos del lead directamente
-- (negociacion_exitosa, tiene_intento_contacto, tiene_contacto_efectivo, motivo_descarte)
-- en lugar de stage_history y contact_attempts que pueden estar vacíos.
-- Ejecutar en Supabase SQL Editor

-- ─── get_team_summary — usa flags del lead, sin filtro de fecha en totales ────

create or replace function get_team_summary(
  p_period    text,
  p_date      date,
  p_country   text        default null,
  p_source    lead_source default null,
  p_hunter_id uuid        default null,
  p_leader_id uuid        default null,
  p_date_from date        default null,
  p_date_to   date        default null
)
returns json as $$
declare
  v_from     timestamptz;
  v_to       timestamptz;
  v_days     int;
  v_biz_days int;
  v_user_id  uuid := auth.uid();
  v_role     user_role;
begin
  select pb.v_from, pb.v_to, pb.v_days, pb.v_biz_days
  into v_from, v_to, v_days, v_biz_days
  from period_bounds(p_period, p_date, p_date_from, p_date_to) pb;

  select role into v_role from profiles where id = v_user_id;

  return (
    with hunters as (
      select p.id, p.full_name, p.email, p.country, p.daily_target
      from profiles p
      where p.is_active = true
        and p.role = 'HUNTER'
        and (p_country   is null or p.country::text = p_country)
        and (p_hunter_id is null or p.id = p_hunter_id)
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
        )
    ),
    hunter_stats as (
      select
        h.id           as hunter_id,
        h.full_name    as hunter_name,
        h.email        as hunter_email,
        h.country      as country,
        h.daily_target as daily_target,

        -- Total leads asignados al hunter (todos, sin filtro de fecha)
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
        ) as total_leads,

        -- Sin contactar: sin intento de contacto
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.tiene_intento_contacto = false
           and l.bloqueado = false
           and l.negociacion_exitosa = false
        ) as leads_without_contact,

        -- Con TYC (SOB)
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.tyc is not null
        ) as leads_con_tyc,

        -- Sin TYC (SOB)
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.tyc is null
        ) as leads_sin_tyc,

        -- Gestionados: con algún intento de contacto
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.tiene_intento_contacto = true
        ) as leads_with_contact,

        -- Contactos efectivos
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.tiene_contacto_efectivo = true
        ) as leads_with_effective,

        -- OB: snapshot actual
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.current_stage = 'OB'
        ) as ob_count,

        -- R2S: leads con negociacion_exitosa = true
        -- Si el lead tiene fecha_estado, filtra por período; si no, cuenta todos
        (select count(*) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and (p_source is null or l.source = p_source)
           and l.negociacion_exitosa = true
           and (
             l.fecha_estado is null
             or l.fecha_estado::timestamptz between v_from and v_to
           )
        ) as r2s_count

      from hunters h
    ),
    ranked as (
      select
        hs.*,
        case when v_biz_days > 0
          then round(hs.r2s_count::numeric / v_biz_days, 2) else 0
        end as r2s_per_day,
        case when hs.total_leads > 0
          then round(hs.r2s_count::numeric / hs.total_leads * 100, 1) else 0
        end as close_rate,
        row_number() over (order by hs.r2s_count desc) as ranking
      from hunter_stats hs
    )
    select json_build_object(
      'period',   p_period,
      'from',     v_from,
      'to',       v_to,
      'bizDays',  v_biz_days,
      'totals', json_build_object(
        'totalLeads',                sum(total_leads),
        'leadsWithoutContact',       sum(leads_without_contact),
        'leadsConTyc',               sum(leads_con_tyc),
        'leadsSinTyc',               sum(leads_sin_tyc),
        'leadsWithContactAttempt',   sum(leads_with_contact),
        'leadsWithEffectiveContact', sum(leads_with_effective),
        'obCount',                   sum(ob_count),
        'r2sCount',                  sum(r2s_count),
        'productivity',              sum(r2s_count),
        'contactabilityRate', case
          when sum(leads_with_contact) > 0
          then round(sum(leads_with_effective)::numeric / sum(leads_with_contact) * 100, 1)
          else 0
        end,
        'closeRate', case
          when sum(total_leads) > 0
          then round(sum(r2s_count)::numeric / sum(total_leads) * 100, 1)
          else 0
        end,
        'teamR2sPerDay', case
          when v_biz_days > 0 and count(*) > 0
          then round(sum(r2s_count)::numeric / v_biz_days / count(*), 2)
          else 0
        end
      ),
      'team', coalesce((
        select json_agg(json_build_object(
          'hunterId',                  r.hunter_id,
          'hunterName',                r.hunter_name,
          'hunterEmail',               r.hunter_email,
          'country',                   r.country,
          'ranking',                   r.ranking,
          'totalLeads',                r.total_leads,
          'leadsWithoutContact',       r.leads_without_contact,
          'leadsConTyc',               r.leads_con_tyc,
          'leadsSinTyc',               r.leads_sin_tyc,
          'leadsWithContactAttempt',   r.leads_with_contact,
          'leadsWithEffectiveContact', r.leads_with_effective,
          'contactabilityRate', case when r.leads_with_contact > 0
            then round(r.leads_with_effective::numeric / r.leads_with_contact * 100, 1)
            else 0
          end,
          'obCount',      r.ob_count,
          'r2sCount',     r.r2s_count,
          'productivity', r.r2s_count,
          'r2sPerDay',    r.r2s_per_day,
          'closeRate',    r.close_rate
        ) order by r.ranking)
        from ranked r
      ), '[]')
    )
    from ranked
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ─── get_stage_advances — usa fecha_estado del lead en vez de stage_history ───

create or replace function get_stage_advances(
  p_period    text,
  p_date      date,
  p_country   text        default null,
  p_source    lead_source default null,
  p_hunter_id uuid        default null,
  p_leader_id uuid        default null,
  p_date_from date        default null,
  p_date_to   date        default null
)
returns json as $$
declare
  v_from    timestamptz;
  v_to      timestamptz;
  v_user_id uuid := auth.uid();
  v_role    user_role;
begin
  select pb.v_from, pb.v_to into v_from, v_to
  from period_bounds(p_period, p_date, p_date_from, p_date_to) pb;
  select role into v_role from profiles where id = v_user_id;

  return (
    select coalesce(json_agg(json_build_object('stage', stage, 'count', cnt) order by cnt desc), '[]')
    from (
      -- Primero intenta con stage_history (si hay registros)
      select l.current_stage as stage, count(distinct l.id) as cnt
      from leads l
      join profiles p on p.id = l.assigned_to_id
      where l.is_deleted = false
        and p.is_active = true
        and p.role = 'HUNTER'
        and (p_country   is null or l.country::text = p_country)
        and (p_source    is null or l.source = p_source)
        and (p_hunter_id is null or l.assigned_to_id = p_hunter_id)
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
        )
        -- Usa fecha_estado si existe, si no usa stage_changed_at
        and coalesce(l.fecha_estado::timestamptz, l.stage_changed_at) between v_from and v_to
        and l.current_stage not in ('SIN_CONTACTO')
      group by l.current_stage
    ) s
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ─── get_discard_reasons — usa motivo_descarte del lead ──────────────────────

create or replace function get_discard_reasons(
  p_period    text,
  p_date      date,
  p_country   text        default null,
  p_source    lead_source default null,
  p_hunter_id uuid        default null,
  p_leader_id uuid        default null,
  p_date_from date        default null,
  p_date_to   date        default null
)
returns json as $$
declare
  v_from    timestamptz;
  v_to      timestamptz;
  v_user_id uuid := auth.uid();
  v_role    user_role;
begin
  select pb.v_from, pb.v_to into v_from, v_to
  from period_bounds(p_period, p_date, p_date_from, p_date_to) pb;
  select role into v_role from profiles where id = v_user_id;
  return (
    select coalesce(json_agg(json_build_object('reason', reason, 'count', cnt) order by cnt desc), '[]')
    from (
      select
        coalesce(l.motivo_descarte, 'Sin especificar') as reason,
        count(*) as cnt
      from leads l
      join profiles p on p.id = l.assigned_to_id
      where l.is_deleted = false
        and l.current_stage = 'DESCARTADO'
        and p.is_active = true
        and p.role = 'HUNTER'
        and (p_country   is null or l.country::text = p_country)
        and (p_source    is null or l.source = p_source)
        and (p_hunter_id is null or l.assigned_to_id = p_hunter_id)
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
        )
      group by l.motivo_descarte
    ) s
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
