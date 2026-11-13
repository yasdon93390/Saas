/**
 * Traduit les codes d'erreur renvoyés par les fonctions SQL (voir la migration
 * de la phase 1) en messages compréhensibles. Le détail technique n'est jamais
 * montré à l'utilisateur.
 */
export type ActionErrorKind = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "internal";

const KIND_BY_CODE: Record<string, ActionErrorKind> = {
  "28000": "unauthenticated",
  "42501": "forbidden",
  P0002: "not_found",
  "23505": "conflict",
  "22023": "invalid",
  "23514": "invalid",
  "22P02": "invalid",
};

const DEFAULT_MESSAGES: Record<ActionErrorKind, string> = {
  unauthenticated: "Votre session a expiré. Reconnectez-vous.",
  forbidden: "Vous n'avez pas la permission d'effectuer cette action.",
  not_found: "Élément introuvable.",
  conflict: "Cette opération entre en conflit avec des données existantes.",
  invalid: "Les données envoyées ne sont pas valides.",
  internal: "Une erreur est survenue. Réessayez dans un instant.",
};

export function errorKind(error: { code?: string } | null | undefined): ActionErrorKind {
  return (error?.code && KIND_BY_CODE[error.code]) || "internal";
}

export function errorMessage(
  error: { code?: string } | null | undefined,
  overrides: Partial<Record<ActionErrorKind, string>> = {},
): string {
  const kind = errorKind(error);
  return overrides[kind] ?? DEFAULT_MESSAGES[kind];
}
