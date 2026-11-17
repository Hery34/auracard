import { expect, test, type Locator, type Page } from "@playwright/test";

import { workerAddress } from "./helpers/accounts";
import { colorsOf, contrastRatio } from "./helpers/contrast";
import { qrCodeOf, signIn } from "./helpers/nfc";
import { createProfile } from "./helpers/public-profile";
import { e2eSiteUrl, giveLogo, qrStyleOf } from "./helpers/qr";

/**
 * Contrat de balisage de la fiche 0026 (lot A, sans dessin du QR ni export), figé par ces tests :
 *
 * `/tableau-de-bord` : lien nommé exactement « Mon QR code » (`href="/tableau-de-bord/qr"`).
 * `/tableau-de-bord/qr` (sans session → `/connexion`) :
 * - titre `h1` « Mon QR code » ;
 * - l'URL encodée `${SITE_URL}/q/{code}` affichée en texte, exactement (alternative textuelle du futur dessin) ;
 *   le QR est créé au premier affichage (`ensure_qr_code`) et le code ne change pas d'une visite à l'autre ;
 * - tant que `QR_PRINT_READY` n'est pas `true` : « Domaine provisoire : n'imprimez pas ce QR code. » visible en
 *   permanence (la pile E2E ne définit pas la variable) ;
 * - formulaire : deux champs natifs `<input type="color">` étiquetés « Couleur des modules » (`fg`) et
 *   « Couleur du fond » (`bg`), préremplis avec le style enregistré ; case à cocher « Ajouter mon logo au centre »
 *   (`logo`) ; bouton dont le nom commence par « Enregistrer » ; cibles ≥ 44 px (champs, bouton, libellé de la case) ;
 * - sans `logo_url` : la case est désactivée et un lien de `<main>` dont le nom contient « logo » mène à
 *   `/tableau-de-bord/profil` ; avec `logo_url` : la case est active ;
 * - règle non respectée (décision 4) : dans `<main>`, « Les modules doivent être plus foncés que le fond. »
 *   ou « Contraste insuffisant : 4,5:1 minimum entre les modules et le fond. » (affiché en direct ou après envoi ;
 *   le bouton peut être désactivé tant que la règle n'est pas respectée) ; rien n'est enregistré ;
 * - enregistrement réussi : « Style enregistré. » ; le style est relu à la visite suivante.
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const QR_PATH = "/tableau-de-bord/qr";
const PROFILE_EDITOR_PATH = "/tableau-de-bord/profil";
const PROVISIONAL_DOMAIN = /Domaine provisoire\s?: n['’]imprimez pas ce QR code\./;
const NOT_DARKER = /Les modules doivent être plus foncés que le fond\./;
const LOW_CONTRAST = /Contraste insuffisant\s?: 4,5:1 minimum entre les modules et le fond\./;
const SAVED = /Style enregistré\./;
const DEFAULT_STYLE = { fg: "#000000", bg: "#ffffff", logo: false };
const MIN_TARGET_PX = 44;
const TEXT_MIN = 4.5;

function modulesColor(page: Page): Locator {
  return page.getByLabel("Couleur des modules", { exact: true });
}

function backgroundColor(page: Page): Locator {
  return page.getByLabel("Couleur du fond", { exact: true });
}

function logoOption(page: Page): Locator {
  return page.getByRole("checkbox", { name: "Ajouter mon logo au centre" });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Enregistrer/ });
}

async function expectTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
}

/** Height of what a finger hits for a checkbox: its label when it has one, the box itself otherwise. */
async function checkboxTargetHeight(checkbox: Locator): Promise<number> {
  return checkbox.evaluate((element) => {
    const input = element as HTMLInputElement;
    const heights = [input, ...Array.from(input.labels ?? [])].map((node) => node.getBoundingClientRect().height);
    return Math.max(...heights);
  });
}

/** Fills both colours; submits when the page lets it (the button may stay disabled while the rule is broken). */
async function submitColors(page: Page, fg: string, bg: string): Promise<void> {
  await modulesColor(page).fill(fg);
  await backgroundColor(page).fill(bg);
  await expect(modulesColor(page)).toHaveValue(fg);
  await expect(backgroundColor(page)).toHaveValue(bg);
  const button = saveButton(page);
  if (await button.isEnabled()) {
    const answered = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === QR_PATH,
    );
    await button.click();
    await answered;
  }
}

