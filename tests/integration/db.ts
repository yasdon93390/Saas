import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const DEFAULT_URL = "postgres://cashpilot_test:cashpilot_test@localhost:5432/cashpilot_test";
const ROOT = join(__dirname, "..", "..");

export type Role = "anon" | "authenticated" | "service_role";

/** Erreur PostgreSQL telle que renvoyée par le pilote `pg`. */
export type PgError = Error & { code?: string };

export async function connect(): Promise<Client> {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  // Garde-fou : ces tests effacent le schéma "public". Ils refusent de tourner
  // ailleurs que sur une base locale explicitement dédiée aux tests.
  const { hostname, pathname } = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(hostname) || !pathname.endsWith("_test")) {
    throw new Error(`Base de test refusée (${hostname}${pathname}) : hôte local et nom en "_test" exigés.`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Remet la base à zéro puis applique toutes les migrations, dans l'ordre. */
export async function resetDatabase(client: Client): Promise<void> {
  await client.query(readFileSync(join(ROOT, "supabase/tests/supabase-shim.sql"), "utf8"));
  const dir = join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(join(dir, file), "utf8"));
  }
}

/**
 * Exécute `fn` dans une transaction, sous le rôle indiqué et avec l'identité
 * `userId` — exactement ce que fait Supabase pour une requête d'utilisateur.
 * La transaction est validée si `fn` réussit, annulée sinon.
 */
export async function as<T>(
  client: Client,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    const claims = userId ? JSON.stringify({ sub: userId, role }) : "";
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query(`set local role ${role}`);
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function createUser(
  client: Client,
  email: string,
  options: { verified?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query(
    "insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
    [email, options.verified === false ? null : new Date()],
  );
  return rows[0].id as string;
}
