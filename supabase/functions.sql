-- ════════════════════════════════════════════════════════════
-- ⚠️  DEPRECATED — no correr contra una DB con migrations_v5.sql aplicado.
-- Las funciones get_team_summary y get_discard_reasons aquí referencian
-- etapas BLOQUEADO_* que fueron reemplazadas por DESCARTADO + motivo_descarte.
-- La versión activa en producción está en supabase/migrations_v5.sql
-- ════════════════════════════════════════════════════════════
-- RPC Functions — rappi-lead-tracker-inbound
-- ════════════════════════════════════════════════════════════

-- ─── Helper: period bounds ───────────────────────────────────────────────────
-- Handles: today | this_week | last_week | this_month | last_month
-- v_biz_days = Mon–Fri days elapsed in the period (capped at p_date for current periods)

create or replace function period_bounds(p_period text, p_date date)
returns table(v_from timestamptz, v_to timestamptz, v_days int, v_biz_days int) as $$
declare
  v_start date;
  v_end   date;
begin
  case p_period
    when 'today' then
      v_start := p_date;
      v_end   := p_date;
    when 'this_week' then
      v_start := date_trunc('week', p_date::timestamp)::date;           -- Monday
      v_end   := least(v_start + 6, p_date);                           -- cap at today
    when 'last_week' then
      v_start := (date_trunc('week', p_date::timestamp) - interval '7 days')::date;
      v_end   := v_start + 6;                                           -- full week Mon–Sun
    when 'this_month' then
      v_start := date_trunc('month', p_date::timestamp)::date;
      v_end   := least((v_start + interval '1 month' - interval '1 day')::date, p_date);
    when 'last_month' then
      v_start := (date_trunc('month', p_date::timestamp) - interval '1 month')::date;
      v_end   := (v_start + interval '1 month' - interval '1 day')::date;
    else -- fallback: this_month
      v_start := date_trunc('month', p_date::timestamp)::date;
      v_end   := least((v_start + interval '1 month' - interval '1 day')::date, p_date);
  end case;

  return query
    select
      v_start::timestamptz,
      (v_end::timestamptz + interval '1 day' - interval '1 second'),
      (v_end - v_start + 1)::int,
      (
        select count(*)::int
        from generate_series(v_start, v_end, '1 day'::interval) d
        where extract(isodow from d) <= 5   -- 1=Mon … 5=Fri
      );
end;
$$ language plpgsql security definer;

-- ─── get_report_summary ──────────────────────────────────────────────────────
-- Para el HUNTER: resumen de su propio desempeño.

create or replace function get_report_summary(p_period text, p_date date)
returns json as $$
declare
  v_from         timestamptz;
  v_to           timestamptz;
  v_days         int;
  v_user_id      uuid := auth.uid();
  v_daily_target int;
  v_productivity bigint;
