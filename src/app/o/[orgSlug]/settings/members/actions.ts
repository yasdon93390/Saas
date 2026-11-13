"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/context";
import { errorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import {
  changeRoleSchema,
  fieldErrors,
  inviteMemberSchema,
  memberIdSchema,
  setDisabledSchema,
  type FormState,
} from "@/lib/validation/schemas";

/*
 * Chaque action suit le même ordre :
 *   1. vérifier l'appartenance à l'organisation et la permission ;
 *   2. valider les données reçues ;
 *   3. appeler la fonction SQL, qui revérifie les règles et écrit l'audit.
 */

export async function inviteMember(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "members.manage");
  if (!auth.ok) return { error: auth.error };

  const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", {
    p_org: auth.context.organization.id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) {
    return { error: errorMessage(error, { conflict: "Cette personne est déjà membre de l'organisation." }) };
  }

  revalidatePath(`/o/${orgSlug}/settings/members`);
  return {
    success: `Invitation enregistrée pour ${parsed.data.email}. Demandez-lui de créer un compte avec cette adresse : l'invitation l'attendra à sa première connexion.`,
  };
}

export async function changeMemberRole(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "members.manage");
  if (!auth.ok) return { error: auth.error };

  const parsed = changeRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Demande invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_member_role", {
    p_member_id: parsed.data.memberId,
    p_role: parsed.data.role,
  });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/settings/members`);
  return {};
}

export async function setMemberDisabled(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "members.manage");
  if (!auth.ok) return { error: auth.error };

  const parsed = setDisabledSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Demande invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_disabled", {
    p_member_id: parsed.data.memberId,
    p_disabled: parsed.data.disabled === "true",
  });
  if (error) {
    return {
      error: errorMessage(error, {
        invalid: "Impossible : l'organisation doit conserver au moins un propriétaire actif.",
      }),
    };
  }

  revalidatePath(`/o/${orgSlug}/settings/members`);
  return {};
}

export async function revokeInvitation(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "members.manage");
  if (!auth.ok) return { error: auth.error };

  const parsed = memberIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Demande invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_member_id: parsed.data.memberId });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/settings/members`);
  return {};
}
