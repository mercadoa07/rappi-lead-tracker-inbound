# QA Report & Fix Plan — rappi-lead-tracker-inbound

> **Propósito de este documento:** sirve como instrucciones detalladas para que otra IA (o desarrollador) ejecute los cambios necesarios. Cada hallazgo incluye ubicación exacta, explicación, y el fix recomendado con código.
>
> **Orden de ejecución:** respeta el orden. CRÍTICOS primero (bloquean cualquier otra cosa), luego ALTOS, MEDIOS y BAJOS. Los fixes están agrupados por severidad, no por archivo.
>
> **Fecha del audit:** 2026-04-11
> **Auditor:** Claude (Opus 4.6) via Claude Code
> **Repo local:** `C:\Users\apelis.mercado\Documents\GitHub\rappi-lead-tracker-inbound`
> **Repo remoto:** https://github.com/mercadoa07/rappi-lead-tracker-inbound-is.git
> **App en producción:** https://rappi-lead-tracker-inbound-is.vercel.app/
> **Supabase project:** qqutphbfycuxniqaatdl
>
> **IMPORTANTE — Acciones que SÓLO el humano puede hacer (no la IA):**
> 1. Rotar la `service_role` key en Supabase Dashboard → Project Settings → API → Reset service_role key
> 2. Rotar también la `anon` key por precaución
> 3. Actualizar variables de entorno en Vercel Dashboard tras rotar
> 4. Revisar si el repo en GitHub está público y considerarlo temporalmente privado hasta limpiar historia
> 5. Verificar si alguna de las claves expuestas fue usada maliciosamente (Supabase logs)
>
> Todo lo demás puede hacerlo la IA ejecutora con acceso al filesystem.

---

## 📋 Resumen ejecutivo

| Severidad | Cantidad | Categoría |
|-----------|----------|-----------|
| CRÍTICO   | 4 | Seguridad (3) + Bug (1) |
| ALTO      | 8 | Seguridad (1) + Bug (4) + Performance (3) |
| MEDIO     | 8 | Bug (5) + Performance (3) |
| BAJO      | 9 | Cleanup / defensas en profundidad |

**Total: 29 hallazgos documentados.**

Los hallazgos de performance (bundle size, queries N+1, índices faltantes, deps muertas, memoización, etc.) **SÍ** están incluidos en este reporte — ver sección ALTO (#7, #11, #12) y MEDIO (#19, #20) y BAJO (#27, #28).

---

# 🚨 CRÍTICOS

## CRIT-1: Service role key expuesta en el bundle JS de producción

**Categoría:** Seguridad
**Archivos afectados:**
- `client/src/lib/supabase.ts:8-19`
- `client/.env` (línea 3)
- `client/src/services/api.ts:682, 766, 783`
- Scripts en raíz: `import_leads.mjs:8`, `reimport_leads.mjs:14`, `create_inbound_users.mjs:8`, `migrate_profiles.mjs:9`

**Problema:**
La variable `VITE_SUPABASE_SERVICE_ROLE_KEY` tiene el prefijo `VITE_` en `.env`, lo cual hace que Vite la inyecte en el bundle JS del cliente. Fue verificado descargando `https://rappi-lead-tracker-inbound-is.vercel.app/assets/index-PZVHtQOK.js` y el JWT con `"role":"service_role"` está visible en texto plano. Con esa clave se pueden leer los 15,238 leads actuales (con PII: nombre + teléfono) y hacer cualquier operación sobre la DB bypasseando RLS.

Adicionalmente, 3 scripts `.mjs` en la raíz tienen hardcoded la misma service_role key y están commiteados en git (verificado con `git ls-files`).

**Fix — Pasos para la IA ejecutora:**

### Paso 1: Eliminar `supabaseAdmin` del cliente

Reemplazar el contenido completo de `client/src/lib/supabase.ts` con:

```ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Paso 2: Eliminar la línea de env

Editar `client/.env` y **borrar** la línea:
```
VITE_SUPABASE_SERVICE_ROLE_KEY=...
```
(dejar solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`)

Hacer lo mismo en `client/.env.example`.

### Paso 3: Reemplazar los 3 usos de `supabaseAdmin` en `client/src/services/api.ts`

Las 3 operaciones que usan `supabaseAdmin` son privilegiadas y deben moverse a Supabase Edge Functions o Vercel API Routes con auth server-side. Mientras se migran, se pueden reemplazar por una función RPC `SECURITY DEFINER` en Supabase que valide el rol del usuario autenticado.

**Opción A (rápida, recomendada):** Crear RPCs en Postgres con `SECURITY DEFINER` que validen `auth.uid()` y el rol ADMIN.

