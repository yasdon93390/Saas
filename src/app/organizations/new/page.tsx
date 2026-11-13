import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/context";
import { createOrganization } from "../actions";

export const metadata: Metadata = { title: "Nouvelle organisation" };

const COUNTRIES = [
  { value: "FR", label: "France" },
  { value: "BE", label: "Belgique" },
  { value: "LU", label: "Luxembourg" },
];
const TIMEZONES = [
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Brussels", label: "Bruxelles" },
  { value: "Europe/Luxembourg", label: "Luxembourg" },
];
const CURRENCIES = [{ value: "EUR", label: "Euro (EUR)" }];

export default async function NewOrganizationPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Card>
        <CardHeader
          title="Créer une organisation"
          description="L'espace de travail de votre entreprise. Vous en serez le propriétaire."
        />
        <CardBody>
          <ActionForm action={createOrganization}>
            <Field name="name" label="Nom de l'entreprise" autoComplete="organization" />
            <Field
              name="slug"
              label="Identifiant dans l'adresse (facultatif)"
              required={false}
              placeholder="ma-societe"
              hint="Lettres minuscules, chiffres et tirets. Laissé vide, il est déduit du nom. Il ne pourra pas être modifié pour l'instant."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField name="country" label="Pays" options={COUNTRIES} />
              <SelectField name="timezone" label="Fuseau horaire" options={TIMEZONES} />
              <SelectField name="currency" label="Devise principale" options={CURRENCIES} />
            </div>
            <div className="flex items-center gap-4 pt-2">
              <SubmitButton>Créer l&apos;organisation</SubmitButton>
              <Link href="/organizations" className="text-sm text-ink-soft hover:underline">
                Annuler
              </Link>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </main>
  );
}
