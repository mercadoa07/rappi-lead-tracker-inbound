-- ════════════════════════════════════════════════════════════
-- Gestión Update — corre este script completo en Supabase SQL Editor
-- ════════════════════════════════════════════════════════════

-- ─── 1. period_bounds — agrega soporte de rango personalizado ────────────────

create or replace function period_bounds(
  p_period    text,
  p_date      date,
  p_date_from date default null,
  p_date_to   date default null
)
returns table(v_from timestamptz, v_to timestamptz, v_days int, v_biz_days int) as $$
declare
  v_start date;
  v_end   date;
begin
  case p_period
    when 'today' then
      v_start := p_date; v_end := p_date;
    when 'this_week' then
      v_start := date_trunc('week', p_date::timestamp)::date;
      v_end   := least(v_start + 6, p_date);
    when 'last_week' then
      v_start := (date_trunc('week', p_date::timestamp) - interval '7 days')::date;
      v_end   := v_start + 6;
    when 'this_month' then
      v_start := date_trunc('month', p_date::timestamp)::date;
      v_end   := least((v_start + interval '1 month' - interval '1 day')::date, p_date);
    when 'last_month' then
      v_start := (date_trunc('month', p_date::timestamp) - interval '1 month')::date;
      v_end   := (v_start + interval '1 month' - interval '1 day')::date;
    when 'custom' then
      v_start := coalesce(p_date_from, p_date);
      v_end   := coalesce(p_date_to, p_date);
    else
      v_start := date_trunc('month', p_date::timestamp)::date;
      v_end   := least((v_start + interval '1 month' - interval '1 day')::date, p_date);
  end case;
  return query select
    v_start::timestamptz,
    (v_end::timestamptz + interval '1 day' - interval '1 second'),
    (v_end - v_start + 1)::int,
    (select count(*)::int from generate_series(v_start, v_end, '1 day'::interval) d
     where extract(isodow from d) <= 5);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ─── 2. get_team_summary — nuevos filtros + nuevas métricas ──────────────────
--   Nuevos parámetros : p_hunter_id, p_leader_id, p_date_from, p_date_to
--   Nuevas métricas   : leadsWithoutContact, closeRate, teamR2sPerDay

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

        -- Leads asignados al hunter durante el período
        (select count(distinct l.id) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and l.assigned_at between v_from and v_to
           and (p_source is null or l.source = p_source)
        ) as total_leads,

        -- Sin contactar: asignados en período, sin ningún intento de contacto
        (select count(distinct l.id) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and l.assigned_at between v_from and v_to
           and (p_source is null or l.source = p_source)
           and not exists (select 1 from contact_attempts ca where ca.lead_id = l.id)
        ) as leads_without_contact,

        -- Con TYC
        (select count(distinct l.id) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and l.assigned_at between v_from and v_to
           and l.tyc is not null
           and (p_source is null or l.source = p_source)
        ) as leads_con_tyc,

        -- Sin TYC
        (select count(distinct l.id) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and l.assigned_at between v_from and v_to
           and l.tyc is null
           and (p_source is null or l.source = p_source)
        ) as leads_sin_tyc,

        -- Gestionados: leads contactados durante el período
        (select count(distinct ca.lead_id)
         from contact_attempts ca
         join leads l on l.id = ca.lead_id
         where l.assigned_to_id = h.id and l.is_deleted = false
           and ca.contacted_at between v_from and v_to
           and (p_source is null or l.source = p_source)
        ) as leads_with_contact,

        -- Contactos efectivos en el período
        (select count(distinct ca.lead_id)
         from contact_attempts ca
         join leads l on l.id = ca.lead_id
         where l.assigned_to_id = h.id and l.is_deleted = false
           and ca.result = 'EFECTIVO'
           and ca.contacted_at between v_from and v_to
           and (p_source is null or l.source = p_source)
        ) as leads_with_effective,

        -- OB: snapshot actual
        (select count(distinct l.id) from leads l
         where l.assigned_to_id = h.id and l.is_deleted = false
           and l.current_stage = 'OB'
           and (p_source is null or l.source = p_source)
        ) as ob_count,

        -- R2S: leads que entraron a OK_R2S o VENTA durante el período
        (select count(distinct sh.lead_id)
         from stage_history sh
         join leads l on l.id = sh.lead_id
         where l.assigned_to_id = h.id and l.is_deleted = false
           and sh.to_stage in ('OK_R2S', 'VENTA')
           and sh.changed_at between v_from and v_to
           and (p_source is null or l.source = p_source)
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

-- ─── 3. get_funnel_distribution — distribución actual de etapas ──────────────

create or replace function get_funnel_distribution(
  p_country   text        default null,
  p_source    lead_source default null,
  p_hunter_id uuid        default null,
  p_leader_id uuid        default null
)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_role    user_role;
begin
  select role into v_role from profiles where id = v_user_id;
  return (
    select coalesce(json_agg(json_build_object('stage', stage, 'count', cnt) order by cnt desc), '[]')
    from (
      select l.current_stage as stage, count(*) as cnt
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
      group by l.current_stage
    ) s
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ─── 4. get_stage_advances — leads que entraron a cada etapa en el período ────

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
      select sh.to_stage as stage, count(distinct sh.lead_id) as cnt
      from stage_history sh
      join leads l on l.id = sh.lead_id
      join profiles p on p.id = l.assigned_to_id
      where sh.changed_at between v_from and v_to
        and l.is_deleted = false
        and p.is_active = true
        and p.role = 'HUNTER'
        and (p_country   is null or l.country::text = p_country)
        and (p_source    is null or l.source = p_source)
        and (p_hunter_id is null or l.assigned_to_id = p_hunter_id)
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
        )
      group by sh.to_stage
    ) s
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ─── 5. get_discard_reasons — causales de descarte en el período ─────────────

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
    select coalesce(json_agg(json_build_object('reason', stage, 'count', cnt) order by cnt desc), '[]')
    from (
      select sh.to_stage as stage, count(distinct sh.lead_id) as cnt
      from stage_history sh
      join leads l on l.id = sh.lead_id
      join profiles p on p.id = l.assigned_to_id
      where sh.changed_at between v_from and v_to
        and sh.to_stage like 'BLOQUEADO%'
        and l.is_deleted = false
        and p.is_active = true
        and p.role = 'HUNTER'
        and (p_country   is null or l.country::text = p_country)
        and (p_source    is null or l.source = p_source)
        and (p_hunter_id is null or l.assigned_to_id = p_hunter_id)
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
        )
      group by sh.to_stage
    ) s
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