Crear nuevo archivo `supabase/admin_rpcs.sql`:

```sql
-- ════════════════════════════════════════════════════════════
-- Admin RPCs — replacement for client-side service_role usage
-- ════════════════════════════════════════════════════════════

-- Helper: check current user is admin
create or replace function is_admin()
returns boolean as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'ADMIN', false);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Create profile (replaces profilesApi.create using supabaseAdmin)
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

-- Upsert leads (replaces importApi.upsertLeads)
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

-- Upsert profiles (replaces importApi.upsertProfiles)
create or replace function admin_upsert_profiles(p_rows jsonb)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: only ADMIN can upsert profiles';
  end if;

  insert into profiles (id, email, full_name, role, country, team, daily_target, leader_id)
  select
    (r->>'id')::uuid,
    r->>'email',
    r->>'full_name',
    (r->>'role')::user_role,
    (r->>'country')::country,
    coalesce((r->>'team')::lead_source, 'SDR'),
    coalesce((r->>'daily_target')::int, 4),
    nullif(r->>'leader_id','')::uuid
  from jsonb_array_elements(p_rows) r
  on conflict (email) do update set
    full_name    = excluded.full_name,
    role         = excluded.role,
    country      = excluded.country,
    team         = excluded.team,
    daily_target = excluded.daily_target,
    leader_id    = excluded.leader_id,
    updated_at   = now();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Grant execute to authenticated users (RPC itself validates role)
grant execute on function admin_create_profile to authenticated;
grant execute on function admin_upsert_leads to authenticated;
grant execute on function admin_upsert_profiles to authenticated;
```

**La IA ejecutora debe indicarle al humano:** "Corre `supabase/admin_rpcs.sql` en el SQL Editor de Supabase antes de desplegar el código nuevo."

Luego actualizar `client/src/services/api.ts`:

1. Cambiar el import de la línea 2:
```ts
import { supabase } from '../lib/supabase'
```
(quitar `supabaseAdmin`)

2. Reemplazar `profilesApi.create` (líneas 673-697) con:
```ts
create: async (payload: {
  id:          string
  email:       string
  fullName:    string
  role:        string
  country:     Country
  dailyTarget: number
  leaderId?:   string
}) => {
  const { data, error } = await supabase.rpc('admin_create_profile', {
    p_id:           payload.id,
    p_email:        payload.email,
    p_full_name:    payload.fullName,
    p_role:         payload.role,
    p_country:      payload.country,
    p_daily_target: payload.dailyTarget,
    p_leader_id:    payload.leaderId ?? null,
  })
  if (error) throw error
  return mapProfile(data)
},
```

3. Reemplazar `importApi.upsertLeads` (líneas 757-780) con:
```ts
upsertLeads: async (rows: Record<string, unknown>[]) => {
  const BATCH = 500
  let imported = 0
  let skipped  = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { data, error } = await supabase.rpc('admin_upsert_leads', { p_rows: batch })
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`)
      skipped += batch.length
    } else {
      imported += (data?.imported ?? batch.length)
    }
  }

  return { imported, skipped, errors }
},
```

4. Reemplazar `importApi.upsertProfiles` (líneas 782-787) con:
```ts
upsertProfiles: async (rows: Record<string, unknown>[]) => {
  const { error } = await supabase.rpc('admin_upsert_profiles', { p_rows: rows })
  if (error) throw error
},
```

### Paso 4: Eliminar scripts con service_role hardcoded

Los siguientes archivos en la raíz del repo tienen service_role key hardcoded:
- `import_leads.mjs`
- `reimport_leads.mjs`
- `create_inbound_users.mjs`
- `migrate_profiles.mjs`

**Opción A (recomendada):** Moverlos a una carpeta `scripts/` gitignoreada y hacer que lean de `process.env.SUPABASE_SERVICE_ROLE_KEY`:

1. Crear carpeta `scripts/` en la raíz
2. Mover los 4 `.mjs` ahí
3. Agregar al `.gitignore`:
```
scripts/
*.csv
profiles_source.json
```
4. En cada `.mjs`, reemplazar la línea hardcoded por:
```js
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
```
5. Crear `scripts/.env.example` con las vars necesarias
6. Ejecutar `git rm` sobre los archivos originales (git los detectará como eliminados, pero su contenido seguirá en la historia — avisar al humano que debe correr `git filter-repo` o `BFG Repo-Cleaner` para purgar historia).

### Paso 5: Avisar al humano

Después de aplicar los cambios, la IA ejecutora debe recordarle al humano que:
1. **Rotar** la service_role key en Supabase Dashboard
2. **Actualizar** las env vars en Vercel (quitar `VITE_SUPABASE_SERVICE_ROLE_KEY`)
3. **Limpiar la historia de git** con `git filter-repo --invert-paths --path import_leads.mjs --path reimport_leads.mjs --path create_inbound_users.mjs --path migrate_profiles.mjs`
4. **Forzar push** después de limpiar (con permiso explícito)
5. **Revisar logs de Supabase** por uso anómalo de la clave comprometida

---

## CRIT-2: Privilege escalation vía `profiles_update_own`

**Categoría:** Seguridad
**Archivo:** `supabase/rls.sql:33-35`

**Problema:**
```sql
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id);
```

No tiene `WITH CHECK` ni restricción de columnas. Un HUNTER puede ejecutar `UPDATE profiles SET role='ADMIN' WHERE id = me` y promoverse a admin.

**Fix:**

Crear un nuevo archivo `supabase/fix_privilege_escalation.sql` con:

```sql
-- ════════════════════════════════════════════════════════════
-- Fix: prevent hunters from escalating their own privileges
-- ════════════════════════════════════════════════════════════

