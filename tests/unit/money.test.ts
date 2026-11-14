import { describe, expect, it } from "vitest";
import { formatMinorPlain, formatMoney, parseAmount } from "@/lib/money";

const ok = (minor: number) => ({ ok: true, minor });

describe("parseAmount — lecture exacte", () => {
  it.each([
    ["1 234,56", 123456],
    ["1234.56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1 234,56 €", 123456],
    ["1 234,56", 123456],
    ["EUR 1234,56", 123456],
    ["1234,5", 123450],
    ["1234", 123400],
    ["0,07", 7],
    [",5", 50],
    ["12.", 1200],
    ["1.234.567,89", 123456789],
    ["1,234,567.89", 123456789],
    ["1.234.567", 123456700],
    ["+42,00", 4200],
    ["0,10", 10],
    ["0,20", 20],
    ["0,30", 30],
    ["19,99", 1999],
    ["4,35", 435],
    ["1,15", 115],
    ["8,70", 870],
    ["99999999999,99", 9999999999999],
  ])("%j → %i centimes", (input, expected) => {
    expect(parseAmount(input)).toEqual(ok(expected));
  });

  it("0,1 + 0,2 = 0,3 exactement, là où les nombres flottants échouent", () => {
    const sum = [parseAmount("0,1"), parseAmount("0,2")].reduce((total, r) => total + (r.ok ? r.minor : NaN), 0);
    expect(sum).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe("parseAmount — refus plutôt que deviner", () => {
  it.each([
    ["1.234", "ambigu"],
    ["1,234", "ambigu"],
    ["", "manquant"],
    ["   ", "manquant"],
    ["-50,00", "négatif"],
    ["(50,00)", "négatif"],
    ["cent euros", "inattendus"],
    ["12,345", "ambigu"],
    ["10,999", "ambigu"],
    ["1,2345", "décimales"],
    ["1.23.45", "milliers"],
    ["12,34,56", "milliers"],
    ["1.2345,67", "milliers"],
    ["1e5", "inattendus"],
    ["0x10", "inattendus"],
    ["1,2,3.4.5", "incohérents"],
    [".", "illisible"],
    ["100000000000,01", "élevé"],
    ["999999999999999999", "élevé"],
  ])("%j est refusé (%s)", (input, reason) => {
    const result = parseAmount(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(reason);
  });

  it("le séparateur décimal explicite lève l'ambiguïté", () => {
    expect(parseAmount("1.234", "comma")).toEqual(ok(123400));
    expect(parseAmount("1,234", "dot")).toEqual(ok(123400));
    expect(parseAmount("1.234", "dot").ok).toBe(false); // 3 décimales
    expect(parseAmount("12,5", "comma")).toEqual(ok(1250));
    expect(parseAmount("1,2,5", "comma").ok).toBe(false);
  });

  it("refuse une devise non prise en charge", () => {
    expect(parseAmount("10", "auto", "JPY").ok).toBe(false);
  });
});

describe("mise en forme", () => {
  it.each([
    [123456, "1 234,56 €"],
    [7, "0,07 €"],
    [0, "0,00 €"],
    [100000000, "1 000 000,00 €"],
    [-4000, "-40,00 €"],
  ])("%i → %s", (minor, expected) => {
    expect(formatMoney(minor)).toBe(expected);
  });

  it("aller-retour : tout montant affiché se relit à l'identique", () => {
    for (const minor of [1, 9, 10, 99, 100, 101, 999, 12345, 999999, 123456789, 9999999999999]) {
      expect(parseAmount(formatMoney(minor))).toEqual(ok(minor));
      expect(parseAmount(formatMinorPlain(minor), "comma")).toEqual(ok(minor));
    }
  });
});
