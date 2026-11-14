import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth/context";
import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function NewCustomerPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await requireOrgContext(orgSlug, "data.write");

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader title="Nouveau client" />
        <CardBody>
          <CustomerForm
            action={createCustomer.bind(null, orgSlug)}
            submitLabel="Créer le client"
            cancelHref={`/o/${orgSlug}/customers`}
          />
        </CardBody>
      </Card>
    </div>
  );
}
