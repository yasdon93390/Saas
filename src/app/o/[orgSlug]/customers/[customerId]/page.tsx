import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DefinitionList, EmptyState, PageHeader, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/import/dates";
import { isInvoiceStatus, STATUS_LABELS } from "@/lib/invoices/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { resumeCustomerReminders, setCustomerArchived, suspendCustomerReminders } from "../actions";

export const metadata: Metadata = { title: "Fiche client" };

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; customerId: string }>;
}) {
  const { orgSlug, customerId } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  if (!z.uuid().safeParse(customerId).success) notFound();
  const canWrite = can(context.role, "data.write");
  const base = `/o/${orgSlug}`;

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", context.organization.id)
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) notFound();

  const [{ data: invoices }, { data: sameName }, { data: sameEmail }] = await Promise.all([
    supabase
      .from("invoice_overview")
      .select("id, number, due_date, total_minor, remaining_minor, currency, status")
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId)
      .order("due_date", { ascending: false })
      .limit(50),
    supabase
      .from("customers")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .ilike("name", customer.name.replace(/[%_\\]/g, (char: string) => `\\${char}`))
      .neq("id", customerId)
      .limit(5),
    customer.billing_email
      ? supabase
          .from("customers")
          .select("id, name")
          .eq("organization_id", context.organization.id)
          .eq("billing_email", customer.billing_email)
          .neq("id", customerId)
          .limit(5)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const duplicates = [...new Map([...(sameName ?? []), ...(sameEmail ?? [])].map((d) => [d.id, d])).values()];
  const archived = customer.status === "archived";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={customer.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {archived ? <Badge tone="neutral">Archivé</Badge> : <Badge tone="success">Actif</Badge>}
            {customer.reminders_suspended_at ? <Badge tone="warning">Relances suspendues</Badge> : null}
            <span>{customer.source === "csv" ? "Créé par import" : "Créé manuellement"}</span>
          </span>
        }
        actions={
          canWrite ? (
            <Link href={`${base}/customers/${customerId}/edit`} className={buttonClass("secondary")}>
              Modifier
            </Link>
          ) : null
        }
      />

      {duplicates.length > 0 ? (
        <Alert tone="info">
          Doublon possible : même nom ou même email que{" "}
          {duplicates.map((duplicate, index) => (
            <span key={duplicate.id}>
              {index > 0 ? ", " : ""}
              <Link href={`${base}/customers/${duplicate.id}`} className="font-medium text-action hover:underline">
                {duplicate.name}
              </Link>
            </span>
          ))}
          . Aucune fusion n&apos;est faite automatiquement : vérifiez et archivez la fiche en trop si besoin.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Coordonnées" />
        <CardBody>
          <DefinitionList
            items={[
              { label: "Nom commercial", value: customer.trade_name },
              { label: "Email de facturation", value: customer.billing_email },
              { label: "Contact", value: customer.contact_name },
              { label: "Téléphone", value: customer.phone },
              { label: "Adresse", value: customer.address },
              { label: "Pays", value: customer.country },
              { label: "Langue des relances", value: customer.language === "en" ? "Anglais" : "Français" },
              { label: "Identifiant externe", value: customer.external_id },
              { label: "Notes internes", value: customer.notes },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Factures" description="Les 50 plus récentes, par échéance." />
        {invoices && invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass.table}>
              <caption className="sr-only">Factures du client</caption>
              <thead className={tableClass.head}>
                <tr>
                  <th scope="col" className={tableClass.th}>Numéro</th>
                  <th scope="col" className={tableClass.th}>Échéance</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>Total</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>Reste dû</th>
                  <th scope="col" className={tableClass.th}>Statut</th>
                </tr>
              </thead>
              <tbody className={tableClass.body}>
                {invoices.map((invoice) => {
                  const status = isInvoiceStatus(invoice.status) ? STATUS_LABELS[invoice.status] : null;
                  return (
                    <tr key={invoice.id}>
                      <td className={tableClass.td}>
                        <Link href={`${base}/invoices/${invoice.id}`} className="font-medium text-action hover:underline">
                          {invoice.number}
                        </Link>
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap text-ink-soft`}>{formatDate(invoice.due_date)}</td>
                      <td className={tableClass.amount}>{formatMoney(invoice.total_minor, invoice.currency)}</td>
                      <td className={tableClass.amount}>
                        {invoice.status === "cancelled" ? "—" : formatMoney(invoice.remaining_minor, invoice.currency)}
                      </td>
                      <td className={tableClass.td}>{status ? <Badge tone={status.tone}>{status.label}</Badge> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Aucune facture pour ce client." />
        )}
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader
            title="Relances"
            description="Suspendre empêche toute relance automatique vers ce client, quelle que soit la facture."
          />
          <CardBody>
            {customer.reminders_suspended_at ? (
              <div className="space-y-4">
                <p className="text-sm text-ink">
                  Relances suspendues. Motif : <span className="font-medium">{customer.reminders_suspended_reason}</span>
                </p>
                <ActionForm action={resumeCustomerReminders.bind(null, orgSlug, customerId)}>
                  <SubmitButton variant="secondary">Autoriser à nouveau les relances</SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <ActionForm action={suspendCustomerReminders.bind(null, orgSlug, customerId)}>
                <Field name="reason" label="Motif de la suspension" maxLength={500} />
                <SubmitButton variant="secondary">Suspendre les relances</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      {canWrite ? (
        <Card>
          <CardHeader
            title={archived ? "Client archivé" : "Archiver ce client"}
            description={
              archived
                ? "Un client archivé n'apparaît plus dans les listes et ne peut plus recevoir de nouvelle facture."
                : "Le client et ses factures sont conservés. L'archivage peut être annulé à tout moment."
            }
          />
          <CardBody>
            <ActionForm action={setCustomerArchived.bind(null, orgSlug, customerId, !archived)}>
              <SubmitButton variant={archived ? "secondary" : "danger"}>
                {archived ? "Restaurer le client" : "Archiver le client"}
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
