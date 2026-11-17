import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";

import { workerAddress } from "./helpers/accounts";
import { colorsOf, contrastRatio } from "./helpers/contrast";
import {
  activateBehindTheApplication,
  deleteProvisionedTags,
  disableBehindTheApplication,
  freshAddress,
  provisionTag,
  qrCodeOf,
  signIn,
  submitSignIn,
  tagStateOf,
  type Tag,
} from "./helpers/nfc";
import { createProfile } from "./helpers/public-profile";
import { expectNoStoreNoIndex } from "./helpers/vcard";

/**
 * Contrat de balisage de la fiche 0025, figé par ces tests :
 *
 * Redirections (route handlers)
 * - `/t/{uid}` : puce active d'un profil publié → 307 vers `/p/{slug}` ; puce en stock → 307 vers `/activer/{uid}` ;
 *   sinon 404, page HTML française contenant « Cette carte n'est pas active. », identique quelle que soit la cause.
 * - `/q/{code}` : même chose (307 vers `/p/{slug}` ou la même page 404).
 * - Toute réponse : `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`.
 * - `robots.txt` : `Disallow` pour `/v/`, `/t/`, `/q/` et `/activer/`.
 *
 * `/activer/{uid}` (page publique, `<meta name="robots">` contenant `noindex`) ; uid hors format → 404.
 * - Sans session : texte « Connectez-vous pour activer cette carte », lien nommé « Se connecter » vers
 *   `/connexion?suivant=/activer/{uid}` (encodé ou non) et lien « Créer un compte » vers `/inscription`.
 * - Avec session : champ natif `<input>` étiqueté « Code d'activation » (`autocomplete="off"`, `inputmode="text"`,
 *   `text-transform: uppercase`) ; après un refus, `aria-invalid="true"` et `aria-describedby` vers un élément contenant
 *   le message (décision 13) ; bouton « Activer » (≥ 44 px de haut, contraste AA) ; succès → `/tableau-de-bord/puces` ;
 *   refus → `role="alert"` dans `<main>` contenant le message de `ACTIVATION_ERROR_MESSAGES` (« Code incorrect ou carte
 *   indisponible. », « Trop d'essais. Réessayez dans une heure. »).
 *
 * `/connexion?suivant=…` : champ caché `suivant` ; après connexion, retour sur `/activer/{uid}` si et seulement si la
 * valeur est exactement `/activer/{uid}` bien formé, sinon `/tableau-de-bord`.
 *
 * `/tableau-de-bord` : lien nommé exactement « Mes puces » (`href="/tableau-de-bord/puces"`).
 * `/tableau-de-bord/puces` : titre `h1` « Mes puces » ; une puce = un élément de liste (`listitem`) contenant les
 * 4 derniers caractères de son uid, son statut en texte exact « Active » ou « Désactivée » et sa date d'activation
 * (« 17 novembre 2026 ») ; boutons dont le nom commence par « Désactiver » / « Réactiver » et
 * « Retirer de mon compte » (≥ 44 px). « Retirer de mon compte » ouvre une boîte (`role="dialog"` ou `"alertdialog"`)
 * contenant « La carte pourra être activée de nouveau avec son code. », un bouton « Retirer la carte » (confirme)
 * et un bouton « Annuler ». Liste vide : « Aucune carte. Approchez votre carte d'un téléphone pour l'activer. »
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const NOT_ACTIVE = /Cette carte n['’]est pas active\./;
const WRONG_CODE_MESSAGE = "Code incorrect ou carte indisponible.";
const CODE_LABEL = /^Code d['’]activation$/;
const SIGN_IN_TO_ACTIVATE = /Connectez-vous pour activer cette carte/;
const NO_TAGS = /Aucune carte\. Approchez votre carte d['’]un téléphone pour l['’]activer\./;
const RELEASE_CONFIRMATION = "La carte pourra être activée de nouveau avec son code.";
const MY_TAGS_PATH = "/tableau-de-bord/puces";
const MIN_TARGET_PX = 44;
const TEXT_MIN = 4.5;
/** Well-formed code that no provisioned tag can have. */
const WRONG_CODE = "00000-00000";
/** Well-formed uid never provisioned. */
const UNKNOWN_UID = "zzzzzzzzzzzz";

test.afterAll(async () => {
  await deleteProvisionedTags();
});

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/** Decision 13: the Location header is exactly the relative path. */
function locationPath(response: APIResponse): string {
  return response.headers()["location"] ?? "";
}

async function scan(page: Page, path: string): Promise<APIResponse> {
  return page.request.get(path, { maxRedirects: 0 });
}

function codeField(page: Page): Locator {
  return page.getByLabel(CODE_LABEL);
}

function activateButton(page: Page): Locator {
  return page.getByRole("button", { name: "Activer", exact: true });
}

