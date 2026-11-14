import { z } from "zod";
import { CsvError, parseCsv, type Delimiter } from "@/lib/csv";
import { parseAmount, type DecimalStyle } from "@/lib/money";
import { parseDate, type DateFormat } from "./dates";

/** Limites de l'import. La base applique la même limite de lignes. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export const IMPORT_FIELDS = [
  { key: "number", label: "Numéro de facture", required: true, hints: ["numero", "n°", "facture", "reference", "ref", "invoice", "number"] },
  { key: "customer_name", label: "Client (raison sociale)", required: true, hints: ["client", "raison sociale", "societe", "customer", "nom"] },
  { key: "issue_date", label: "Date d'émission", required: true, hints: ["emission", "date facture", "issue", "date"] },
  { key: "due_date", label: "Date d'échéance", required: true, hints: ["echeance", "due"] },
  { key: "total", label: "Montant total TTC", required: true, hints: ["total", "ttc", "montant", "amount"] },
  { key: "paid", label: "Montant déjà payé", required: false, hints: ["paye", "regle", "paid", "encaisse"] },
  { key: "currency", label: "Devise", required: false, hints: ["devise", "currency"] },
  { key: "recipient_email", label: "Email destinataire", required: false, hints: ["email", "mail", "courriel"] },
  { key: "customer_external_id", label: "Identifiant client externe", required: false, hints: ["code client", "id client", "compte client", "customer id"] },
  { key: "external_id", label: "Identifiant facture externe", required: false, hints: ["id facture", "identifiant", "external"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

export const importSettingsSchema = z.object({
  delimiter: z.enum([",", ";", "\t"]),
  dateFormat: z.enum(["DMY", "YMD", "MDY"]),
  decimalStyle: z.enum(["auto", "comma", "dot"]),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS.map((field) => field.key)), z.string().max(200)),
});

export type ImportSettings = {
  delimiter: Delimiter;
  dateFormat: DateFormat;
  decimalStyle: DecimalStyle;
  mapping: ColumnMapping;
};

export type ValidRow = {
  row_number: number;
  number: string;
  customer_name: string;
  customer_external_id: string | null;
  customer_email: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  recipient_email: string | null;
  external_id: string | null;
  raw: Record<string, string>;
};

export type RejectedRow = { row_number: number; messages: string[]; raw: Record<string, string> };

export type ImportAnalysis =
  | { ok: false; error: string }
  | { ok: true; headers: string[]; totalRows: number; valid: ValidRow[]; rejected: RejectedRow[] };

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9°]+/g, " ").trim();

/** Propose une correspondance colonnes → champs à partir des noms d'en-tête. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const match = headers.find(
      (header) => !taken.has(header) && field.hints.some((hint) => normalize(header).includes(normalize(hint))),
    );
    if (match) {
      mapping[field.key] = match;
      taken.add(match);
    }
  }
  return mapping;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Contrôle un fichier ligne par ligne, sans rien écrire. Fonction pure :
 * mêmes entrées, même résultat. Elle sert à la vérification avant import ET à
 * l'import lui-même, qui ne fait donc jamais confiance au navigateur.
 */
export function analyzeImport(text: string, settings: ImportSettings, defaultCurrency: string): ImportAnalysis {
  let table;
  try {
    table = parseCsv(text, settings.delimiter);
  } catch (error) {
    return { ok: false, error: error instanceof CsvError ? error.message : "Fichier illisible." };
  }
  if (table.rows.length === 0) return { ok: false, error: "Le fichier ne contient aucune ligne de données." };
  if (table.rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `Le fichier dépasse ${MAX_IMPORT_ROWS} lignes. Découpez-le en plusieurs fichiers.` };
  }

  const index: Partial<Record<ImportFieldKey, number>> = {};
  for (const field of IMPORT_FIELDS) {
    const header = settings.mapping[field.key];
    if (!header) {
      if (field.required) return { ok: false, error: `Aucune colonne n'est associée au champ « ${field.label} ».` };
      continue;
    }
    const position = table.headers.indexOf(header);
    if (position === -1) return { ok: false, error: `La colonne « ${header} » n'existe pas dans le fichier.` };
    index[field.key] = position;
  }

  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];
  const seenNumbers = new Map<string, number>();

  for (const row of table.rows) {
    const raw = Object.fromEntries(table.headers.map((header, i) => [header, row.cells[i] ?? ""]));
    const messages: string[] = [];
    const cell = (key: ImportFieldKey) => (index[key] === undefined ? "" : (row.cells[index[key]] ?? "").trim());

    if (row.cells.length !== table.headers.length) {
      messages.push(`La ligne compte ${row.cells.length} colonnes au lieu de ${table.headers.length}.`);
    }

    const number = cell("number");
    if (number === "") messages.push("Numéro de facture manquant.");
    else if (number.length > 100) messages.push("Numéro de facture trop long (100 caractères maximum).");

    const customerName = cell("customer_name");
    if (customerName === "") messages.push("Client manquant.");
    else if (customerName.length > 200) messages.push("Nom du client trop long (200 caractères maximum).");

    const issue = parseDate(cell("issue_date"), settings.dateFormat);
    if (!issue.ok) messages.push(`Date d'émission : ${issue.error}`);
    const due = parseDate(cell("due_date"), settings.dateFormat);
    if (!due.ok) messages.push(`Date d'échéance : ${due.error}`);
    if (issue.ok && due.ok && due.iso < issue.iso) messages.push("L'échéance précède la date d'émission.");

    const currency = (cell("currency") || defaultCurrency).toUpperCase();
    if (currency !== "EUR") messages.push(`Devise non prise en charge : ${currency}. Seul l'euro est accepté pour l'instant.`);

    const total = parseAmount(cell("total"), settings.decimalStyle);
    if (!total.ok) messages.push(`Montant total : ${total.error}`);
    else if (total.minor === 0) messages.push("Le montant total doit être supérieur à zéro.");

    const paidText = cell("paid");
    const paid = paidText === "" ? ({ ok: true, minor: 0 } as const) : parseAmount(paidText, settings.decimalStyle);
    if (!paid.ok) messages.push(`Montant payé : ${paid.error}`);
    if (total.ok && paid.ok && paid.minor > total.minor) messages.push("Le montant payé dépasse le montant total.");

    const email = cell("recipient_email").toLowerCase();
    if (email !== "" && (!EMAIL.test(email) || email.length > 254)) messages.push(`Adresse email invalide « ${email} ».`);

    if (number !== "") {
      const first = seenNumbers.get(number);
      if (first !== undefined) messages.push(`Numéro de facture déjà présent ligne ${first} du même fichier.`);
      else seenNumbers.set(number, row.number);
    }

    if (messages.length > 0 || !issue.ok || !due.ok || !total.ok || !paid.ok) {
      rejected.push({ row_number: row.number, messages, raw });
      continue;
    }

    valid.push({
      row_number: row.number,
      number,
      customer_name: customerName,
      customer_external_id: cell("customer_external_id") || null,
      customer_email: email || null,
      issue_date: issue.iso,
      due_date: due.iso,
      currency,
      total_minor: total.minor,
      paid_minor: paid.minor,
      recipient_email: email || null,
      external_id: cell("external_id") || null,
      raw,
    });
  }

  return { ok: true, headers: table.headers, totalRows: table.rows.length, valid, rejected };
}
