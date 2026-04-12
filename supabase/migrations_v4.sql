-- migrations_v4.sql
-- Reemplaza etapas BLOQUEADO_* por una sola etapa DESCARTADO con motivo_descarte
-- Ejecutar en Supabase SQL Editor

-- 1. Nueva columna motivo_descarte
alter table public.leads
  add column if not exists motivo_descarte text;

-- 2. Nueva etapa DESCARTADO en el enum
alter type funnel_stage add value if not exists 'DESCARTADO';

-- 3. Migrar leads existentes con etapas BLOQUEADO_* a DESCARTADO
update public.leads
set
  motivo_descarte = case current_stage::text
    when 'BLOQUEADO_NO_INTERESA'         then 'No le interesa'
    when 'BLOQUEADO_IMPOSIBLE_CONTACTO'  then 'Imposible contacto'
    when 'BLOQUEADO_FUERA_COBERTURA'     then 'Fuera de cobertura'
    when 'BLOQUEADO_NO_RESTAURANTE'      then 'No es restaurante'
    when 'BLOQUEADO_RESTAURANTE_CERRADO' then 'Restaurante cerrado'
    when 'BLOQUEADO_YA_EN_RAPPI'         then 'Ya trabaja con Rappi'
  end,
  bloqueado     = true,
  current_stage = 'DESCARTADO'
where current_stage::text like 'BLOQUEADO_%';