/**
 * One attempt = one request carrying `code`. React resets the form when an action settles (end of `pending`): a value
 * typed before that reset would be wiped and an empty code submitted, which never reaches the database counter. So the
 * previous action must have settled (button enabled again) before typing, and the typed value is checked before sending.
 */
async function submitCode(page: Page, code: string): Promise<void> {
  const button = activateButton(page);
  await expect(button).toBeEnabled();
  await codeField(page).fill(code);
  await expect(codeField(page)).toHaveValue(code);
  const answered = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith("/activer/"),
  );
  await button.click();
  const response = await answered;
  expect(response.request().postData() ?? "").toContain(code);
}

/** `role="alert"` of the page content: the Next.js route announcer (same role, outside `<main>`) is left out. */
function formAlert(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

function tagRow(page: Page, uid: string): Locator {
  return page.getByRole("listitem").filter({ hasText: uid.slice(-4) });
}

async function expectTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
}

/** A published profile owning one tag activated behind the application. */
async function publishedOwnerOfOneTag(): Promise<{ email: string; slug: string; tag: Tag; tagId: string }> {
  const profile = await createProfile({ is_published: true });
  const tag = await provisionTag();
  const tagId = await activateBehindTheApplication(profile.email, tag);
  return { email: profile.email, slug: profile.slug, tag, tagId };
}

// ---------------------------------------------------------------------------------------------------------------

test.describe("redirections /t et /q (critères 1 et 2)", () => {
  test("critère 1 : puce assignée à un profil publié → 307 vers /p/{slug}, no-store et noindex", async ({ page }) => {
    const { slug, tag } = await publishedOwnerOfOneTag();

    const response = await scan(page, `/t/${tag.uid}`);

    expect(response.status()).toBe(307);
    expect(locationPath(response)).toBe(`/p/${slug}`);
    expectNoStoreNoIndex(response);
  });

  test("critère 1 : en suivant la redirection, le téléphone affiche le profil", async ({ page }) => {
    const { slug, tag } = await publishedOwnerOfOneTag();

    await page.goto(`/t/${tag.uid}`);

    await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
  });

  test("critère 1 : inconnue, désactivée, non publiée, format invalide → 404 identiques, no-store et noindex", async ({ page }) => {
    const disabled = await publishedOwnerOfOneTag();
    await disableBehindTheApplication(disabled.email, disabled.tagId);
    const unpublished = await createProfile({ is_published: false });
    const unpublishedTag = await provisionTag();
    await activateBehindTheApplication(unpublished.email, unpublishedTag);

    const responses = [
      await scan(page, `/t/${UNKNOWN_UID}`),
      await scan(page, `/t/${disabled.tag.uid}`),
      await scan(page, `/t/${unpublishedTag.uid}`),
      await scan(page, `/t/${disabled.tag.uid.toUpperCase()}`),
      await scan(page, "/t/trop-court"),
    ];

    const bodies: string[] = [];
    for (const response of responses) {
      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"] ?? "").toMatch(/^text\/html/);
      expectNoStoreNoIndex(response);
      bodies.push(await response.text());
    }
    expect(bodies[0]).toMatch(NOT_ACTIVE);
    expect(new Set(bodies).size).toBe(1);
  });

  test("critère 2 : puce en stock → 307 vers /activer/{uid}", async ({ page }) => {
    const tag = await provisionTag();

    const response = await scan(page, `/t/${tag.uid}`);

    expect(response.status()).toBe(307);
    expect(locationPath(response)).toBe(`/activer/${tag.uid}`);
    expectNoStoreNoIndex(response);
  });

  test("critère 1 : QR d'un profil publié → 307 vers /p/{slug} ; non publié, inconnu, hors format → 404", async ({ page }) => {
    const published = await createProfile({ is_published: true });
    const unpublished = await createProfile({ is_published: false });
    const publishedCode = await qrCodeOf(published.email);
    const unpublishedCode = await qrCodeOf(unpublished.email);

    const redirect = await scan(page, `/q/${publishedCode}`);
    expect(redirect.status()).toBe(307);
    expect(locationPath(redirect)).toBe(`/p/${published.slug}`);
    expectNoStoreNoIndex(redirect);

    const bodies: string[] = [];
    for (const path of [`/q/${unpublishedCode}`, "/q/zzzzzzzz", `/q/${publishedCode.toUpperCase()}`]) {
      const response = await scan(page, path);
      expect(response.status(), path).toBe(404);
      expectNoStoreNoIndex(response);
      bodies.push(await response.text());
    }
    expect(bodies[0]).toMatch(NOT_ACTIVE);
    expect(new Set(bodies).size).toBe(1);
  });

  test("décision 4 : robots.txt interdit /v/, /t/, /q/ et /activer/", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();

    for (const path of ["/v/", "/t/", "/q/", "/activer/"]) {
      expect(body).toMatch(new RegExp(`^Disallow: ${path.replaceAll("/", "\\/")}$`, "m"));
    }
  });
});

