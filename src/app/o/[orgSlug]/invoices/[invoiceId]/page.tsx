import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  ActionForm,
  CheckboxField,
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DefinitionList, EmptyState, PageHeader, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/import/dates";
import { EVENT_LABELS, isInvoiceStatus, OPERATION_KINDS, OPERATION_LABELS, STATUS_LABELS } from "@/lib/invoices/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cancelInvoice, finalizeInvoice, recordOperation, resumeInvoice, suspendInvoice } from "../actions";

export const metadata: Metadata = { title: "Facture" };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orgSlug: string; invoiceId: string }>;
}) {
  const { orgSlug, invoiceId } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  if (!z.uuid().safeParse(invoiceId).success) notFound();
  const canWrite = can(context.role, "data.write");
  const canPay = can(context.role, "payments.write");

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoice_overview")
    .select("*")
    .eq("organization_id", context.organization.id)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) notFound();

  const [{ data: operations }, { data: events }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, kind, amount_minor, currency, paid_at, reference, note, source, created_by")
      .eq("organization_id", context.organization.id)
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("invoice_events")
      .select("id, type, actor_id, metadata, created_at")
      .eq("organization_id", context.organization.id)
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false }),
  ]);

  const actorIds = [...new Set((events ?? []).flatMap((event) => (event.actor_id ? [event.actor_id] : [])))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name, email").in("id", actorIds)
    : { data: [] };
  const actors = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name || profile.email]));

  const statusValue: unknown = invoice.status;
  const status = isInvoiceStatus(statusValue) ? STATUS_LABELS[statusValue] : null;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const open = invoice.lifecycle === "open";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: context.organization.timezone }).format(new Date());
  const timestamp = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: context.organization.timezone,
  });

  const describe = (type: string, metadata: Record<string, unknown>): string => {
    if (type === "payment.recorded" && typeof metadata.amount_minor === "number") {
      const kind = OPERATION_KINDS.find((value) => value === metadata.kind);
      return `${kind ? OPERATION_LABELS[kind] : "Opération"} de ${money(metadata.amount_minor)}`;
    }
    if (typeof metadata.reason === "string") return `Motif : ${metadata.reason}`;
    return "";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Facture ${invoice.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
            {invoice.is_overdue && invoice.status !== "overdue" ? <Badge tone="danger">En retard</Badge> : null}
            <Link href={`/o/${orgSlug}/customers/${invoice.customer_id}`} className="text-action hover:underline">
              {invoice.customer_name}
            </Link>
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Montant total", value: money(invoice.total_minor) },
          { label: "Déjà réglé", value: money(invoice.paid_minor) },
          { label: "Reste dû", value: invoice.lifecycle === "cancelled" ? "—" : money(invoice.remaining_minor) },
        ].map((figure) => (
          <Card key={figure.label}>
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{figure.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{figure.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Détail" />
        <CardBody>
          <DefinitionList
            items={[
              { label: "Date d'émission", value: formatDate(invoice.issue_date) },
              { label: "Date d'échéance", value: formatDate(invoice.due_date) },
              { label: "Email destinataire", value: invoice.recipient_email },
              { label: "Origine", value: invoice.source === "csv" ? "Import CSV" : "Saisie manuelle" },
              ...(invoice.suspended_reason ? [{ label: "Motif de suspension", value: invoice.suspended_reason }] : []),
              ...(invoice.cancel_reason ? [{ label: "Motif d'annulation", value: invoice.cancel_reason }] : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Paiements, avoirs et corrections"
          description="Une opération enregistrée ne se modifie pas : une erreur se corrige par une correction en sens inverse."
        />
        {operations && operations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass.table}>
              <caption className="sr-only">Opérations de la facture</caption>
              <thead className={tableClass.head}>
                <tr>
                  <th scope="col" className={tableClass.th}>Date</th>
                  <th scope="col" className={tableClass.th}>Type</th>
                  <th scope="col" className={tableClass.th}>Référence et note</th>
                  <th scope="col" className={`${tableClass.th} text-right`}>Montant</th>
                </tr>
              </thead>
              <tbody className={tableClass.body}>
                {operations.map((operation) => (
                  <tr key={operation.id}>
                    <td className={`${tableClass.td} whitespace-nowrap text-ink-soft`}>{formatDate(operation.paid_at)}</td>
                    <td className={tableClass.td}>
                      {OPERATION_LABELS[operation.kind as keyof typeof OPERATION_LABELS] ?? operation.kind}
                    </td>
                    <td className={`${tableClass.td} text-ink-soft`}>
                      {[operation.reference, operation.note].filter(Boolean).join(" — ") || "—"}
                    </td>
                    <td className={tableClass.amount}>{money(operation.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Aucune opération enregistrée." />
        )}
        {canPay && open ? (
          <CardBody className="border-t border-line">
            <h3 className="mb-4 text-sm font-semibold text-ink">Enregistrer une opération</h3>
            <ActionForm action={recordOperation.bind(null, orgSlug, invoiceId)}>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField
                  name="kind"
                  label="Type"
                  options={OPERATION_KINDS.map((kind) => ({ value: kind, label: OPERATION_LABELS[kind] }))}
                />
                <Field
                  name="amount"
                  label="Montant"
                  inputMode="decimal"
                  placeholder="250,00"
                  hint="Négatif uniquement pour une correction."
                />
                <Field name="date" label="Date" type="date" defaultValue={today} />
              </div>
              <Field name="reference" label="Référence (facultatif)" required={false} maxLength={200} />
              <TextAreaField name="note" label="Note" hint="Obligatoire pour une correction." rows={2} />
              <SubmitButton>Enregistrer l&apos;opération</SubmitButton>
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Historique" />
        <ol className="divide-y divide-line">
          {(events ?? []).map((event) => {
            const detail = describe(event.type, (event.metadata ?? {}) as Record<string, unknown>);
            return (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-6 py-3 text-sm">
                <span>
                  <span className="font-medium text-ink">{EVENT_LABELS[event.type] ?? event.type}</span>
                  {detail ? <span className="text-ink-soft"> · {detail}</span> : null}
                </span>
                <span className="text-ink-faint">
                  {(event.actor_id && actors.get(event.actor_id)) || "Système"} ·{" "}
                  {timestamp.format(new Date(event.created_at))}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {canWrite && invoice.lifecycle === "draft" ? (
        <Card>
          <CardHeader title="Brouillon" description="Finaliser la facture la fait entrer dans le suivi." />
          <CardBody>
            <ActionForm action={finalizeInvoice.bind(null, orgSlug, invoiceId)}>
              <SubmitButton>Finaliser la facture</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {canWrite && open && invoice.status !== "paid" ? (
        <Card>
          <CardHeader
            title="Suivi"
            description="Suspendre le suivi empêche toute relance automatique de cette facture."
          />
          <CardBody>
            {invoice.suspended_at ? (
              <ActionForm action={resumeInvoice.bind(null, orgSlug, invoiceId)}>
                <SubmitButton variant="secondary">Reprendre le suivi</SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={suspendInvoice.bind(null, orgSlug, invoiceId)}>
                <Field name="reason" label="Motif de la suspension" maxLength={500} />
                <SubmitButton variant="secondary">Suspendre le suivi</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      {canWrite && invoice.lifecycle !== "cancelled" && invoice.paid_minor === 0 ? (
        <Card>
          <CardHeader
            title="Annuler la facture"
            description="Action définitive : une facture annulée sort du suivi et ne peut pas être rouverte."
          />
          <CardBody>
            <ActionForm action={cancelInvoice.bind(null, orgSlug, invoiceId)}>
              <Field name="reason" label="Motif de l'annulation" maxLength={500} />
              <CheckboxField name="confirm" label="Je confirme l'annulation définitive de cette facture." />
              <SubmitButton variant="danger">Annuler la facture</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
