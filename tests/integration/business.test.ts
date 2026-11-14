import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, connect, createUser, resetDatabase, type PgError } from "./db";

/**
 * Phase 2 : clients, factures, opérations de règlement, import.
 *   Acme   : alice (owner), fiona (finance), colin (collaborator), victor (viewer)
 *   Globex : bob (owner)
 */
let db: Client;
const u: Record<string, string> = {};
let acme: string;
let globex: string;
let acmeCustomer: string;
let globexCustomer: string;

async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: PgError | undefined;
  try {
    await promise;
  } catch (error) {
    caught = error as PgError;
  }
  expect(caught, `une erreur ${code} était attendue`).toBeDefined();
  expect(caught?.code).toBe(code);
}

const rpc = (id: string, sql: string, params: unknown[] = []) =>
  as(db, "authenticated", id, () => db.query(sql, params));

async function addMember(org: string, owner: string, email: string, role: string): Promise<string> {
  const id = await createUser(db, email);
  const { rows } = await rpc(owner, "select public.invite_member($1, $2, $3) as id", [org, email, role]);
  await rpc(id, "select public.accept_invitation($1)", [rows[0].id]);
  return id;
}

async function createCustomer(user: string, org: string, data: Record<string, unknown>): Promise<string> {
  const { rows } = await rpc(user, "select public.create_customer($1, $2) as id", [org, JSON.stringify(data)]);
  return rows[0].id;
}

let sequence = 0;
async function createInvoice(
  user: string,
  org: string,
  customer: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  sequence += 1;
  const data = {
    customer_id: customer,
    number: `F-${sequence.toString().padStart(4, "0")}`,
    issue_date: "2026-01-01",
    due_date: "2099-01-31",
    currency: "EUR",
    total_minor: 100000,
    ...overrides,
  };
  const { rows } = await rpc(user, "select public.create_invoice($1, $2, $3) as id", [
    org,
    JSON.stringify(data),
    randomUUID(),
  ]);
  return rows[0].id;
}

const pay = (user: string, invoice: string, amount: number, kind = "payment", note: string | null = null, key = randomUUID()) =>
  rpc(user, "select public.record_invoice_operation($1, $2, $3, current_date, null, $4, $5) as id", [
    invoice,
    kind,
    amount,
    note,
    key,
  ]);

async function overview(invoice: string) {
  const { rows } = await db.query(
    "select status, is_overdue, paid_minor::int, remaining_minor::int from public.invoice_overview where id = $1",
    [invoice],
  );
  return rows[0];
}

beforeAll(async () => {
  db = await connect();
  await resetDatabase(db);
  u.alice = await createUser(db, "alice@acme.test");
  u.bob = await createUser(db, "bob@globex.test");
  acme = (await rpc(u.alice, "select public.create_organization('Acme', 'acme', 'FR', 'Europe/Paris', 'EUR') as id")).rows[0].id;
  globex = (await rpc(u.bob, "select public.create_organization('Globex', 'globex', 'FR', 'Europe/Paris', 'EUR') as id")).rows[0].id;
  u.fiona = await addMember(acme, u.alice, "fiona@acme.test", "finance");
  u.colin = await addMember(acme, u.alice, "colin@acme.test", "collaborator");
  u.victor = await addMember(acme, u.alice, "victor@acme.test", "viewer");
  acmeCustomer = await createCustomer(u.fiona, acme, { name: "Dupont SARL", billing_email: "Compta@Dupont.test" });
  globexCustomer = await createCustomer(u.bob, globex, { name: "Initech" });
});

afterAll(async () => {
  await db?.end();
});

