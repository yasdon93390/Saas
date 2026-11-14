-- =============================================================================
-- CashPilot AI — Phase 2 : données métier
-- Clients, factures, opérations de règlement, import CSV.
--
-- Rappels :
--   * Les montants sont des entiers en unités mineures (centimes). Jamais de
--     nombre à virgule flottante.
--   * Le montant réglé d'une facture n'est jamais saisi : il est recalculé par
--     la base à partir des opérations, dans la même transaction.
--   * Le statut d'une facture n'est jamais saisi : il est calculé à la lecture
--     à partir de faits (solde, échéance, annulation, suspension).
--   * Aucune écriture directe : tout passe par les fonctions ci-dessous.
-- =============================================================================

create type public.record_source as enum ('manual', 'csv');
create type public.customer_status as enum ('active', 'archived');
create type public.invoice_lifecycle as enum ('draft', 'open', 'cancelled');
create type public.invoice_status as enum
  ('draft', 'pending', 'overdue', 'partially_paid', 'paid', 'disputed', 'suspended', 'cancelled');
create type public.payment_kind as enum ('payment', 'credit_note', 'correction');
create type public.import_row_outcome as enum ('skipped', 'error');

-- Plafond de sécurité : 100 milliards d'unités majeures. Garantit que tout
-- montant tient sans perte dans un nombre JSON.
create function private.max_amount_minor() returns bigint
language sql immutable set search_path = '' as $$ select 10000000000000::bigint $$;

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  trade_name      text check (char_length(trade_name) <= 200),
  billing_email   text check (
    billing_email is null or (
      billing_email = lower(btrim(billing_email))
      and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and char_length(billing_email) <= 254
    )
  ),
  contact_name    text check (char_length(contact_name) <= 200),
  phone           text check (char_length(phone) <= 50),
  address         text check (char_length(address) <= 500),
  country         text check (country is null or country ~ '^[A-Z]{2}$'),
  language        text not null default 'fr' check (language in ('fr', 'en')),
  notes           text check (char_length(notes) <= 5000),
  source          public.record_source not null default 'manual',
  external_id     text check (external_id is null or char_length(btrim(external_id)) between 1 and 200),
  status          public.customer_status not null default 'active',
  reminders_suspended_at     timestamptz,
  reminders_suspended_reason text check (char_length(reminders_suspended_reason) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  constraint customer_suspension_has_reason check (
    (reminders_suspended_at is null) = (reminders_suspended_reason is null)
  )
);

create unique index customers_external_key
  on public.customers (organization_id, source, external_id) where external_id is not null;
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_org_email_idx on public.customers (organization_id, billing_email);

-- -----------------------------------------------------------------------------
-- Import CSV (déclaré avant les factures, qui y font référence)
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  file_name       text not null check (char_length(file_name) between 1 and 255),
  file_sha256     text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  settings        jsonb not null default '{}'::jsonb,
  total_rows      integer not null check (total_rows >= 0),
  imported_count  integer not null default 0 check (imported_count >= 0),
  skipped_count   integer not null default 0 check (skipped_count >= 0),
  error_count     integer not null default 0 check (error_count >= 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  unique (organization_id, id)
);

create index import_batches_org_created_idx on public.import_batches (organization_id, created_at desc);

-- Seules les lignes ignorées ou refusées sont conservées : c'est le rapport d'erreurs.
create table public.import_rows (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  batch_id        uuid not null,
  row_number      integer not null check (row_number >= 1),
  outcome         public.import_row_outcome not null,
  messages        text[] not null,
  raw             jsonb not null default '{}'::jsonb,
  foreign key (organization_id, batch_id) references public.import_batches (organization_id, id) on delete restrict
);

create index import_rows_batch_idx on public.import_rows (organization_id, batch_id, row_number);

