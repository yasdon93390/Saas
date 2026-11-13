import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold text-ink">Créer un compte</h1>
      <ActionForm action={signUp}>
        <Field name="displayName" label="Votre nom" autoComplete="name" />
        <Field name="email" label="Adresse email professionnelle" type="email" autoComplete="email" />
        <Field
          name="password"
          label="Mot de passe"
          type="password"
          autoComplete="new-password"
          hint="12 caractères minimum."
        />
        <SubmitButton className="w-full">Créer mon compte</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm text-ink-soft">
        Déjà inscrit ?{" "}
        <Link href="/login" className="text-action hover:underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