describe("garde-fous structurels (phase 2)", () => {
  it("toute table de public a la RLS activée, forcée, et au moins une politique", async () => {
    const { rows } = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (not (c.relrowsecurity and c.relforcerowsecurity)
             or not exists (select 1 from pg_policy p where p.polrelid = c.oid))`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("toute table métier porte organization_id NOT NULL", async () => {
    const { rows } = await db.query(`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and t.table_name not in ('organizations', 'profiles')
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name
            and c.column_name = 'organization_id' and c.is_nullable = 'NO')`);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("toute vue de public applique la RLS de l'utilisateur (security_invoker)", async () => {
    const { rows } = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce(c.reloptions @> array['security_invoker=true'], false)`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("anonyme : aucun droit ; connecté : lecture seule sur les nouvelles tables", async () => {
    const anon = await db.query(`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    expect(anon.rows).toEqual([]);
    const writes = await db.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`);
    expect(writes.rows).toEqual([]);
    const functions = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(functions.rows.map((r) => r.proname)).toEqual([]);
  });

  it("aucune colonne de montant n'est un nombre à virgule flottante", async () => {
    const { rows } = await db.query(`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and (column_name like '%_minor' or data_type in ('real', 'double precision', 'money'))
        and data_type <> 'bigint'`);
    expect(rows).toEqual([]);
  });
});

describe("isolation entre organisations (phase 2)", () => {
  let invoice: string;

  beforeAll(async () => {
    invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    await pay(u.fiona, invoice, 1000);
  });

  it("aucune donnée d'Acme n'est lisible depuis Globex", async () => {
    for (const table of ["customers", "invoices", "payments", "invoice_events", "import_batches", "import_rows", "invoice_overview"]) {
      const { rows } = await rpc(u.bob, `select 1 from public.${table} where organization_id = $1`, [acme]);
      expect(rows, table).toEqual([]);
    }
  });

  it("aucune action de Globex n'atteint une donnée d'Acme", async () => {
    const notFound = "P0002";
    await expectPgError(rpc(u.bob, "select public.update_customer($1, $2)", [acmeCustomer, '{"name":"Piraté"}']), notFound);
    await expectPgError(rpc(u.bob, "select public.set_customer_archived($1, true)", [acmeCustomer]), notFound);
    await expectPgError(rpc(u.bob, "select public.set_customer_reminders_suspended($1, true, 'x')", [acmeCustomer]), notFound);
    await expectPgError(rpc(u.bob, "select public.cancel_invoice($1, 'x')", [invoice]), notFound);
    await expectPgError(rpc(u.bob, "select public.set_invoice_suspended($1, true, 'x')", [invoice]), notFound);
    await expectPgError(pay(u.bob, invoice, 100), notFound);
    await expectPgError(rpc(u.bob, "select public.create_customer($1, $2)", [acme, '{"name":"Intrus"}']), notFound);
    await expectPgError(rpc(u.bob, "select public.import_invoices($1, '{}', '[]', '[]')", [acme]), notFound);
  });

  it("une facture ne peut pas être rattachée au client d'une autre organisation", async () => {
    // Via la fonction : le client de Globex est « introuvable » depuis Acme.
    await expectPgError(createInvoice(u.fiona, acme, globexCustomer), "P0002");
    // Même avec la clé d'administration, la clé étrangère composite refuse.
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query(
          `insert into public.invoices (organization_id, customer_id, number, issue_date, due_date, currency, total_minor)
           values ($1, $2, 'X-1', '2026-01-01', '2026-02-01', 'EUR', 100)`,
          [acme, globexCustomer],
        ),
      ),
      "23503",
    );
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query(
          `insert into public.payments (organization_id, invoice_id, kind, amount_minor, currency, paid_at)
           values ($1, $2, 'payment', 100, 'EUR', current_date)`,
          [globex, invoice],
        ),
      ),
      "23503",
    );
  });

  it("deux organisations peuvent utiliser le même numéro de facture", async () => {
    await createInvoice(u.fiona, acme, acmeCustomer, { number: "COMMUN-1" });
    await createInvoice(u.bob, globex, globexCustomer, { number: "COMMUN-1" });
  });
});

