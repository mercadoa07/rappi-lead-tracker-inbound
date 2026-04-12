-- ════════════════════════════════════════════════════════════
-- Fix CRIT-3 + ALTO-9: RLS leads — LIDER y HUNTER
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- Fix: leads_update_lider ahora exige rol LIDER explícitamente
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

-- Fix ALTO-9: HUNTER no puede reasignar sus leads a otros
drop policy if exists "leads_update_hunter" on leads;

create policy "leads_update_hunter"
  on leads for update
  using (assigned_to_id = auth.uid())
  with check (assigned_to_id = auth.uid());