begin
  select pb.v_from, pb.v_to, pb.v_days
  into v_from, v_to, v_days
  from period_bounds(p_period, p_date) pb;

  select daily_target into v_daily_target from profiles where id = v_user_id;
  v_daily_target := coalesce(v_daily_target, 4);

  -- Productividad: leads en OB + OK_R2S + VENTA
  select count(distinct id)
  into v_productivity
  from leads
  where assigned_to_id = v_user_id
    and is_deleted = false
    and current_stage in ('OB', 'OK_R2S', 'VENTA');

  return json_build_object(
    'period',                    p_period,
    'from',                      v_from,
    'to',                        v_to,
    'totalLeads',                (
      select count(*) from leads
      where assigned_to_id = v_user_id and is_deleted = false
    ),
    'leadsWithContactAttempt',   (
      select count(distinct ca.lead_id)
      from contact_attempts ca
      join leads l on l.id = ca.lead_id
      where l.assigned_to_id = v_user_id
        and ca.contacted_at between v_from and v_to
    ),
    'leadsWithEffectiveContact', (
      select count(distinct ca.lead_id)
      from contact_attempts ca
      join leads l on l.id = ca.lead_id
      where l.assigned_to_id = v_user_id
        and ca.result = 'EFECTIVO'
        and ca.contacted_at between v_from and v_to
    ),
    'contactabilityRate', (
      select case
        when count(distinct ca.lead_id) filter (where ca.contacted_at between v_from and v_to) > 0
        then round(
          count(distinct ca.lead_id) filter (where ca.result = 'EFECTIVO' and ca.contacted_at between v_from and v_to)::numeric
          / count(distinct ca.lead_id) filter (where ca.contacted_at between v_from and v_to) * 100, 1)
        else 0
      end
      from contact_attempts ca
      join leads l on l.id = ca.lead_id
      where l.assigned_to_id = v_user_id
    ),
    'funnelDistribution', (
      select coalesce(json_agg(json_build_object('stage', current_stage, 'count', cnt)), '[]')
      from (
        select current_stage, count(*) as cnt
        from leads
        where assigned_to_id = v_user_id and is_deleted = false
        group by current_stage
      ) s
    ),
    'productivity',          v_productivity,
    'accumulatedTarget',     v_daily_target * v_days,
    'gap',                   v_productivity - (v_daily_target * v_days),
    'closedRate', (
      select case
        when count(*) filter (where current_stage not like 'BLOQUEADO%') > 0
        then round(
          count(*) filter (where current_stage in ('OK_R2S', 'VENTA'))::numeric
          / count(*) filter (where current_stage not like 'BLOQUEADO%') * 100, 1)
        else 0
      end
      from leads where assigned_to_id = v_user_id and is_deleted = false
    ),
    'blockedBreakdown', (
      select coalesce(json_agg(json_build_object('stage', current_stage, 'count', cnt)), '[]')
      from (
        select current_stage, count(*) as cnt
        from leads
        where assigned_to_id = v_user_id
          and is_deleted = false
          and current_stage like 'BLOQUEADO%'
        group by current_stage
      ) s
    ),
    'successfulNegotiation', (
      select count(*) from leads
      where assigned_to_id = v_user_id
        and is_deleted = false
        and current_stage in ('OK_R2S', 'VENTA')
    )
  );
end;
$$ language plpgsql security definer;

-- ─── get_team_summary ────────────────────────────────────────────────────────
-- Para LIDER/ADMIN: métricas por hunter con soporte SDR/SOB.
--
-- Definiciones:
--   total_leads        = leads asignados AL HUNTER durante el período
--   leads_with_contact = leads (de cualquier fecha) contactados durante el período
--   r2s_count          = leads que ENTRARON a OK_R2S o VENTA durante el período (via stage_history)
--   ob_count           = snapshot: leads actualmente en OB
--   r2s_per_day        = r2s_count / días hábiles del período
--   accumulatedTarget  = daily_target × días hábiles del período
--   gap                = r2s_count − accumulatedTarget
--   phasing            = r2s_count / accumulatedTarget × 100

