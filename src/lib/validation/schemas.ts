import { z } from "zod";
import { OPERATION_KINDS } from "@/lib/invoices/labels";
import { parseAmount } from "@/lib/money";
import { ROLES } from "@/lib/permissions";

/**
 * Schémas de validation des entrées. Toute donnée venant du navigateur passe
 * par l'un d'eux avant d'être utilisée par le serveur.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Adresse trop longue.")
  .pipe(z.email("Adresse email invalide."));

// 72 caractères : limite technique de l'algorithme de hachage utilisé par Supabase.
const password = z
  .string()
  .min(12, "12 caractères minimum.")
  .max(72, "72 caractères maximum.");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Mot de passe requis.").max(72),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Nom requis.").max(80, "80 caractères maximum."),
  email,
  password,
});

export const forgotPasswordSchema = z.object({ email });
export const updatePasswordSchema = z.object({ password });

export const SUPPORTED_COUNTRIES = ["FR", "BE", "LU"] as const;
export const SUPPORTED_CURRENCIES = ["EUR"] as const;
export const SUPPORTED_TIMEZONES = ["Europe/Paris", "Europe/Brussels", "Europe/Luxembourg"] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "3 à 40 caractères : lettres minuscules, chiffres et tirets.");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "2 caractères minimum.").max(120, "120 caractères maximum."),
  slug: slugSchema,
  country: z.enum(SUPPORTED_COUNTRIES, "Pays non pris en charge."),
  timezone: z.enum(SUPPORTED_TIMEZONES, "Fuseau horaire non pris en charge."),
  currency: z.enum(SUPPORTED_CURRENCIES, "Devise non prise en charge."),
});

export const inviteMemberSchema = z.object({
  email,
  role: z.enum(ROLES, "Rôle inconnu."),
});

export const memberIdSchema = z.object({ memberId: z.uuid() });
export const changeRoleSchema = memberIdSchema.extend({ role: z.enum(ROLES, "Rôle inconnu.") });
export const setDisabledSchema = memberIdSchema.extend({ disabled: z.enum(["true", "false"]) });

/** Propose un identifiant d'URL à partir d'un nom : « Société Générale » → « societe-generale ». */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * N'accepte qu'un chemin interne comme destination de redirection.
 * Empêche qu'un lien piégé renvoie l'utilisateur vers un site extérieur
 * après sa connexion.
 */
export function safeRedirectPath(value: unknown, fallback = "/organizations"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export function fieldErrors(error: z.ZodError): FormState {
  return {
    error: "Vérifiez les champs signalés.",
    fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[] | undefined>,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 : clients, factures, opérations
// ---------------------------------------------------------------------------
const optionalText = (max: number) =>
  z.string().trim().max(max, `${max} caractères maximum.`).optional().default("");

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Adresse trop longue.")
  .refine((value) => value === "" || z.email().safeParse(value).success, "Adresse email invalide.")
  .optional()
  .default("");

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Raison sociale requise.").max(200, "200 caractères maximum."),
  trade_name: optionalText(200),
  billing_email: optionalEmail,
  contact_name: optionalText(200),
  phone: optionalText(50),
  address: optionalText(500),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "" || /^[A-Z]{2}$/.test(value), "Code pays sur 2 lettres, par exemple FR.")
    .optional()
    .default(""),
  language: z.enum(["fr", "en"], "Langue non prise en charge."),
  external_id: optionalText(200),
  notes: optionalText(5000),
});

/** Date ISO (AAAA-MM-JJ) réelle, telle que renvoyée par un champ de type date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date requise.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date invalide.");

/** Montant saisi en texte, converti en centimes sans passer par un nombre flottant. */
const amountMinor = (options: { allowNegative?: boolean } = {}) =>
  z.string().transform((value, context) => {
    const text = value.trim();
    const negative = options.allowNegative === true && text.startsWith("-");
    const parsed = parseAmount(negative ? text.slice(1) : text);
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    if (parsed.minor === 0) {
      context.addIssue({ code: "custom", message: "Le montant doit être différent de zéro." });
      return z.NEVER;
    }
    return negative ? -parsed.minor : parsed.minor;
  });

export const invoiceSchema = z
  .object({
    customer_id: z.uuid("Choisissez un client."),
    number: z.string().trim().min(1, "Numéro requis.").max(100, "100 caractères maximum."),
    issue_date: isoDate,
    due_date: isoDate,
    total: amountMinor(),
    recipient_email: optionalEmail,
    draft: z.literal("true").optional(),
    idempotencyKey: z.uuid(),
  })
  .refine((data) => data.due_date >= data.issue_date, {
    path: ["due_date"],
    message: "L'échéance ne peut pas précéder la date d'émission.",
  });

export const operationSchema = z
  .object({
    kind: z.enum(OPERATION_KINDS, "Type d'opération inconnu."),
    amount: amountMinor({ allowNegative: true }),
    date: isoDate,
    reference: optionalText(200),
    note: optionalText(1000),
    idempotencyKey: z.uuid(),
  })
  .superRefine((data, context) => {
    if (data.kind !== "correction" && data.amount < 0) {
      context.addIssue({ code: "custom", path: ["amount"], message: "Un paiement ou un avoir est toujours positif." });
    }
    if (data.kind === "correction" && data.note === "") {
      context.addIssue({ code: "custom", path: ["note"], message: "Une correction doit être justifiée." });
    }
  });

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500, "500 caractères maximum."),
});

export const confirmedReasonSchema = reasonSchema.extend({
  confirm: z.literal("true", "Cochez la case pour confirmer."),
});
