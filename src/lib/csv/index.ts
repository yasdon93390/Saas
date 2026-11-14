/**
 * Lecture et écriture de fichiers CSV (RFC 4180) : guillemets, guillemets
 * doublés, retours à la ligne dans une cellule, fins de ligne Windows ou Unix.
 * Ce module ne dépend de rien : il sert à l'aperçu dans le navigateur comme au
 * contrôle côté serveur.
 */
export type Delimiter = "," | ";" | "\t";

export const DELIMITER_LABELS: Record<Delimiter, string> = {
  ";": "Point-virgule ( ; )",
  ",": "Virgule ( , )",
  "\t": "Tabulation",
};

export type CsvTable = { headers: string[]; rows: { number: number; cells: string[] }[] };

export class CsvError extends Error {}

/** Choisit le séparateur le plus fréquent sur la première ligne, hors guillemets. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<Delimiter, number> = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char as Delimiter] += 1;
  }
  return (Object.entries(counts) as [Delimiter, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Découpe le texte en lignes et cellules. `number` est le numéro de ligne
 * dans le fichier d'origine (la ligne d'en-tête est la ligne 1).
 */
export function parseCsv(text: string, delimiter: Delimiter): CsvTable {
  const input = text.replace(/^﻿/, "");
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    cell = "";
    if (cells.some((value) => value.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new CsvError(`Guillemet ouvert ligne ${recordLine} et jamais refermé.`);
  if (cell !== "" || cells.length > 0) endRecord();

  if (records.length === 0) throw new CsvError("Le fichier est vide.");
  const headers = records[0].cells.map((header) => header.trim());
  if (headers.some((header) => header === "")) throw new CsvError("La ligne d'en-tête contient une colonne sans nom.");
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new CsvError("Deux colonnes portent le même nom dans la ligne d'en-tête.");
  }

  return {
    headers,
    rows: records.slice(1).map((record) => ({ number: record.line, cells: record.cells.map((value) => value.trim()) })),
  };
}

/**
 * Prépare une cellule pour l'export. Un tableur exécute comme formule toute
 * cellule commençant par = + - @ : on les neutralise par une apostrophe, pour
 * qu'une donnée importée ne puisse pas piéger la personne qui ouvre l'export.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Fichier CSV lisible par Excel en français : point-virgule et marque UTF-8. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
