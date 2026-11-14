/**
 * Montants — règles du projet :
 *   * un montant est un ENTIER en unités mineures (centimes pour l'euro) ;
 *   * on ne passe jamais par un nombre à virgule flottante : la lecture se fait
 *     caractère par caractère, sur du texte ;
 *   * une saisie ambiguë est refusée plutôt que devinée.
 */

/** Plafond identique à celui de la base : 100 milliards d'unités majeures. */
export const MAX_AMOUNT_MINOR = 10_000_000_000_000;

/** Nombre de décimales par devise. Seul l'euro est pris en charge au MVP. */
const EXPONENTS: Record<string, number> = { EUR: 2 };

export type DecimalStyle = "auto" | "comma" | "dot";

export type AmountResult = { ok: true; minor: number } | { ok: false; error: string };

const fail = (error: string): AmountResult => ({ ok: false, error });

/**
 * Convertit un texte en unités mineures.
 *   "1 234,56" · "1234.56" · "1.234,56" · "1,234.56" · "1234,5" → 123456 / 123450
 *
 * En mode "auto", "1.234" ou "1,234" est refusé : impossible de savoir s'il
 * s'agit de mille deux cent trente-quatre ou de un virgule deux cent trente-quatre.
 */
export function parseAmount(input: string, style: DecimalStyle = "auto", currency = "EUR"): AmountResult {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) return fail(`Devise non prise en charge : ${currency}.`);

  // Espaces (y compris insécables), symbole et code de devise.
  let text = input.replace(/[\s   ']/g, "").replace(/€|EUR/gi, "");
  if (text === "") return fail("Montant manquant.");
  if (text.startsWith("+")) text = text.slice(1);
  if (text.startsWith("-") || text.startsWith("(")) return fail("Un montant négatif n'est pas accepté ici.");
  if (!/^[0-9.,]+$/.test(text)) return fail("Le montant contient des caractères inattendus.");
  if (!/[0-9]/.test(text)) return fail("Montant illisible.");

  const dots = text.split(".").length - 1;
  const commas = text.split(",").length - 1;
  let decimalSeparator: "." | "," | null = null;

  if (style === "comma" || style === "dot") {
    decimalSeparator = style === "comma" ? "," : ".";
    if ((style === "comma" ? commas : dots) > 1) return fail("Plusieurs séparateurs décimaux.");
    if ((style === "comma" ? commas : dots) === 0) decimalSeparator = null;
  } else if (dots > 0 && commas > 0) {
    // Les deux sont présents : le dernier rencontré est le séparateur décimal.
    decimalSeparator = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    if ((decimalSeparator === "." ? dots : commas) > 1) return fail("Séparateurs incohérents.");
  } else if (dots + commas === 1) {
    const separator = dots === 1 ? "." : ",";
    const [whole, fraction] = text.split(separator);
    if (fraction.length === 3 && whole.length >= 1 && whole.length <= 3) {
      return fail(
        `Montant ambigu « ${input.trim()} » : précisez le séparateur décimal (virgule ou point) dans les options d'import.`,
      );
    }
    decimalSeparator = separator;
  }
  // Sinon : un même séparateur répété → séparateur de milliers.

  const thousandsSeparator = decimalSeparator === "." ? "," : decimalSeparator === "," ? "." : dots > 0 ? "." : ",";
  const [wholePart, fractionPart = ""] = decimalSeparator ? text.split(decimalSeparator) : [text];

  if (wholePart.includes(thousandsSeparator)) {
    const groups = wholePart.split(thousandsSeparator);
    const valid = groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every((group) => group.length === 3);
    if (!valid) return fail("Séparateurs de milliers mal placés.");
  }
  const whole = wholePart.split(thousandsSeparator).join("");

  if (!/^[0-9]*$/.test(whole) || !/^[0-9]*$/.test(fractionPart)) return fail("Montant illisible.");
  if (whole === "" && fractionPart === "") return fail("Montant illisible.");
  if (fractionPart.length > exponent) return fail(`Trop de décimales : ${exponent} au maximum.`);

  const digits = (whole || "0") + fractionPart.padEnd(exponent, "0");
  if (digits.replace(/^0+/, "").length > 14) return fail("Montant trop élevé.");

  // Conversion d'une suite de chiffres en entier : aucune virgule flottante en jeu.
  const minor = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return fail("Montant trop élevé.");
  return { ok: true, minor };
}

/** 123456 → « 1 234,56 € ». La mise en forme part de l'entier, par découpage de texte. */
export function formatMoney(minor: number, currency = "EUR"): string {
  const exponent = EXPONENTS[currency] ?? 2;
  if (!Number.isSafeInteger(minor)) return "—";
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = digits.slice(digits.length - exponent);
  const symbol = currency === "EUR" ? "€" : currency;
  return `${sign}${whole},${fraction} ${symbol}`;
}

/** 123456 → « 1234,56 » : valeur brute pour un export CSV. */
export function formatMinorPlain(minor: number, currency = "EUR"): string {
  const exponent = EXPONENTS[currency] ?? 2;
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0");
  return `${sign}${digits.slice(0, digits.length - exponent)},${digits.slice(digits.length - exponent)}`;
}
