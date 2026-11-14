import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Tableau de bord</h1>
      <Card className="mt-6">
        <CardBody className="py-10 text-center">
          <p className="font-medium text-ink">Votre espace est prêt.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            Commencez par importer vos factures. Les indicateurs et les relances arriveront dans les
            prochaines étapes. Aucune relance ne peut être envoyée pour l&apos;instant.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {can(context.role, "data.write") ? (
              <Link href={`/o/${orgSlug}/imports/new`} className={buttonClass("primary")}>
                Importer des factures
              </Link>
            ) : (
              <Link href={`/o/${orgSlug}/invoices`} className={buttonClass("primary")}>
                Voir les factures
              </Link>
            )}
            {can(context.role, "members.manage") ? (
              <Link href={`/o/${orgSlug}/settings/members`} className={buttonClass("secondary")}>
                Inviter un collègue
              </Link>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