-- Trigger que bloquea cambios en campos sensibles cuando el usuario
-- se actualiza a sí mismo (no aplica a admins actualizando a otros)
create or replace function prevent_self_privilege_escalation()
returns trigger as $$
begin
  if auth.uid() = new.id and (
       new.role         is distinct from old.role
    or new.is_active    is distinct from old.is_active
    or new.leader_id    is distinct from old.leader_id
    or new.country      is distinct from old.country
    or new.team         is distinct from old.team
    or new.daily_target is distinct from old.daily_target
  ) then
    -- Si es admin, permitir (admin editando su propio perfil puede cambiar todo)
    if coalesce((select role from profiles where id = auth.uid()), 'HUNTER'::user_role) <> 'ADMIN' then
      raise exception 'No puedes modificar estos campos de tu propio perfil';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists prevent_self_privilege_escalation_trg on profiles;
create trigger prevent_self_privilege_escalation_trg
  before update on profiles
  for each row execute function prevent_self_privilege_escalation();
```

Indicarle al humano que lo corra en el SQL Editor de Supabase.

---

## CRIT-3: Cualquier autenticado puede actualizar leads sin asignar

**Categoría:** Seguridad
**Archivo:** `supabase/rls.sql:86-93`

**Problema:**
```sql
create policy "leads_update_lider"
  on leads for update
  using (
    assigned_to_id in (
      select id from profiles where leader_id = auth.uid()
    )
    or assigned_to_id is null
  );
```

No filtra por `role='LIDER'`. Las policies de UPDATE se combinan con OR. Resultado: cualquier HUNTER puede hacer `UPDATE leads SET assigned_to_id = me WHERE assigned_to_id IS NULL` y robar todos los leads sin asignar.

**Fix:**

Crear archivo `supabase/fix_rls_lider_policy.sql`:

```sql
-- ════════════════════════════════════════════════════════════
-- Fix: leads_update_lider now enforces LIDER role explicitly
-- ════════════════════════════════════════════════════════════

drop policy if exists "leads_update_lider" on leads;

create policy "leads_update_lider"
  on leads for update
  using (
    (select role from profiles where id = auth.uid()) = 'LIDER'
    and (
      assigned_to_id in (select id from profiles where leader_id = auth.uid())
      or (
        assigned_to_id is null
        and country in (select distinct country from profiles where leader_id = auth.uid())
      )
    )
  )
  with check (
    (select role from profiles where id = auth.uid()) = 'LIDER'
    and (
      assigned_to_id in (select id from profiles where leader_id = auth.uid())
      or assigned_to_id is null
    )
  );

-- Fix también la policy de HUNTER para que no pueda reasignar
drop policy if exists "leads_update_hunter" on leads;

create policy "leads_update_hunter"
  on leads for update
  using (assigned_to_id = auth.uid())
  with check (assigned_to_id = auth.uid());
