import { z } from "zod";
import { resolveOrgContext } from "@/lib/auth/context";
import { toCsv } from "@/lib/csv";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Rapport d'erreurs d'un import, au format CSV. Mêmes contrôles qu'une page :
 * membre actif de l'organisation, permission de lecture, puis RLS.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; batchId: string }> }) {
  const { orgSlug, batchId } = await params;
  const context = await resolveOrgContext(orgSlug);
  if (!context || !z.uuid().safeParse(batchId).success) return new Response("Introuvable", { status: 404 });
  if (!can(context.role, "data.read")) return new Response("Accès refusé", { status: 403 });

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("import_batches")
    .select("id")
    .eq("organization_id", context.organization.id)
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return new Response("Introuvable", { status: 404 });

  const { data: rows } = await supabase
    .from("import_rows")
    .select("row_number, outcome, messages, raw")
    .eq("organization_id", context.organization.id)
    .eq("batch_id", batchId)
    .order("row_number")
    .limit(5000);

  const columns = [...new Set((rows ?? []).flatMap((row) => Object.keys((row.raw ?? {}) as Record<string, string>)))];
  const csv = toCsv(
    ["Ligne", "Résultat", "Motif", ...columns],
    (rows ?? []).map((row) => [
      row.row_number,
      row.outcome === "skipped" ? "Ignorée" : "Erreur",
      (row.messages as string[]).join(" "),
      ...columns.map((column) => ((row.raw ?? {}) as Record<string, string>)[column] ?? ""),
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rapport-import-${batchId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
