import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { workerAddress } from "./helpers/accounts";
import { accountExists, giveAvatar } from "./helpers/account";
import {
  activateBehindTheApplication,
  deleteProvisionedTags,
  provisionTag,
  qrCodeOf,
  signIn,
  submitSignIn,
  tagStateOf,
  freshAddress,
} from "./helpers/nfc";
import { objectsOf } from "./helpers/profile-images";
import { createProfile } from "./helpers/public-profile";

/**
 * Contrat de balisage de la fiche 0023, figé par ces tests :
 *
 * `/tableau-de-bord` : lien nommé exactement « Mon compte » (`href="/tableau-de-bord/compte"`).
 * `/tableau-de-bord/compte` (sans session → `/connexion`) :
 * - titre `h1` « Mon compte » ; un texte dans `<main>` disant que la suppression est définitive (/définitive/i) ;
 * - dans `<main>`, la phrase exacte « Votre compte de connexion est aussi supprimé, sauf s'il sert encore à d'autres
 *   services. » (apostrophe droite ou typographique) ;
 * - champ texte natif étiqueté exactement « Pour confirmer, saisissez SUPPRIMER » (`name="confirmation"`,
 *   `autocomplete="off"`) ; bouton « Supprimer mon compte » (≥ 44 px de haut). Le bouton peut rester désactivé tant que
 *   la saisie n'est pas exactement `SUPPRIMER` ; l'action vérifie de toute façon côté serveur ;
 * - confirmation erronée envoyée : `role="alert"` dans `<main>` contenant « Saisissez exactement SUPPRIMER pour
 *   confirmer. », on reste sur la page, rien n'est supprimé.
 * Succès : déconnexion (aucun cookie `sb-*`), redirection vers `/?compte=supprime`, l'accueil affiche
 * « Votre compte a été supprimé. » (absent de `/` sans ce paramètre) ; `/p/{slug}` (vu publié juste avant, donc en
 * cache) et `/q/{code}` répondent 404 ; la puce est en stock ; le dossier `carnet-media/<profile_id>/` est vide ;
 * `/tableau-de-bord` renvoie vers `/connexion` ; la reconnexion échoue avec « Adresse ou mot de passe incorrect. ».
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const ACCOUNT_PATH = "/tableau-de-bord/compte";
const HOME_AFTER_DELETION = /\/\?compte=supprime$/;
const DELETED_MESSAGE = "Votre compte a été supprimé.";
const WRONG_CONFIRMATION_MESSAGE = "Saisissez exactement SUPPRIMER pour confirmer.";
const CONFIRMATION_LABEL = "Pour confirmer, saisissez SUPPRIMER";
const LOGIN_ACCOUNT_NOTICE = /Votre compte de connexion est aussi supprimé, sauf s['’]il sert encore à d['’]autres services\./;
const MIN_TARGET_PX = 44;

function confirmationField(page: Page): Locator {
  return page.getByLabel(CONFIRMATION_LABEL, { exact: true });
}

function deleteButton(page: Page): Locator {
  return page.getByRole("button", { name: "Supprimer mon compte" });
}

async function sessionCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-")).map((cookie) => cookie.name);
}

async function statusOf(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  if (response === null) {
    throw new Error(`GET ${path} returned no response`);
  }
  return response.status();
}

test.afterEach(async () => {
  await deleteProvisionedTags();
});

test.describe("suppression de compte (0023)", () => {
  test("le tableau de bord mène à « Mon compte » ; la page explique et demande SUPPRIMER", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const link = page.getByRole("link", { name: "Mon compte", exact: true });
    await expect(link).toHaveAttribute("href", ACCOUNT_PATH);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Mon compte" })).toBeVisible();
    await expect(page.locator("main")).toContainText(/définitive/i);
    await expect(page.locator("main")).toContainText(LOGIN_ACCOUNT_NOTICE);
    await expect(confirmationField(page)).toHaveAttribute("name", "confirmation");
    await expect(confirmationField(page)).toHaveAttribute("autocomplete", "off");
    await confirmationField(page).fill("SUPPRIMER");
    const box = await deleteButton(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  });

  test("critère 5 : sans session, /tableau-de-bord/compte renvoie vers /connexion", async ({ page }) => {
    await page.goto(ACCOUNT_PATH);

    await expect(page).toHaveURL(/\/connexion$/);
  });

  test("critère 4 : confirmation erronée → rien n'est supprimé", async ({ page, context }) => {
    const profile = await createProfile({ is_published: true });
    await signIn(page, profile.email);
    await page.goto(ACCOUNT_PATH);

    await confirmationField(page).fill("supprimer");
    if (await deleteButton(page).isEnabled()) {
      await deleteButton(page).click();
      await expect(page.locator("main").getByRole("alert")).toContainText(WRONG_CONFIRMATION_MESSAGE);
    }

    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
    expect(await sessionCookies(context)).not.toStrictEqual([]);
    expect(await accountExists(profile.userId)).toBe(true);
    expect(await statusOf(page, `/p/${profile.slug}`)).toBe(200);
  });

  test("critères 1, 2 et 6 : confirmation correcte → données effacées, déconnecté, message sur l'accueil, reconnexion impossible", async ({
    page,
    context,
  }) => {
    const profile = await createProfile({ is_published: true });
    await giveAvatar(profile.profileId);
    const tag = await provisionTag();
    await activateBehindTheApplication(profile.email, tag);
    const qrCode = await qrCodeOf(profile.email);
    expect(await statusOf(page, `/p/${profile.slug}`), "témoin : profil publié servi (et mis en cache)").toBe(200);

    await signIn(page, profile.email);
    await page.goto(ACCOUNT_PATH);
    await confirmationField(page).fill("SUPPRIMER");
    await deleteButton(page).click();

    await expect(page).toHaveURL(HOME_AFTER_DELETION);
    await expect(page.getByText(DELETED_MESSAGE)).toBeVisible();
    expect(await sessionCookies(context)).toStrictEqual([]);

    expect(await accountExists(profile.userId)).toBe(false);
    expect(await objectsOf(profile.profileId)).toStrictEqual([]);
    expect((await tagStateOf(tag.uid)).status).toBe("stock");
    expect(await statusOf(page, `/p/${profile.slug}`)).toBe(404);
    expect(await statusOf(page, `/q/${qrCode}`)).toBe(404);

    await page.goto("/");
    await expect(page.getByText(DELETED_MESSAGE)).toHaveCount(0);

    await page.goto("/tableau-de-bord");
    await expect(page).toHaveURL(/\/connexion$/);

    await freshAddress(page);
    await page.goto("/connexion");
    await submitSignIn(page, profile.email);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Adresse ou mot de passe incorrect.");
    await expect(page).toHaveURL(/\/connexion$/);
  });
});
