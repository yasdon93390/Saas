import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importer des factures" };

export default async function NewImportPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await requireOrgContext(orgSlug, "data.write");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Importer des factures" />
      <ImportWizard orgSlug={orgSlug} />
    </div>
  );
}
