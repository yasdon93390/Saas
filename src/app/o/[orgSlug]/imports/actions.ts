"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/context";
import { errorMessage } from "@/lib/db/errors";
import { analyzeImport, importSettingsSchema, MAX_IMPORT_BYTES, type ImportAnalysis } from "@/lib/import/invoices";
import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string().min(1),
  settings: importSettingsSchema,
});

export type ImportPayload = z.input<typeof payloadSchema>;

export type ImportCheck =
  | { ok: false; error: string }
  | {
      ok: true;
      totalRows: number;
      validCount: number;
      rejectedCount: number;
      /** Aperçu des premières lignes refusées ; le rapport complet suit l'import. */
      rejectedSample: { row_number: number; messages: string[] }[];
      alreadyImported: boolean;
    };

type Prepared =
  | { ok: false; error: string }
  | { ok: true; organizationId: string; sha256: string; analysis: Extract<ImportAnalysis, { ok: true }>; payload: z.output<typeof payloadSchema> };

/**
 * Tronc commun à la vérification et à l'import : le serveur relit et recontrôle
 * lui-même le fichier à chaque fois. Rien de ce que le navigateur a calculé
 * (aperçu, compteurs) n'est repris.
 */
async function prepare(orgSlug: string, input: unknown): Promise<Prepared> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Demande d'import invalide." };
  if (!/\.csv$/i.test(parsed.data.fileName)) return { ok: false, error: "Seuls les fichiers .csv sont acceptés." };
  if (Buffer.byteLength(parsed.data.text, "utf8") > MAX_IMPORT_BYTES) {
    return { ok: false, error: "Le fichier dépasse 2 Mo. Découpez-le en plusieurs fichiers." };
  }
  if (parsed.data.text.includes("\u0000")) return { ok: false, error: "Ce fichier n'est pas un fichier texte CSV." };

  const analysis = analyzeImport(parsed.data.text, parsed.data.settings, auth.context.organization.defaultCurrency);
  if (!analysis.ok) return { ok: false, error: analysis.error };

  return {
    ok: true,
    organizationId: auth.context.organization.id,
    sha256: createHash("sha256").update(parsed.data.text, "utf8").digest("hex"),
    analysis,
    payload: parsed.data,
  };
}

/** Étape de vérification : contrôle tout, n'écrit rien. */
export async function checkImport(orgSlug: string, input: ImportPayload): Promise<ImportCheck> {
  const prepared = await prepare(orgSlug, input);
  if (!prepared.ok) return prepared;

  const supabase = await createClient();
  const { count } = await supabase
    .from("import_batches")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", prepared.organizationId)
    .eq("file_sha256", prepared.sha256);

  return {
    ok: true,
    totalRows: prepared.analysis.totalRows,
    validCount: prepared.analysis.valid.length,
    rejectedCount: prepared.analysis.rejected.length,
    rejectedSample: prepared.analysis.rejected
      .slice(0, 10)
      .map((row) => ({ row_number: row.row_number, messages: row.messages })),
    alreadyImported: (count ?? 0) > 0,
  };
}

export type ImportRun = { ok: false; error: string } | { ok: true; batchId: string };

/** Import proprement dit, après confirmation explicite de l'utilisateur. */
export async function runImport(orgSlug: string, input: ImportPayload): Promise<ImportRun> {
  const prepared = await prepare(orgSlug, input);
  if (!prepared.ok) return prepared;

  const supabase = await createClient();
  const { data: batchId, error } = await supabase.rpc("import_invoices", {
    p_org: prepared.organizationId,
    p_meta: {
      file_name: prepared.payload.fileName,
      file_sha256: prepared.sha256,
      settings: prepared.payload.settings,
    },
    p_rows: prepared.analysis.valid,
    p_rejected: prepared.analysis.rejected,
  });
  if (error || typeof batchId !== "string") return { ok: false, error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}`, "layout");
  return { ok: true, batchId };
}
