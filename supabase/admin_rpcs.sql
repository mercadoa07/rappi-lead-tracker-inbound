-- ════════════════════════════════════════════════════════════
-- Admin RPCs — reemplazo de supabaseAdmin en el cliente
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- Helper: verifica que el usuario actual sea ADMIN
create or replace function is_admin()
returns boolean as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'ADMIN', false);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Crear perfil (reemplaza profilesApi.create que usaba supabaseAdmin)
create or replace function admin_create_profile(
  p_id           uuid,
  p_email        text,
  p_full_name    text,
  p_role         text,
  p_country      country,
  p_daily_target int,
  p_leader_id    uuid default null
)
returns profiles as $$
declare
  v_profile profiles;
begin
  if not is_admin() then
    raise exception 'Unauthorized: only ADMIN can create profiles';
  end if;

  insert into profiles (id, email, full_name, role, country, daily_target, leader_id)
  values (p_id, p_email, p_full_name, p_role::user_role, p_country, p_daily_target, p_leader_id)
  returning * into v_profile;

  return v_profile;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Upsert leads (reemplaza importApi.upsertLeads que usaba supabaseAdmin)
create or replace function admin_upsert_leads(p_rows jsonb)
returns json as $$
declare
  v_imported int := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: only ADMIN can import leads';
  end if;

  insert into leads (
    lead_id_external, name, country, source, ops_zone, entry_method,
    phone1, phone2, informacion_lead, tyc, observaciones, external_store_id,
    assigned_to_id, assigned_at, current_stage, week_assigned, semana_lead
  )
  select
    (r->>'lead_id_external')::text,
    (r->>'name')::text,
    (r->>'country')::country,
    coalesce((r->>'source')::lead_source, 'SDR'),
    r->>'ops_zone',
    r->>'entry_method',
    r->>'phone1',
    r->>'phone2',
    r->>'informacion_lead',
    nullif(r->>'tyc','')::timestamptz,
    r->>'observaciones',
    r->>'external_store_id',
    nullif(r->>'assigned_to_id','')::uuid,
    coalesce(nullif(r->>'assigned_at','')::timestamptz, now()),
    coalesce((r->>'current_stage')::funnel_stage, 'SIN_CONTACTO'),
    coalesce(nullif(r->>'week_assigned','')::timestamptz, date_trunc('week', now())),
    nullif(r->>'semana_lead','')::timestamptz
  from jsonb_array_elements(p_rows) r
  on conflict (lead_id_external) do update set
    name              = excluded.name,
    country           = excluded.country,
    source            = excluded.source,
    ops_zone          = excluded.ops_zone,
    entry_method      = excluded.entry_method,
    phone1            = excluded.phone1,
    phone2            = excluded.phone2,
    informacion_lead  = excluded.informacion_lead,
    tyc               = excluded.tyc,
    observaciones     = excluded.observaciones,
    external_store_id = excluded.external_store_id,
    semana_lead       = excluded.semana_lead,
    updated_at        = now();

  get diagnostics v_imported = row_count;
  return json_build_object('imported', v_imported);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Upsert profiles (reemplaza importApi.upsertProfiles que usaba supabaseAdmin)
create or replace function admin_upsert_profiles(p_rows jsonb)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: only ADMIN can upsert profiles';
  end if;

  insert into profiles (id, email, full_name, role, country, daily_target, leader_id)
  select
    (r->>'id')::uuid,
    r->>'email',
    r->>'full_name',
    (r->>'role')::user_role,
    (r->>'country')::country,
    coalesce((r->>'daily_target')::int, 4),
    nullif(r->>'leader_id','')::uuid
  from jsonb_array_elements(p_rows) r
  on conflict (email) do update set
    full_name    = excluded.full_name,
    role         = excluded.role,
    country      = excluded.country,
    daily_target = excluded.daily_target,
    leader_id    = excluded.leader_id,
    updated_at   = now();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Dar acceso a usuarios autenticados (la RPC valida el rol internamente)
grant execute on function is_admin to authenticated;
grant execute on function admin_create_profile to authenticated;
grant execute on function admin_upsert_leads to authenticated;
grant execute on function admin_upsert_profiles to authenticated;