```

---

## CRIT-4: Filter injection en búsqueda de leads

**Categoría:** Seguridad / Bug
**Archivo:** `client/src/services/api.ts:167-171`

**Problema:**
```ts
if (filters.search) {
  query = query.or(
    `name.ilike.%${filters.search}%,lead_id_external.ilike.%${filters.search}%`,
  )
}
```

El input del usuario entra directo al DSL de PostgREST. Un atacante puede inyectar filtros adicionales escribiendo en el buscador: `%,assigned_to_id.not.is.null` o similar.

**Fix:**

Reemplazar el bloque por:

```ts
if (filters.search) {
  // Escape PostgREST special chars: , ( ) * % \ : "
  const safe = filters.search.replace(/[,()*%\\:"']/g, ' ').trim()
  if (safe) {
    query = query.or(
      `name.ilike.%${safe}%,lead_id_external.ilike.%${safe}%`,
    )
  }
}
```

**Mejor aún (opcional):** usar `.ilike()` chained con `.or()` programático en lugar de string templating. Pero la sanitización es suficiente como fix mínimo.

---

# 🔴 ALTOS

## ALTO-5: PII en CSVs sin gitignore

**Archivos:** raíz del repo

**Problema:** `.gitignore` no excluye `*.csv` ni `profiles_source.json`. Aunque los CSVs actuales (`Leads Outbound 2026-04-11.csv`, etc.) no están tracked, un commit accidental los publicaría. Contienen PII (nombres + teléfonos).

**Fix:** Agregar al `.gitignore`:

```
# Data files (PII)
*.csv
profiles_source.json
scripts/
```

## ALTO-6: `assignLeads` silencia errores

**Archivo:** `client/src/services/api.ts:726-751`

**Problema:** `.then(() => undefined)` transforma errores en success. `Promise.all` nunca rechaza.

**Fix:** Reemplazar el bloque por:

```ts
assignLeads: async (hunterIds: string[], leadIds: string[]) => {
  if (hunterIds.length === 0 || leadIds.length === 0) return

  const perHunter = Math.ceil(leadIds.length / hunterIds.length)
  const updates: Promise<unknown>[] = []
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
        .then(({ error }) => {
          if (error) throw error
        }),
    )
  }

  const results = await Promise.allSettled(updates)
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    throw new Error(`${failed.length} batch(es) de asignación fallaron`)
  }
},
```

## ALTO-7: Kanban sin paginación (fetch 10,000 leads)

**Archivo:** `client/src/pages/KanbanPage.tsx` (alrededor de líneas 309-314)

**Problema:** Usa `limit: 10000` y ya hay ~15k leads en producción. Memoria y render lentos, transfer de ~MB de payload por cada carga.

**Fix — Opción A (rápida):** Crear una RPC que regrese solo campos mínimos para Kanban:

Agregar a `supabase/gestion_functions.sql` o nuevo archivo:

```sql
create or replace function get_kanban_leads(
  p_country text default null,
  p_source  lead_source default null
)
returns table(
  id             uuid,
  name           text,
  current_stage  funnel_stage,
  assigned_to_id uuid,
  assigned_name  text,
  stage_changed_at timestamptz,
  country        country,
  source         lead_source
) as $$
  select
    l.id, l.name, l.current_stage, l.assigned_to_id,
    p.full_name, l.stage_changed_at, l.country, l.source
  from leads l
  left join profiles p on p.id = l.assigned_to_id
  where l.is_deleted = false
    and (p_country is null or l.country::text = p_country)
    and (p_source  is null or l.source = p_source)
