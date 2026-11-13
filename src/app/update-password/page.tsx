import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { requireUser } from "@/lib/auth/context";
import { updatePassword } from "../(auth)/actions";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function UpdatePasswordPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-5 text-xl font-semibold text-ink">Nouveau mot de passe</h1>
        <ActionForm action={updatePassword}>
          <Field
            name="password"
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            hint="12 caractères minimum."
          />
          <SubmitButton className="w-full">Enregistrer</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
