import Link from "next/link";
import { ActionForm, Field, SelectField, SubmitButton, TextAreaField } from "@/components/forms/action-form";
import type { FormState } from "@/lib/validation/schemas";

export type CustomerValues = {
  name?: string | null;
  trade_name?: string | null;
  billing_email?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  language?: string | null;
  external_id?: string | null;
  notes?: string | null;
};

const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
];

export function CustomerForm({
  action,
  values = {},
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values?: CustomerValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const text = (value: string | null | undefined) => value ?? undefined;

  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Raison sociale" defaultValue={text(values.name)} maxLength={200} />
        <Field name="trade_name" label="Nom commercial" required={false} defaultValue={text(values.trade_name)} maxLength={200} />
        <Field
          name="billing_email"
          label="Email de facturation"
          type="email"
          required={false}
          defaultValue={text(values.billing_email)}
          hint="Adresse à laquelle seront envoyées les relances."
        />
        <Field name="contact_name" label="Contact" required={false} defaultValue={text(values.contact_name)} maxLength={200} />
        <Field name="phone" label="Téléphone" required={false} defaultValue={text(values.phone)} maxLength={50} />
        <Field
          name="country"
          label="Pays"
          required={false}
          defaultValue={text(values.country) ?? "FR"}
          maxLength={2}
          hint="Code sur 2 lettres : FR, BE, LU…"
        />
        <SelectField name="language" label="Langue des relances" options={LANGUAGES} defaultValue={values.language ?? "fr"} />
        <Field
          name="external_id"
          label="Identifiant externe"
          required={false}
          defaultValue={text(values.external_id)}
          hint="Code client dans votre logiciel comptable, s'il existe."
        />
      </div>
      <TextAreaField name="address" label="Adresse" defaultValue={text(values.address)} rows={2} />
      <TextAreaField name="notes" label="Notes internes" defaultValue={text(values.notes)} />
      <div className="flex items-center gap-4 pt-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="text-sm text-ink-soft hover:underline">
          Annuler
        </Link>
      </div>
    </ActionForm>
  );
}