-- -----------------------------------------------------------------------------
-- Factures
-- -----------------------------------------------------------------------------
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  customer_id     uuid not null,
  number          text not null check (char_length(btrim(number)) between 1 and 100 and number = btrim(number)),
  issue_date      date not null,
  due_date        date not null,
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor     bigint not null check (total_minor > 0 and total_minor <= private.max_amount_minor()),
  -- Maintenu exclusivement par le déclencheur sur les opérations.
  paid_minor      bigint not null default 0,
  recipient_email text check (
    recipient_email is null or (
      recipient_email = lower(btrim(recipient_email))
      and recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and char_length(recipient_email) <= 254
    )
  ),
  lifecycle       public.invoice_lifecycle not null default 'open',
  cancelled_at    timestamptz,
  cancel_reason   text check (char_length(cancel_reason) <= 500),
  suspended_at    timestamptz,
  suspended_reason text check (char_length(suspended_reason) <= 500),
  source          public.record_source not null default 'manual',
  external_id     text check (external_id is null or char_length(btrim(external_id)) between 1 and 200),
  import_batch_id uuid,
  idempotency_key uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  -- Clés composites : une facture ne peut pas pointer vers le client ou
  -- l'import d'une autre organisation, quel que soit le chemin d'écriture.
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, import_batch_id) references public.import_batches (organization_id, id) on delete restrict,
  constraint invoice_dates_ordered check (due_date >= issue_date),
  constraint invoice_paid_within_total check (paid_minor >= 0 and paid_minor <= total_minor),
  constraint invoice_cancellation_consistent check ((lifecycle = 'cancelled') = (cancelled_at is not null)),
  constraint invoice_cancellation_has_reason check ((cancelled_at is null) = (cancel_reason is null)),
  constraint invoice_suspension_has_reason check ((suspended_at is null) = (suspended_reason is null))
);

create unique index invoices_external_key
  on public.invoices (organization_id, source, external_id) where external_id is not null;
create index invoices_org_due_idx on public.invoices (organization_id, due_date);
create index invoices_org_customer_idx on public.invoices (organization_id, customer_id);
create index invoices_org_lifecycle_idx on public.invoices (organization_id, lifecycle);

-- -----------------------------------------------------------------------------
-- Opérations de règlement : paiements, avoirs, corrections. Ajout seul.
-- Une erreur se corrige par une opération inverse, jamais par une modification.
-- -----------------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id      uuid not null,
  kind            public.payment_kind not null,
  amount_minor    bigint not null check (abs(amount_minor) <= private.max_amount_minor()),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at         date not null,
  reference       text check (char_length(reference) <= 200),
  note            text check (char_length(note) <= 1000),
  source          public.record_source not null default 'manual',
  idempotency_key uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id) on delete restrict,
  -- Paiements et avoirs sont positifs ; seule une correction peut être négative.
  constraint payment_amount_sign check (
    (kind in ('payment', 'credit_note') and amount_minor > 0) or (kind = 'correction' and amount_minor <> 0)
  ),
  constraint correction_has_note check (kind <> 'correction' or char_length(btrim(coalesce(note, ''))) > 0)
);

create index payments_invoice_idx on public.payments (organization_id, invoice_id, created_at);

-- Chronologie d'une facture, lisible par tous les membres. Ajout seul.
create table public.invoice_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id      uuid not null,
  type            text not null check (type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  actor_id        uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id) on delete restrict
);

create index invoice_events_invoice_idx on public.invoice_events (organization_id, invoice_id, created_at);

-- -----------------------------------------------------------------------------
-- Déclencheurs
-- -----------------------------------------------------------------------------
create trigger customers_set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

create function private.append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger payments_append_only before update or delete on public.payments
  for each row execute function private.append_only();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function private.append_only();
create trigger invoice_events_append_only before update or delete on public.invoice_events
  for each row execute function private.append_only();
create trigger invoice_events_no_truncate before truncate on public.invoice_events
  for each statement execute function private.append_only();

-- Chaque opération doit être dans la devise de sa facture, puis le montant
-- réglé est recalculé à partir de TOUTES les opérations (jamais incrémenté).
-- La contrainte invoice_paid_within_total refuse alors tout trop-perçu.
create function private.apply_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_currency text;
begin
  select i.currency into v_currency
  from public.invoices i
  where i.organization_id = new.organization_id and i.id = new.invoice_id
  for update;

  if v_currency is distinct from new.currency then
    raise exception 'payment currency must match invoice currency' using errcode = '22023';
  end if;

  update public.invoices i
  set paid_minor = (
    select coalesce(sum(p.amount_minor), 0)
    from public.payments p
    where p.organization_id = new.organization_id and p.invoice_id = new.invoice_id
  )
  where i.organization_id = new.organization_id and i.id = new.invoice_id;
  return null;