$$ language sql stable security definer set search_path = public, pg_temp;
```

Y actualizar `KanbanPage.tsx` para consumir `supabase.rpc('get_kanban_leads', ...)` en lugar de `leadsApi.getLeads({ limit: 10000 })`.

**Fix — Opción B:** Paginar por columna (cada stage trae solo los primeros 50 con botón "cargar más"). Requiere refactor mayor.

## ALTO-8: Invalidación de queries inconsistente en Kanban

**Archivo:** `client/src/pages/KanbanPage.tsx:373-374`

**Problema:** Dos `invalidateQueries` separados pueden mostrar estado parcial entre refetches.

**Fix:** Usar un prefijo común:

```ts
// Cambiar las queryKey a algo como ['kanban', 'pipeline'] y ['kanban', 'sin-contacto']
// Y luego invalidar así:
queryClient.invalidateQueries({ queryKey: ['kanban'] })
```

La IA ejecutora debe verificar los `queryKey` actuales en el archivo antes de aplicar este cambio.

## ALTO-9: HUNTER puede reasignar sus leads a otros

**Archivo:** `supabase/rls.sql:80-83` (`leads_update_hunter`)

**Problema:** Sin `WITH CHECK`, un HUNTER puede cambiar `assigned_to_id` durante un UPDATE y perder acceso al lead.

**Fix:** Ya está incluido en el fix de CRIT-3 (ver arriba `supabase/fix_rls_lider_policy.sql`).

## ALTO-10: `get_discard_reasons` roto post-migración

**Archivos:** `supabase/functions.sql:354-425` vs `supabase/migrations_v5.sql:242-287`

**Problema:** La versión en `functions.sql` filtra `sh.to_stage like 'BLOQUEADO%'` pero el refactor (commit `c5c01cb9`) reemplazó `BLOQUEADO_*` con `DESCARTADO + motivo_descarte`. Si alguien re-ejecuta `functions.sql` después de la migración v5, la función regresa vacío.

**Fix:**

1. Eliminar la función vieja del archivo legacy o agregar una nota al inicio de `functions.sql`:

```sql
-- ⚠️  DEPRECATED: use migrations_v5.sql — this file is kept for historical reference only
-- Functions here reference BLOQUEADO_* stages that were replaced by DESCARTADO.
-- DO NOT run this file against a migrated database.
```

2. Verificar en producción que la versión activa es la de `migrations_v5.sql`. La IA debe preguntarle al humano: "¿Puedes correr en Supabase SQL Editor `SELECT prosrc FROM pg_proc WHERE proname = 'get_discard_reasons';` y pegarme el resultado? Necesito confirmar qué versión está viva."

## ALTO-11: Subqueries N+1 en `get_team_summary`

**Archivo:** `supabase/migrations_v5.sql:47-130`

**Problema:** Cada hunter dispara 8 subqueries independientes sobre `leads`. Con 50 hunters × 8 subqueries = 400 passes secuenciales. Con 15k leads la función se degrada a varios segundos.

**Fix:** Refactorizar `hunter_stats` a una agregación única con `count(*) filter (where ...)`:

Crear archivo `supabase/optimize_team_summary.sql`:

```sql
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
        h.id                                       as hunter_id,
        h.full_name                                as hunter_name,
        h.email                                    as hunter_email,
        h.country                                  as country,
        h.daily_target                             as daily_target,
        count(l.id)                                as total_leads,
        count(l.id) filter (
          where l.tiene_intento_contacto = false
            and l.bloqueado = false
            and l.negociacion_exitosa = false
        )                                          as leads_without_contact,
        count(l.id) filter (where l.tyc is not null) as leads_con_tyc,
        count(l.id) filter (where l.tyc is null)     as leads_sin_tyc,
        count(l.id) filter (where l.tiene_intento_contacto = true)  as leads_with_contact,
        count(l.id) filter (where l.tiene_contacto_efectivo = true) as leads_with_effective,
        count(l.id) filter (where l.current_stage = 'OB')           as ob_count,
        count(l.id) filter (
          where l.negociacion_exitosa = true
            and (l.fecha_estado is null or l.fecha_estado::timestamptz between v_from and v_to)
        )                                          as r2s_count
      from hunters h
      left join leads l
             on l.assigned_to_id = h.id
            and l.is_deleted = false
            and (p_source is null or l.source = p_source)
      group by h.id, h.full_name, h.email, h.country, h.daily_target
    ),
    ranked as (
      select
        hs.*,
        case when v_biz_days > 0
          then round(hs.r2s_count::numeric / v_biz_days, 2) else 0 end as r2s_per_day,
        case when hs.total_leads > 0
          then round(hs.r2s_count::numeric / hs.total_leads * 100, 1) else 0 end as close_rate,
        row_number() over (order by hs.r2s_count desc) as ranking
      from hunter_stats hs
    )
    select json_build_object(
      'period',  p_period,
      'from',    v_from,
      'to',      v_to,
      'bizDays', v_biz_days,
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
          else 0 end,
        'closeRate', case
          when sum(total_leads) > 0
          then round(sum(r2s_count)::numeric / sum(total_leads) * 100, 1)
          else 0 end,
        'teamR2sPerDay', case
          when v_biz_days > 0 and count(*) > 0
          then round(sum(r2s_count)::numeric / v_biz_days / count(*), 2)
          else 0 end
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
            else 0 end,
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
```

## ALTO-12: Índices faltantes

**Archivo:** `supabase/schema.sql:120-132`

**Problema:** Las queries hacen filtros y joins sobre columnas sin índice compuesto. Con 15k leads ya empieza a doler.

**Fix:** Crear archivo `supabase/add_missing_indexes.sql`:

```sql
-- ════════════════════════════════════════════════════════════
-- Missing indexes for performance
-- ════════════════════════════════════════════════════════════

-- Leads: queries filtran casi siempre por assigned_to_id + is_deleted
create index if not exists leads_assigned_not_deleted_idx
  on leads(assigned_to_id, is_deleted)
  where is_deleted = false;

-- Kanban / snapshots OB: assigned + stage
create index if not exists leads_assigned_stage_idx
  on leads(assigned_to_id, current_stage)
  where is_deleted = false;

-- Reports por período de asignación
create index if not exists leads_assigned_at_idx
  on leads(assigned_at)
  where is_deleted = false;

-- Reports de team_summary v5 usa fecha_estado
create index if not exists leads_fecha_estado_idx
  on leads(fecha_estado)
  where is_deleted = false and negociacion_exitosa = true;

-- Flags usados en filter(where ...)
create index if not exists leads_flags_idx
  on leads(tiene_intento_contacto, tiene_contacto_efectivo, bloqueado, negociacion_exitosa)
  where is_deleted = false;

-- Contact attempts por período
create index if not exists contact_attempts_contacted_at_idx
  on contact_attempts(contacted_at);

-- Stage history por período
create index if not exists stage_history_changed_at_idx
  on stage_history(changed_at);
```

---

# 🟡 MEDIOS

## MED-13: Double fetch en AuthContext

**Archivo:** `client/src/context/AuthContext.tsx:65-83`

**Problema:** `loadProfile` se llama en `getSession` y luego inmediatamente en `onAuthStateChange` con el evento `INITIAL_SESSION`. Fetch duplicado + race condition.

**Fix:** Reemplazar el `useEffect` (líneas 65-83) por:

```ts
useEffect(() => {
  let initialLoadDone = false

  supabase.auth.getSession().then(({ data: { session } }) => {
    initialLoadDone = true
    if (session?.user) {
      loadProfile(session.user.id)
    } else {
      setState((s) => ({ ...s, isLoading: false }))
    }
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // Skip INITIAL_SESSION — ya lo manejamos en getSession
    if (!initialLoadDone || event === 'INITIAL_SESSION') return
    if (session?.user) {
      loadProfile(session.user.id)
    } else {
      setState((s) => ({ ...s, user: null, isAuthenticated: false, isLoading: false }))
    }
  })

  return () => subscription.unsubscribe()
}, [loadProfile])
```

## MED-14: `SECURITY DEFINER` sin `search_path`

**Archivos:** `supabase/functions.sql`, `supabase/gestion_functions.sql`, `supabase/migrations_v5.sql`

**Problema:** Todas las funciones `security definer` no fijan `search_path`, lo que es un vector conocido en Postgres/Supabase (ver https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).

**Fix:** Agregar `set search_path = public, pg_temp` a cada función. La IA ejecutora debe:

1. Abrir cada uno de los 3 archivos SQL
2. Para cada `$$ language plpgsql security definer;` cambiar a `$$ language plpgsql security definer set search_path = public, pg_temp;`
3. Avisar al humano que debe re-correr los archivos en Supabase SQL Editor

## MED-15: Paréntesis ausentes en role checks SQL

**Archivos:** Todas las funciones en `supabase/functions.sql`, `supabase/gestion_functions.sql`, `supabase/migrations_v5.sql`

**Problema:** Bloques como:
```sql
and (
  v_role = 'LIDER' and p.leader_id = v_user_id
  or v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id)
)
```
Son correctos por precedencia de `AND > OR`, pero frágiles.

**Fix:** Agregar paréntesis explícitos en cada ocurrencia:
```sql
and (
  (v_role = 'LIDER' and p.leader_id = v_user_id)
  or (v_role = 'ADMIN' and (p_leader_id is null or p.leader_id = p_leader_id))
)
```

## MED-16: `get_team_trends` no filtra `is_deleted`

**Archivo:** `supabase/functions.sql:479-537`

**Problema:** Los joins con `contact_attempts` no excluyen leads borrados vía `is_deleted=true`. Infla métricas de tendencias.

**Fix:** Agregar `and l.is_deleted = false` en los joins. La IA ejecutora debe revisar si esta función está en uso (grep en client) antes de tocarla; si no se usa, marcarla como deprecated.

## MED-17: Timezone bug en ImportPage

**Archivo:** `client/src/pages/ImportPage.tsx:61-79`

**Problema:** `new Date(s).toISOString().split('T')[0]` desplaza fechas según la TZ del navegador. En AR/CL (UTC-3) puede restar un día.

**Fix:** Reemplazar la lógica de parseo de fecha por una que construya fechas en UTC explícitamente, o usar `date-fns/parseISO` que ya está en deps. Ejemplo:

```ts
import { parseISO, format } from 'date-fns'

