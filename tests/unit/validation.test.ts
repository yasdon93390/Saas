import { describe, expect, it } from "vitest";
import { errorKind } from "@/lib/db/errors";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  safeRedirectPath,
  signUpSchema,
  slugify,
} from "@/lib/validation/schemas";

describe("safeRedirectPath", () => {
  it("accepte les chemins internes", () => {
    expect(safeRedirectPath("/o/acme/settings/members")).toBe("/o/acme/settings/members");
  });

  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "javascript:alert(1)",
    "o/acme",
    "/o/acme\nSet-Cookie: x",
    "",
    null,
    undefined,
    42,
  ])("refuse %j et renvoie la destination par défaut", (value) => {
    expect(safeRedirectPath(value)).toBe("/organizations");
  });
});

describe("slugify", () => {
  it.each([
    ["Société Générale", "societe-generale"],
    ["  ACME & Fils (Lyon)  ", "acme-fils-lyon"],
    ["L'Atelier du 12", "l-atelier-du-12"],
  ])("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it("ne dépasse jamais 40 caractères et ne finit pas par un tiret", () => {
    const slug = slugify("a".repeat(39) + " bcd");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("schémas", () => {
  it("normalise l'email d'invitation et refuse un rôle inconnu", () => {
    expect(inviteMemberSchema.parse({ email: "  Nina@Acme.FR ", role: "finance" })).toEqual({
      email: "nina@acme.fr",
      role: "finance",
    });
    expect(inviteMemberSchema.safeParse({ email: "nina@acme.fr", role: "superadmin" }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: "pas-un-email", role: "viewer" }).success).toBe(false);
  });

  it("exige un mot de passe d'au moins 12 caractères", () => {
    const base = { displayName: "Nina", email: "nina@acme.fr" };
    expect(signUpSchema.safeParse({ ...base, password: "court" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "un mot de passe long" }).success).toBe(true);
  });

  it("refuse pays, devise, fuseau et identifiant hors liste", () => {
    const valid = { name: "Acme", slug: "acme", country: "FR", timezone: "Europe/Paris", currency: "EUR" };
    expect(createOrganizationSchema.safeParse(valid).success).toBe(true);
    for (const override of [{ country: "US" }, { currency: "USD" }, { timezone: "Mars/Olympus" }, { slug: "A B" }, { slug: "-a-" }]) {
      expect(createOrganizationSchema.safeParse({ ...valid, ...override }).success, JSON.stringify(override)).toBe(false);
    }
  });
});

describe("traduction des erreurs SQL", () => {
  it("associe chaque code à sa catégorie, et l'inconnu à une erreur interne", () => {
    expect(errorKind({ code: "42501" })).toBe("forbidden");
    expect(errorKind({ code: "P0002" })).toBe("not_found");
    expect(errorKind({ code: "23505" })).toBe("conflict");
    expect(errorKind({ code: "XX000" })).toBe("internal");
    expect(errorKind(null)).toBe("internal");
  });
});
