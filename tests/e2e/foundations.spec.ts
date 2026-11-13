import { expect, test } from "@playwright/test";
import { createOrganization, emailLink, PASSWORD, RUN, signIn, signOut, signUp } from "./helpers";

/**
 * Parcours critiques de la phase 1, joués dans l'ordre par trois personnes :
 *   Alice crée l'organisation Acme et invite Bob en lecture seule ;
 *   Carole crée une organisation concurrente, Globex.
 */
const alice = `alice-${RUN}@acme.test`;
const bob = `bob-${RUN}@acme.test`;
const carole = `carole-${RUN}@globex.test`;
const acme = `acme-${RUN}`;
const globex = `globex-${RUN}`;

test.describe.configure({ mode: "serial" });

test("un visiteur non connecté est renvoyé vers la connexion", async ({ page }) => {
  await page.goto(`/o/${acme}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto("/organizations");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("une connexion refusée ne révèle pas si le compte existe", async ({ page }) => {
  await signIn(page, `inconnu-${RUN}@acme.test`);
  await expect(page.locator("p[role=alert]")).toContainText("Email ou mot de passe incorrect");
  // Le formulaire conserve l'adresse saisie après une erreur.
  await expect(page.getByLabel("Adresse email")).toHaveValue(`inconnu-${RUN}@acme.test`);
});

test("Alice s'inscrit, confirme son email, crée Acme et invite Bob", async ({ page }) => {
  await signUp(page, "Alice", alice);
  await expect(page.getByText("aucune organisation")).toBeVisible();

  await createOrganization(page, "Acme", acme);
  await expect(page.getByText("Propriétaire")).toBeVisible();

  await page.getByRole("link", { name: "Inviter un collègue" }).click();
  await page.getByLabel("Adresse email").fill(bob);
  await page.getByLabel("Rôle", { exact: true }).selectOption("viewer");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation enregistrée");
  await expect(page.getByRole("row", { name: new RegExp(bob) })).toContainText("Invitation en attente");

  // Alice ne peut pas modifier sa propre ligne.
  const own = page.getByRole("row", { name: /Alice/ });
  await expect(own.getByRole("button")).toHaveCount(0);

  await page.getByRole("link", { name: "Journal d'audit" }).click();
  await expect(page.getByRole("cell", { name: "Organisation créée" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Membre invité" })).toBeVisible();
});

test("un identifiant d'organisation déjà pris est refusé proprement", async ({ page }) => {
  await signIn(page, alice);
  await expect(page).toHaveURL(/\/organizations$/);
  await page.goto("/organizations/new");
  await page.getByLabel("Nom de l'entreprise").fill("Acme bis");
  await page.getByLabel("Identifiant dans l'adresse (facultatif)").fill(acme);
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("déjà utilisé");
});

test("Bob rejoint Acme en lecture seule : il voit, mais ne peut rien modifier", async ({ page }) => {
  await signUp(page, "Bob", bob);
  await expect(page.getByText("Invitations en attente")).toBeVisible();
  await page.getByRole("button", { name: "Rejoindre" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${acme}$`));
  await expect(page.getByText("Lecture seule")).toBeVisible();

  // Pas de lien vers l'audit, pas de bouton d'invitation.
  await expect(page.getByRole("link", { name: "Journal d'audit" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Inviter un collègue" })).toHaveCount(0);

  await page.goto(`/o/${acme}/settings/members`);
  await expect(page.getByRole("heading", { name: "Membres" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inviter" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Désactiver|Modifier/ })).toHaveCount(0);

  // En forçant l'adresse, le serveur répond 403.
  const response = await page.goto(`/o/${acme}/settings/audit`);
  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
});

test("Carole crée Globex : aucune des deux organisations ne voit l'autre", async ({ page }) => {
  await signUp(page, "Carole", carole);
  await createOrganization(page, "Globex", globex);

  const response = await page.goto(`/o/${acme}`);
  expect(response?.status()).toBe(404);
  expect((await page.goto(`/o/${acme}/settings/members`))?.status()).toBe(404);
  expect((await page.goto(`/o/${acme}/settings/audit`))?.status()).toBe(404);

  await page.goto("/organizations");
  await expect(page.getByRole("link", { name: /Globex/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Acme/ })).toHaveCount(0);

  await page.goto(`/o/${globex}/settings/members`);
  await expect(page.getByRole("row", { name: /Carole/ })).toBeVisible();
  await expect(page.getByText(alice)).toHaveCount(0);
  await expect(page.getByText(bob)).toHaveCount(0);
  await signOut(page);
});

test("Alice désactive Bob : il perd l'accès immédiatement", async ({ browser }) => {
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signIn(bobPage, bob);
  await expect(bobPage).toHaveURL(/\/organizations$/);
  await bobPage.goto(`/o/${acme}`);
  await expect(bobPage.getByText("Lecture seule")).toBeVisible();

  const alicePage = await (await browser.newContext()).newPage();
  await signIn(alicePage, alice);
  await expect(alicePage).toHaveURL(/\/organizations$/);
  await alicePage.goto(`/o/${acme}/settings/members`);
  await alicePage.getByRole("row", { name: /Bob/ }).getByRole("button", { name: "Désactiver l'accès" }).click();
  await expect(alicePage.getByRole("row", { name: /Bob/ })).toContainText("Désactivé");

  // La session de Bob est toujours ouverte, mais l'organisation lui est fermée.
  expect((await bobPage.goto(`/o/${acme}`))?.status()).toBe(404);
});

test("une redirection vers un site extérieur après connexion est ignorée", async ({ page }) => {
  await page.goto("/login?next=https://evil.test/phishing");
  await page.getByLabel("Adresse email").fill(alice);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/localhost:3000\/organizations$/);
});

test("Carole réinitialise son mot de passe par email", async ({ page }) => {
  const newPassword = "un-nouveau-mot-de-passe";
  await page.goto("/forgot-password");
  await page.getByLabel("Adresse email").fill(carole);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByRole("status")).toContainText("lien de réinitialisation");

  // Le dernier email reçu est celui de réinitialisation.
  await page.goto(await emailLink(carole));
  await expect(page).toHaveURL(/\/update-password$/);
  await page.getByLabel("Nouveau mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  await signOut(page);

  await signIn(page, carole);
  await expect(page.locator("p[role=alert]")).toContainText("Email ou mot de passe incorrect");
  await signIn(page, carole, newPassword);
  await expect(page).toHaveURL(/\/organizations$/);
});
