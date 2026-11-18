import { expect, test, type Locator, type Page } from "@playwright/test";

import { freshAddress, signIn } from "./helpers/nfc";
import { minutesAgo, refusingOrigin, seedLeads, storedLeads } from "./helpers/leads";
import { FULL_PROFILE, createProfile, type ProfileFixture } from "./helpers/public-profile";
import { profileFieldsOf, signInAs } from "./helpers/profile-editor";

/**
 * Contrat de balisage de la fiche 0032, figé par ces tests (profils iPhone 15 et Pixel 7).
 *
 * Clés Turnstile (décision 6, ADR 0008) — injectées par `playwright.config.ts` dans l'environnement de `pnpm start`
 * (et, en CI, au niveau du job `e2e`, `pnpm build` compris) ; jamais les clés de production :
 * - serveur principal (`http://localhost:3000`, ou `E2E_BASE_URL`) : `TURNSTILE_SITE_KEY=1x00000000000000000000AA`
 *   (widget visible, toujours accepté) et `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (toujours accepté) ;
 * - serveur « refus » (`E2E_TURNSTILE_REFUSING_URL`, par défaut `http://localhost:3001`), second `webServer` du même
 *   build : même clé de site, `TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA` (toujours refusé), `SITE_URL`
 *   égal à son origine. Le widget de test charge le vrai script de Cloudflare : accès réseau à
 *   `challenges.cloudflare.com` requis.
 *
 * Page publique `/p/{slug}` :
 * - profil qui accepte les messages : un bouton nommé exactement « Laisser mes coordonnées », `aria-expanded="false"`
 *   tant que le formulaire est replié ; aucun champ du formulaire visible ; aucune requête vers
 *   `challenges.cloudflare.com`, aucun `<script>` ni `<iframe>` de ce domaine dans le DOM ni dans le HTML servi ;
 * - au clic : `aria-expanded="true"`, un `<form>` contenant les champs étiquetés exactement « Nom », « E-mail »
 *   (`type="email"`), « Message » (`textarea`), une case à cocher obligatoire (`required` ou `aria-required="true"`)
 *   dont le nom commence par « J'accepte » et cite le nom affiché du propriétaire, la mention d'information (nom du
 *   propriétaire, « 12 mois », « Cloudflare », « Infomaniak » ; décision 14 : « Vous pouvez demander l'accès à vos
 *   coordonnées, leur effacement ou vous opposer à leur traitement auprès de <nom>. Cloudflare peut traiter des données
 *   techniques hors de l'Union européenne. »), un champ caché `idempotencyKey` (uuid v4 généré au
 *   montage, jamais dans le HTML servi), le widget Turnstile (champ `cf-turnstile-response` rempli par Cloudflare) et
 *   un bouton « Envoyer » ; le script Cloudflare n'est demandé qu'à ce moment ;
 * - décision 14 : le widget est rendu par `window.turnstile.render` avec `action: "lead"` et `cData: <slug>` ;
 * - décision 14 (après le second audit) : après tout refus sans écriture (toute erreur sauf `unexpected`), le champ
 *   `idempotencyKey` porte une nouvelle clé (uuid v4) ; `challenge_failed` est vérifié ici, `rate_limited` et
 *   `challenge_unavailable` le sont par les tests unitaires (`lead-form-view.test.ts`) ;
 * - succès : `role="status"` contenant « Message envoyé » ;
 * - refus : `role="alert"` ; Turnstile refusé → message contenant « anti-robot » ; champs invalides → « Vérifiez les
 *   champs signalés. », chaque champ fautif `aria-invalid="true"` et `aria-describedby` vers son message ;
 * - profil qui refuse les messages (`accepts_leads = false`) : ni bouton, ni formulaire ;
 * - la page reste statique (`Cache-Control` sans `private` ni `no-store`).
 *
 * Éditeur `/tableau-de-bord/profil` : interrupteur `<input type="checkbox" role="switch">` nommé exactement
 * « Recevoir des messages », enregistré avec le reste du formulaire (« Enregistrer »).
 *
 * `/tableau-de-bord/messages` (sans session → `/connexion`), dynamique (`Cache-Control` contenant `no-store`) :
 * - lien « Mes messages » depuis `/tableau-de-bord` ; titre `h1` « Mes messages » ;
 * - aucun message : texte commençant par « Aucun message » ;
 * - chaque message est un élément de liste (`<li>`) de `<main>` contenant le nom, l'e-mail et le message en texte brut
 *   (aucune balise interprétée, aucun lien automatique), plus récent d'abord, 20 par page ;
 * - au-delà : lien « Messages plus anciens » vers `?avant=<curseur>` ; rendu serveur, sans JavaScript ;
 * - `?avant=` invalide → première page ;
 * - bouton dont le nom commence par « Supprimer » dans chaque message → boîte (`dialog` ou `alertdialog`) contenant
 *   « définitivement », un bouton « Annuler » et un bouton « Supprimer le message » (confirme).
 */

