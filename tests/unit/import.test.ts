import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell, detectDelimiter, parseCsv, toCsv } from "@/lib/csv";
import { formatDate, parseDate } from "@/lib/import/dates";
import { analyzeImport, guessMapping, type ImportSettings } from "@/lib/import/invoices";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

function settingsFor(text: string): ImportSettings {
  const delimiter = detectDelimiter(text);
  const headers = text.split(/\r?\n/, 1)[0].split(delimiter);
  return { delimiter, dateFormat: "DMY", decimalStyle: "auto", mapping: guessMapping(headers) };
}

const analyze = (name: string) => {
  const text = fixture(name);
  return analyzeImport(text, settingsFor(text), "EUR");
};

describe("lecture CSV", () => {
  it("détecte le séparateur", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a;b",c,d')).toBe(",");
  });

  it("gère guillemets, guillemets doublés, retours à la ligne, BOM et fins de ligne Windows", () => {
    const table = parseCsv('﻿nom;note\r\n"Durand; Petit";"dit ""le grand"""\r\n"sur\ndeux lignes";x\r\n\r\n', ";");
    expect(table.headers).toEqual(["nom", "note"]);
    expect(table.rows).toEqual([
      { number: 2, cells: ["Durand; Petit", 'dit "le grand"'] },
      { number: 3, cells: ["sur\ndeux lignes", "x"] },
    ]);
  });

  it("refuse fichier vide, en-tête en double et guillemet non refermé", () => {
    expect(() => parseCsv("", ";")).toThrow("vide");
    expect(() => parseCsv("a;A\n1;2", ";")).toThrow("même nom");
    expect(() => parseCsv('a;b\n"1;2', ";")).toThrow("jamais refermé");
  });
});

describe("dates", () => {
  it("applique le format choisi, sans deviner", () => {
    expect(parseDate("03/04/2026", "DMY")).toEqual({ ok: true, iso: "2026-04-03" });
    expect(parseDate("03/04/2026", "MDY")).toEqual({ ok: true, iso: "2026-03-04" });
    expect(parseDate("2026-04-03", "YMD")).toEqual({ ok: true, iso: "2026-04-03" });
    expect(parseDate("3.4.2026", "DMY")).toEqual({ ok: true, iso: "2026-04-03" });
  });

  it.each(["31/02/2026", "29/02/2025", "00/01/2026", "12/13/2026", "05/01/26", "hier", "", "2026-01-05"])(
    "refuse %j au format jour/mois/année",
    (input) => {
      expect(parseDate(input, "DMY").ok).toBe(false);
    },
  );

  it("accepte le 29 février d'une année bissextile", () => {
    expect(parseDate("29/02/2028", "DMY")).toEqual({ ok: true, iso: "2028-02-29" });
  });

  it("affiche une date ISO au format français", () => {
    expect(formatDate("2026-01-31")).toBe("31/01/2026");
  });
});

describe("correspondance des colonnes", () => {
  it("reconnaît les en-têtes français usuels", () => {
    expect(guessMapping(["Numéro", "Client", "Date facture", "Échéance", "Montant TTC", "Déjà payé", "Email"])).toEqual({
      number: "Numéro",
      customer_name: "Client",
      issue_date: "Date facture",
      due_date: "Échéance",
      total: "Montant TTC",
      paid: "Déjà payé",
      recipient_email: "Email",
    });
  });
});

describe("contrôle d'un fichier — les quatre cas du cahier des charges", () => {
  it("CSV valide : toutes les lignes passent, montants exacts", () => {
    const result = analyze("factures-valides.csv");
    if (!result.ok) throw new Error(result.error);
    expect(result.rejected).toEqual([]);
    expect(result.valid.map((row) => [row.number, row.total_minor, row.paid_minor])).toEqual([
      ["FA-2026-001", 123456, 0],
      ["FA-2026-002", 48000, 20000],
      ["FA-2026-003", 1250000, 1250000],
      ["FA-2026-004", 8990, 0],
    ]);
    expect(result.valid[3].customer_name).toBe("Durand, Petit & Associés");
    expect(result.valid[0]).toMatchObject({ issue_date: "2026-01-05", due_date: "2026-02-04", currency: "EUR" });
  });

  it("CSV avec doublons : la seconde occurrence est refusée et renvoie à la première", () => {
    const result = analyze("factures-doublons.csv");
    if (!result.ok) throw new Error(result.error);
    expect(result.valid.map((row) => row.number)).toEqual(["FA-2026-010", "FA-2026-011"]);
    expect(result.rejected.map((row) => [row.row_number, row.messages[0]])).toEqual([
      [4, "Numéro de facture déjà présent ligne 2 du même fichier."],
      [5, "Numéro de facture déjà présent ligne 3 du même fichier."],
    ]);
  });

  it("CSV mal formé : refus global avec un message clair, rien n'est importé", () => {
    const result = analyze("factures-mal-forme.csv");
    expect(result).toEqual({ ok: false, error: "Guillemet ouvert ligne 2 et jamais refermé." });
  });

  it("CSV avec dates ou montants invalides : chaque ligne fautive est expliquée", () => {
    const result = analyze("factures-invalides.csv");
    if (!result.ok) throw new Error(result.error);
    expect(result.valid.map((row) => row.number)).toEqual(["FA-2026-041"]);
    const reasons = Object.fromEntries(result.rejected.map((row) => [row.row_number, row.messages.join(" ")]));
    expect(reasons[2]).toContain("Date invalide");
    expect(reasons[3]).toContain("L'échéance précède");
    expect(reasons[4]).toContain("caractères inattendus");
    expect(reasons[5]).toContain("ambigu");
    expect(reasons[6]).toContain("dépasse le montant total");
    expect(reasons[7]).toContain("négatif");
    expect(reasons[8]).toContain("Numéro de facture manquant");
    expect(reasons[9]).toContain("Client manquant");
    expect(reasons[10]).toContain("email invalide");
    expect(reasons[11]).toContain("supérieur à zéro");
    expect(reasons[12]).toContain("ambigu");
    expect(result.rejected).toHaveLength(11);
  });

  it("est déterministe : deux analyses du même fichier donnent le même résultat", () => {
    expect(analyze("factures-valides.csv")).toEqual(analyze("factures-valides.csv"));
  });

  it("refuse une colonne obligatoire non associée, une devise étrangère et un fichier sans données", () => {
    const text = fixture("factures-valides.csv");
    const settings = settingsFor(text);
    expect(analyzeImport(text, { ...settings, mapping: { ...settings.mapping, total: undefined } }, "EUR")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Montant total"),
    });
    const usd = analyzeImport(text, settings, "USD");
    expect(usd.ok && usd.rejected.length).toBe(4);
    expect(analyzeImport("Numéro;Client\n", settings, "EUR")).toMatchObject({ ok: false });
  });
});

describe("export CSV", () => {
  it("neutralise les cellules qu'un tableur exécuterait comme formule", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+33123456789")).toBe("'+33123456789");
    expect(csvCell("-12")).toBe("'-12");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("Dupont SARL")).toBe("Dupont SARL");
  });

  it("produit un fichier relisible à l'identique", () => {
    const csv = toCsv(["Ligne", "Motif"], [[4, 'Client "X"; ambigu'], [5, "sur\ndeux lignes"]]);
    expect(parseCsv(csv, ";").rows.map((row) => row.cells)).toEqual([
      ["4", 'Client "X"; ambigu'],
      ["5", "sur\ndeux lignes"],
    ]);
  });
});
