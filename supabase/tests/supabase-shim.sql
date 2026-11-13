-- =============================================================================
-- TESTS UNIQUEMENT — ne jamais exécuter sur une vraie base Supabase.
--
-- Reproduit, sur un PostgreSQL nu, le strict nécessaire de l'environnement
-- Supabase pour pouvoir tester les migrations et la RLS sans Docker :
--   * les rôles anon / authenticated / service_role ;
--   * le schéma auth, la table auth.users et la fonction auth.uid() ;
--   * les droits par défaut de Supabase, qui donnent TOUT à anon et
--     authenticated sur chaque nouvelle table de "public". C'est volontaire :
--     les tests prouvent ainsi que nos migrations retirent bien ces droits.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

drop schema if exists public cascade;
drop schema if exists private cascade;
drop schema if exists auth cascade;

create schema public;
create schema auth;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
