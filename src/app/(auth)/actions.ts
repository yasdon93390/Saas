"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrors,
  forgotPasswordSchema,
  safeRedirectPath,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type FormState,
} from "@/lib/validation/schemas";

const callbackUrl = (next: string) =>
  `${env().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Confirmez d'abord votre adresse grâce au lien reçu par email." };
    }
    // Message identique que le compte existe ou non : on ne révèle rien.
    return { error: "Email ou mot de passe incorrect." };
  }
  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUp(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: callbackUrl("/organizations"),
    },
  });
  if (error) {
    if (error.code === "weak_password") {
      return { error: "Ce mot de passe est trop faible ou trop répandu. Choisissez-en un autre." };
    }
    if (error.status === 429) {
      return { error: "Trop de tentatives. Patientez quelques minutes." };
    }
    return { error: "Inscription impossible pour le moment. Réessayez dans un instant." };
  }
  // Même message si l'adresse est déjà inscrite.
  return {
    success: "Si cette adresse est valide, un email de confirmation vient d'être envoyé. Ouvrez-le pour activer votre compte.",
  };
}

export async function requestPasswordReset(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl("/update-password"),
  });
  return {
    success: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.",
  };
}

export async function updatePassword(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = updatePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") {
      return { error: "Ce mot de passe est trop faible ou trop répandu. Choisissez-en un autre." };
    }
    if (error.code === "same_password") {
      return { error: "Le nouveau mot de passe doit être différent de l'ancien." };
    }
    return { error: "Modification impossible. Redemandez un lien de réinitialisation." };
  }
  redirect("/organizations");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
