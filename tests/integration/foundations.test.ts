import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, connect, createUser, resetDatabase, type PgError } from "./db";

/**
 * Tests de la phase 1 exécutés contre un vrai PostgreSQL.
 *
 * Décor : deux organisations sans aucun lien.
 *   Acme   : alice (owner), adam (admin), fiona (finance), colin (collaborator), victor (viewer)
 *   Globex : bob (owner)
 */
let db: Client;
const u: Record<string, string> = {};
let acme: string;
let globex: string;
const memberId: Record<string, string> = {};

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

const user = <T>(id: string, fn: () => Promise<T>) => as(db, "authenticated", id, fn);
const rpc = (id: string, sql: string, params: unknown[] = []) => user(id, () => db.query(sql, params));

async function addMember(org: string, owner: string, email: string, role: string): Promise<string> {
  const id = await createUser(db, email);
  const { rows } = await rpc(owner, "select public.invite_member($1, $2, $3) as id", [org, email, role]);
  await rpc(id, "select public.accept_invitation($1)", [rows[0].id]);
  memberId[email.split("@")[0]] = rows[0].id;
  return id;
}

beforeAll(async () => {
  db = await connect();
  await resetDatabase(db);

  u.alice = await createUser(db, "alice@acme.test");
  u.bob = await createUser(db, "bob@globex.test");

  acme = (
    await rpc(u.alice, "select public.create_organization('Acme', 'acme', 'FR', 'Europe/Paris', 'EUR') as id")
  ).rows[0].id;
  globex = (
    await rpc(u.bob, "select public.create_organization('Globex', 'globex', 'FR', 'Europe/Paris', 'EUR') as id")
  ).rows[0].id;

  u.adam = await addMember(acme, u.alice, "adam@acme.test", "admin");
  u.fiona = await addMember(acme, u.alice, "fiona@acme.test", "finance");
  u.colin = await addMember(acme, u.alice, "colin@acme.test", "collaborator");
  u.victor = await addMember(acme, u.alice, "victor@acme.test", "viewer");

  const { rows } = await db.query(
    "select id, invited_email from public.organization_members where invited_email in ('alice@acme.test', 'bob@globex.test')",
  );
  for (const row of rows) memberId[row.invited_email.split("@")[0]] = row.id;
});

afterAll(async () => {
  await db?.end();
});

