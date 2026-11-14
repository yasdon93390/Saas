import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Modifier le client" };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; customerId: string }>;
}) {
  const { orgSlug, customerId } = await params;
  const context = await requireOrgContext(orgSlug, "data.write");
  if (!z.uuid().safeParse(customerId).success) notFound();

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("name, trade_name, billing_email, contact_name, phone, address, country, language, external_id, notes")
    .eq("organization_id", context.organization.id)
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader title={`Modifier ${customer.name}`} />
        <CardBody>
          <CustomerForm
            action={updateCustomer.bind(null, orgSlug, customerId)}
            values={customer}
            submitLabel="Enregistrer"
            cancelHref={`/o/${orgSlug}/customers/${customerId}`}
          />
        </CardBody>
      </Card>
    </div>
  );
}