describe("rôles (phase 2)", () => {
  it("Collaborateur et Lecture seule ne peuvent rien créer ni modifier", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    for (const name of ["colin", "victor"]) {
      const id = u[name];
      await expectPgError(rpc(id, "select public.create_customer($1, $2)", [acme, '{"name":"X"}']), "42501");
      await expectPgError(rpc(id, "select public.update_customer($1, $2)", [acmeCustomer, '{"name":"X"}']), "42501");
      await expectPgError(createInvoice(id, acme, acmeCustomer), "42501");
      await expectPgError(pay(id, invoice, 100), "42501");
      await expectPgError(rpc(id, "select public.cancel_invoice($1, 'x')", [invoice]), "42501");
      await expectPgError(rpc(id, "select public.import_invoices($1, '{}', '[]', '[]')", [acme]), "42501");
      await expectPgError(rpc(id, "insert into public.payments (organization_id, invoice_id, kind, amount_minor, currency, paid_at) values ($1, $2, 'payment', 1, 'EUR', current_date)", [acme, invoice]), "42501");
    }
  });

  it("mais ils peuvent consulter", async () => {
    const { rows } = await rpc(u.victor, "select count(*)::int as n from public.invoice_overview");
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe("montants et statuts", () => {
  it("à venir → partiellement payée → payée, avec un solde toujours exact", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { total_minor: 123456 });
    expect(await overview(invoice)).toEqual({ status: "pending", is_overdue: false, paid_minor: 0, remaining_minor: 123456 });

    await pay(u.fiona, invoice, 23456);
    expect(await overview(invoice)).toEqual({ status: "partially_paid", is_overdue: false, paid_minor: 23456, remaining_minor: 100000 });

    await pay(u.fiona, invoice, 100000);
    expect(await overview(invoice)).toEqual({ status: "paid", is_overdue: false, paid_minor: 123456, remaining_minor: 0 });
  });

  it("échue → partiellement payée (toujours en retard) → payée", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { issue_date: "2020-01-01", due_date: "2020-01-31" });
    expect(await overview(invoice)).toMatchObject({ status: "overdue", is_overdue: true });
    await pay(u.fiona, invoice, 40000);
    expect(await overview(invoice)).toMatchObject({ status: "partially_paid", is_overdue: true });
    await pay(u.fiona, invoice, 60000);
    expect(await overview(invoice)).toMatchObject({ status: "paid", is_overdue: false });
  });

  it("l'échéance est jugée dans le fuseau de l'organisation", async () => {
    const { rows } = await db.query(`
      select private.compute_invoice_status('open', 100, 0, false, date '2026-03-10', date '2026-03-10') as same_day,
             private.compute_invoice_status('open', 100, 0, false, date '2026-03-10', date '2026-03-11') as next_day`);
    expect(rows[0]).toEqual({ same_day: "pending", next_day: "overdue" });
  });

  it("un trop-perçu est refusé et ne laisse aucune trace", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { total_minor: 5000 });
    await expectPgError(pay(u.fiona, invoice, 5001), "23514");
    await pay(u.fiona, invoice, 3000);
    await expectPgError(pay(u.fiona, invoice, 2001), "23514");
    const { rows } = await db.query("select count(*)::int as n from public.payments where invoice_id = $1", [invoice]);
    expect(rows[0].n).toBe(1);
    expect(await overview(invoice)).toMatchObject({ paid_minor: 3000, remaining_minor: 2000 });
  });

  it("avoir et correction : chaque opération est explicite", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { total_minor: 10000 });
    await pay(u.fiona, invoice, 4000);
    await pay(u.fiona, invoice, 1000, "credit_note");
    expect(await overview(invoice)).toMatchObject({ paid_minor: 5000, remaining_minor: 5000 });

    // Une correction exige un motif, et ne peut pas rendre le réglé négatif.
    await expectPgError(pay(u.fiona, invoice, -4000, "correction"), "23514");
    await expectPgError(pay(u.fiona, invoice, -6000, "correction", "Erreur de saisie"), "23514");
    await pay(u.fiona, invoice, -4000, "correction", "Paiement saisi sur la mauvaise facture");
    expect(await overview(invoice)).toMatchObject({ status: "partially_paid", paid_minor: 1000, remaining_minor: 9000 });

    // Paiements et avoirs sont strictement positifs.
    await expectPgError(pay(u.fiona, invoice, 0), "23514");
    await expectPgError(pay(u.fiona, invoice, -100), "23514");
  });

  it("le montant réglé ne peut être modifié par aucun autre chemin", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    await expectPgError(
      as(db, "service_role", null, () => db.query("update public.invoices set paid_minor = 500 where id = $1", [invoice])),
      "42501",
    );
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query(
          `insert into public.invoices (organization_id, customer_id, number, issue_date, due_date, currency, total_minor, paid_minor)
           values ($1, $2, 'X-2', '2026-01-01', '2026-02-01', 'EUR', 100, 50)`,
          [acme, acmeCustomer],
        ),
      ),
      "42501",
    );
  });

  it("les opérations ne peuvent être ni modifiées ni supprimées, même avec tous les droits", async () => {
    await expectPgError(db.query("update public.payments set amount_minor = 1"), "42501");
    await expectPgError(db.query("delete from public.payments"), "42501");
    await expectPgError(db.query("truncate public.payments cascade"), "42501");
    await expectPgError(db.query("delete from public.invoice_events"), "42501");
  });

  it("une opération dans une autre devise que la facture est refusée", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query(
          `insert into public.payments (organization_id, invoice_id, kind, amount_minor, currency, paid_at)
           values ($1, $2, 'payment', 100, 'USD', current_date)`,
          [acme, invoice],
        ),
      ),
      "22023",
    );
  });

  it("montant nul, négatif ou échéance avant émission : refusés", async () => {
    await expectPgError(createInvoice(u.fiona, acme, acmeCustomer, { total_minor: 0 }), "23514");
    await expectPgError(createInvoice(u.fiona, acme, acmeCustomer, { total_minor: -5 }), "23514");
    await expectPgError(createInvoice(u.fiona, acme, acmeCustomer, { issue_date: "2026-02-01", due_date: "2026-01-01" }), "23514");
    await expectPgError(createInvoice(u.fiona, acme, acmeCustomer, { currency: "eur" }), "23514");
  });
});