test.describe("activation /activer/{uid} (critères 2 et 3)", () => {
  test("critère 2 : sans session, scan → page d'activation → connexion → retour → bon code → Mes puces → profil", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    const tag = await provisionTag();
    await freshAddress(page);

    await page.goto(`/t/${tag.uid}`);
    await expect(page).toHaveURL(new RegExp(`/activer/${tag.uid}$`));
    await expect(page.getByText(SIGN_IN_TO_ACTIVATE)).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
    const signInLink = page.getByRole("link", { name: "Se connecter", exact: true });
    const href = new URL((await signInLink.getAttribute("href")) ?? "", page.url());
    expect(href.pathname).toBe("/connexion");
    expect(href.searchParams.get("suivant")).toBe(`/activer/${tag.uid}`);
    expect(await signInLink.getAttribute("href")).toBe(`/connexion?suivant=%2Factiver%2F${tag.uid}`);
    expect(await page.getByRole("link", { name: "Créer un compte", exact: true }).getAttribute("href")).toBe("/inscription");

    await signInLink.click();
    await expect(page).toHaveURL(/\/connexion\?/);
    await submitSignIn(page, profile.email);
    await expect(page).toHaveURL(new RegExp(`/activer/${tag.uid}$`));

    await submitCode(page, tag.activationCode.replace("-", "").toLowerCase());

    await expect(page).toHaveURL(new RegExp(`${MY_TAGS_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Mes puces" })).toBeVisible();
    await expect(tagRow(page, tag.uid).getByText("Active", { exact: true })).toBeVisible();
    expect(await tagStateOf(tag.uid)).toMatchObject({ status: "assigned" });

    await page.goto(`/t/${tag.uid}`);
    await expect(page).toHaveURL(new RegExp(`/p/${profile.slug}$`));
  });

  test("critère 2 : rejouer l'activation → même résultat, sans erreur", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    const tag = await provisionTag();
    await signIn(page, profile.email);

    for (const attempt of [1, 2]) {
      await page.goto(`/activer/${tag.uid}`);
      await submitCode(page, tag.activationCode);
      await expect(page, `attempt ${attempt}`).toHaveURL(new RegExp(`${MY_TAGS_PATH}$`));
    }
    await expect(formAlert(page)).toHaveCount(0);
    await expect(tagRow(page, tag.uid)).toHaveCount(1);
  });

  test("critère 3 : mauvais code ou puce inconnue → le même message, annoncé", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    const tag = await provisionTag();
    await signIn(page, profile.email);

    await page.goto(`/activer/${tag.uid}`);
    await submitCode(page, WRONG_CODE);
    await expect(formAlert(page)).toContainText(WRONG_CODE_MESSAGE);
    await expect(page).toHaveURL(new RegExp(`/activer/${tag.uid}$`));
    const wrongCode = (await formAlert(page).textContent())?.trim();

    await page.goto(`/activer/${UNKNOWN_UID}`);
    await submitCode(page, tag.activationCode);
    await expect(formAlert(page)).toContainText(WRONG_CODE_MESSAGE);
    expect((await formAlert(page).textContent())?.trim()).toBe(wrongCode);

    expect(await tagStateOf(tag.uid)).toMatchObject({ status: "stock" });
  });

  test("critère 3 : 11e essai du compte dans l'heure → « Trop d'essais »", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    const tag = await provisionTag();
    await signIn(page, profile.email);
    await page.goto(`/activer/${tag.uid}`);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await submitCode(page, WRONG_CODE);
      await expect(formAlert(page), `attempt ${attempt}`).toContainText(WRONG_CODE_MESSAGE);
    }
    await submitCode(page, tag.activationCode);

    await expect(formAlert(page)).toContainText(/Trop d['’]essais\. Réessayez dans une heure\./);
    expect(await tagStateOf(tag.uid)).toMatchObject({ status: "stock" });
  });

  test("décision 5 : uid hors format → 404 ; la page est noindex", async ({ page }) => {
    const missing = await page.goto("/activer/TROP-COURT");
    expect(missing?.status()).toBe(404);

    const tag = await provisionTag();
    await page.goto(`/activer/${tag.uid}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("décision 10 : champ du code accessible (libellé, autocomplete off, inputmode texte, majuscules), bouton ≥ 44 px et contrasté", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    const tag = await provisionTag();
    await signIn(page, profile.email);
    await page.goto(`/activer/${tag.uid}`);

    const field = codeField(page);
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).toHaveAttribute("inputmode", "text");
    expect(await field.evaluate((element) => getComputedStyle(element).textTransform)).toBe("uppercase");
    await expectTarget(field);

    const button = activateButton(page);
    await expectTarget(button);
    const colors = await colorsOf(button);
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(TEXT_MIN);

    await submitCode(page, WRONG_CODE);
    const alert = formAlert(page);
    await expect(alert).toContainText(WRONG_CODE_MESSAGE);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
    expect(describedBy).not.toBe("");
    const descriptions = await Promise.all(
      describedBy.split(/\s+/).map((id) => page.locator(`[id="${id}"]`).textContent()),
    );
    expect(descriptions.join(" ")).toContain(WRONG_CODE_MESSAGE);
    const alertColors = await colorsOf(alert);
    expect(contrastRatio(alertColors.text, alertColors.background)).toBeGreaterThanOrEqual(TEXT_MIN);
  });
});

test.describe("retour après connexion (critère 4)", () => {
  for (const [label, suivant] of [
    ["URL protocole-relative", "//evil.example"],
    ["URL absolue vers une page d'activation", "https://evil.example/activer/7k2m9p4q8r3s"],
    ["barre oblique inverse", "/\\evil.example"],
    ["tableau de bord", "/tableau-de-bord/profil"],
    ["chemin d'activation encodé", "%2Factiver%2F7k2m9p4q8r3s"],
  ] as const) {
    test(`critère 4 : suivant = ${label} → /tableau-de-bord, jamais ailleurs`, async ({ page }) => {
      const profile = await createProfile({ is_published: true });
      await freshAddress(page);

      await page.goto(`/connexion?suivant=${encodeURIComponent(suivant)}`);
      await submitSignIn(page, profile.email);

      await expect(page).toHaveURL(/\/tableau-de-bord$/);
      expect(page.url()).not.toContain("evil.example");
    });
  }
});

test.describe("Mes puces (critère 5)", () => {
  test("lien « Mes puces » depuis le tableau de bord ; liste vide → message d'invitation", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    await signIn(page, profile.email);

    const link = page.getByRole("link", { name: "Mes puces", exact: true });
    await expect(link).toHaveAttribute("href", MY_TAGS_PATH);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${MY_TAGS_PATH}$`));
    await expect(page.getByText(NO_TAGS)).toBeVisible();
  });

  test("sans session → /connexion", async ({ page }) => {
    await page.goto(MY_TAGS_PATH);

    await expect(page).toHaveURL(/\/connexion/);
  });

  test("désactiver → /t 404 ; réactiver → 307 ; retirer (confirmé) → stock puis réactivation avec le même code", async ({ page }) => {
    const { email, slug, tag } = await publishedOwnerOfOneTag();
    await signIn(page, email);
    await page.goto(MY_TAGS_PATH);
    const row = tagRow(page, tag.uid);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row).toContainText(/\d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/);

    const disable = row.getByRole("button", { name: /^Désactiver/ });
    await expectTarget(disable);
    await disable.click();
    await expect(row.getByText("Désactivée", { exact: true })).toBeVisible();
    expect((await scan(page, `/t/${tag.uid}`)).status()).toBe(404);

    await row.getByRole("button", { name: /^Réactiver/ }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    const active = await scan(page, `/t/${tag.uid}`);
    expect(active.status()).toBe(307);
    expect(locationPath(active)).toBe(`/p/${slug}`);

    const release = row.getByRole("button", { name: /^Retirer de mon compte/ });
    await expectTarget(release);
    await release.click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toContainText(RELEASE_CONFIRMATION);
    await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(row).toHaveCount(1);
    expect(await tagStateOf(tag.uid)).toMatchObject({ status: "assigned" });

    await release.click();
    await dialog.getByRole("button", { name: "Retirer la carte", exact: true }).click();
    await expect(tagRow(page, tag.uid)).toHaveCount(0);
    await expect(page.getByText(NO_TAGS)).toBeVisible();
    const stock = await scan(page, `/t/${tag.uid}`);
    expect(stock.status()).toBe(307);
    expect(locationPath(stock)).toBe(`/activer/${tag.uid}`);

    await page.goto(`/activer/${tag.uid}`);
    await submitCode(page, tag.activationCode);
    await expect(page).toHaveURL(new RegExp(`${MY_TAGS_PATH}$`));
    await expect(tagRow(page, tag.uid).getByText("Active", { exact: true })).toBeVisible();
  });

  test("un autre membre ne voit pas les puces d'autrui", async ({ page }) => {
    const owner = await publishedOwnerOfOneTag();
    const other = await createProfile({ is_published: true });
    await signIn(page, other.email);

    await page.goto(MY_TAGS_PATH);

    await expect(page.getByText(NO_TAGS)).toBeVisible();
    await expect(tagRow(page, owner.tag.uid)).toHaveCount(0);
    expect(await tagStateOf(owner.tag.uid)).toMatchObject({ status: "assigned" });
  });
});
