import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton } from "@/components/forms/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createInvoice } from "../actions";

export const metadata: Metadata = { title: "Nouvelle facture" };

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ customer?: string }>;
}) {
  const { orgSlug } = await params;
  const { customer: preselected } = await searchParams;
  const context = await requireOrgContext(orgSlug, "data.write");

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("status", "active")
    .order("name")
    .limit(1000);

  if (!customers || customers.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <EmptyState
            title="Créez d'abord un client."
            action={
              <Link href={`/o/${orgSlug}/customers/new`} className={buttonClass("primary")}>
                Nouveau client
              </Link>
            }
          >
            Une facture est toujours rattachée à un client.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: context.organization.timezone }).format(new Date());
  const options = customers.map((customer) => ({ value: customer.id, label: customer.name }));
  const selected = customers.some((customer) => customer.id === preselected) ? preselected : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader
          title="Nouvelle facture"
          description={`Montant en ${context.organization.defaultCurrency}. Une fois créée, le montant ne se modifie plus : il se corrige par un avoir.`}
        />
        <CardBody>
          <ActionForm action={createInvoice.bind(null, orgSlug)}>
            {/* Clé unique générée à l'affichage : un double clic ne crée pas deux factures. */}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <SelectField name="customer_id" label="Client" options={options} defaultValue={selected} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="number" label="Numéro de facture" maxLength={100} />
              <Field
                name="total"
                label="Montant total TTC"
                inputMode="decimal"
                placeholder="1 234,56"
                hint="Exemple : 1 234,56"
              />
              <Field name="issue_date" label="Date d'émission" type="date" defaultValue={today} />
              <Field name="due_date" label="Date d'échéance" type="date" />
            </div>
            <Field
              name="recipient_email"
              label="Email destinataire (facultatif)"
              type="email"
              required={false}
              hint="Laissé vide, l'email de facturation du client sera utilisé."
            />
            <CheckboxField name="draft" label="Enregistrer comme brouillon (facture non suivie pour l'instant)" />
            <div className="flex items-center gap-4 pt-2">
              <SubmitButton>Créer la facture</SubmitButton>
              <Link href={`/o/${orgSlug}/invoices`} className="text-sm text-ink-soft hover:underline">
                Annuler
              </Link>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
