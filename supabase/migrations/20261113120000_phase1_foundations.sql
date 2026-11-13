-- =============================================================================
-- CashPilot AI — Phase 1 : fondations
-- Organisations, profils, membres, rôles, journal d'audit, RLS.
--
-- Principes :
--   * Chaque table métier porte organization_id NOT NULL.
--   * La RLS est activée ET forcée sur toutes les tables.
--   * Les utilisateurs n'ont AUCUN droit d'écriture direct sur ces tables :
--     toute écriture passe par une fonction ci-dessous, qui vérifie les
--     permissions, applique les règles et écrit le journal d'audit dans la
--     même transaction.
--   * Le rôle anonyme (visiteur non connecté) n'a accès à rien.
-- =============================================================================

-- Schéma privé : non exposé par l'API Supabase (seul "public" l'est).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'finance', 'collaborator', 'viewer');
create type public.member_status as enum ('invited', 'active', 'disabled');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  country          text not null check (country ~ '^[A-Z]{2}$'),
  timezone         text not null,
  default_currency text not null check (default_currency ~ '^[A-Z]{3}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null
);

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- NULL tant que l'invitation n'est pas acceptée.
  user_id         uuid references auth.users (id) on delete cascade,
  invited_email   text not null check (
    invited_email = lower(btrim(invited_email))
    and invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and char_length(invited_email) <= 254
  ),
  role            public.org_role not null,
  status          public.member_status not null default 'invited',
  invited_by      uuid references auth.users (id) on delete set null,
  invited_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Cible des clés étrangères composites des futures tables métier.
  unique (organization_id, id),
  unique (organization_id, invited_email),
  -- Une invitation n'a pas encore d'utilisateur ; un membre en a toujours un.
  constraint member_user_matches_status check ((status = 'invited') = (user_id is null))
);

create unique index organization_members_org_user_key
  on public.organization_members (organization_id, user_id)
  where user_id is not null;
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_invited_email_idx
  on public.organization_members (invited_email)
  where status = 'invited';

-- Journal d'audit : ajout seul.
-- actor_id et entity_id n'ont volontairement pas de clé étrangère : le journal
-- doit survivre à la suppression d'un compte sans être modifié.
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_id        uuid,
  action          text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type     text not null,
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Déclencheurs techniques
-- -----------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function private.set_updated_at();

-- Le journal d'audit ne peut être ni modifié, ni supprimé, ni vidé —
-- y compris par la clé d'administration.
create function private.audit_logs_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update_delete before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- Création automatique du profil à l'inscription, et suivi de l'email.
create function private.handle_auth_user_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, display_name)
    values (
      new.id,
      lower(coalesce(new.email, '')),
      left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80)
    )
    on conflict (id) do nothing;
  elsif new.email is distinct from old.email then
    update public.profiles set email = lower(coalesce(new.email, '')) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_auth_user_change();
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row execute function private.handle_auth_user_change();

-- Une organisation garde toujours au moins un Owner actif.
-- Vérifié en fin de transaction, quel que soit le chemin (y compris la clé
-- d'administration ou la suppression d'un compte utilisateur).
create function private.ensure_active_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations o where o.id = old.organization_id)
     and not exists (
       select 1 from public.organization_members m
       where m.organization_id = old.organization_id
         and m.role = 'owner'
         and m.status = 'active'
     )
  then
    raise exception 'organization must keep at least one active owner'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger organization_members_keep_owner
  after update or delete on public.organization_members
  deferrable initially deferred
  for each row execute function private.ensure_active_owner();