const OPEN_FORM = "Laisser mes coordonnées";
const LABELS = { name: "Nom", email: "E-mail", message: "Message" } as const;
const CONSENT = /^J['’]accepte/;
const SEND = "Envoyer";
const SENT = /Message envoyé/;
const ANTI_ROBOT = /anti-robot/i;
const CHECK_FIELDS = "Vérifiez les champs signalés.";
const MESSAGES_PATH = "/tableau-de-bord/messages";
const OLDER = "Messages plus anciens";
const EMPTY = /^\s*Aucun message/;
const CLOUDFLARE_HOST = "challenges.cloudflare.com";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_TIMEOUT = { timeout: 30_000 } as const;
const QUIET_MS = 1500;

/** Decision 14: sentences added to the notice (straight or typographic apostrophes). */
const RIGHTS = [
  /Vous pouvez demander l['’]accès à vos coordonnées, leur effacement ou vous opposer à leur traitement auprès de /,
  /Cloudflare peut traiter des données techniques hors de l['’]Union européenne\./,
] as const;

const VISITOR = { name: "Jean Visiteur E2E", email: "jean.visiteur@example.test", message: "Bonjour,\nje souhaite un devis." } as const;

// ---------------------------------------------------------------------------------------------------------------
// Locators and actions

function openButton(page: Page): Locator {
  return page.getByRole("button", { name: OPEN_FORM, exact: true });
}

function leadForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByRole("button", { name: SEND, exact: true }) });
}

function field(page: Page, label: string): Locator {
  return leadForm(page).getByLabel(label, { exact: true });
}

function consent(page: Page): Locator {
  return leadForm(page).getByRole("checkbox", { name: CONSENT });
}

/** Records every request to Cloudflare's challenge host. */
function watchCloudflare(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === CLOUDFLARE_HOST) {
      urls.push(request.url());
    }
  });
  return urls;
}

async function cloudflareElements(page: Page): Promise<number> {
  return page.locator(`script[src*="${CLOUDFLARE_HOST}"], iframe[src*="${CLOUDFLARE_HOST}"]`).count();
}

async function openPublicPage(page: Page, slug: string, origin = ""): Promise<void> {
  await freshAddress(page);
  const response = await page.goto(`${origin}/p/${slug}`);
  expect(response?.status(), `/p/${slug}`).toBe(200);
}

async function openForm(page: Page): Promise<void> {
  await openButton(page).click();
  await expect(openButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(field(page, LABELS.name)).toBeVisible();
}

/** The test site key always passes: Cloudflare fills `cf-turnstile-response` with its dummy token. */
async function waitForChallengeToken(page: Page): Promise<void> {
  await expect(leadForm(page).locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, TOKEN_TIMEOUT);
}

async function fillValidForm(page: Page, values: { name: string; email: string; message: string } = VISITOR): Promise<void> {
  await field(page, LABELS.name).fill(values.name);
  await field(page, LABELS.email).fill(values.email);
  await field(page, LABELS.message).fill(values.message);
  await consent(page).check();
}

async function idempotencyKeyOf(page: Page): Promise<string> {
  const key = await leadForm(page).locator('input[type="hidden"][name="idempotencyKey"]').inputValue();
  expect(key).toMatch(UUID_V4);
  return key;
}

type TurnstileRender = { action: unknown; cData: unknown };

/** Cloudflare's script (`api.js?render=explicit`, redirected to a versioned `…/b/<hash>/api.js`). */
const TURNSTILE_SCRIPT = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/(b\/[^/]+\/)?api\.js/;

/**
 * Records the options of every `window.turnstile.render` call: the script is served with a trailing wrapper of
 * `render` (redefining `window.turnstile` before the script runs keeps Cloudflare from registering its API).
 */
async function watchTurnstileRenders(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __turnstileRenders: TurnstileRender[] }).__turnstileRenders = [];
  });
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    const response = await route.fetch();
    const wrapper =
      ";(function(){var api=window.turnstile;var render=api.render;api.render=function(container,options){" +
      "window.__turnstileRenders.push({action:options&&options.action,cData:options&&options.cData});" +
      "return render.apply(this,arguments);};})();";
    await route.fulfill({ response, body: (await response.text()) + wrapper });
  });
}

