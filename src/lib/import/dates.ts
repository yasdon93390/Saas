export type DateFormat = "DMY" | "YMD" | "MDY";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  DMY: "Jour / mois / année (31/01/2026)",
  YMD: "Année - mois - jour (2026-01-31)",
  MDY: "Mois / jour / année (01/31/2026)",
};

export type DateResult = { ok: true; iso: string } | { ok: false; error: string };

/**
 * Lit une date selon le format CHOISI par l'utilisateur — jamais deviné :
 * « 03/04/2026 » est le 3 avril ou le 4 mars selon le fichier.
 * Renvoie une date ISO (AAAA-MM-JJ) et refuse les dates impossibles (31/02).
 */
export function parseDate(input: string, format: DateFormat): DateResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Date manquante." };

  const parts = text.split(/[/.\-]/);
  if (parts.length !== 3 || parts.some((part) => !/^\d{1,4}$/.test(part))) {
    return { ok: false, error: `Date illisible « ${text} ».` };
  }
  const [a, b, c] = parts.map((part) => Number.parseInt(part, 10));
  const [year, month, day] = format === "DMY" ? [c, b, a] : format === "MDY" ? [c, a, b] : [a, b, c];
  const yearText = format === "YMD" ? parts[0] : parts[2];

  if (yearText.length !== 4) return { ok: false, error: `Année sur 4 chiffres attendue dans « ${text} ».` };
  if (year < 1990 || year > 2100) return { ok: false, error: `Année hors limites dans « ${text} ».` };

  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!real) {
    return { ok: false, error: `Date invalide « ${text} » pour le format ${DATE_FORMAT_LABELS[format]}.` };
  }
  return { ok: true, iso: date.toISOString().slice(0, 10) };
}

/** « 2026-01-31 » → « 31/01/2026 », sans passer par un fuseau horaire. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