create or replace function get_team_summary(
  p_period  text,
  p_date    date,
  p_country text         default null,
  p_source  lead_source  default null
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
  from period_bounds(p_period, p_date) pb;

  select role into v_role from profiles where id = v_user_id;

  return (
    with hunters as (
      select p.id, p.full_name, p.email, p.country, p.daily_target
      from profiles p
      where p.is_active = true
        and p.role = 'HUNTER'
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or v_role = 'ADMIN'
        )
        and (p_country is null or p.country::text = p_country)
    ),
    hunter_stats as (
      select
        h.id           as hunter_id,
        h.full_name    as hunter_name,
        h.email        as hunter_email,
        h.country      as country,
        h.daily_target as daily_target,

        -- Leads asignados AL hunter DURANTE el período
        (
          select count(distinct l.id)
          from leads l
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and l.assigned_at between v_from and v_to
            and (p_source is null or l.source = p_source)
        ) as total_leads,

        (
          select count(distinct l.id)
          from leads l
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and l.assigned_at between v_from and v_to
            and l.tyc is not null
            and (p_source is null or l.source = p_source)
        ) as leads_con_tyc,

        (
          select count(distinct l.id)
          from leads l
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and l.assigned_at between v_from and v_to
            and l.tyc is null
            and (p_source is null or l.source = p_source)
        ) as leads_sin_tyc,

        -- Gestionados: leads (cualquier fecha) con intento de contacto DURANTE el período
        (
          select count(distinct ca.lead_id)
          from contact_attempts ca
          join leads l on l.id = ca.lead_id
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and ca.contacted_at between v_from and v_to
            and (p_source is null or l.source = p_source)
        ) as leads_with_contact,

        -- C. Efectivos: leads con contacto EFECTIVO durante el período
        (
          select count(distinct ca.lead_id)
          from contact_attempts ca
          join leads l on l.id = ca.lead_id
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and ca.result = 'EFECTIVO'
            and ca.contacted_at between v_from and v_to
            and (p_source is null or l.source = p_source)
        ) as leads_with_effective,

        -- OB: snapshot actual (no filtrado por período)
        (
          select count(distinct l.id)
          from leads l
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and l.current_stage = 'OB'
            and (p_source is null or l.source = p_source)
        ) as ob_count,

        -- R2S: leads que ENTRARON a OK_R2S o VENTA durante el período
        (
          select count(distinct sh.lead_id)
          from stage_history sh
          join leads l on l.id = sh.lead_id
          where l.assigned_to_id = h.id
            and l.is_deleted = false
            and sh.to_stage in ('OK_R2S', 'VENTA')
            and sh.changed_at between v_from and v_to
            and (p_source is null or l.source = p_source)
        ) as r2s_count

      from hunters h
    ),
    ranked as (
      select
        hs.*,
        -- Productividad = R2S por día hábil del período
        case when v_biz_days > 0
          then round(hs.r2s_count::numeric / v_biz_days, 2)
          else 0
        end as r2s_per_day,
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
        'leadsConTyc',               sum(leads_con_tyc),
        'leadsSinTyc',               sum(leads_sin_tyc),
        'leadsWithContactAttempt',   sum(leads_with_contact),
        'leadsWithEffectiveContact', sum(leads_with_effective),
        'obCount',                   sum(ob_count),
        'r2sCount',                  sum(r2s_count),
        'productivity',              sum(r2s_count),
        'accumulatedTarget',         sum(daily_target) * v_biz_days,
        'gap',                       sum(r2s_count) - sum(daily_target) * v_biz_days,
        'contactabilityRate', case
          when sum(leads_with_contact) > 0
          then round(sum(leads_with_effective)::numeric / sum(leads_with_contact) * 100, 1)
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
          'leadsConTyc',               r.leads_con_tyc,
          'leadsSinTyc',               r.leads_sin_tyc,
          'leadsWithContactAttempt',   r.leads_with_contact,
          'leadsWithEffectiveContact', r.leads_with_effective,
          'contactabilityRate', case when r.leads_with_contact > 0
            then round(r.leads_with_effective::numeric / r.leads_with_contact * 100, 1)
            else 0
          end,
          'obCount',          r.ob_count,
          'r2sCount',         r.r2s_count,
          'productivity',     r.r2s_count,
          'r2sPerDay',        r.r2s_per_day,
          'accumulatedTarget', r.daily_target * v_biz_days,
          'gap',              r.r2s_count - (r.daily_target * v_biz_days),
          'phasing', case when (r.daily_target * v_biz_days) > 0
            then round(r.r2s_count::numeric / (r.daily_target * v_biz_days) * 100, 1)
            else 0
          end
        ) order by r.ranking)
        from ranked r
      ), '[]')
    )
    from ranked
  );
end;
$$ language plpgsql security definer;

-- ─── get_closed_rate_report ──────────────────────────────────────────────────
-- Reporte mensual SOB closed rate.

create or replace function get_closed_rate_report(
  p_month   int,
  p_year    int,
  p_country text default null
)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_role    user_role;
  v_from    timestamptz;
  v_to      timestamptz;
