import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  const canWrite = can(context.role, "data.write");
  const base = `/o/${orgSlug}/imports`;

  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("import_batches")
    .select("id, file_name, total_rows, imported_count, skipped_count, error_count, created_at, created_by")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const authorIds = [...new Set((batches ?? []).flatMap((batch) => (batch.created_by ? [batch.created_by] : [])))];
  const { data: profiles } = authorIds.length
    ? await supabase.from("profiles").select("id, display_name, email").in("id", authorIds)
    : { data: [] };
  const authors = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name || profile.email]));
  const timestamp = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: context.organization.timezone,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Imports"
        description="Qui a importé quoi, quand, et avec quel résultat. Les 50 derniers."
        actions={
          canWrite ? (
            <Link href={`${base}/new`} className={buttonClass("primary")}>
              Importer un fichier CSV
            </Link>
          ) : null
        }
      />
      <Card>
        {batches && batches.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass.table}>
              <caption className="sr-only">Historique des imports</caption>
              <thead className={tableClass.head}>
                <tr>
                  <th scope="col" className={tableClass.th}>Fichier</th>
                  <th scope="col" className={tableClass.th}>Date</th>
                  <th scope="col" className={tableClass.th}>Auteur</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>Importées</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>Ignorées</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>En erreur</th>
                </tr>
              </thead>
              <tbody className={tableClass.body}>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className={tableClass.td}>
                      <Link href={`${base}/${batch.id}`} className="font-medium text-action hover:underline">
                        {batch.file_name}
                      </Link>
                    </td>
                    <td className={`${tableClass.td} whitespace-nowrap text-ink-soft`}>
                      {timestamp.format(new Date(batch.created_at))}
                    </td>
                    <td className={`${tableClass.td} text-ink-soft`}>
                      {(batch.created_by && authors.get(batch.created_by)) || "—"}
                    </td>
                    <td className={tableClass.amount}>{batch.imported_count}</td>
                    <td className={tableClass.amount}>{batch.skipped_count}</td>
                    <td className={tableClass.amount}>{batch.error_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Aucun import pour l'instant.">
            Importez vos factures depuis un fichier CSV exporté de votre logiciel de facturation.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
