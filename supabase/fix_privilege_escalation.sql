-- ════════════════════════════════════════════════════════════
-- Fix CRIT-2: previene que un HUNTER se promueva a ADMIN
-- Correr en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

create or replace function prevent_self_privilege_escalation()
returns trigger as $$
begin
  if auth.uid() = new.id and (
       new.role         is distinct from old.role
    or new.is_active    is distinct from old.is_active
    or new.leader_id    is distinct from old.leader_id
    or new.country      is distinct from old.country
    or new.daily_target is distinct from old.daily_target
  ) then
    -- Admins pueden editar su propio perfil sin restricción
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