describe("idempotence", () => {
  it("rejouer la création d'une facture avec la même clé ne crée rien de plus", async () => {
    const key = randomUUID();
    const data = JSON.stringify({
      customer_id: acmeCustomer, number: "IDEM-1", issue_date: "2026-01-01", due_date: "2026-02-01",
      currency: "EUR", total_minor: 100,
    });
    const first = await rpc(u.fiona, "select public.create_invoice($1, $2, $3) as id", [acme, data, key]);
    const second = await rpc(u.fiona, "select public.create_invoice($1, $2, $3) as id", [acme, data, key]);
    expect(second.rows[0].id).toBe(first.rows[0].id);
  });

  it("un même numéro de facture avec une autre clé est un conflit", async () => {
    await expectPgError(createInvoice(u.fiona, acme, acmeCustomer, { number: "IDEM-1" }), "23505");
  });

  it("rejouer un paiement avec la même clé ne l'enregistre qu'une fois", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { total_minor: 1000 });
    const key = randomUUID();
    const first = await pay(u.fiona, invoice, 600, "payment", null, key);
    const second = await pay(u.fiona, invoice, 600, "payment", null, key);
    expect(second.rows[0].id).toBe(first.rows[0].id);
    expect(await overview(invoice)).toMatchObject({ paid_minor: 600 });
  });
});

