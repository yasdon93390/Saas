import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-ink">Mot de passe oublié</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.
      </p>
      <ActionForm action={requestPasswordReset}>
        <Field name="email" label="Adresse email" type="email" autoComplete="email" />
        <SubmitButton className="w-full">Recevoir le lien</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm">
        <Link href="/login" className="text-action hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </>
  );
}