-- -----------------------------------------------------------------------------
-- Fonctions d'appui pour la RLS
-- "security definer" : elles lisent organization_members sans déclencher la RLS
-- de cette même table (ce qui provoquerait une boucle).
-- -----------------------------------------------------------------------------
create function private.is_org_member(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create function private.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create function private.shares_org_with(p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user
  );
$$;

-- Email vérifié de l'utilisateur courant (NULL si non connecté ou non vérifié).
create function private.current_verified_email() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;
$$;

create function private.write_audit(
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function private.shares_org_with(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.organizations        force  row level security;
alter table public.profiles             enable row level security;
alter table public.profiles             force  row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force  row level security;
alter table public.audit_logs           enable row level security;
alter table public.audit_logs           force  row level security;

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Droits : lecture seule pour les utilisateurs connectés, rien pour les anonymes.
revoke all on public.organizations, public.profiles, public.organization_members, public.audit_logs
  from public, anon, authenticated;

grant select on public.organizations, public.profiles, public.organization_members, public.audit_logs
  to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, insert, update, delete
  on public.organizations, public.profiles, public.organization_members
  to service_role;
grant select, insert on public.audit_logs to service_role;

-- -----------------------------------------------------------------------------
-- Fonctions métier (seul chemin d'écriture pour les utilisateurs)
--
-- Codes d'erreur renvoyés, traduits par l'application :
--   28000 non authentifié · 42501 interdit · P0002 introuvable
--   23505 conflit         · 22023 donnée invalide
-- -----------------------------------------------------------------------------

create function public.create_organization(
  p_name text,
  p_slug text,
  p_country text,
  p_timezone text,
  p_currency text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text := private.current_verified_email();
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_email is null then
    raise exception 'email not verified' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, country, timezone, default_currency, created_by)
  values (btrim(p_name), p_slug, p_country, p_timezone, p_currency, v_uid)
  returning id into v_org;

  insert into public.organization_members
    (organization_id, user_id, invited_email, role, status, invited_by, accepted_at)
  values (v_org, v_uid, v_email, 'owner', 'active', v_uid, now());

  perform private.write_audit(v_org, 'organization.created', 'organization', v_org,
    jsonb_build_object('slug', p_slug));
  return v_org;
end;
$$;

create function public.invite_member(
  p_org uuid,
  p_email text,
  p_role public.org_role
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_member public.organization_members%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.has_org_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Seul un Owner peut nommer un autre Owner.
  if p_role = 'owner' and not private.has_org_role(p_org, array['owner']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_member
  from public.organization_members m
  where m.organization_id = p_org and m.invited_email = v_email
  for update;

  if found then
    if v_member.status <> 'invited' then
      raise exception 'already a member' using errcode = '23505';
    end if;
    -- Réinviter la même adresse est sans effet de bord : on met à jour le rôle.
    if v_member.role is distinct from p_role then
      update public.organization_members set role = p_role where id = v_member.id;
      perform private.write_audit(p_org, 'member.invitation_updated', 'organization_member', v_member.id,
        jsonb_build_object('old_role', v_member.role, 'new_role', p_role));
    end if;
    return v_member.id;
  end if;

  insert into public.organization_members (organization_id, invited_email, role, status, invited_by)
  values (p_org, v_email, p_role, 'invited', v_uid)
  returning * into v_member;

  perform private.write_audit(p_org, 'member.invited', 'organization_member', v_member.id,
    jsonb_build_object('role', p_role));
  return v_member.id;
end;
$$;

-- Invitations en attente pour l'utilisateur connecté. Le lien se fait sur son
-- adresse email VÉRIFIÉE : aucune invitation ne peut être acceptée par quelqu'un
-- qui ne contrôle pas la boîte mail invitée.
create function public.my_pending_invitations()
returns table (
  member_id uuid,
  organization_id uuid,
  organization_name text,
  role public.org_role,
  invited_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, o.id, o.name, m.role, m.invited_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.status = 'invited'
    and m.invited_email = private.current_verified_email()
  order by m.invited_at desc;
$$;

create function public.accept_invitation(p_member_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_email  text := private.current_verified_email();
  v_member public.organization_members%rowtype;
  v_slug   text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_member
  from public.organization_members m
  where m.id = p_member_id
  for update;

  -- Même réponse que l'invitation n'existe pas ou ne soit pas pour cet email :
  -- on ne révèle pas son existence.
  if not found or v_email is null or v_member.status <> 'invited' or v_member.invited_email <> v_email then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  update public.organization_members
  set user_id = v_uid, status = 'active', accepted_at = now()
  where id = v_member.id;

  perform private.write_audit(v_member.organization_id, 'member.invitation_accepted',
    'organization_member', v_member.id, jsonb_build_object('role', v_member.role));

  select o.slug into v_slug from public.organizations o where o.id = v_member.organization_id;
  return v_slug;
end;
$$;

-- Règles communes à toute action d'un membre sur un autre membre.
create function private.assert_can_manage_member(p_target public.organization_members)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.has_org_role(p_target.organization_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Personne ne modifie sa propre ligne : pas d'auto-promotion, pas de verrouillage accidentel.
  if p_target.user_id = v_uid then
    raise exception 'cannot modify own membership' using errcode = '42501';
  end if;
  -- Un Admin ne peut pas agir sur un Owner.
  if p_target.role = 'owner'
     and not private.has_org_role(p_target.organization_id, array['owner']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_can_manage_member(public.organization_members) from public;

create function public.change_member_role(p_member_id uuid, p_role public.org_role) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
begin
  select * into v_member from public.organization_members m where m.id = p_member_id for update;
  if not found or not private.is_org_member(v_member.organization_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_member(v_member);
  if p_role = 'owner'
     and not private.has_org_role(v_member.organization_id, array['owner']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_member.role = p_role then
    return;
  end if;

  update public.organization_members set role = p_role where id = v_member.id;
  perform private.write_audit(v_member.organization_id, 'member.role_changed',
    'organization_member', v_member.id,
    jsonb_build_object('old_role', v_member.role, 'new_role', p_role));
end;
$$;

create function public.set_member_disabled(p_member_id uuid, p_disabled boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
  v_target public.member_status := case when p_disabled then 'disabled' else 'active' end;
begin
  select * into v_member from public.organization_members m where m.id = p_member_id for update;
  if not found or not private.is_org_member(v_member.organization_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_member(v_member);
  if v_member.status = 'invited' then
    raise exception 'invitation cannot be disabled, revoke it instead' using errcode = '22023';
  end if;
  if v_member.status = v_target then
    return;
  end if;

  update public.organization_members set status = v_target where id = v_member.id;
  perform private.write_audit(v_member.organization_id,
    case when p_disabled then 'member.disabled' else 'member.reactivated' end,
    'organization_member', v_member.id, '{}'::jsonb);
end;
$$;

create function public.revoke_invitation(p_member_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
begin
  select * into v_member from public.organization_members m where m.id = p_member_id for update;
  if not found or not private.is_org_member(v_member.organization_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_member(v_member);
  if v_member.status <> 'invited' then
    raise exception 'not a pending invitation' using errcode = '22023';
  end if;

  delete from public.organization_members where id = v_member.id;
  perform private.write_audit(v_member.organization_id, 'member.invitation_revoked',
    'organization_member', v_member.id, jsonb_build_object('role', v_member.role));
end;
$$;

-- Seuls les utilisateurs connectés peuvent appeler ces fonctions.
revoke all on function
  public.create_organization(text, text, text, text, text),
  public.invite_member(uuid, text, public.org_role),
  public.my_pending_invitations(),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, public.org_role),
  public.set_member_disabled(uuid, boolean),
  public.revoke_invitation(uuid)
from public, anon;

grant execute on function
  public.create_organization(text, text, text, text, text),
  public.invite_member(uuid, text, public.org_role),
  public.my_pending_invitations(),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, public.org_role),
  public.set_member_disabled(uuid, boolean),
  public.revoke_invitation(uuid)
to authenticated;