describe("cycle de vie", () => {
  it("brouillon → finalisée ; aucune opération sur un brouillon", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { draft: true });
    expect(await overview(invoice)).toMatchObject({ status: "draft" });
    await expectPgError(pay(u.fiona, invoice, 100), "22023");
    await rpc(u.fiona, "select public.finalize_invoice($1)", [invoice]);
    expect(await overview(invoice)).toMatchObject({ status: "pending" });
  });

  it("suspension avec motif obligatoire, puis reprise", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer, { issue_date: "2020-01-01", due_date: "2020-01-31" });
    await expectPgError(rpc(u.fiona, "select public.set_invoice_suspended($1, true, '  ')", [invoice]), "22023");
    await rpc(u.fiona, "select public.set_invoice_suspended($1, true, 'Accord verbal en cours')", [invoice]);
    expect(await overview(invoice)).toMatchObject({ status: "suspended", is_overdue: true });
    await rpc(u.fiona, "select public.set_invoice_suspended($1, false, null)", [invoice]);
    expect(await overview(invoice)).toMatchObject({ status: "overdue" });
  });

  it("annulation avec motif ; impossible si des règlements existent ; plus aucune opération ensuite", async () => {
    const paid = await createInvoice(u.fiona, acme, acmeCustomer);
    await pay(u.fiona, paid, 100);
    await expectPgError(rpc(u.fiona, "select public.cancel_invoice($1, 'Erreur')", [paid]), "23514");

    const invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    await expectPgError(rpc(u.fiona, "select public.cancel_invoice($1, '')", [invoice]), "22023");
    await rpc(u.fiona, "select public.cancel_invoice($1, 'Facture émise par erreur')", [invoice]);
    expect(await overview(invoice)).toMatchObject({ status: "cancelled", is_overdue: false });
    await expectPgError(pay(u.fiona, invoice, 100), "22023");
  });

  it("chaque étape est tracée dans la chronologie et dans l'audit", async () => {
    const invoice = await createInvoice(u.fiona, acme, acmeCustomer);
    await pay(u.fiona, invoice, 100);
    await rpc(u.fiona, "select public.set_invoice_suspended($1, true, 'Motif')", [invoice]);
    const events = await db.query("select type from public.invoice_events where invoice_id = $1 order by created_at, type", [invoice]);
    expect(events.rows.map((r) => r.type).sort()).toEqual(["invoice.created", "invoice.suspended", "payment.recorded"]);
    const audit = await db.query("select count(*)::int as n from public.audit_logs where entity_id = $1 and actor_id = $2", [invoice, u.fiona]);
    expect(audit.rows[0].n).toBe(3);
  });

  it("client : archivage, suspension des relances avec motif, pas de facture sur un client archivé", async () => {
    const customer = await createCustomer(u.fiona, acme, { name: "Client à archiver" });
    await expectPgError(rpc(u.fiona, "select public.set_customer_reminders_suspended($1, true, null)", [customer]), "22023");
    await rpc(u.fiona, "select public.set_customer_reminders_suspended($1, true, 'Litige commercial')", [customer]);
    await rpc(u.fiona, "select public.set_customer_archived($1, true)", [customer]);
    await expectPgError(createInvoice(u.fiona, acme, customer), "22023");
    const { rows } = await db.query("select status, reminders_suspended_reason, billing_email from public.customers where id = $1", [customer]);
    expect(rows[0]).toEqual({ status: "archived", reminders_suspended_reason: "Litige commercial", billing_email: null });
  });

  it("l'email du client est normalisé en minuscules", async () => {
    const { rows } = await db.query("select billing_email from public.customers where id = $1", [acmeCustomer]);
    expect(rows[0].billing_email).toBe("compta@dupont.test");
  });
});

