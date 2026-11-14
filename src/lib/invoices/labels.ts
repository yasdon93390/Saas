import type { BadgeTone } from "@/components/ui/badge";

export const INVOICE_STATUSES = [
  "pending",
  "overdue",
  "partially_paid",
  "paid",
  "suspended",
  "disputed",
  "draft",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Le libellé porte l'information ; la couleur n'est qu'un renfort. */
export const STATUS_LABELS: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "À venir", tone: "info" },
  overdue: { label: "Échue", tone: "danger" },
  partially_paid: { label: "Partiellement payée", tone: "warning" },
  paid: { label: "Payée", tone: "success" },
  suspended: { label: "Suspendue", tone: "neutral" },
  disputed: { label: "Contestée", tone: "warning" },
  draft: { label: "Brouillon", tone: "neutral" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export const OPERATION_KINDS = ["payment", "credit_note", "correction"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_LABELS: Record<OperationKind, string> = {
  payment: "Paiement",
  credit_note: "Avoir",
  correction: "Correction",
};

export const EVENT_LABELS: Record<string, string> = {
  "invoice.created": "Facture créée",
  "invoice.imported": "Facture importée",
  "invoice.finalized": "Brouillon finalisé",
  "invoice.cancelled": "Facture annulée",
  "invoice.suspended": "Suivi suspendu",
  "invoice.resumed": "Suivi repris",
  "payment.recorded": "Opération enregistrée",
};
