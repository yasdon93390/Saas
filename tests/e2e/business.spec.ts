import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createOrganization, RUN, signIn, signOut, signUp } from "./helpers";

/**
 * Parcours critiques de la phase 2 : clients, factures, règlements, import CSV.
 *   Diane (propriétaire) et Éric (lecture seule) chez Durand ; Fanny chez un concurrent.
 */
const diane = `diane-${RUN}@durand.test`;
const eric = `eric-${RUN}@durand.test`;
const fanny = `fanny-${RUN}@concurrent.test`;
const durand = `durand-${RUN}`;
const concurrent = `concurrent-${RUN}`;
const fixture = (name: string) => join(__dirname, "..", "fixtures", name);
let invoiceUrl = "";

test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/organizations$/);
}

async function recordOperation(page: Page, kind: string, amount: string, note = "") {
  await page.getByLabel("Type").selectOption(kind);
  await page.getByLabel("Montant", { exact: true }).fill(amount);
  if (note) await page.getByLabel("Note").fill(note);
  await page.getByRole("button", { name: "Enregistrer l'opération" }).click();
}

async function upload(page: Page, file: string) {
  await page.goto(`/o/${durand}/imports/new`);
  await page.getByLabel("Fichier CSV").setInputFiles(fixture(file));
}

test("mise en place : Diane crée Durand et invite Éric en lecture seule", async ({ page }) => {
  await signUp(page, "Diane", diane);
  await createOrganization(page, "Durand", durand);
  await page.goto(`/o/${durand}/settings/members`);
  await page.getByLabel("Adresse email").fill(eric);
  await page.getByLabel("Rôle", { exact: true }).selectOption("viewer");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation enregistrée");
  await signOut(page);

  await signUp(page, "Éric", eric);
  await page.getByRole("button", { name: "Rejoindre" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${durand}$`));
});

test("Diane crée un client, puis une facture au centime près", async ({ page }) => {
  await login(page, diane);
  await page.goto(`/o/${durand}/customers/new`);
  await page.getByLabel("Raison sociale").fill("Menuiserie Roux");
  await page.getByLabel("Email de facturation").fill("Compta@Menuiserie-Roux.test");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: "Menuiserie Roux" })).toBeVisible();
  await expect(page.getByText("compta@menuiserie-roux.test")).toBeVisible();

  await page.goto(`/o/${durand}/invoices/new`);
  await page.getByLabel("Client").selectOption({ label: "Menuiserie Roux" });
  await page.getByLabel("Numéro de facture").fill("FA-001");
  await page.getByLabel("Date d'échéance").fill("2099-12-31");

  // Une saisie ambiguë est refusée, et le formulaire conserve ce qui a été saisi.
  await page.getByLabel("Montant total TTC").fill("1.234");
  await page.getByRole("button", { name: "Créer la facture" }).click();
  await expect(page.getByText(/Montant ambigu/)).toBeVisible();
  await expect(page.getByLabel("Numéro de facture")).toHaveValue("FA-001");

  await page.getByLabel("Montant total TTC").fill("1 234,56");
  await page.getByRole("button", { name: "Créer la facture" }).click();
  await expect(page.getByRole("heading", { name: "Facture FA-001" })).toBeVisible();
  await expect(page.getByText("À venir")).toBeVisible();
  await expect(page.getByText(/^1\s234,56\s€$/)).toHaveCount(2); // total et reste dû
  invoiceUrl = new URL(page.url()).pathname;
});

test("paiement partiel, trop-perçu refusé, correction, puis solde", async ({ page }) => {
  await login(page, diane);
  await page.goto(invoiceUrl);

  await recordOperation(page, "payment", "234,56");
  await expect(page.getByRole("status")).toContainText("Opération enregistrée");
  await expect(page.getByText("Partiellement payée")).toBeVisible();
  await expect(page.getByText(/^1\s000,00\s€$/)).toBeVisible();

  await recordOperation(page, "payment", "1000,01");
  await expect(page.locator("p[role=alert]")).toContainText("ne peut ni dépasser le total");
  await expect(page.getByText(/^1\s000,00\s€$/)).toBeVisible();

  // Une correction sans justification est refusée.
  await recordOperation(page, "correction", "-34,56");
  await expect(page.getByText("Une correction doit être justifiée.")).toBeVisible();
  await recordOperation(page, "correction", "-34,56", "Paiement saisi en double");
  await expect(page.getByText(/^1\s034,56\s€$/)).toBeVisible();

  await recordOperation(page, "payment", "1034,56");
  await expect(page.getByText("Payée", { exact: true })).toBeVisible();
  await expect(page.getByText(/^0,00\s€$/)).toBeVisible();
  // Facture soldée : plus d'annulation possible.
  await expect(page.getByRole("button", { name: "Annuler la facture" })).toHaveCount(0);
});

test("une facture annulée exige un motif et une confirmation", async ({ page }) => {
  await login(page, diane);
  await page.goto(`/o/${durand}/invoices/new`);
  await page.getByLabel("Numéro de facture").fill("FA-002");
  await page.getByLabel("Montant total TTC").fill("50");
  await page.getByLabel("Date d'échéance").fill("2099-12-31");
  await page.getByRole("button", { name: "Créer la facture" }).click();
  await expect(page.getByRole("heading", { name: "Facture FA-002" })).toBeVisible();

  await page.getByLabel("Motif de l'annulation").fill("Émise par erreur");
  await page.getByRole("button", { name: "Annuler la facture" }).click();
  await expect(page.getByText("Cochez la case pour confirmer.")).toBeVisible();
  await page.getByLabel("Je confirme l'annulation définitive de cette facture.").check();
  await page.getByRole("button", { name: "Annuler la facture" }).click();
  await expect(page.getByText("Annulée", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer l'opération" })).toHaveCount(0);
});

test("import d'un CSV valide, puis réimport sans aucun doublon", async ({ page }) => {
  await login(page, diane);

  await upload(page, "factures-valides.csv");
  await expect(page.getByLabel("Montant total TTC *")).toHaveValue("Montant TTC");
  await expect(page.getByLabel("Date d'échéance *")).toHaveValue("Échéance");
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(page.getByText("Rien n'a encore été enregistré.")).toBeVisible();
  await page.getByRole("button", { name: "Importer 4 facture(s)" }).click();
  await expect(page.getByRole("heading", { name: "Résultat de l'import" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Toutes les lignes du fichier ont été importées");

  await page.goto(`/o/${durand}/invoices?q=FA-2026`);
  await expect(page.getByRole("row")).toHaveCount(5); // en-tête + 4 factures
  await expect(page.getByRole("row", { name: /FA-2026-002/ })).toContainText("Partiellement payée");
  await expect(page.getByRole("row", { name: /FA-2026-003/ })).toContainText("Payée");
  await expect(page.getByRole("row", { name: /FA-2026-001/ })).toContainText(/1\s234,56\s€/);
  await expect(page.getByRole("row", { name: /FA-2026-004/ })).toContainText("Durand, Petit & Associés");

  // Second passage du même fichier.
  await upload(page, "factures-valides.csv");
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(page.getByText("Ce fichier a déjà été importé à l'identique")).toBeVisible();
  await page.getByRole("button", { name: "Importer 4 facture(s)" }).click();
  await expect(page.getByRole("heading", { name: "Résultat de l'import" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ignorée/ })).toHaveCount(4);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger le rapport (CSV)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^rapport-import-.*\.csv$/);

  await page.goto(`/o/${durand}/invoices?q=FA-2026`);
  await expect(page.getByRole("row")).toHaveCount(5);
  await page.goto(`/o/${durand}/customers?q=Boulangerie`);
  await expect(page.getByRole("row")).toHaveCount(2); // un seul client créé pour deux factures
});

test("un CSV aux dates et montants invalides est expliqué ligne par ligne", async ({ page }) => {
  await login(page, diane);
  await upload(page, "factures-invalides.csv");
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(page.getByText("Ligne 2")).toBeVisible();
  await expect(page.getByText(/Date invalide/)).toBeVisible();
  await expect(page.getByText(/Les 10 premières sur 11/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Importer 1 facture(s)" })).toBeEnabled();
});

test("un CSV mal formé est refusé avant toute étape", async ({ page }) => {
  await login(page, diane);
  await upload(page, "factures-mal-forme.csv");
  await expect(page.locator("p[role=alert]")).toContainText("jamais refermé");
  await expect(page.getByRole("button", { name: "Vérifier le fichier" })).toHaveCount(0);
});

test("Éric, en lecture seule, consulte mais ne peut rien créer ni modifier", async ({ page }) => {
  await login(page, eric);
  await page.goto(`/o/${durand}/invoices`);
  await expect(page.getByRole("row", { name: /FA-001/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouvelle facture" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Importer un CSV" })).toHaveCount(0);

  await page.goto(invoiceUrl);
  await expect(page.getByRole("heading", { name: "Facture FA-001" })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(1); // seulement « Se déconnecter »

  for (const path of ["invoices/new", "customers/new", "imports/new"]) {
    expect((await page.goto(`/o/${durand}/${path}`))?.status(), path).toBe(403);
  }
});

test("Fanny, d'une autre organisation, ne voit aucune donnée de Durand", async ({ page }) => {
  await signUp(page, "Fanny", fanny);
  await createOrganization(page, "Concurrent", concurrent);

  expect((await page.goto(invoiceUrl))?.status()).toBe(404);
  expect((await page.goto(`/o/${durand}/invoices`))?.status()).toBe(404);
  expect((await page.goto(`/o/${durand}/imports`))?.status()).toBe(404);
  // L'identifiant de la facture de Durand, collé dans l'adresse de sa propre organisation.
  expect((await page.goto(invoiceUrl.replace(durand, concurrent)))?.status()).toBe(404);

  await page.goto(`/o/${concurrent}/invoices`);
  await expect(page.getByText("Aucune facture pour l'instant.")).toBeVisible();
});