async function turnstileRenders(page: Page): Promise<TurnstileRender[]> {
  return page.evaluate(() => (window as unknown as { __turnstileRenders: TurnstileRender[] }).__turnstileRenders);
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

/** The messages: the list items of `<main>` that carry their own « Supprimer » button. */
function items(page: Page): Locator {
  return main(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: /^Supprimer/ }) });
}

async function itemNames(page: Page): Promise<string[]> {
  const texts = await items(page).allInnerTexts();
  return texts.map((text) => text.match(/Visiteur \d+/)?.[0] ?? text);
}

async function openMessages(page: Page, email: string, query = ""): Promise<void> {
  await signIn(page, email);
  await page.goto(`${MESSAGES_PATH}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Mes messages" })).toBeVisible();
}

/** `count` messages named « Visiteur 0 » (newest) to « Visiteur count−1 » (oldest). */
async function seedNumbered(profile: ProfileFixture, count: number): Promise<void> {
  await seedLeads(
    profile.profileId,
    Array.from({ length: count }, (_, index) => ({
      name: `Visiteur ${index}`,
      email: `visiteur-${index}@example.test`,
      message: `Message numéro ${index}`,
      createdAt: minutesAgo(index + 1),
    })),
  );
}

function names(from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, index) => `Visiteur ${from + index}`);
}

// ---------------------------------------------------------------------------------------------------------------

test.describe("formulaire de contact : replié, sans script tiers, page statique (critère 5, décision 1)", () => {
  test("critère 5 : formulaire replié, aucun script ni iframe Cloudflare tant qu'il est fermé ; chargé à l'ouverture", async ({ page }) => {
    const profile = await createProfile();
    const cloudflare = watchCloudflare(page);

    await openPublicPage(page, profile.slug);

    await expect(openButton(page)).toBeVisible();
    await expect(openButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel(LABELS.message, { exact: true })).toHaveCount(0);
    await page.waitForTimeout(QUIET_MS);
    expect(cloudflare, "requêtes vers Cloudflare avant ouverture").toStrictEqual([]);
    expect(await cloudflareElements(page)).toBe(0);

    await openForm(page);

    await expect.poll(() => cloudflare.length, TOKEN_TIMEOUT).toBeGreaterThan(0);
    await waitForChallengeToken(page);
  });

  test("critère 5 : /p/{slug} statique — Cache-Control public, HTML servi sans Cloudflare ni clé d'idempotence", async ({ page, context }) => {
    const profile = await createProfile();
    await freshAddress(page);
    const response = await page.goto(`/p/${profile.slug}`);
    expect(response?.headers()["cache-control"] ?? "", "Cache-Control d'une page statique ou ISR").not.toMatch(/private|no-store/);
    const html = (await response?.text()) ?? "";
    expect(html).not.toContain(CLOUDFLARE_HOST);

    await openForm(page);
    const firstKey = await idempotencyKeyOf(page);
    const other = await context.newPage();
    await openPublicPage(other, profile.slug);
    await openForm(other);
    const secondKey = await idempotencyKeyOf(other);

    expect(secondKey, "une clé par formulaire monté").not.toBe(firstKey);
    expect(html).not.toContain(firstKey);
    expect(html).not.toContain(secondKey);
  });

  test("critère 3 : profil qui refuse les messages → ni bouton ni formulaire (témoin : un profil qui accepte a son bouton)", async ({
    page,
  }) => {
    const witness = await createProfile();
    await openPublicPage(page, witness.slug);
    await expect(openButton(page), "témoin").toBeVisible();
    const profile = await createProfile({ accepts_leads: false });

    await openPublicPage(page, profile.slug);

    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: SEND, exact: true })).toHaveCount(0);
    await expect(page.getByLabel(LABELS.message, { exact: true })).toHaveCount(0);
  });
});

test.describe("formulaire de contact : envoi (critères 1 et 2)", () => {
  test("critère 1 : envoi valide → « Message envoyé », visible dans « Mes messages » du propriétaire", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug);
    await openForm(page);
    await fillValidForm(page);
    await waitForChallengeToken(page);

    await leadForm(page).getByRole("button", { name: SEND, exact: true }).click();

    await expect(page.getByRole("status").filter({ hasText: SENT })).toBeVisible();
    const stored = await storedLeads(profile.profileId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: VISITOR.name, email: VISITOR.email, message: VISITOR.message });

    await openMessages(page, profile.email);
    const item = items(page).filter({ hasText: VISITOR.name });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(VISITOR.email);
    await expect(item).toContainText("je souhaite un devis.");
  });

  test("critère 1 : double soumission (requête rejouée, même clé) → un seul message", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug);
    await openForm(page);
    await fillValidForm(page);
    await waitForChallengeToken(page);
    let replayed = 0;
    await page.route(
      (url) => url.pathname === `/p/${profile.slug}`,
      async (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
          replayed += 1;
          await page.request.fetch(request);
        }
        await route.continue();
      },
    );

    await leadForm(page).getByRole("button", { name: SEND, exact: true }).click();

    await expect(page.getByRole("status").filter({ hasText: SENT })).toBeVisible();
    expect(replayed, "la Server Action a été rejouée").toBe(1);
    expect(await storedLeads(profile.profileId)).toHaveLength(1);
  });

  test("critère 2 : jeton refusé par Cloudflare (clé de test « toujours refusé ») → message anti-robot, rien d'écrit", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug, refusingOrigin());
    await openForm(page);
    await fillValidForm(page);
    await waitForChallengeToken(page);

    await leadForm(page).getByRole("button", { name: SEND, exact: true }).click();

    await expect(page.getByRole("alert").filter({ hasText: ANTI_ROBOT })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: SENT })).toHaveCount(0);
    expect(await storedLeads(profile.profileId)).toStrictEqual([]);
  });

  test("décision 14 : widget rendu avec action « lead » et cData = slug (jeton lié au profil)", async ({ page }) => {
    const profile = await createProfile();
    await watchTurnstileRenders(page);
    await openPublicPage(page, profile.slug);
    await openForm(page);
    await waitForChallengeToken(page);

    expect(await turnstileRenders(page)).toStrictEqual([{ action: "lead", cData: profile.slug }]);
  });

  test("décision 14 : après « challenge_failed », nouvelle clé d'idempotence (rien n'a été écrit)", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug, refusingOrigin());
    await openForm(page);
    await fillValidForm(page);
    await waitForChallengeToken(page);
    const refusedKey = await idempotencyKeyOf(page);

    await leadForm(page).getByRole("button", { name: SEND, exact: true }).click();

    await expect(page.getByRole("alert").filter({ hasText: ANTI_ROBOT })).toBeVisible();
    await expect.poll(() => idempotencyKeyOf(page)).not.toBe(refusedKey);
    expect(await storedLeads(profile.profileId)).toStrictEqual([]);
  });

  test("critère 6 et décision 9 : case non cochée et e-mail invalide → erreurs annoncées sur les champs, rien d'écrit", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug);
    await openForm(page);
    await field(page, LABELS.name).fill(VISITOR.name);
    await field(page, LABELS.email).fill("pas-une-adresse");
    await field(page, LABELS.message).fill(VISITOR.message);
    await waitForChallengeToken(page);
    // The browser's own checks (type="email", required) are bypassed: the server and the page must announce the errors.
    await leadForm(page).evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });

    await leadForm(page).getByRole("button", { name: SEND, exact: true }).click();

    await expect(page.getByRole("alert").filter({ hasText: CHECK_FIELDS })).toBeVisible();
    for (const [control, pattern] of [
      [field(page, LABELS.email), /adresse e-mail/i],
      [consent(page), /coch/i],
    ] as const) {
      await expect(control).toHaveAttribute("aria-invalid", "true");
      const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
      expect(describedBy, "aria-describedby").not.toBe("");
      const description = (await Promise.all(describedBy.split(/\s+/).map((id) => page.locator(`[id="${id}"]`).innerText()))).join(" ");
      expect(description).toMatch(pattern);
      expect(description).not.toContain("pas-une-adresse");
    }
    await expect(field(page, LABELS.name)).not.toHaveAttribute("aria-invalid", "true");
    expect(await storedLeads(profile.profileId)).toStrictEqual([]);
  });
});

test.describe("formulaire de contact : mention RGPD et accessibilité (décision 3, critère 6)", () => {
  test("décision 3 et 14 : mention d'information (propriétaire, 12 mois, Cloudflare, Infomaniak, droits, transfert) et case obligatoire", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug);
    await openForm(page);

    const form = leadForm(page);
    await expect(form).toContainText(FULL_PROFILE.display_name);
    await expect(form).toContainText("12 mois");
    await expect(form).toContainText("Cloudflare");
    await expect(form).toContainText("Infomaniak");
    for (const sentence of RIGHTS) {
      await expect(form).toContainText(sentence);
    }
    await expect(form).toContainText(new RegExp(`leur traitement auprès de ${FULL_PROFILE.display_name}\\.`));
    await expect(consent(page)).toBeVisible();
    await expect(consent(page)).not.toBeChecked();
    const required = (await consent(page).getAttribute("required")) !== null || (await consent(page).getAttribute("aria-required")) === "true";
    expect(required, "case de consentement obligatoire").toBe(true);
    await expect(consent(page)).toHaveAccessibleName(new RegExp(FULL_PROFILE.display_name));
  });

  test("critère 6 : champs étiquetés, types natifs, bouton d'envoi nommé", async ({ page }) => {
    const profile = await createProfile();
    await openPublicPage(page, profile.slug);
    await openForm(page);

    await expect(field(page, LABELS.name)).toBeVisible();
    await expect(field(page, LABELS.email)).toHaveAttribute("type", "email");
    await expect(field(page, LABELS.message)).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(leadForm(page).getByRole("button", { name: SEND, exact: true })).toBeVisible();
  });
});

test.describe("éditeur : interrupteur « Recevoir des messages » (décision 1)", () => {
  test("décision 1 : activé par défaut ; désactivé et enregistré → plus de formulaire sur la page publique ; réactivé → de retour", async ({
    page,
  }) => {
    const profile = await createProfile();
    await signInAs(page, profile.email);
    await page.goto("/tableau-de-bord/profil");
    const toggle = page.getByRole("switch", { name: "Recevoir des messages", exact: true });
    await expect(toggle).toHaveAttribute("type", "checkbox");
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Modifications enregistrées." })).toBeVisible();
    await expect.poll(async () => (await profileFieldsOf(profile.profileId)).accepts_leads).toBe(false);

    await page.goto(`/p/${profile.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);

    await page.goto("/tableau-de-bord/profil");
    await page.getByRole("switch", { name: "Recevoir des messages", exact: true }).check();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Modifications enregistrées." })).toBeVisible();
    await expect.poll(async () => (await profileFieldsOf(profile.profileId)).accepts_leads).toBe(true);

    await page.goto(`/p/${profile.slug}`);
    await expect(openButton(page)).toBeVisible();
  });
});

