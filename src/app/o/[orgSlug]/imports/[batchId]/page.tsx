import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Résultat de l'import" };

const SHOWN = 100;

export default async function ImportResultPage({
  params,
}: {
  params: Promise<{ orgSlug: string; batchId: string }>;
}) {
  const { orgSlug, batchId } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  if (!z.uuid().safeParse(batchId).success) notFound();

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, file_name, total_rows, imported_count, skipped_count, error_count, created_at")
    .eq("organization_id", context.organization.id)
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) notFound();

  const { data: rows } = await supabase
    .from("import_rows")
    .select("id, row_number, outcome, messages")
    .eq("organization_id", context.organization.id)
    .eq("batch_id", batchId)
    .order("row_number")
    .limit(SHOWN);

  const reported = batch.skipped_count + batch.error_count;
  const timestamp = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: context.organization.timezone,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Résultat de l'import"
        description={`${batch.file_name} — ${timestamp.format(new Date(batch.created_at))}`}
        actions={
          <>
            {reported > 0 ? (
              <a href={`/o/${orgSlug}/imports/${batchId}/report`} className={buttonClass("secondary")} download>
                Télécharger le rapport (CSV)
              </a>
            ) : null}
            <Link href={`/o/${orgSlug}/invoices`} className={buttonClass("primary")}>
              Voir les factures
            </Link>
          </>
        }
      />

      {batch.error_count === 0 && batch.skipped_count === 0 ? (
        <Alert tone="success">Toutes les lignes du fichier ont été importées.</Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Lignes du fichier", value: batch.total_rows },
          { label: "Factures importées", value: batch.imported_count },
          { label: "Lignes ignorées", value: batch.skipped_count },
          { label: "Lignes en erreur", value: batch.error_count },
        ].map((figure) => (
          <Card key={figure.label}>
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{figure.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{figure.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {rows && rows.length > 0 ? (
        <Card>
          <CardHeader
            title="Lignes non importées"
            description={
              reported > SHOWN
                ? `Les ${SHOWN} premières sur ${reported}. Téléchargez le rapport pour la liste complète.`
                : "Corrigez ces lignes dans votre fichier puis réimportez-le : les factures déjà importées ne seront pas dupliquées."
            }
          />
          <div className="overflow-x-auto">
            <table className={tableClass.table}>
              <caption className="sr-only">Lignes non importées</caption>
              <thead className={tableClass.head}>
                <tr>
                  <th scope="col" className={tableClass.th}>Ligne</th>
                  <th scope="col" className={tableClass.th}>Résultat</th>
                  <th scope="col" className={tableClass.th}>Motif</th>
                </tr>
              </thead>
              <tbody className={tableClass.body}>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={`${tableClass.td} tabular-nums`}>{row.row_number}</td>
                    <td className={tableClass.td}>
                      {row.outcome === "skipped" ? <Badge tone="neutral">Ignorée</Badge> : <Badge tone="danger">Erreur</Badge>}
                    </td>
                    <td className={`${tableClass.td} text-ink-soft`}>{(row.messages as string[]).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
