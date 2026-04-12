-- ════════════════════════════════════════════════════════════
-- Fix BAJO-27: políticas DELETE explícitas (deny) para tablas de audit
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- contact_attempts: nadie puede borrar desde el cliente
drop policy if exists "contact_attempts_no_delete" on contact_attempts;
create policy "contact_attempts_no_delete"
  on contact_attempts for delete
  using (false);

-- stage_history: nadie puede borrar desde el cliente
drop policy if exists "stage_history_no_delete" on stage_history;
create policy "stage_history_no_delete"
  on stage_history for delete
  using (false);
