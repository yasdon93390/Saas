import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/alert";
import { safeRedirectPath } from "@/lib/validation/schemas";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <>
      <h1 className="mb-5 text-xl font-semibold text-ink">Connexion</h1>
      {error === "link" ? (
        <div className="mb-4">
          <Alert tone="error">Ce lien est invalide ou a expiré. Demandez-en un nouveau.</Alert>
        </div>
      ) : null}
      <ActionForm action={signIn}>
        <input type="hidden" name="next" value={safeRedirectPath(next)} />
        <Field name="email" label="Adresse email" type="email" autoComplete="email" />
        <Field name="password" label="Mot de passe" type="password" autoComplete="current-password" />
        <SubmitButton className="w-full">Se connecter</SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-action hover:underline">
          Mot de passe oublié ?
        </Link>
        <Link href="/signup" className="text-action hover:underline">
          Créer un compte
        </Link>
      </div>
    </>
  );
}
