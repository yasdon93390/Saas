"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/context";
import { errorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import { customerSchema, fieldErrors, reasonSchema, type FormState } from "@/lib/validation/schemas";

const idSchema = z.uuid();

export async function createCustomer(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };

  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_customer", {
    p_org: auth.context.organization.id,
    p_data: parsed.data,
  });
  if (error || typeof id !== "string") {
    return { error: errorMessage(error, { conflict: "Un client porte déjà cet identifiant externe." }) };
  }
  revalidatePath(`/o/${orgSlug}/customers`);
  redirect(`/o/${orgSlug}/customers/${id}`);
}

export async function updateCustomer(
  orgSlug: string,
  customerId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(customerId).success) return { error: "Client introuvable." };

  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_customer", { p_customer: customerId, p_data: parsed.data });
  if (error) {
    return { error: errorMessage(error, { conflict: "Un client porte déjà cet identifiant externe." }) };
  }
  revalidatePath(`/o/${orgSlug}/customers`);
  redirect(`/o/${orgSlug}/customers/${customerId}`);
}

export async function setCustomerArchived(
  orgSlug: string,
  customerId: string,
  archived: boolean,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(customerId).success) return { error: "Client introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_archived", { p_customer: customerId, p_archived: archived });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/customers`, "layout");
  return {};
}

export async function suspendCustomerReminders(
  orgSlug: string,
  customerId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(customerId).success) return { error: "Client introuvable." };

  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_reminders_suspended", {
    p_customer: customerId,
    p_suspended: true,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/customers`, "layout");
  return {};
}

export async function resumeCustomerReminders(
  orgSlug: string,
  customerId: string,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(customerId).success) return { error: "Client introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_reminders_suspended", {
    p_customer: customerId,
    p_suspended: false,
    p_reason: null,
  });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/customers`, "layout");
  return {};
}
