import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export const PASSWORD = "un-mot-de-passe-de-test";

/** Suffixe unique par exécution : les tests peuvent être relancés sans remise à zéro. */
export const RUN = Date.now().toString(36);

/** Récupère le dernier lien reçu par email à cette adresse (boîte locale Mailpit). */
export async function emailLink(to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
      const match = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/);
      if (match) return match[1].replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun email reçu pour ${to}`);
}

export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Votre nom").fill(name);
  await page.getByLabel("Adresse email professionnelle").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("status")).toContainText("email de confirmation");
  await page.goto(await emailLink(email));
  await expect(page).toHaveURL(/\/organizations$/);
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/login/);
}

export async function createOrganization(page: Page, name: string, slug: string): Promise<void> {
  await page.goto("/organizations/new");
  await page.getByLabel("Nom de l'entreprise").fill(name);
  await page.getByLabel("Identifiant dans l'adresse (facultatif)").fill(slug);
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
}