describe("garde-fous structurels", () => {
  it("toute table de public a la RLS activée et forcée", async () => {
    const { rows } = await db.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("toute table de public a au moins une politique RLS", async () => {
    const { rows } = await db.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("le rôle anonyme n'a aucun droit sur aucune table ni fonction", async () => {
    const tables = await db.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    expect(tables.rows).toEqual([]);

    const functions = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(functions.rows.map((r) => r.proname)).toEqual([]);
  });

  it("un utilisateur connecté n'a aucun droit d'écriture direct, sauf son nom affiché", async () => {
    const { rows } = await db.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`);
    expect(rows).toEqual([]);

    const columns = await db.query(`
      select table_name, column_name, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`);
    expect(columns.rows).toEqual([
      { table_name: "profiles", column_name: "display_name", privilege_type: "UPDATE" },
    ]);
  });

  it("toute fonction security definer fixe son search_path", async () => {
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});

describe("isolation entre organisations", () => {
  it("chacun ne voit que son organisation", async () => {
    const alice = await rpc(u.alice, "select slug from public.organizations");
    expect(alice.rows).toEqual([{ slug: "acme" }]);
    const bob = await rpc(u.bob, "select slug from public.organizations");
    expect(bob.rows).toEqual([{ slug: "globex" }]);
  });

  it("même en visant explicitement l'autre organisation, rien n'est renvoyé", async () => {
    for (const table of ["organization_members", "audit_logs"]) {
      const { rows } = await rpc(u.bob, `select 1 from public.${table} where organization_id = $1`, [acme]);
      expect(rows, table).toEqual([]);
    }
    const org = await rpc(u.bob, "select 1 from public.organizations where id = $1", [acme]);
    expect(org.rows).toEqual([]);
  });

  it("les profils de l'autre organisation sont invisibles", async () => {
    const { rows } = await rpc(u.bob, "select email from public.profiles order by email");
    expect(rows).toEqual([{ email: "bob@globex.test" }]);
    const alice = await rpc(u.alice, "select count(*)::int as n from public.profiles");
    expect(alice.rows[0].n).toBe(5);
  });

  it("un Owner ne peut pas agir sur les membres d'une autre organisation", async () => {
    await expectPgError(rpc(u.bob, "select public.invite_member($1, 'x@x.test', 'viewer')", [acme]), "42501");
    await expectPgError(rpc(u.bob, "select public.change_member_role($1, 'viewer')", [memberId.adam]), "P0002");
    await expectPgError(rpc(u.bob, "select public.set_member_disabled($1, true)", [memberId.adam]), "P0002");
    await expectPgError(rpc(u.bob, "select public.revoke_invitation($1)", [memberId.adam]), "P0002");
  });

  it("les écritures directes sont refusées par la base", async () => {
    const denied = "42501";
    await expectPgError(
      rpc(u.alice, "insert into public.organizations (name, slug, country, timezone, default_currency) values ('X', 'xxx', 'FR', 'UTC', 'EUR')"),
      denied,
    );
    await expectPgError(rpc(u.alice, "update public.organizations set name = 'Piraté'"), denied);
    await expectPgError(rpc(u.victor, "update public.organization_members set role = 'owner'"), denied);
    await expectPgError(rpc(u.alice, "delete from public.organization_members"), denied);
    await expectPgError(
      rpc(u.alice, "insert into public.audit_logs (organization_id, action, entity_type) values ($1, 'fake.event', 'x')", [acme]),
      denied,
    );
    await expectPgError(rpc(u.alice, "delete from public.audit_logs"), denied);
  });

  it("un visiteur non connecté ne lit rien et n'appelle rien", async () => {
    await expectPgError(as(db, "anon", null, () => db.query("select * from public.organizations")), "42501");
    await expectPgError(
      as(db, "anon", null, () => db.query("select public.create_organization('X', 'xxx', 'FR', 'UTC', 'EUR')")),
      "42501",
    );
  });
});

describe("rôles et permissions", () => {
  it("seuls Owner et Admin peuvent inviter", async () => {
    for (const name of ["fiona", "colin", "victor"]) {
      await expectPgError(rpc(u[name], "select public.invite_member($1, 'new@acme.test', 'viewer')", [acme]), "42501");
    }
  });

  it("un Admin ne peut ni nommer un Owner, ni toucher à un Owner", async () => {
    await expectPgError(rpc(u.adam, "select public.invite_member($1, 'boss@acme.test', 'owner')", [acme]), "42501");
    await expectPgError(rpc(u.adam, "select public.change_member_role($1, 'owner')", [memberId.fiona]), "42501");
    await expectPgError(rpc(u.adam, "select public.change_member_role($1, 'viewer')", [memberId.alice]), "42501");
    await expectPgError(rpc(u.adam, "select public.set_member_disabled($1, true)", [memberId.alice]), "42501");
  });

  it("personne ne modifie son propre rôle", async () => {
    await expectPgError(rpc(u.adam, "select public.change_member_role($1, 'finance')", [memberId.adam]), "42501");
    await expectPgError(rpc(u.alice, "select public.set_member_disabled($1, true)", [memberId.alice]), "42501");
  });

  it("le journal d'audit n'est lisible que par Owner et Admin", async () => {
    for (const name of ["fiona", "colin", "victor"]) {
      const { rows } = await rpc(u[name], "select 1 from public.audit_logs");
      expect(rows, name).toEqual([]);
    }
    const admin = await rpc(u.adam, "select 1 from public.audit_logs");
    expect(admin.rows.length).toBeGreaterThan(0);
  });

  it("un Admin peut changer le rôle d'un non-Owner, et c'est tracé", async () => {
    await rpc(u.adam, "select public.change_member_role($1, 'finance')", [memberId.colin]);
    const { rows } = await db.query(
      "select actor_id, metadata from public.audit_logs where action = 'member.role_changed' and entity_id = $1",
      [memberId.colin],
    );
    expect(rows).toEqual([{ actor_id: u.adam, metadata: { old_role: "collaborator", new_role: "finance" } }]);
    await rpc(u.adam, "select public.change_member_role($1, 'collaborator')", [memberId.colin]);
  });

  it("un membre désactivé perd immédiatement tout accès", async () => {
    await rpc(u.alice, "select public.set_member_disabled($1, true)", [memberId.victor]);
    const orgs = await rpc(u.victor, "select 1 from public.organizations");
    expect(orgs.rows).toEqual([]);
    const members = await rpc(u.victor, "select 1 from public.organization_members");
    expect(members.rows).toEqual([]);
    await rpc(u.alice, "select public.set_member_disabled($1, false)", [memberId.victor]);
    const back = await rpc(u.victor, "select 1 from public.organizations");
    expect(back.rows.length).toBe(1);
  });

  it("le nom affiché est modifiable par son propriétaire uniquement", async () => {
    await rpc(u.alice, "update public.profiles set display_name = 'Alice' where id = $1", [u.alice]);
    const other = await rpc(u.alice, "update public.profiles set display_name = 'Piraté' where id = $1", [u.adam]);
    expect(other.rowCount).toBe(0);
    await expectPgError(rpc(u.alice, "update public.profiles set email = 'x@x.test' where id = $1", [u.alice]), "42501");
  });
});

describe("dernier Owner", () => {
  it("le seul Owner ne peut être ni rétrogradé ni désactivé, même avec la clé d'administration", async () => {
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query("update public.organization_members set role = 'admin' where id = $1", [memberId.bob]),
      ),
      "23514",
    );
    await expectPgError(
      as(db, "service_role", null, () =>
        db.query("update public.organization_members set status = 'disabled' where id = $1", [memberId.bob]),
      ),
      "23514",
    );
  });

  it("supprimer le compte du seul Owner est refusé", async () => {
    await db.query("begin");
    await expectPgError(
      (async () => {
        await db.query("delete from auth.users where id = $1", [u.bob]);
        await db.query("commit");
      })(),
      "23514",
    );
    await db.query("rollback");
  });

  it("la propriété se transmet : un second Owner peut rétrograder le premier", async () => {
    await rpc(u.alice, "select public.change_member_role($1, 'owner')", [memberId.adam]);
    await rpc(u.adam, "select public.change_member_role($1, 'admin')", [memberId.alice]);
    const { rows } = await db.query(
      "select invited_email from public.organization_members where organization_id = $1 and role = 'owner'",
      [acme],
    );
    expect(rows).toEqual([{ invited_email: "adam@acme.test" }]);
    // Retour à l'état initial.
    await rpc(u.adam, "select public.change_member_role($1, 'owner')", [memberId.alice]);
    await rpc(u.alice, "select public.change_member_role($1, 'admin')", [memberId.adam]);
  });
});

describe("invitations", () => {
  it("réinviter la même adresse ne crée pas de doublon", async () => {
    const first = await rpc(u.alice, "select public.invite_member($1, ' Nina@Acme.test ', 'viewer') as id", [acme]);
    const second = await rpc(u.alice, "select public.invite_member($1, 'nina@acme.test', 'viewer') as id", [acme]);
    expect(second.rows[0].id).toBe(first.rows[0].id);
    const { rows } = await db.query(
      "select count(*)::int as n from public.organization_members where invited_email = 'nina@acme.test'",
    );
    expect(rows[0].n).toBe(1);
    memberId.nina = first.rows[0].id;
  });

  it("inviter quelqu'un qui est déjà membre est un conflit", async () => {
    await expectPgError(rpc(u.alice, "select public.invite_member($1, 'adam@acme.test', 'viewer')", [acme]), "23505");
  });

  it("une invitation n'est visible et acceptable que par l'email invité, une fois vérifié", async () => {
    const stranger = await createUser(db, "mallory@evil.test");
    const unverified = await createUser(db, "nina@acme.test", { verified: false });

    const none = await rpc(stranger, "select * from public.my_pending_invitations()");
    expect(none.rows).toEqual([]);
    await expectPgError(rpc(stranger, "select public.accept_invitation($1)", [memberId.nina]), "P0002");

    const notYet = await rpc(unverified, "select * from public.my_pending_invitations()");
    expect(notYet.rows).toEqual([]);
    await expectPgError(rpc(unverified, "select public.accept_invitation($1)", [memberId.nina]), "P0002");

    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [unverified]);
    const pending = await rpc(unverified, "select organization_name, role from public.my_pending_invitations()");
    expect(pending.rows).toEqual([{ organization_name: "Acme", role: "viewer" }]);

    const accepted = await rpc(unverified, "select public.accept_invitation($1) as slug", [memberId.nina]);
    expect(accepted.rows[0].slug).toBe("acme");
    await expectPgError(rpc(unverified, "select public.accept_invitation($1)", [memberId.nina]), "P0002");
  });

  it("une invitation révoquée ne peut plus être acceptée", async () => {
    const invited = await createUser(db, "oscar@acme.test");
    const { rows } = await rpc(u.alice, "select public.invite_member($1, 'oscar@acme.test', 'finance') as id", [acme]);
    await rpc(u.alice, "select public.revoke_invitation($1)", [rows[0].id]);
    await expectPgError(rpc(invited, "select public.accept_invitation($1)", [rows[0].id]), "P0002");
  });
});

describe("création d'organisation", () => {
  it("exige un utilisateur connecté à l'email vérifié", async () => {
    await expectPgError(
      as(db, "authenticated", null, () =>
        db.query("select public.create_organization('X', 'xxx', 'FR', 'UTC', 'EUR')"),
      ),
      "28000",
    );
    const unverified = await createUser(db, "pending@acme.test", { verified: false });
    await expectPgError(
      rpc(unverified, "select public.create_organization('X', 'xxx', 'FR', 'UTC', 'EUR')"),
      "42501",
    );
  });

  it("refuse un identifiant déjà pris et des données invalides", async () => {
    await expectPgError(rpc(u.bob, "select public.create_organization('Autre', 'acme', 'FR', 'Europe/Paris', 'EUR')"), "23505");
    await expectPgError(rpc(u.bob, "select public.create_organization('Autre', 'autre', 'FR', 'Mars/Olympus', 'EUR')"), "22023");
    await expectPgError(rpc(u.bob, "select public.create_organization('Autre', 'Pas Valide', 'FR', 'Europe/Paris', 'EUR')"), "23514");
    await expectPgError(rpc(u.bob, "select public.create_organization('Autre', 'autre', 'FR', 'Europe/Paris', 'euro')"), "23514");
  });

  it("le créateur devient Owner et l'événement est tracé", async () => {
    const { rows } = await db.query(
      `select m.role, m.status, (select count(*)::int from public.audit_logs a
         where a.organization_id = m.organization_id and a.action = 'organization.created') as audits
       from public.organization_members m where m.organization_id = $1 and m.user_id = $2`,
      [globex, u.bob],
    );
    expect(rows).toEqual([{ role: "owner", status: "active", audits: 1 }]);
  });
});

describe("journal d'audit", () => {
  it("ne peut être ni modifié, ni supprimé, ni vidé, même avec tous les droits", async () => {
    await expectPgError(db.query("update public.audit_logs set action = 'x.y'"), "42501");
    await expectPgError(db.query("delete from public.audit_logs"), "42501");
    await expectPgError(db.query("truncate public.audit_logs"), "42501");
  });
});