end;
$$;

create trigger payments_apply after insert on public.payments
  for each row execute function private.apply_payment();

-- Dernière barrière : paid_minor ne peut changer que via le déclencheur ci-dessus.
create function private.protect_invoice_paid_minor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.paid_minor is distinct from old.paid_minor and pg_trigger_depth() < 2 then
    raise exception 'paid_minor is derived from payments' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoices_protect_paid_minor before update on public.invoices
  for each row execute function private.protect_invoice_paid_minor();

create function private.reject_initial_paid_minor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.paid_minor <> 0 then
    raise exception 'paid_minor is derived from payments' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoices_reject_initial_paid_minor before insert on public.invoices
  for each row execute function private.reject_initial_paid_minor();

-- -----------------------------------------------------------------------------
-- Statut calculé — une seule définition, utilisée partout.
-- Ordre de priorité : annulée → brouillon → payée → suspendue
--                     → partiellement payée → échue → à venir.
-- (« contestée » arrivera avec les litiges, en phase 5.)
-- -----------------------------------------------------------------------------
create function private.compute_invoice_status(
  p_lifecycle public.invoice_lifecycle,
  p_total_minor bigint,
  p_paid_minor bigint,
  p_suspended boolean,
  p_due_date date,
  p_today date
) returns public.invoice_status
language sql immutable set search_path = '' as $$
  select case
    when p_lifecycle = 'cancelled' then 'cancelled'
    when p_lifecycle = 'draft' then 'draft'
    when p_paid_minor >= p_total_minor then 'paid'
    when p_suspended then 'suspended'
    when p_paid_minor > 0 then 'partially_paid'
    when p_due_date < p_today then 'overdue'
    else 'pending'
  end::public.invoice_status;
$$;

-- « Aujourd'hui » est évalué dans le fuseau horaire de l'organisation.
-- security_invoker : la vue applique la RLS de l'utilisateur qui la lit.
create view public.invoice_overview with (security_invoker = true) as
select
  i.id,
  i.organization_id,
  i.customer_id,
  c.name as customer_name,
  i.number,
  i.issue_date,
  i.due_date,
  i.currency,
  i.total_minor,
  i.paid_minor,
  i.total_minor - i.paid_minor as remaining_minor,
  i.recipient_email,
  i.lifecycle,
  i.cancelled_at,
  i.cancel_reason,
  i.suspended_at,
  i.suspended_reason,
  i.source,
  i.external_id,
  i.import_batch_id,
  i.created_at,
  private.compute_invoice_status(
    i.lifecycle, i.total_minor, i.paid_minor, i.suspended_at is not null, i.due_date,
    (now() at time zone o.timezone)::date
  ) as status,
  (
    i.lifecycle = 'open'
    and i.paid_minor < i.total_minor
    and i.due_date < (now() at time zone o.timezone)::date
  ) as is_overdue
from public.invoices i
join public.customers c on c.organization_id = i.organization_id and c.id = i.customer_id
join public.organizations o on o.id = i.organization_id;

-- -----------------------------------------------------------------------------
-- RLS et droits
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'import_batches', 'import_rows', 'invoices', 'payments', 'invoice_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))',
      t || '_select', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

revoke all on public.invoice_overview from public, anon, authenticated;
grant select on public.invoice_overview to authenticated, service_role;

revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function private.shares_org_with(uuid) to authenticated, service_role;
grant execute on function private.max_amount_minor() to authenticated, service_role;
grant execute on function private.compute_invoice_status(
  public.invoice_lifecycle, bigint, bigint, boolean, date, date
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fonctions d'appui
-- -----------------------------------------------------------------------------

-- Vérifie connexion, appartenance et rôle. Un non-membre reçoit « introuvable » :
-- on ne révèle pas l'existence d'une donnée d'une autre organisation.
create function private.require_role(p_org uuid, p_roles public.org_role[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(p_org, p_roles) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create function private.operators() returns public.org_role[]
language sql immutable set search_path = '' as $$
  select array['owner', 'admin', 'finance']::public.org_role[];
$$;

create function private.record_invoice_event(
  p_org uuid, p_invoice uuid, p_type text, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invoice_events (organization_id, invoice_id, type, actor_id, metadata)
  values (p_org, p_invoice, p_type, (select auth.uid()), coalesce(p_metadata, '{}'::jsonb));
  perform private.write_audit(p_org, p_type, 'invoice', p_invoice, p_metadata);
end;
$$;

-- Texte vide ou blanc → NULL.
create function private.clean(p_value text) returns text
language sql immutable set search_path = '' as $$ select nullif(btrim(p_value), '') $$;

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
create function public.create_customer(p_org uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_org, private.operators());

  insert into public.customers (
    organization_id, name, trade_name, billing_email, contact_name, phone, address,
    country, language, notes, external_id, source, created_by
  ) values (
    p_org,
    btrim(p_data ->> 'name'),
    private.clean(p_data ->> 'trade_name'),
    lower(private.clean(p_data ->> 'billing_email')),
    private.clean(p_data ->> 'contact_name'),
    private.clean(p_data ->> 'phone'),
    private.clean(p_data ->> 'address'),
    upper(private.clean(p_data ->> 'country')),
    coalesce(private.clean(p_data ->> 'language'), 'fr'),
    private.clean(p_data ->> 'notes'),
    private.clean(p_data ->> 'external_id'),
    'manual',
    (select auth.uid())
  ) returning id into v_id;

  perform private.write_audit(p_org, 'customer.created', 'customer', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.update_customer(p_customer uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers%rowtype;
begin
  select * into v_customer from public.customers c where c.id = p_customer for update;
  perform private.require_role(v_customer.organization_id, private.operators());

  update public.customers set
    name          = btrim(p_data ->> 'name'),
    trade_name    = private.clean(p_data ->> 'trade_name'),
    billing_email = lower(private.clean(p_data ->> 'billing_email')),
    contact_name  = private.clean(p_data ->> 'contact_name'),
    phone         = private.clean(p_data ->> 'phone'),
    address       = private.clean(p_data ->> 'address'),
    country       = upper(private.clean(p_data ->> 'country')),
    language      = coalesce(private.clean(p_data ->> 'language'), 'fr'),
    notes         = private.clean(p_data ->> 'notes'),
    external_id   = private.clean(p_data ->> 'external_id')
  where id = v_customer.id;

  perform private.write_audit(v_customer.organization_id, 'customer.updated', 'customer', v_customer.id, '{}'::jsonb);
end;
$$;

create function public.set_customer_archived(p_customer uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers%rowtype;
  v_target public.customer_status := case when p_archived then 'archived' else 'active' end;
begin
  select * into v_customer from public.customers c where c.id = p_customer for update;
  perform private.require_role(v_customer.organization_id, private.operators());
  if v_customer.status = v_target then
    return;
  end if;

  update public.customers set status = v_target where id = v_customer.id;
  perform private.write_audit(v_customer.organization_id,
    case when p_archived then 'customer.archived' else 'customer.restored' end,
    'customer', v_customer.id, '{}'::jsonb);
end;
$$;

create function public.set_customer_reminders_suspended(
  p_customer uuid, p_suspended boolean, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers%rowtype;
  v_reason text := private.clean(p_reason);
begin
  select * into v_customer from public.customers c where c.id = p_customer for update;
  perform private.require_role(v_customer.organization_id, private.operators());

  if p_suspended then
    if v_reason is null then
      raise exception 'a reason is required' using errcode = '22023';
    end if;
    update public.customers
    set reminders_suspended_at = coalesce(reminders_suspended_at, now()), reminders_suspended_reason = v_reason
    where id = v_customer.id;
    perform private.write_audit(v_customer.organization_id, 'customer.reminders_suspended',
      'customer', v_customer.id, jsonb_build_object('reason', v_reason));
  elsif v_customer.reminders_suspended_at is not null then
    update public.customers
    set reminders_suspended_at = null, reminders_suspended_reason = null
    where id = v_customer.id;
    perform private.write_audit(v_customer.organization_id, 'customer.reminders_resumed',
      'customer', v_customer.id, '{}'::jsonb);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Factures
-- -----------------------------------------------------------------------------
create function public.create_invoice(p_org uuid, p_data jsonb, p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_customer public.customers%rowtype;
begin
  perform private.require_role(p_org, private.operators());

  -- Même clé rejouée (double clic, nouvel essai réseau) : on renvoie la facture déjà créée.
  select i.id into v_id from public.invoices i
  where i.organization_id = p_org and i.idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  select * into v_customer from public.customers c
  where c.organization_id = p_org and c.id = (p_data ->> 'customer_id')::uuid;
  if not found then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'customer is archived' using errcode = '22023';
  end if;

  insert into public.invoices (
    organization_id, customer_id, number, issue_date, due_date, currency, total_minor,
    recipient_email, lifecycle, external_id, source, idempotency_key, created_by
  ) values (
    p_org,
    v_customer.id,
    btrim(p_data ->> 'number'),
    (p_data ->> 'issue_date')::date,
    (p_data ->> 'due_date')::date,
    p_data ->> 'currency',
    (p_data ->> 'total_minor')::bigint,
    lower(private.clean(p_data ->> 'recipient_email')),
    case when coalesce((p_data ->> 'draft')::boolean, false) then 'draft' else 'open' end::public.invoice_lifecycle,
    private.clean(p_data ->> 'external_id'),
    'manual',
    p_idempotency_key,
    (select auth.uid())
  ) returning id into v_id;

  perform private.record_invoice_event(p_org, v_id, 'invoice.created',
    jsonb_build_object('total_minor', (p_data ->> 'total_minor')::bigint, 'currency', p_data ->> 'currency'));
  return v_id;
end;
$$;

create function public.finalize_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices i where i.id = p_invoice for update;
  perform private.require_role(v_invoice.organization_id, private.operators());
  if v_invoice.lifecycle <> 'draft' then
    raise exception 'invoice is not a draft' using errcode = '22023';
  end if;

  update public.invoices set lifecycle = 'open' where id = v_invoice.id;
  perform private.record_invoice_event(v_invoice.organization_id, v_invoice.id, 'invoice.finalized');
end;
$$;

create function public.cancel_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
  v_reason text := private.clean(p_reason);
begin
  select * into v_invoice from public.invoices i where i.id = p_invoice for update;
  perform private.require_role(v_invoice.organization_id, private.operators());
  if v_invoice.lifecycle = 'cancelled' then
    return;
  end if;
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  -- Une facture qui porte des règlements ne s'annule pas : il faut d'abord les corriger.
  if v_invoice.paid_minor <> 0 then
    raise exception 'invoice has payments' using errcode = '23514';
  end if;

  update public.invoices
  set lifecycle = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
  where id = v_invoice.id;
  perform private.record_invoice_event(v_invoice.organization_id, v_invoice.id, 'invoice.cancelled',
    jsonb_build_object('reason', v_reason));
end;
$$;

create function public.set_invoice_suspended(p_invoice uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
  v_reason text := private.clean(p_reason);
begin
  select * into v_invoice from public.invoices i where i.id = p_invoice for update;
  perform private.require_role(v_invoice.organization_id, private.operators());
  if v_invoice.lifecycle <> 'open' then
    raise exception 'invoice is not open' using errcode = '22023';
  end if;

  if p_suspended then
    if v_reason is null then
      raise exception 'a reason is required' using errcode = '22023';
    end if;
    if v_invoice.suspended_at is not null then
      return;
    end if;
    update public.invoices set suspended_at = now(), suspended_reason = v_reason where id = v_invoice.id;
    perform private.record_invoice_event(v_invoice.organization_id, v_invoice.id, 'invoice.suspended',
      jsonb_build_object('reason', v_reason));
  elsif v_invoice.suspended_at is not null then
    update public.invoices set suspended_at = null, suspended_reason = null where id = v_invoice.id;
    perform private.record_invoice_event(v_invoice.organization_id, v_invoice.id, 'invoice.resumed');
  end if;
end;
$$;

create function public.record_invoice_operation(
  p_invoice uuid,
  p_kind public.payment_kind,
  p_amount_minor bigint,
  p_date date,
  p_reference text,
  p_note text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
  v_id uuid;
begin
  select * into v_invoice from public.invoices i where i.id = p_invoice for update;
  perform private.require_role(v_invoice.organization_id, private.operators());

  select p.id into v_id from public.payments p
  where p.organization_id = v_invoice.organization_id and p.idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  if v_invoice.lifecycle <> 'open' then
    raise exception 'invoice is not open' using errcode = '22023';
  end if;
  if p_date is null or p_date > (now() + interval '1 day')::date then
    raise exception 'invalid date' using errcode = '22023';
  end if;

  insert into public.payments (
    organization_id, invoice_id, kind, amount_minor, currency, paid_at, reference, note,
    source, idempotency_key, created_by
  ) values (
    v_invoice.organization_id, v_invoice.id, p_kind, p_amount_minor, v_invoice.currency, p_date,
    private.clean(p_reference), private.clean(p_note), 'manual', p_idempotency_key, (select auth.uid())
  ) returning id into v_id;

  perform private.record_invoice_event(v_invoice.organization_id, v_invoice.id, 'payment.recorded',
    jsonb_build_object('kind', p_kind, 'amount_minor', p_amount_minor, 'currency', v_invoice.currency));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Import CSV
--
-- p_rows     : lignes déjà validées par l'application (montants en centimes,
--              dates ISO). La base revérifie tout via ses contraintes.
-- p_rejected : lignes refusées par l'application, à consigner dans le rapport.
--
-- Rejouer le même fichier ne crée aucun doublon : une facture dont le numéro
-- existe déjà est ignorée et signalée.
-- -----------------------------------------------------------------------------
create function public.import_invoices(p_org uuid, p_meta jsonb, p_rows jsonb, p_rejected jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_row jsonb;
  v_existing public.invoices%rowtype;
  v_customer uuid;
  v_matches integer;
  v_invoice uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
  v_number text;
  v_external text;
  v_paid bigint;
begin
  perform private.require_role(p_org, private.operators());
  if jsonb_typeof(p_rows) <> 'array' or jsonb_typeof(p_rejected) <> 'array' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) + jsonb_array_length(p_rejected) > 5000 then
    raise exception 'too many rows' using errcode = '22023';
  end if;

  insert into public.import_batches (organization_id, file_name, file_sha256, settings, total_rows, created_by)
  values (
    p_org, left(p_meta ->> 'file_name', 255), p_meta ->> 'file_sha256',
    coalesce(p_meta -> 'settings', '{}'::jsonb),
    jsonb_array_length(p_rows) + jsonb_array_length(p_rejected),
    (select auth.uid())
  ) returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rejected) loop
    insert into public.import_rows (organization_id, batch_id, row_number, outcome, messages, raw)
    values (
      p_org, v_batch, (v_row ->> 'row_number')::integer, 'error',
      array(select jsonb_array_elements_text(v_row -> 'messages')),
      coalesce(v_row -> 'raw', '{}'::jsonb)
    );
    v_errors := v_errors + 1;
  end loop;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_number := btrim(v_row ->> 'number');
    v_external := private.clean(v_row ->> 'customer_external_id');
    v_paid := coalesce((v_row ->> 'paid_minor')::bigint, 0);

    begin
      select * into v_existing from public.invoices i
      where i.organization_id = p_org and i.number = v_number;

      if found then
        insert into public.import_rows (organization_id, batch_id, row_number, outcome, messages, raw)
        values (
          p_org, v_batch, (v_row ->> 'row_number')::integer, 'skipped',
          array[case
            when v_existing.total_minor = (v_row ->> 'total_minor')::bigint
             and v_existing.due_date = (v_row ->> 'due_date')::date
            then 'Facture déjà présente : ligne ignorée.'
            else 'Une facture porte déjà ce numéro avec un montant ou une échéance différents : à vérifier manuellement.'
          end],
          coalesce(v_row -> 'raw', '{}'::jsonb)
        );
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Rattachement du client : par identifiant externe s'il est fourni, sinon par nom exact.
      if v_external is not null then
        select count(*), (array_agg(c.id))[1] into v_matches, v_customer
        from public.customers c
        where c.organization_id = p_org and c.external_id = v_external;
      else
        select count(*), (array_agg(c.id))[1] into v_matches, v_customer
        from public.customers c
        where c.organization_id = p_org and lower(c.name) = lower(btrim(v_row ->> 'customer_name'));
      end if;

      if v_matches > 1 then
        insert into public.import_rows (organization_id, batch_id, row_number, outcome, messages, raw)
        values (
          p_org, v_batch, (v_row ->> 'row_number')::integer, 'error',
          array['Plusieurs clients correspondent à cette ligne : rattachement ambigu, à traiter manuellement.'],
          coalesce(v_row -> 'raw', '{}'::jsonb)
        );
        v_errors := v_errors + 1;
        continue;
      end if;

      if v_matches = 0 then
        insert into public.customers (organization_id, name, billing_email, external_id, source, created_by)
        values (
          p_org, btrim(v_row ->> 'customer_name'), lower(private.clean(v_row ->> 'customer_email')),
          v_external, 'csv', (select auth.uid())
        ) returning id into v_customer;
      end if;

      insert into public.invoices (
        organization_id, customer_id, number, issue_date, due_date, currency, total_minor,
        recipient_email, external_id, source, import_batch_id, created_by
      ) values (
        p_org, v_customer, v_number,
        (v_row ->> 'issue_date')::date, (v_row ->> 'due_date')::date,
        v_row ->> 'currency', (v_row ->> 'total_minor')::bigint,
        lower(private.clean(v_row ->> 'recipient_email')),
        private.clean(v_row ->> 'external_id'), 'csv', v_batch, (select auth.uid())
      ) returning id into v_invoice;

      if v_paid > 0 then
        insert into public.payments (
          organization_id, invoice_id, kind, amount_minor, currency, paid_at, note, source, created_by
        ) values (
          p_org, v_invoice, 'payment', v_paid, v_row ->> 'currency',
          (now() at time zone 'UTC')::date, 'Montant déjà réglé déclaré dans le fichier importé.', 'csv',
          (select auth.uid())
        );
      end if;

      insert into public.invoice_events (organization_id, invoice_id, type, actor_id, metadata)
      values (p_org, v_invoice, 'invoice.imported', (select auth.uid()), jsonb_build_object('batch_id', v_batch));
      v_imported := v_imported + 1;
    exception when others then
      -- La ligne fautive est annulée seule et consignée ; les autres continuent.
      insert into public.import_rows (organization_id, batch_id, row_number, outcome, messages, raw)
      values (
        p_org, v_batch, (v_row ->> 'row_number')::integer, 'error',
        array['Ligne refusée par les contrôles de la base (code ' || sqlstate || ').'],
        coalesce(v_row -> 'raw', '{}'::jsonb)
      );
      v_errors := v_errors + 1;
    end;
  end loop;

  update public.import_batches
  set imported_count = v_imported, skipped_count = v_skipped, error_count = v_errors
  where id = v_batch;

  perform private.write_audit(p_org, 'import.completed', 'import_batch', v_batch,
    jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'errors', v_errors));
  return v_batch;
end;
$$;

-- -----------------------------------------------------------------------------
-- Droits d'exécution
-- -----------------------------------------------------------------------------
revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function private.shares_org_with(uuid) to authenticated, service_role;
grant execute on function private.max_amount_minor() to authenticated, service_role;
grant execute on function private.compute_invoice_status(
  public.invoice_lifecycle, bigint, bigint, boolean, date, date
) to authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_customer(uuid, jsonb)',
    'public.update_customer(uuid, jsonb)',
    'public.set_customer_archived(uuid, boolean)',
    'public.set_customer_reminders_suspended(uuid, boolean, text)',
    'public.create_invoice(uuid, jsonb, uuid)',
    'public.finalize_invoice(uuid)',
    'public.cancel_invoice(uuid, text)',
    'public.set_invoice_suspended(uuid, boolean, text)',
    'public.record_invoice_operation(uuid, public.payment_kind, bigint, date, text, text, uuid)',
    'public.import_invoices(uuid, jsonb, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