function parseSheetDate(raw: unknown): string | undefined {
  if (!raw) return undefined
  const s = String(raw).trim()
  if (!s) return undefined

  // Excel serial
  const n = Number(s)
  if (!isNaN(n) && n > 1000) {
    const d = XLSX.SSF.parse_date_code(n)
    if (d) {
      // Construir fecha en UTC, no local
      const utc = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0))
      return format(utc, 'yyyy-MM-dd')
    }
  }

  // ISO string
  try {
    const parsed = parseISO(s)
    if (!isNaN(parsed.getTime())) return format(parsed, 'yyyy-MM-dd')
  } catch { /* ignore */ }

  return undefined
}
```

La IA ejecutora debe leer el archivo actual primero porque el código exacto puede diferir.

## MED-18: Bundle principal de 486KB

**Problema:** El chunk `index-PZVHtQOK.js` mide 486KB (no comprimido). El grueso viene de `@supabase/supabase-js`, `@tanstack/react-query`, `react-router-dom`, `@dnd-kit/core` (que sólo usa Kanban), y otros.

**Fix:**
1. Mover `@dnd-kit/core` a dynamic import dentro de `KanbanPage`:

```ts
// Al inicio de KanbanPage.tsx, reemplazar imports estáticos de @dnd-kit por:
import { lazy, Suspense } from 'react'
const KanbanBoard = lazy(() => import('./KanbanBoard'))
```

Y mover la lógica de dnd-kit a un nuevo archivo `KanbanBoard.tsx`. Esto saca ~30KB del main chunk.

2. Verificar que `date-fns` se importe por submódulo (`import { format } from 'date-fns/format'`) y no todo.

3. Considerar splitting de `@supabase/supabase-js` — aunque es core y no es fácil de lazy-loadear.

## MED-19: Dependencias muertas en package.json

**Archivo:** `client/package.json`

**Problema:** Las siguientes deps están instaladas pero **nunca se importan** en `client/src`:
- `recharts` (verificado con grep)
- `framer-motion`
- `html2canvas`
- `jspdf`

Ocupan ~50MB en `node_modules`, inflan `package-lock.json` y el tiempo de install en Vercel.

**Fix:** La IA ejecutora debe correr:

```bash
cd client
npm uninstall recharts framer-motion html2canvas jspdf
```

Y verificar que el build sigue pasando con `npm run build`.

## MED-20: `alerts` sin policies de INSERT/UPDATE amplias

**Archivo:** `supabase/rls.sql:157-165`

**Problema:** Sólo hay policies SELECT y UPDATE para `user_id = auth.uid()`. No hay INSERT. Si el app genera alertas desde el cliente, fallará silenciosamente. Si lo hace via trigger `SECURITY DEFINER`, OK. La IA ejecutora debe verificar que exista tal trigger; si no, agregar una policy de INSERT.

**Fix condicional:** primero grepear `from('alerts').insert` en `client/src`. Si existe, agregar:

```sql
create policy "alerts_insert_system"
  on alerts for insert
  with check (true);  -- o más restrictivo según el caso