describe("import", () => {
  const meta = JSON.stringify({ file_name: "factures.csv", file_sha256: "a".repeat(64), settings: {} });
  const row = (n: number, overrides: Record<string, unknown> = {}) => ({
    row_number: n,
    customer_name: "Martin & Fils",
    number: `IMP-${n}`,
    issue_date: "2026-01-01",
    due_date: "2026-01-31",
    currency: "EUR",
    total_minor: 120050,
    paid_minor: 0,
    raw: { numero: `IMP-${n}` },
    ...overrides,
  });
  const run = (rows: unknown[], rejected: unknown[] = []) =>
    rpc(u.fiona, "select public.import_invoices($1, $2, $3, $4) as id", [acme, meta, JSON.stringify(rows), JSON.stringify(rejected)]);
  const batch = async (id: string) =>
    (await db.query("select total_rows, imported_count, skipped_count, error_count from public.import_batches where id = $1", [id])).rows[0];

  it("importe, crée le client une seule fois et reprend le montant déjà réglé", async () => {
    const id = (await run([row(1), row(2, { paid_minor: 20050 }), row(3, { customer_name: "  martin & fils " })])).rows[0].id;
    expect(await batch(id)).toEqual({ total_rows: 3, imported_count: 3, skipped_count: 0, error_count: 0 });

    const customers = await db.query("select count(*)::int as n from public.customers where organization_id = $1 and lower(name) = 'martin & fils'", [acme]);
    expect(customers.rows[0].n).toBe(1);
    const partial = await db.query("select status, paid_minor::int, remaining_minor::int from public.invoice_overview where organization_id = $1 and number = 'IMP-2'", [acme]);
    expect(partial.rows[0]).toEqual({ status: "partially_paid", paid_minor: 20050, remaining_minor: 100000 });
  });

  it("relancer le même fichier ne crée aucun doublon", async () => {
    const before = await db.query("select count(*)::int as n from public.invoices where organization_id = $1", [acme]);
    const id = (await run([row(1), row(2, { paid_minor: 20050 }), row(3)])).rows[0].id;
    expect(await batch(id)).toEqual({ total_rows: 3, imported_count: 0, skipped_count: 3, error_count: 0 });
    const after = await db.query("select count(*)::int as n from public.invoices where organization_id = $1", [acme]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const payments = await db.query("select count(*)::int as n from public.payments p join public.invoices i on i.id = p.invoice_id where i.number = 'IMP-2'");
    expect(payments.rows[0].n).toBe(1);
  });

  it("signale une facture existante dont le montant diffère, sans la modifier", async () => {
    const id = (await run([row(1, { total_minor: 999 })])).rows[0].id;
    const report = await db.query("select outcome, messages from public.import_rows where batch_id = $1", [id]);
    expect(report.rows[0].outcome).toBe("skipped");
    expect(report.rows[0].messages[0]).toContain("à vérifier manuellement");
    const invoice = await db.query("select total_minor::int from public.invoices where organization_id = $1 and number = 'IMP-1'", [acme]);
    expect(invoice.rows[0].total_minor).toBe(120050);
  });

  it("une ligne refusée par la base n'empêche pas les autres, et figure au rapport", async () => {
    const id = (await run(
      [row(10), row(11, { paid_minor: 999999999 }), row(12, { due_date: "2025-01-01" }), row(13)],
      [{ row_number: 14, messages: ["Montant invalide."], raw: { montant: "abc" } }],
    )).rows[0].id;
    expect(await batch(id)).toEqual({ total_rows: 5, imported_count: 2, skipped_count: 0, error_count: 3 });
    const report = await db.query("select row_number, outcome from public.import_rows where batch_id = $1 order by row_number", [id]);
    expect(report.rows).toEqual([
      { row_number: 11, outcome: "error" },
      { row_number: 12, outcome: "error" },
      { row_number: 14, outcome: "error" },
    ]);
    // La facture de la ligne 11 n'existe pas : la ligne a été annulée entièrement.
    const orphan = await db.query("select 1 from public.invoices where organization_id = $1 and number = 'IMP-11'", [acme]);
    expect(orphan.rows).toEqual([]);
  });

  it("deux clients homonymes : rattachement ambigu, ligne refusée", async () => {
    await createCustomer(u.fiona, acme, { name: "Homonyme SA" });
    await createCustomer(u.fiona, acme, { name: "homonyme sa" });
    const id = (await run([row(20, { customer_name: "Homonyme SA" })])).rows[0].id;
    expect(await batch(id)).toMatchObject({ imported_count: 0, error_count: 1 });
  });

  it("refuse plus de 5 000 lignes", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(1000 + i));
    await expectPgError(run(rows), "22023");
  });
});
