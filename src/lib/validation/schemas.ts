import { z } from "zod";
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
