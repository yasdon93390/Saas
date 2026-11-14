"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/context";
import { errorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import {
  confirmedReasonSchema,
  fieldErrors,
  invoiceSchema,
  operationSchema,
  reasonSchema,
  type FormState,
} from "@/lib/validation/schemas";

const idSchema = z.uuid();

export async function createInvoice(orgSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };

  const parsed = invoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);
  const { total, draft, idempotencyKey, ...rest } = parsed.data;

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_invoice", {
    p_org: auth.context.organization.id,
    p_data: {
      ...rest,
      total_minor: total,
      currency: auth.context.organization.defaultCurrency,
      draft: draft === "true",
    },
    p_idempotency_key: idempotencyKey,
  });
  if (error || typeof id !== "string") {
    return {
      error: errorMessage(error, {
        conflict: "Une facture porte déjà ce numéro dans votre organisation.",
        not_found: "Client introuvable.",
        invalid: "Facture refusée : vérifiez le client (il ne doit pas être archivé), les dates et le montant.",
      }),
    };
  }
  revalidatePath(`/o/${orgSlug}/invoices`);
  redirect(`/o/${orgSlug}/invoices/${id}`);
}

export async function recordOperation(
  orgSlug: string,
  invoiceId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "payments.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(invoiceId).success) return { error: "Facture introuvable." };

  const parsed = operationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_invoice_operation", {
    p_invoice: invoiceId,
    p_kind: parsed.data.kind,
    p_amount_minor: parsed.data.amount,
    p_date: parsed.data.date,
    p_reference: parsed.data.reference,
    p_note: parsed.data.note,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return {
      error:
        error.code === "23514"
          ? "Opération refusée : le montant réglé ne peut ni dépasser le total de la facture, ni devenir négatif."
          : errorMessage(error, {
              invalid: "Opération refusée : la facture doit être ouverte et la date ne peut pas être dans le futur.",
            }),
    };
  }
  revalidatePath(`/o/${orgSlug}/invoices`, "layout");
  return { success: "Opération enregistrée." };
}

export async function cancelInvoice(
  orgSlug: string,
  invoiceId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(invoiceId).success) return { error: "Facture introuvable." };

  const parsed = confirmedReasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice: invoiceId, p_reason: parsed.data.reason });
  if (error) {
    return {
      error:
        error.code === "23514"
          ? "Cette facture porte des règlements. Annulez-les d'abord par une correction, puis annulez la facture."
          : errorMessage(error),
    };
  }
  revalidatePath(`/o/${orgSlug}/invoices`, "layout");
  return {};
}

export async function suspendInvoice(
  orgSlug: string,
  invoiceId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(invoiceId).success) return { error: "Facture introuvable." };

  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_invoice_suspended", {
    p_invoice: invoiceId,
    p_suspended: true,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/invoices`, "layout");
  return {};
}

export async function resumeInvoice(
  orgSlug: string,
  invoiceId: string,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(invoiceId).success) return { error: "Facture introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_invoice_suspended", {
    p_invoice: invoiceId,
    p_suspended: false,
    p_reason: null,
  });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/invoices`, "layout");
  return {};
}

export async function finalizeInvoice(
  orgSlug: string,
  invoiceId: string,
): Promise<FormState> {
  const auth = await authorizeAction(orgSlug, "data.write");
  if (!auth.ok) return { error: auth.error };
  if (!idSchema.safeParse(invoiceId).success) return { error: "Facture introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_invoice", { p_invoice: invoiceId });
  if (error) return { error: errorMessage(error) };

  revalidatePath(`/o/${orgSlug}/invoices`, "layout");
  return {};
}