begin
  select role into v_role from profiles where id = v_user_id;

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_to   := v_from + interval '1 month' - interval '1 second';

  return (
    with scope as (
      select
        p.id   as hunter_id,
        p.full_name as hunter_name,
        p.country,
        p2.full_name as lider_name
      from profiles p
      left join profiles p2 on p2.id = p.leader_id
      where p.is_active = true
        and p.role = 'HUNTER'
        and (
          (v_role = 'LIDER' and p.leader_id = v_user_id)
          or v_role = 'ADMIN'
        )
        and (p_country is null or p.country::text = p_country)
    ),
    stats as (
      select
        s.hunter_id,
        s.hunter_name,
        s.lider_name,
        s.country,
        case when l.tyc is not null then 'SI' else 'NO' end as tiene_tyc,
        count(distinct l.id)                                 as leads,
        count(distinct l.id) filter (
          where l.current_stage in ('OK_R2S', 'VENTA')
        )                                                    as leads_rts
      from scope s
      left join leads l
             on l.assigned_to_id = s.hunter_id
            and l.is_deleted = false
            and l.source = 'SOB'
            and l.assigned_at between v_from and v_to
      group by s.hunter_id, s.hunter_name, s.lider_name, s.country, tiene_tyc
    )
    select coalesce(json_agg(json_build_object(
      'hunterId',    hunter_id,
      'hunterName',  hunter_name,
      'liderName',   lider_name,
      'country',     country,
      'tieneTyc',    tiene_tyc,
      'leads',       leads,
      'leadsRts',    leads_rts,
      'closedRate',  case when leads > 0
                     then round(leads_rts::numeric / leads * 100, 1)
                     else 0 end
    )), '[]')
    from stats
  );
end;
$$ language plpgsql security definer;

-- ─── get_hc_summary ──────────────────────────────────────────────────────────
-- Resumen de headcount y carga por país/semana.

create or replace function get_hc_summary(p_source lead_source default null)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_role    user_role;
begin
  select role into v_role from profiles where id = v_user_id;

  if v_role != 'ADMIN' then
    return '[]'::json;
  end if;

  return (
    select coalesce(json_agg(json_build_object(
      'country',       country,
      'source',        team,
      'hunters',       hunters,
      'totalLeads',    total_leads,
      'leadsThisWeek', leads_this_week,
      'leadsPerHunter', case when hunters > 0
                        then round(total_leads::numeric / hunters, 1)
                        else 0 end
    )), '[]')
    from (
      select
        p.country,
        p.team,
        count(distinct p.id)            as hunters,
        count(l.id)                     as total_leads,
        count(l.id) filter (
          where l.week_assigned >= date_trunc('week', now())
        )                               as leads_this_week
      from profiles p
      left join leads l
             on l.assigned_to_id = p.id
            and l.is_deleted = false
            and (p_source is null or l.source = p_source)
      where p.is_active = true
        and p.role = 'HUNTER'
        and (p_source is null or p.team = p_source)
      group by p.country, p.team
      order by p.country, p.team
    ) s
  );
end;
$$ language plpgsql security definer;

-- ─── get_team_trends ─────────────────────────────────────────────────────────

create or replace function get_team_trends(
  p_days   int         default 7,
  p_source lead_source default null
)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_role    user_role;
begin
  select role into v_role from profiles where id = v_user_id;

  return (
    with days as (
      select generate_series(
        current_date - (p_days - 1),
        current_date,
        interval '1 day'
      )::date as day
    ),
    hunter_scope as (
      select id from profiles
      where is_active = true and role = 'HUNTER'
        and (
          v_role = 'ADMIN'
          or leader_id = v_user_id
          or id = v_user_id
        )
        and (p_source is null or team = p_source)
    )
    select json_agg(json_build_object(
      'date',           d.day,
      'contactability', coalesce(round(
        count(distinct ca_eff.lead_id)::numeric
        / nullif(count(distinct ca_any.lead_id), 0) * 100, 1), 0),
      'productivity',   count(distinct ca_any.lead_id),
      'newLeads',       (
        select count(*) from leads nl
        where nl.assigned_to_id in (select id from hunter_scope)
          and date_trunc('day', nl.assigned_at) = d.day
          and nl.is_deleted = false
          and (p_source is null or nl.source = p_source)
      )
    ) order by d.day)
    from days d
    left join contact_attempts ca_any
           on date_trunc('day', ca_any.contacted_at) = d.day
          and ca_any.lead_id in (
            select l.id from leads l
            where l.assigned_to_id in (select id from hunter_scope)
              and (p_source is null or l.source = p_source)
          )
    left join contact_attempts ca_eff
           on ca_eff.id = ca_any.id
          and ca_eff.result = 'EFECTIVO'
    group by d.day
    order by d.day
  );
end;
$$ language plpgsql security definer;