```

Si no existe, dejar así y asumir que es via trigger/RPC.

---

# 🟢 BAJOS

## BAJO-21: Headers de seguridad en `vercel.json`

**Archivo:** `client/vercel.json`

**Fix:** Reemplazar contenido por:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains; preload" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

## BAJO-22: `KanbanPage.tsx:345` silently drops leads

**Fix:** Agregar un `console.warn` cuando se encuentre un stage no esperado.

## BAJO-23: `React.memo` ausente en filas de ranking

**Archivos:** `client/src/pages/RankingPage.tsx`

**Fix:** Wrappear `RankingRow` y `PodiumCard` en `React.memo`.

## BAJO-24: `clearFilters` sin `useCallback` en LeadsPage

**Archivo:** `client/src/pages/LeadsPage.tsx:481-489`

**Fix:** Envolver en `useCallback(() => { ... }, [])`.

## BAJO-25: `ALL_STAGES` re-creado cada render

**Archivo:** `client/src/pages/LeadsPage.tsx:17-21`

**Fix:** Mover al scope de módulo (fuera del componente).

## BAJO-26: `.env.example` menciona service_role

**Archivo:** `client/.env.example`

**Fix:** Borrar la línea `VITE_SUPABASE_SERVICE_ROLE_KEY` del ejemplo. Agregar comentario:

```
# VITE_* vars are bundled in the client. NEVER put service_role or other secrets here.
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## BAJO-27: `contact_attempts` / `stage_history` sin DELETE policy

**Archivo:** `supabase/rls.sql`

**Fix:** Agregar policies explícitas (aunque sea `using (false)`) para que los errores sean claros en caso de intento de borrado.

## BAJO-28: Falta tipo para `supabase.auth` event

**Archivo:** `client/src/context/AuthContext.tsx:74`

**Nota:** Uso de `_event` sugiere ignoracion; con el fix de MED-13 se usa `event` explícitamente.

## BAJO-29: Logs / console.log en producción

La IA ejecutora debe hacer `grep -n "console\.log" client/src -r` y decidir cuáles dejar (errores críticos) y cuáles quitar (debug leftover).

---

# ✅ Checklist de ejecución

La IA ejecutora debe seguir este orden estricto:

## Fase 1: SECURE THE DOOR (no mergear sin esto)

- [ ] CRIT-1 paso 1-3: Eliminar `supabaseAdmin` del cliente y reemplazar con RPCs
- [ ] CRIT-1 paso 4: Mover scripts `.mjs` a `scripts/` gitignoreada, usar env vars
- [ ] CRIT-1 paso 5: Avisar al humano que debe rotar keys y limpiar historia git
- [ ] CRIT-2: Crear `supabase/fix_privilege_escalation.sql` y pedir al humano que lo corra
- [ ] CRIT-3: Crear `supabase/fix_rls_lider_policy.sql` y pedir al humano que lo corra
- [ ] CRIT-4: Sanitizar input en `.or()` de `api.ts`
- [ ] ALTO-5: Actualizar `.gitignore`
- [ ] Probar `npm run build` en `client/` → debe compilar sin errores

## Fase 2: CORRECTNESS

- [ ] ALTO-6: `assignLeads` con `Promise.allSettled`
- [ ] ALTO-8: Unificar `queryKey` en Kanban
- [ ] ALTO-9: Ya cubierto por CRIT-3
- [ ] ALTO-10: Marcar `functions.sql` como deprecated
- [ ] MED-13: Fix double fetch AuthContext
- [ ] MED-16: Filter `is_deleted` en `get_team_trends` (si se usa)
- [ ] MED-17: Timezone fix en ImportPage
- [ ] MED-20: Verificar alerts policies

## Fase 3: PERFORMANCE

- [ ] ALTO-7: RPC `get_kanban_leads` + cambiar KanbanPage
- [ ] ALTO-11: Refactor `get_team_summary` a agregación única (crear `optimize_team_summary.sql`)
- [ ] ALTO-12: Crear `add_missing_indexes.sql`
- [ ] MED-18: Lazy load dnd-kit en Kanban
- [ ] MED-19: `npm uninstall` deps muertas

## Fase 4: HARDENING + POLISH

- [ ] MED-14: `search_path` en todas las funciones `SECURITY DEFINER`
- [ ] MED-15: Paréntesis en role checks SQL
- [ ] BAJO-21: Headers en `vercel.json`
- [ ] BAJO-22: Warn en stages desconocidos
- [ ] BAJO-23: `React.memo` en ranking
- [ ] BAJO-24: `useCallback` en clearFilters
- [ ] BAJO-25: Mover `ALL_STAGES` a módulo
- [ ] BAJO-26: Limpiar `.env.example`
- [ ] BAJO-27: DELETE policies explícitas
- [ ] BAJO-29: Limpiar `console.log`

## Fase 5: POST-DEPLOYMENT (tareas del humano)

- [ ] Rotar service_role key en Supabase Dashboard
- [ ] Rotar anon key
- [ ] Actualizar env vars en Vercel
- [ ] Redeploy
- [ ] `git filter-repo` para purgar los `.mjs` con secretos de la historia
- [ ] Force push con respaldo previo
- [ ] Revisar Supabase logs por actividad anómala con la clave comprometida
- [ ] Considerar hacer el repo privado mientras dura la remediación

---

# 📎 Referencias / archivos clave

**Frontend:**
- `client/src/lib/supabase.ts` — cliente Supabase (tiene `supabaseAdmin` filtrado)
- `client/src/context/AuthContext.tsx` — auth state + load profile
- `client/src/services/api.ts` — todas las queries (789 líneas)
- `client/src/pages/KanbanPage.tsx` — hotspot de perf
- `client/src/pages/ImportPage.tsx` — hotspot de bundle size (xlsx)
- `client/src/pages/LeadsPage.tsx` — búsqueda vulnerable a filter injection

**Supabase:**
- `supabase/schema.sql` — definición de tablas, enums, índices
- `supabase/rls.sql` — policies (⚠️ tiene 2 CRÍTICOS)
- `supabase/functions.sql` — funciones viejas (⚠️ DEPRECATED post-v5)
- `supabase/gestion_functions.sql` — funciones v3
- `supabase/migrations_v5.sql` — versión actual de funciones de gestión

**Configuración:**
- `client/.env` — tiene la key filtrada
- `client/.env.example` — ejemplo con placeholders
- `client/vercel.json` — mínimo, sin headers de seguridad
- `client/vite.config.ts` — config de Vite
- `.gitignore` — falta `*.csv`, `scripts/`, `profiles_source.json`

---

**Fin del documento.** Cualquier IA o dev que reciba este archivo tiene contexto completo para ejecutar los fixes en el orden correcto. Si algo no queda claro, leer primero los archivos referenciados (no asumir estructura).