async function ownerOnQrPage(page: Page): Promise<{ email: string; profileId: string }> {
  const profile = await createProfile();
  await signIn(page, profile.email);
  await page.goto(QR_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Mon QR code" })).toBeVisible();
  return { email: profile.email, profileId: profile.profileId };
}

test.describe("Mon QR code (critères 1, 5 et 6)", () => {
  test("lien « Mon QR code » depuis le tableau de bord", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const link = page.getByRole("link", { name: "Mon QR code", exact: true });
    await expect(link).toHaveAttribute("href", QR_PATH);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${QR_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Mon QR code" })).toBeVisible();
  });

  test("critère 1 : l'URL encodée ${SITE_URL}/q/{code} est affichée ; deux visites donnent le même code", async ({ page }) => {
    const { email } = await ownerOnQrPage(page);
    const code = await qrCodeOf(email);
    const url = `${e2eSiteUrl()}/q/${code}`;

    await expect(page.getByRole("main").getByText(url, { exact: true })).toBeVisible();

    await page.goto(QR_PATH);
    await expect(page.getByRole("main").getByText(url, { exact: true })).toBeVisible();
    expect(await qrCodeOf(email)).toBe(code);
  });

  test("critère 6 : QR_PRINT_READY absente → avertissement « Domaine provisoire » visible", async ({ page }) => {
    await ownerOnQrPage(page);

    await expect(page.getByText(PROVISIONAL_DOMAIN)).toBeVisible();
  });

  test("critère 5 : sans session → /connexion", async ({ page }) => {
    await page.goto(QR_PATH);

    await expect(page).toHaveURL(/\/connexion/);
  });
});

test.describe("couleurs (critère 2, décisions 4 et 7)", () => {
  test("les champs sont préremplis avec le style par défaut", async ({ page }) => {
    await ownerOnQrPage(page);

    await expect(modulesColor(page)).toHaveValue(DEFAULT_STYLE.fg);
    await expect(backgroundColor(page)).toHaveValue(DEFAULT_STYLE.bg);
    await expect(logoOption(page)).not.toBeChecked();
  });

  test("critère 2 : modules clairs sur fond foncé → signalé, rien n'est enregistré", async ({ page }) => {
    const { profileId } = await ownerOnQrPage(page);

    await submitColors(page, "#ffffff", "#000000");

    await expect(page.getByRole("main").getByText(NOT_DARKER).first()).toBeVisible();
    expect(await qrStyleOf(profileId)).toStrictEqual(DEFAULT_STYLE);
  });

  test("critère 2 : contraste inférieur à 4,5:1 → signalé, rien n'est enregistré", async ({ page }) => {
    const { profileId } = await ownerOnQrPage(page);

    await submitColors(page, "#777777", "#ffffff");

    await expect(page.getByRole("main").getByText(LOW_CONTRAST).first()).toBeVisible();
    expect(await qrStyleOf(profileId)).toStrictEqual(DEFAULT_STYLE);
  });

  test("décision 7 : couleurs valides → « Style enregistré. », relues à la visite suivante ; rejouer → même résultat", async ({ page }) => {
    const { profileId } = await ownerOnQrPage(page);

    await submitColors(page, "#1a2b4c", "#fdf6e3");
    await expect(page.getByRole("main").getByText(SAVED)).toBeVisible();
    expect(await qrStyleOf(profileId)).toStrictEqual({ fg: "#1a2b4c", bg: "#fdf6e3", logo: false });

    await page.goto(QR_PATH);
    await expect(modulesColor(page)).toHaveValue("#1a2b4c");
    await expect(backgroundColor(page)).toHaveValue("#fdf6e3");

    await submitColors(page, "#1a2b4c", "#fdf6e3");
    await expect(page.getByRole("main").getByText(SAVED)).toBeVisible();
    expect(await qrStyleOf(profileId)).toStrictEqual({ fg: "#1a2b4c", bg: "#fdf6e3", logo: false });
  });
});

test.describe("logo (critère 3, décision 5)", () => {
  test("critère 3 : sans logo_url → case désactivée, renvoi vers l'éditeur de profil", async ({ page }) => {
    await ownerOnQrPage(page);

    await expect(logoOption(page)).toBeDisabled();
    await expect(page.getByRole("main").getByRole("link", { name: /logo/i })).toHaveAttribute("href", PROFILE_EDITOR_PATH);
  });

  test("critère 3 : avec logo_url → case active, enregistrée cochée", async ({ page }) => {
    const profile = await createProfile();
    await giveLogo(profile.profileId);
    await signIn(page, profile.email);
    await page.goto(QR_PATH);

    await expect(logoOption(page)).toBeEnabled();
    await logoOption(page).check();
    await submitColors(page, "#000000", "#ffffff");

    await expect(page.getByRole("main").getByText(SAVED)).toBeVisible();
    expect(await qrStyleOf(profile.profileId)).toStrictEqual({ fg: "#000000", bg: "#ffffff", logo: true });
    await page.goto(QR_PATH);
    await expect(logoOption(page)).toBeChecked();
  });
});

test.describe("accessibilité (critère 8)", () => {
  test("champs étiquetés, cibles ≥ 44 px, bouton contrasté", async ({ page }) => {
    await ownerOnQrPage(page);

    for (const field of [modulesColor(page), backgroundColor(page)]) {
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("type", "color");
      await expectTarget(field);
    }
    expect(await checkboxTargetHeight(logoOption(page))).toBeGreaterThanOrEqual(MIN_TARGET_PX);

    const button = saveButton(page);
    await expectTarget(button);
    const colors = await colorsOf(button);
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(TEXT_MIN);
  });
});
