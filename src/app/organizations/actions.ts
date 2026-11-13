"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/context";
import { errorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import {
  createOrganizationSchema,
  fieldErrors,
  memberIdSchema,
  slugify,
  type FormState,
} from "@/lib/validation/schemas";

export async function createOrganization(_state: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { error: "Votre session a expiré. Reconnectez-vous." };

  const raw = Object.fromEntries(formData);
  // Identifiant laissé vide : on le déduit du nom.
  const slug = String(raw.slug ?? "").trim() || slugify(String(raw.name ?? ""));
  const parsed = createOrganizationSchema.safeParse({ ...raw, slug });
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_country: parsed.data.country,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
  });
  if (error) {
    return {
      error: errorMessage(error, {
        conflict: "Cet identifiant est déjà utilisé. Choisissez-en un autre.",
        forbidden: "Confirmez votre adresse email avant de créer une organisation.",
      }),
    };
  }
  redirect(`/o/${parsed.data.slug}`);
}

export async function acceptInvitation(_state: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { error: "Votre session a expiré. Reconnectez-vous." };

  const parsed = memberIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invitation invalide." };

  const supabase = await createClient();
  const { data: slug, error } = await supabase.rpc("accept_invitation", {
    p_member_id: parsed.data.memberId,
  });
  if (error || typeof slug !== "string") {
    return { error: errorMessage(error, { not_found: "Cette invitation n'est plus valable." }) };
  }
  redirect(`/o/${slug}`);
}
