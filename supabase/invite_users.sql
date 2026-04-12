-- invite_users.sql
-- 1. Tabla de invitaciones (sin FK a auth.users)
-- 2. Trigger que crea el perfil automáticamente al primer login con Google
-- 3. INSERT de todos los usuarios INBOUND
--
-- Pega y ejecuta TODO esto en el SQL Editor de Supabase.

-- ─── 1. Tabla de invitaciones ──────────────────────────────────────────────────

create table if not exists public.profile_invites (
  email        text primary key,
  full_name    text    not null,
  role         text    not null,
  country      text    not null,
  daily_target integer not null default 4,
  leader_email text,
  is_active    boolean not null default true
);

-- ─── 2. Función del trigger ────────────────────────────────────────────────────

create or replace function public.handle_new_user_from_invite()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite  public.profile_invites%rowtype;
  v_leader_id uuid;
begin
  -- ¿Hay invitación para este email?
  select * into v_invite
  from public.profile_invites
  where email = new.email;

  if not found then
    return new;
  end if;

  -- Si ya tiene perfil (re-insert por alguna razón), no hacer nada
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  -- Resolver leader_id si tiene supervisor asignado y ese supervisor ya hizo login
  if v_invite.leader_email is not null then
    select id into v_leader_id
    from public.profiles
    where email = v_invite.leader_email
    limit 1;
  end if;

  -- Crear perfil
  insert into public.profiles (id, email, full_name, role, country, daily_target, leader_id, is_active)
  values (
    new.id,
    new.email,
    v_invite.full_name,
    v_invite.role,
    v_invite.country,
    v_invite.daily_target,
    v_leader_id,
    v_invite.is_active
  )
  on conflict (id) do nothing;

  -- Si es supervisor: actualizar comerciales que ya hicieron login antes y quedaron sin leader_id
  if v_invite.role = 'LIDER' then
    update public.profiles p
    set leader_id = new.id
    where p.leader_id is null
      and exists (
        select 1 from public.profile_invites pi
        where pi.email = p.email
          and pi.leader_email = new.email
      );
  end if;

  return new;
end;
$$;

-- ─── 3. Trigger en auth.users ──────────────────────────────────────────────────

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_from_invite();

-- ─── 4. INSERT de todos los usuarios INBOUND ──────────────────────────────────
-- Ejecutar TRUNCATE solo si es primera vez (borra y re-inserta invites)

truncate public.profile_invites;

insert into public.profile_invites (email, full_name, role, country, leader_email) values

-- ── Admins ────────────────────────────────────────────────────────────────────
('danilo.ortega@rappi.com',    'Danilo Ortega',    'ADMIN', 'CO', null),
('jimena.velasquez@rappi.com', 'Jimena Velasquez', 'ADMIN', 'CO', null),
('juan.olivares@rappi.com',    'Juan Olivares',    'ADMIN', 'CL', null),

-- ── Supervisores ──────────────────────────────────────────────────────────────
('alejandro.castillo@rappi.com', 'Alejandro Castillo', 'LIDER', 'MX', null),
('camila.ruiz@rappi.com',        'Camila Ruiz',        'LIDER', 'AR', null),
('estefany.ariza@rappi.com',     'Estefany Ariza',     'LIDER', 'MX', null),
('marcela.reyes@rappi.com',      'Marcela Reyes',      'LIDER', 'CO', null),
('maria.marmolejo@rappi.com',    'Maria Marmolejo',    'LIDER', 'MX', null),
('nicolas.loaiza@rappi.com',     'Nicolas Loaiza',     'LIDER', 'CO', null),
('oscar.barajas@rappi.com',      'Oscar Barajas',      'LIDER', 'PE', null),
('oscar.caucali@rappi.com',      'Oscar Caucali',      'LIDER', 'MX', null),
('sebastian.ibanez@rappi.com',   'Sebastian Ibanez',   'LIDER', 'MX', null),