test.describe("Mes messages : accès (décision 5)", () => {
  test("lien « Mes messages » depuis le tableau de bord", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const link = page.getByRole("link", { name: "Mes messages", exact: true });
    await expect(link).toHaveAttribute("href", MESSAGES_PATH);
    await link.click();

    await expect(page.getByRole("heading", { level: 1, name: "Mes messages" })).toBeVisible();
  });

  test("sans session → /connexion", async ({ page }) => {
    await page.goto(MESSAGES_PATH);

    await expect(page).toHaveURL(/\/connexion/);
  });

  test("page dynamique, Cache-Control no-store ; aucun message → état vide", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const response = await page.goto(MESSAGES_PATH);

    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store/);
    await expect(main(page).getByText(EMPTY).first()).toBeVisible();
    await expect(items(page)).toHaveCount(0);
  });

  test("critère 4 : un autre propriétaire ne voit jamais ces messages", async ({ page }) => {
    const owner = await createProfile();
    await seedNumbered(owner, 3);
    const other = await createProfile();

    await openMessages(page, other.email);

    await expect(main(page).getByText(EMPTY).first()).toBeVisible();
    await expect(main(page).getByText(/Visiteur \d+/)).toHaveCount(0);
  });
});

test.describe("Mes messages : liste (décisions 5, 10 et 11)", () => {
  test("décision 5 : plus récent d'abord ; nom, e-mail et message de chaque visiteur", async ({ page }) => {
    const profile = await createProfile();
    await seedNumbered(profile, 3);

    await openMessages(page, profile.email);

    expect(await itemNames(page)).toStrictEqual(names(0, 3));
    await expect(items(page).first()).toContainText("visiteur-0@example.test");
    await expect(items(page).first()).toContainText("Message numéro 0");
    await expect(page.getByRole("link", { name: OLDER, exact: true })).toHaveCount(0);
  });

  test("décision 10 : 45 messages → pages de 20 par « Messages plus anciens », dans l'ordre, sans perte ni doublon", async ({ page }) => {
    const profile = await createProfile();
    await seedNumbered(profile, 45);
    await openMessages(page, profile.email);

    expect(await itemNames(page)).toStrictEqual(names(0, 20));
    const older = page.getByRole("link", { name: OLDER, exact: true });
    await expect(older).toHaveAttribute("href", /[?&]avant=[A-Za-z0-9_-]+/);

    await older.click();
    await expect(page).toHaveURL(/[?&]avant=/);
    await expect.poll(() => itemNames(page)).toStrictEqual(names(20, 40));

    await page.getByRole("link", { name: OLDER, exact: true }).click();
    await expect.poll(() => itemNames(page)).toStrictEqual(names(40, 45));
    await expect(page.getByRole("link", { name: OLDER, exact: true })).toHaveCount(0);
  });

  test("décision 10 : liste rendue par le serveur — pagination sans JavaScript", async ({ page, browser }) => {
    const profile = await createProfile();
    await seedNumbered(profile, 25);
    await signIn(page, profile.email);
    const noScript = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
      storageState: await page.context().storageState(),
    });
    const staticPage = await noScript.newPage();

    await staticPage.goto(new URL(MESSAGES_PATH, page.url()).toString());
    expect(await itemNames(staticPage)).toStrictEqual(names(0, 20));
    await staticPage.getByRole("link", { name: OLDER, exact: true }).click();
    await expect.poll(() => itemNames(staticPage)).toStrictEqual(names(20, 25));

    await noScript.close();
  });

  test("décision 10 : ?avant= invalide → première page", async ({ page }) => {
    const profile = await createProfile();
    await seedNumbered(profile, 25);

    await openMessages(page, profile.email, "?avant=pas-un-curseur");

    expect(await itemNames(page)).toStrictEqual(names(0, 20));
  });

  test("décision 11 : message affiché en texte brut — HTML littéral, aucun lien automatique", async ({ page }) => {
    const profile = await createProfile();
    const message = '<b>gras</b> <img src="x" onerror="window.__xss=1"> <a href="https://piege.example/">lien</a> https://exemple.example/page';
    await seedLeads(profile.profileId, [{ name: "Visiteur HTML", email: "html@example.test", message, createdAt: minutesAgo(1) }]);

    await openMessages(page, profile.email);

    const item = items(page).filter({ hasText: "Visiteur HTML" });
    await expect(item).toContainText("<b>gras</b>");
    await expect(item).toContainText('<img src="x" onerror="window.__xss=1">');
    await expect(item.locator("b, img, a[href*='piege.example'], a[href*='exemple.example']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

test.describe("Mes messages : suppression avec confirmation (critère 4)", () => {
  test("critère 4 : « Annuler » garde le message ; « Supprimer le message » le supprime (page et base)", async ({ page }) => {
    const profile = await createProfile();
    await seedNumbered(profile, 2);
    await openMessages(page, profile.email);

    const target = items(page).filter({ hasText: "Visiteur 0" });
    await target.getByRole("button", { name: /^Supprimer/ }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toContainText(/définitivement/i);
    await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await storedLeads(profile.profileId)).toHaveLength(2);

    await target.getByRole("button", { name: /^Supprimer/ }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Supprimer le message", exact: true }).click();

    await expect(items(page).filter({ hasText: "Visiteur 0" })).toHaveCount(0);
    await expect(items(page).filter({ hasText: "Visiteur 1" })).toHaveCount(1);
    expect((await storedLeads(profile.profileId)).map((lead) => lead.name)).toStrictEqual(["Visiteur 1"]);
  });
});