-- ── Comerciales — alejandro.castillo (MX) ─────────────────────────────────────
('diana.soto@rappi.com',          'Diana Soto',          'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('jhon.moncada@rappi.com',        'Jhon Moncada',        'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('edwin.celis@rappi.com',         'Edwin Celis',         'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('laura.castellanos@rappi.com',   'Laura Castellanos',   'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('edgar.caro@rappi.com',          'Edgar Caro',          'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('n.romero@rappi.com',            'N Romero',            'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('kelin.camacho@rappi.com',       'Kelin Camacho',       'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('geraldine.laverde@rappi.com',   'Geraldine Laverde',   'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('laura.bolivar@rappi.com',       'Laura Bolivar',       'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('valeria.ramos@rappi.com',       'Valeria Ramos',       'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('gonzalo.carrillo@rappi.com',    'Gonzalo Carrillo',    'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('sebastian.osma@rappi.com',      'Sebastian Osma',      'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('mileth.baron@rappi.com',        'Mileth Baron',        'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('christian.cardenas@rappi.com',  'Christian Cardenas',  'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('juliana.castellanos@rappi.com', 'Juliana Castellanos', 'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('ana.pino@rappi.com',            'Ana Pino',            'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),
('sol.castaneda@rappi.com',       'Sol Castaneda',       'HUNTER', 'MX', 'alejandro.castillo@rappi.com'),

-- ── Comerciales — camila.ruiz (AR + CL) ───────────────────────────────────────
('karen.oviedo@rappi.com',    'Karen Oviedo',    'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('german.godoy@rappi.com',    'German Godoy',    'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('jonathan.chacon@rappi.com', 'Jonathan Chacon', 'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('martin.payares@rappi.com',  'Martin Payares',  'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('gira.perez@rappi.com',      'Gira Perez',      'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('jhonatan.pinzon@rappi.com', 'Jhonatan Pinzon', 'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('andres.florez@rappi.com',   'Andres Florez',   'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('brayan.moreno@rappi.com',   'Brayan Moreno',   'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('maria.ariza@rappi.com',     'Maria Ariza',     'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('michael.caucali@rappi.com', 'Michael Caucali', 'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('danna.ramirez@rappi.com',   'Danna Ramirez',   'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('brayan.caicedo@rappi.com',  'Brayan Caicedo',  'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('eilin.oliveros@rappi.com',  'Eilin Oliveros',  'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('andrea.gaona@rappi.com',    'Andrea Gaona',    'HUNTER', 'CL', 'camila.ruiz@rappi.com'),
('laura.barrios@rappi.com',   'Laura Barrios',   'HUNTER', 'CL', 'camila.ruiz@rappi.com'),
('brayan.pena@rappi.com',     'Brayan Pena',     'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('maria.miquilena@rappi.com', 'Maria Miquilena', 'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('angel.vicioso@rappi.com',   'Angel Vicioso',   'HUNTER', 'CL', 'camila.ruiz@rappi.com'),
('susana.boada@rappi.com',    'Susana Boada',    'HUNTER', 'AR', 'camila.ruiz@rappi.com'),
('angie.ariza@rappi.com',     'Angie Ariza',     'HUNTER', 'CL', 'camila.ruiz@rappi.com'),
('astrid.pena@rappi.com',     'Astrid Pena',     'HUNTER', 'CL', 'camila.ruiz@rappi.com'),

-- ── Comerciales — estefany.ariza (MX) ─────────────────────────────────────────
('ivette.alvarez@rappi.com',     'Ivette Alvarez',     'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('eibi.meneses@rappi.com',       'Eibi Meneses',       'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('silvia.coca@rappi.com',        'Silvia Coca',        'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('andres.rincon@rappi.com',      'Andres Rincon',      'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('laura.garces@rappi.com',       'Laura Garces',       'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('dayana.agudelo@rappi.com',     'Dayana Agudelo',     'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('laura.aldana@rappi.com',       'Laura Aldana',       'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('juan.casilimas@rappi.com',     'Juan Casilimas',     'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('luisa.mendieta@rappi.com',     'Luisa Mendieta',     'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('edgar.reyes@rappi.com',        'Edgar Reyes',        'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('simon.cuervo@rappi.com',       'Simon Cuervo',       'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('kevin.castano@rappi.com',      'Kevin Castano',      'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('melanny.vidal@rappi.com',      'Melanny Vidal',      'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('sebastian.sanabria@rappi.com', 'Sebastian Sanabria', 'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('simonne.chumbe@rappi.com',     'Simonne Chumbe',     'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('nicole.cortes@rappi.com',      'Nicole Cortes',      'HUNTER', 'MX', 'estefany.ariza@rappi.com'),
('laura.roberto@rappi.com',      'Laura Roberto',      'HUNTER', 'MX', 'estefany.ariza@rappi.com'),

-- ── Comerciales — marcela.reyes (CO) ──────────────────────────────────────────
('ana.nieto@rappi.com',         'Ana Nieto',         'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('bairon.salgado@rappi.com',    'Bairon Salgado',    'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('daniel.manzanillo@rappi.com', 'Daniel Manzanillo', 'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('holman.bermudez@rappi.com',   'Holman Bermudez',   'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('enrique.rosa@rappi.com',      'Enrique Rosa',      'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('cristian.calderon@rappi.com', 'Cristian Calderon', 'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('pablo.moreno@rappi.com',      'Pablo Moreno',      'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('bryam.quitian@rappi.com',     'Bryam Quitian',     'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('carolina.neira@rappi.com',    'Carolina Neira',    'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('yeymi.otalora@rappi.com',     'Yeymi Otalora',     'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('jessel.estrada@rappi.com',    'Jessel Estrada',    'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('juanita.sandoval@rappi.com',  'Juanita Sandoval',  'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('david.vergara@rappi.com',     'David Vergara',     'HUNTER', 'CO', 'marcela.reyes@rappi.com'),
('yeimy.otalora@rappi.com',     'Yeimy Otalora',     'HUNTER', 'CO', 'marcela.reyes@rappi.com'),

-- ── Comerciales — maria.marmolejo (MX) ────────────────────────────────────────
('diana.gomes@rappi.com',       'Diana Gomes',       'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('jeison.garcia@rappi.com',     'Jeison Garcia',     'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('danna.lopez@rappi.com',       'Danna Lopez',       'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('salome.hurtado@rappi.com',    'Salome Hurtado',    'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('abel.alcendra@rappi.com',     'Abel Alcendra',     'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('laura.casallas@rappi.com',    'Laura Casallas',    'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('cesar.martinez@rappi.com',    'Cesar Martinez',    'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('santiago.cubillos@rappi.com', 'Santiago Cubillos', 'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('jenny.solano@rappi.com',      'Jenny Solano',      'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('paula.bravo@rappi.com',       'Paula Bravo',       'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('karen.sarmiento@rappi.com',   'Karen Sarmiento',   'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('karen.bueno@rappi.com',       'Karen Bueno',       'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('maira.sanchez@rappi.com',     'Maira Sanchez',     'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('kelly.ortiz@rappi.com',       'Kelly Ortiz',       'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('alejandra.moreno@rappi.com',  'Alejandra Moreno',  'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('noren.gonzalez@rappi.com',    'Noren Gonzalez',    'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),
('tatiana.herrera@rappi.com',   'Tatiana Herrera',   'HUNTER', 'MX', 'maria.marmolejo@rappi.com'),

-- ── Comerciales — nicolas.loaiza (CO) ─────────────────────────────────────────
('angie.barriga@rappi.com',     'Angie Barriga',     'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('ginna.ararat@rappi.com',      'Ginna Ararat',      'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('tatiana.garcia@rappi.com',    'Tatiana Garcia',    'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('a.gomez@rappi.com',           'A Gomez',           'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('dina.parada@rappi.com',       'Dina Parada',       'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('edith.tibacan@rappi.com',     'Edith Tibacan',     'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('deisy.sierra@rappi.com',      'Deisy Sierra',      'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('angel.espitia@rappi.com',     'Angel Espitia',     'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('d.gutierrez@rappi.com',       'D Gutierrez',       'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('edwin.diaz@rappi.com',        'Edwin Diaz',        'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('laura.mancera@rappi.com',     'Laura Mancera',     'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('alejandro.ibanez@rappi.com',  'Alejandro Ibanez',  'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('angelica.casallas@rappi.com', 'Angelica Casallas', 'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('angel.herrera@rappi.com',     'Angel Herrera',     'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('mauricio.pinto@rappi.com',    'Mauricio Pinto',    'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),
('david.reina@rappi.com',       'David Reina',       'HUNTER', 'CO', 'nicolas.loaiza@rappi.com'),

-- ── Comerciales — oscar.barajas (PE + EC) ─────────────────────────────────────
('daniela.acosta@rappi.com',     'Daniela Acosta',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('juana.tinjaca@rappi.com',      'Juana Tinjaca',      'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('daniel.sisa@rappi.com',        'Daniel Sisa',        'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('ana.torres@rappi.com',         'Ana Torres',         'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('paula.restrepo@rappi.com',     'Paula Restrepo',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('alfredo.estarita@rappi.com',   'Alfredo Estarita',   'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('jonathan.baron@rappi.com',     'Jonathan Baron',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('cristian.quiroga@rappi.com',   'Cristian Quiroga',   'HUNTER', 'EC', 'oscar.barajas@rappi.com'),
('miguel.salamanca@rappi.com',   'Miguel Salamanca',   'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('leslie.baquero@rappi.com',     'Leslie Baquero',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('benjamin.padilla@rappi.com',   'Benjamin Padilla',   'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('jose.saiz@rappi.com',          'Jose Saiz',          'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('cristian.palacios@rappi.com',  'Cristian Palacios',  'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('ingrid.ospina@rappi.com',      'Ingrid Ospina',      'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('maria.reales@rappi.com',       'Maria Reales',       'HUNTER', 'EC', 'oscar.barajas@rappi.com'),
('jacqueline.herrera@rappi.com', 'Jacqueline Herrera', 'HUNTER', 'EC', 'oscar.barajas@rappi.com'),
('lina.gutierrez@rappi.com',     'Lina Gutierrez',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('jefrie.murcia@rappi.com',      'Jefrie Murcia',      'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('catalina.pachon@rappi.com',    'Catalina Pachon',    'HUNTER', 'EC', 'oscar.barajas@rappi.com'),
('rodrigo.polo@rappi.com',       'Rodrigo Polo',       'HUNTER', 'PE', 'oscar.barajas@rappi.com'),
('alberto.moreno@rappi.com',     'Alberto Moreno',     'HUNTER', 'PE', 'oscar.barajas@rappi.com'),

-- ── Comerciales — oscar.caucali (MX) ──────────────────────────────────────────
('jessica.uribe@rappi.com',     'Jessica Uribe',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('july.avila@rappi.com',        'July Avila',        'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('gabriela.velandia@rappi.com', 'Gabriela Velandia', 'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('leider.romero@rappi.com',     'Leider Romero',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('maria.cuadros@rappi.com',     'Maria Cuadros',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('hilian.robayo@rappi.com',     'Hilian Robayo',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('alejandra.g@rappi.com',       'Alejandra G',       'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('neider.parra@rappi.com',      'Neider Parra',      'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('laura.aguilar@rappi.com',     'Laura Aguilar',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('fabian.devia@rappi.com',      'Fabian Devia',      'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('silvia.cepeda@rappi.com',     'Silvia Cepeda',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('diana.basabe@rappi.com',      'Diana Basabe',      'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('paula.vasquez@rappi.com',     'Paula Vasquez',     'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('j.barrios@rappi.com',         'J Barrios',         'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('deicy.laiton@rappi.com',      'Deicy Laiton',      'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('alejandro.galindo@rappi.com', 'Alejandro Galindo', 'HUNTER', 'MX', 'oscar.caucali@rappi.com'),
('jaider.cabrera@rappi.com',    'Jaider Cabrera',    'HUNTER', 'MX', 'oscar.caucali@rappi.com'),

-- ── Comerciales — sebastian.ibanez (MX) ───────────────────────────────────────
('adriana.martinez@rappi.com',  'Adriana Martinez',  'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('harold.toro@rappi.com',       'Harold Toro',       'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('wbeimar.fonseca@rappi.com',   'Wbeimar Fonseca',   'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('leidy.vargas@rappi.com',      'Leidy Vargas',      'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('ernesto.garcia@rappi.com',    'Ernesto Garcia',    'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('yiseth.miranda@rappi.com',    'Yiseth Miranda',    'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('angie.benavidez@rappi.com',   'Angie Benavidez',   'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('paula.arias@rappi.com',       'Paula Arias',       'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('j.suarez@rappi.com',          'J Suarez',          'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('maytte.ruiz@rappi.com',       'Maytte Ruiz',       'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('laura.cubides@rappi.com',     'Laura Cubides',     'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('david.soler@rappi.com',       'David Soler',       'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('angie.cruz@rappi.com',        'Angie Cruz',        'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('sebastian.navarro@rappi.com', 'Sebastian Navarro', 'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('john.lozano@rappi.com',       'John Lozano',       'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('diego.escobar@rappi.com',     'Diego Escobar',     'HUNTER', 'MX', 'sebastian.ibanez@rappi.com'),
('tatiana.morales@rappi.com',   'Tatiana Morales',   'HUNTER', 'MX', 'sebastian.ibanez@rappi.com');
