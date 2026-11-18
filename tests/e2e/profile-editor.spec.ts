import { expect, test, type APIResponse, type Locator, type Page, type Request } from "@playwright/test";

import { newClientAddress, workerAddress } from "./helpers/accounts";
import { colorsOf, contrastRatio, cssRgb, focusIndicatorColorsOf, relativeLuminance } from "./helpers/contrast";
import { linksOf, profileFieldsOf, signInAs, websiteLinks, type StoredLink } from "./helpers/profile-editor";
import { FULL_PROFILE, createProfile, type LinkFixture, type ProfileFixture } from "./helpers/public-profile";
import { unfoldVCard } from "./helpers/vcard";

/**
 * Contrat de balisage de l'éditeur `/tableau-de-bord/profil` (fiche 0020), figé par ces tests :
 *
 * Accès
 * - `/tableau-de-bord` : lien nommé exactement « Modifier mon profil » (`href="/tableau-de-bord/profil"`) et un lien
 *   dont le `href` se termine par `/p/{slug}`.
 * - Éditeur : le slug est affiché en texte, avec un lien dont le `href` se termine par `/p/{slug}` ; aucun champ
 *   (`input`, `textarea`, `select`) ne porte le slug ni le nom `slug`.
 * - Sans session (page ou action) : redirection vers `/connexion`.
 *
 * Champs (libellé `<label for>` exact, champ natif)
 * - « Nom affiché », « Poste », « Entreprise », « Bio » (`textarea`), « E-mail public » (`type="email"`),
 *   « Téléphone » (`type="tel"`), « Site web », dans cet ordre.
 * - Bio : compteur visible « {n} / 500 » (espaces facultatifs autour de « / »).
 * - Interrupteurs : `<input type="checkbox" role="switch">` nommés « Profil publié » et
 *   « Visible dans les moteurs de recherche » ; cible (l'input ou son `<label>`) d'au moins 44 px de haut.
 * - Téléphone renseigné : texte « Ce numéro sera visible publiquement sur votre profil. » visible.
 *
 * Liens
 * - Chaque lien est un `group` (`<fieldset>` + `<legend>`) nommé exactement « Lien 1 », « Lien 2 »… dans l'ordre
 *   affiché ; il contient un `<select>` natif « Plateforme » (options : noms de `PLATFORM_NAMES`, ex. « LinkedIn »,
 *   « Site web », « WhatsApp »), un champ « URL », un champ « Libellé (facultatif) » et trois boutons dont le nom
 *   accessible commence par « Monter », « Descendre », « Supprimer » (ex. « Monter le lien 2 »).
 * - « Monter » du premier lien et « Descendre » du dernier sont désactivés ; après un déplacement au clavier,
 *   le focus reste dans le groupe du lien déplacé.
 * - Bouton « Ajouter un lien » : ajoute un groupe en fin de liste ; désactivé à 12 liens.
 * - Plateforme WhatsApp : le groupe affiche « Ce numéro sera visible publiquement sur votre profil. ».
 *
 * Enregistrement
 * - Un seul bouton « Enregistrer » enregistre tout le formulaire (profil puis liens), placé après tous les champs
 *   et tous les liens dans l'ordre de tabulation ; aucun `tabindex` positif.
 * - Succès : `role="status"` contenant « Modifications enregistrées. ».
 * - Refus : `role="alert"` contenant « Vérifiez les champs signalés. » ; chaque champ fautif porte
 *   `aria-invalid="true"` et `aria-describedby` vers un message français qui ne reprend pas la valeur saisie :
 *   site ou URL de lien non `https://` → message contenant « https:// » ; téléphone invalide → message contenant
 *   « numéro de téléphone ».
 *
 * Aperçu
 * - Région nommée « Aperçu » (`<section aria-label="Aperçu">` ou équivalent) rendant la carte de 0018 depuis l'état
 *   du formulaire, sans enregistrer.
 * - Écran large (≥ 1024 px) : formulaire et aperçu visibles ensemble, pas de bascule.
 * - Petit écran (profils iPhone 15 et Pixel 7) : boutons « Modifier » et « Aperçu » (`aria-pressed` sur le bouton
 *   actif) ; un seul des deux panneaux visible, l'état saisi conservé d'un panneau à l'autre.
 * - `/v/{slug}` n'apparaît jamais en clair dans la page servie (décision 11).
 * - Aperçu `inert` (décision 12) : aucun lien ni bouton de la carte n'est focalisable ; le formulaire reste actif.
 *
 * Thème : l'éditeur reste dans le thème sombre de l'application (fond #0A0A0C), même quand l'appareil préfère le
 * clair (l'aperçu n'emporte pas le `data-theme="system"` de la page publique).
 */

/** Same per-worker address as the other specs; every sign-in of this file moves to its own fresh address (`signInAs`). */
test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const EDITOR_PATH = "/tableau-de-bord/profil";

const LABELS = {
  displayName: "Nom affiché",
  jobTitle: "Poste",
  company: "Entreprise",
  bio: "Bio",
  contactEmail: "E-mail public",
  phone: "Téléphone",
  websiteUrl: "Site web",
  platform: "Plateforme",
  url: "URL",
  linkLabel: "Libellé (facultatif)",
} as const;
const SWITCHES = { published: "Profil publié", indexable: "Visible dans les moteurs de recherche" } as const;
const BUTTONS = {
  save: "Enregistrer",
  addLink: "Ajouter un lien",
  edit: "Modifier",
  preview: "Aperçu",
  editProfile: "Modifier mon profil",
} as const;
const MOVE_UP = /^Monter/;
const MOVE_DOWN = /^Descendre/;
const REMOVE = /^Supprimer/;
const MESSAGES = {
  saved: "Modifications enregistrées.",
  checkFields: "Vérifiez les champs signalés.",
  publicNumber: /ce numéro sera visible publiquement sur votre profil/i,
  httpsRequired: /https:\/\//,
  invalidPhone: /num[ée]ro de t[ée]l[ée]phone/i,
} as const;

const PREVIEW_REGION = "Aperçu";
const LINK_GROUP = /^Lien \d+$/;
const BIO_MAX = 500;
const MAX_LINKS = 12;
const MIN_TARGET_PX = 44;
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const CARBON_BLACK = "rgb(10, 10, 12)";
const EMERALD = "rgb(0, 200, 150)";
const WIDE_VIEWPORT = { width: 1280, height: 900 };
const REDIRECT_STATUSES = [302, 303, 307, 308];
const QUIET_MS = 500;

/** Optional fields cleared: the editor starts from a profile that only has its name. */
const BLANK_FIELDS = {
  job_title: null,
  company: null,
  bio: null,
  contact_email: null,
  phone: null,
  website_url: null,
  is_published: false,
  is_indexable: false,
} as const;

const LINKEDIN: LinkFixture = { platform: "linkedin", url: "https://www.linkedin.com/in/e2e-editeur", label: null };
const GITHUB: LinkFixture = { platform: "github", url: "https://github.com/e2e-editeur", label: null };
const PORTFOLIO: LinkFixture = { platform: "website", url: "https://e2e-editeur.example/portfolio", label: "Portfolio" };

// ---------------------------------------------------------------------------------------------------------------
// Locators and actions

function field(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

function toggle(page: Page, name: string): Locator {
  return page.getByRole("switch", { name, exact: true });
}

function button(scope: Page | Locator, name: string | RegExp): Locator {
  return scope.getByRole("button", typeof name === "string" ? { name, exact: true } : { name });
}

function preview(page: Page): Locator {
  return page.getByRole("region", { name: PREVIEW_REGION, exact: true });
}

function linkGroup(page: Page, position: number): Locator {
  return page.getByRole("group", { name: `Lien ${position}`, exact: true });
}

function linkGroups(page: Page): Locator {
  return page.getByRole("group", { name: LINK_GROUP });
}

function savedStatus(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: MESSAGES.saved });
}

function checkFieldsAlert(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: MESSAGES.checkFields });
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_PATH);
  await expect(page).toHaveURL(new RegExp(`${EDITOR_PATH}$`));
}

async function signInToEditor(page: Page, fixture: ProfileFixture): Promise<void> {
  await signInAs(page, fixture.email);
  await openEditor(page);
}

/**
 * Clicks « Enregistrer » and waits until every POST it triggered (the two Server Actions, one after the other) has
 * settled and no new one started for `QUIET_MS`.
 */
async function submit(page: Page): Promise<void> {
  const pending = new Set<Request>();
  let posted = 0;
  let lastActivity = Date.now();
  const started = (request: Request): void => {
    if (request.method() === "POST") {
      posted += 1;
      pending.add(request);
      lastActivity = Date.now();
    }
  };
  const settled = (request: Request): void => {
    if (pending.delete(request)) {
      lastActivity = Date.now();
    }
  };
  page.on("request", started);
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  try {
    await button(page, BUTTONS.save).click();
    await expect
      .poll(() => posted > 0 && pending.size === 0 && Date.now() - lastActivity >= QUIET_MS, {
        message: "Server Actions envoyées et terminées",
      })
      .toBe(true);
  } finally {
    page.off("request", started);
    page.off("requestfinished", settled);
    page.off("requestfailed", settled);
  }
}

async function save(page: Page): Promise<void> {
  await submit(page);
  await expect(savedStatus(page)).toBeVisible();
}

async function fillLink(group: Locator, link: LinkFixture, platformName: string): Promise<void> {
  await group.getByLabel(LABELS.platform, { exact: true }).selectOption({ label: platformName });
  await group.getByLabel(LABELS.url, { exact: true }).fill(link.url);
  await group.getByLabel(LABELS.linkLabel, { exact: true }).fill(link.label ?? "");
}

async function expectLinkGroup(page: Page, position: number, link: LinkFixture): Promise<void> {
  await expect(linkGroup(page, position).getByLabel(LABELS.url, { exact: true }), `URL du lien ${position}`).toHaveValue(
    link.url,
  );
}

/** Texts read by assistive technology for an invalid field: those of the elements its `aria-describedby` points to. */
async function descriptionOf(page: Page, target: Locator): Promise<string> {
  const ids = ((await target.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter((id) => id !== "");
  const texts: string[] = [];
  for (const id of ids) {
    texts.push((await page.locator(`[id="${id}"]`).allTextContents()).join(" ").trim());
  }
  return texts.join(" ");
}

async function expectFieldError(page: Page, target: Locator, message: RegExp, submitted: string): Promise<void> {
  await expect(target).toHaveAttribute("aria-invalid", "true");
  const description = await descriptionOf(page, target);
  expect(description, "message décrit par aria-describedby").toMatch(message);
  expect(description, "la valeur saisie n'est pas reprise").not.toContain(submitted);
}

/** The `<label for>` of a control, or the `<label>` that wraps it. */
function labelOf(page: Page, control: Locator, id: string | null): Locator {
  const wrapping = control.locator("xpath=ancestor::label");
  return id === null ? wrapping : page.locator(`label[for="${id}"]`).or(wrapping).first();
}

async function expectMinTarget(target: Locator, label: string, checkWidth = false): Promise<void> {
  const box = await target.boundingBox();
  expect.soft(box, `${label} : boîte`).not.toBeNull();
  expect.soft(box?.height ?? 0, `${label} : hauteur`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  if (checkWidth) {
    expect.soft(box?.width ?? 0, `${label} : largeur`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  }
}

/** Dark theme: text lighter than its background, ratio at least `minimum`. */
async function expectDarkContrast(target: Locator, minimum: number, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  expect.soft(relativeLuminance(text), `${label} : texte ${cssRgb(text)} plus clair que ${cssRgb(background)}`).toBeGreaterThan(
    relativeLuminance(background),
  );
  const ratio = contrastRatio(text, background);
  expect.soft(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
}

/** Non-text contrast of a control: its border or its own background against what surrounds it, the best of the two. */
async function expectControlVisible(target: Locator, label: string): Promise<void> {
  const { border, background, outerBackground } = await colorsOf(target);
  const ratios = [contrastRatio(background, outerBackground), border === null ? 1 : contrastRatio(border, outerBackground)];
  const best = Math.max(...ratios);
  expect
    .soft(best, `${label} : bordure ${border === null ? "absente" : cssRgb(border)} / fond ${cssRgb(background)} sur ${cssRgb(outerBackground)} = ${best.toFixed(2)}:1`)
    .toBeGreaterThanOrEqual(NON_TEXT_MIN);
}

function expectRedirectToSignIn(response: APIResponse, label: string): void {
  expect(REDIRECT_STATUSES, `${label} : statut ${response.status()}`).toContain(response.status());
  expect(response.headers()["location"], `${label} : en-tête location`).toMatch(/\/connexion(\?|$)/);
}

function idsOf(links: readonly StoredLink[]): string[] {
  return links.map((link) => link.id);
}

function byUrl(links: readonly StoredLink[], url: string): StoredLink {
  const found = links.find((link) => link.url === url);
  if (found === undefined) {
    throw new Error(`no stored link with url ${url}`);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe("éditeur de profil : accès (0020, critère 4)", () => {
  test("critère 4 : /tableau-de-bord/profil sans session → redirection /connexion", async ({ page }) => {
    await page.goto(EDITOR_PATH);

    await expect(page).toHaveURL(/\/connexion$/);
    await expect(button(page, BUTTONS.save)).toHaveCount(0);
  });

  test("critère 4 : GET /tableau-de-bord/profil sans cookie, proxy contourné (x-middleware-subrequest) → redirection rendue par la page, aucun contenu", async ({
    request,
  }) => {
    for (const value of [undefined, "middleware", "src/middleware", "proxy", "src/proxy"]) {
      const response = await request.get(EDITOR_PATH, {
        headers: value === undefined ? {} : { "x-middleware-subrequest": value },
        maxRedirects: 0,
      });

      expectRedirectToSignIn(response, `x-middleware-subrequest=${value ?? "<absent>"}`);
      const body = await response.text();
      expect(body).not.toContain(BUTTONS.save);
      expect(body).not.toContain(LABELS.linkLabel);
    }
  });

  test("critère 4 : action d'enregistrement sans session (cookies effacés après chargement) → /connexion, rien n'est écrit", async ({
    page,
    context,
  }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);
    await field(page, LABELS.jobTitle).fill("Poste écrit sans session");

    await context.clearCookies();
    await button(page, BUTTONS.save).click();

    await expect(page).toHaveURL(/\/connexion$/);
    expect((await profileFieldsOf(profile.profileId)).job_title).toBeNull();
  });

  test("décision 1 : le tableau de bord mène à l'éditeur (« Modifier mon profil ») et à la page publique", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInAs(page, profile.email);

    await expect(page.locator(`a[href$="/p/${profile.slug}"]`).first()).toBeVisible();
    const editorLink = page.getByRole("link", { name: BUTTONS.editProfile, exact: true });
    await expect(editorLink).toHaveAttribute("href", EDITOR_PATH);
    await editorLink.click();

    await expect(page).toHaveURL(new RegExp(`${EDITOR_PATH}$`));
    await expect(field(page, LABELS.displayName)).toHaveValue(FULL_PROFILE.display_name);
  });

  test("décision 5 : slug affiché avec un lien vers /p/{slug}, non modifiable", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);

    await expect(page.getByText(profile.slug).first()).toBeVisible();
    await expect(page.locator(`a[href$="/p/${profile.slug}"]`).first()).toBeVisible();
    await expect(page.locator('[name="slug"]')).toHaveCount(0);
    const values = await page
      .locator("input, textarea, select")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
    expect(values, "aucun champ ne porte le slug").not.toContain(profile.slug);
  });

  test("décision 11 : /v/{slug} jamais en clair", async ({ page }) => {
    const profile = await createProfile({ is_published: true });
    await signInAs(page, profile.email);

    const response = await page.goto(EDITOR_PATH);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");

    const sources = { "HTML servi": (await response?.text()) ?? "", DOM: await page.content() };
    for (const [source, html] of Object.entries(sources)) {
      expect.soft(html, `${source} : /v/${profile.slug}`).not.toContain(`/v/${profile.slug}`);
      expect.soft(html, `${source} : href vers /v/`).not.toMatch(/href=["'][^"']*\/v\//i);
    }
  });
});

test.describe("éditeur de profil : aperçu en direct sur écran large (0020, critère 1)", () => {
  test.use({ viewport: WIDE_VIEWPORT });

  test("critère 1 : modifier nom, poste et liens met à jour l'aperçu sans rien enregistrer", async ({ page }) => {
    const profile = await createProfile({ is_published: false });
    await signInToEditor(page, profile);
    const card = preview(page);
    await expect(card).toBeVisible();
    await expect(field(page, LABELS.displayName)).toBeVisible();
    await expect(button(page, BUTTONS.preview)).toBeHidden();

    await field(page, LABELS.displayName).fill("Nom tapé dans l'éditeur");
    await field(page, LABELS.jobTitle).fill("Poste tapé dans l'éditeur");
    await button(page, BUTTONS.addLink).click();
    await fillLink(linkGroup(page, 1), LINKEDIN, "LinkedIn");

    await expect(card.getByRole("heading", { name: "Nom tapé dans l'éditeur" })).toBeVisible();
    await expect(card.getByText("Poste tapé dans l'éditeur")).toBeVisible();
    await expect(card.locator(`a[href="${LINKEDIN.url}"]`)).toBeVisible();

    const stored = await profileFieldsOf(profile.profileId);
    expect(stored.display_name).toBe(FULL_PROFILE.display_name);
    expect(stored.job_title).toBe(FULL_PROFILE.job_title);
    expect(await linksOf(profile.profileId)).toStrictEqual([]);
  });

  test("décision 12 : aperçu inert — ni lien ni bouton de la carte focalisable (pas de téléchargement de la vCard ni de navigation)", async ({
    page,
  }) => {
    const profile = await createProfile({ is_published: true }, [LINKEDIN, GITHUB]);
    await signInToEditor(page, profile);
    const card = preview(page);
    await expect(card).toBeVisible();
    const controls = card.locator("a, button");
    expect(await controls.count(), "la carte contient des liens et boutons").toBeGreaterThan(0);

    const previewIsInert = await card.evaluate(
      (region) => region.closest("[inert]") !== null || region.querySelector("[inert]") !== null,
    );
    expect.soft(previewIsInert, "attribut inert sur l'aperçu").toBe(true);

    const focusable = await controls.evaluateAll((nodes) =>
      nodes.filter((node) => {
        (node as HTMLElement).focus();
        return document.activeElement === node;
      }).map((node) => node.outerHTML.slice(0, 80)),
    );
    expect(focusable, "éléments de l'aperçu focalisables").toStrictEqual([]);

    await field(page, LABELS.jobTitle).focus();
    await expect(field(page, LABELS.jobTitle)).toBeFocused();
  });
});

test.describe("éditeur de profil : bascule « Modifier / Aperçu » sur petit écran (0020, décision 4)", () => {
  test("décision 4 : un seul panneau visible, la saisie apparaît dans l'aperçu et reste dans le formulaire", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);
    const edit = button(page, BUTTONS.edit);
    const show = button(page, BUTTONS.preview);

    await expect(edit).toBeVisible();
    await expect(show).toBeVisible();
    await expect(edit).toHaveAttribute("aria-pressed", "true");
    await expect(field(page, LABELS.jobTitle)).toBeVisible();
    await expect(preview(page)).toBeHidden();

    await field(page, LABELS.jobTitle).fill("Poste vu dans l'aperçu");
    await show.click();

    await expect(show).toHaveAttribute("aria-pressed", "true");
    await expect(preview(page)).toBeVisible();
    await expect(preview(page).getByText("Poste vu dans l'aperçu")).toBeVisible();
    await expect(field(page, LABELS.jobTitle)).toBeHidden();

    await edit.click();

    await expect(field(page, LABELS.jobTitle)).toBeVisible();
    await expect(field(page, LABELS.jobTitle)).toHaveValue("Poste vu dans l'aperçu");
    await expect(preview(page)).toBeHidden();
    expect((await profileFieldsOf(profile.profileId)).job_title).toBeNull();
  });
});

test.describe("éditeur de profil : enregistrement des champs (0020, critère 1)", () => {
  test("critère 1 : nom, poste, entreprise, bio (compteur), e-mail public, téléphone, site → enregistrés, conservés après rechargement", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS);
    const values = {
      displayName: "Élodie Mérel E2E",
      jobTitle: "Paysagiste",
      company: "Jardins Mérel",
      bio: "Jardins secs et sobres,\nconçus pour durer.",
      contactEmail: "jardins.contact@example.test",
      phone: "+33 6 98 76 54 32",
      websiteUrl: "https://jardins-merel.example/",
    };
    await signInToEditor(page, profile);

    await field(page, LABELS.displayName).fill(values.displayName);
    await field(page, LABELS.jobTitle).fill(values.jobTitle);
    await field(page, LABELS.company).fill(values.company);
    await field(page, LABELS.bio).fill(values.bio);
    await expect(page.getByText(new RegExp(`^\\s*${values.bio.length}\\s*/\\s*${BIO_MAX}\\s*$`))).toBeVisible();
    await field(page, LABELS.contactEmail).fill(values.contactEmail);
    await field(page, LABELS.phone).fill(values.phone);
    await field(page, LABELS.websiteUrl).fill(values.websiteUrl);
    await save(page);

    await expect
      .poll(() => profileFieldsOf(profile.profileId))
      .toStrictEqual({
        display_name: values.displayName,
        job_title: values.jobTitle,
        company: values.company,
        bio: values.bio,
        contact_email: values.contactEmail,
        phone: values.phone,
        website_url: values.websiteUrl,
        is_published: false,
        is_indexable: false,
        accepts_leads: true,
      });

    await page.reload();
    for (const [name, value] of Object.entries(values)) {
      await expect(field(page, LABELS[name as keyof typeof values]), name).toHaveValue(value);
    }
    await expect(page.getByText(new RegExp(`^\\s*${values.bio.length}\\s*/\\s*${BIO_MAX}\\s*$`))).toBeVisible();
    await expect(toggle(page, SWITCHES.published)).not.toBeChecked();
    await expect(toggle(page, SWITCHES.indexable)).not.toBeChecked();
  });

  test("critère 1 : interrupteur « Visible dans les moteurs de recherche » enregistré", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);

    await toggle(page, SWITCHES.indexable).check();
    await save(page);

    await expect.poll(async () => (await profileFieldsOf(profile.profileId)).is_indexable).toBe(true);
    await page.reload();
    await expect(toggle(page, SWITCHES.indexable)).toBeChecked();
  });

  test("critères 2 et 5 : site en http:// et téléphone invalide → erreurs par champ en français, annoncées, rien n'est écrit", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS);
    const httpUrl = "http://jardins-merel.example/";
    const badPhone = "06 12 AB 34";
    await signInToEditor(page, profile);

    await field(page, LABELS.jobTitle).fill("Poste non enregistré");
    await field(page, LABELS.websiteUrl).fill(httpUrl);
    await field(page, LABELS.phone).fill(badPhone);
    await button(page, BUTTONS.save).click();

    await expect(checkFieldsAlert(page)).toBeVisible();
    await expectFieldError(page, field(page, LABELS.websiteUrl), MESSAGES.httpsRequired, httpUrl);
    await expectFieldError(page, field(page, LABELS.phone), MESSAGES.invalidPhone, badPhone);
    await expect(field(page, LABELS.jobTitle)).not.toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(new RegExp(`${EDITOR_PATH}$`));

    const stored = await profileFieldsOf(profile.profileId);
    expect(stored.job_title).toBeNull();
    expect(stored.website_url).toBeNull();
    expect(stored.phone).toBeNull();
  });

  test("décision 6 : téléphone renseigné → « ce numéro sera visible publiquement sur votre profil »", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);

    await field(page, LABELS.phone).fill("+33 6 98 76 54 32");

    await expect(page.getByText(MESSAGES.publicNumber).first()).toBeVisible();
  });
});

test.describe("éditeur de profil : liens (0020, critère 2)", () => {
  test("critère 2 : ajout, réordonnancement au clavier, suppression → enregistrés, conservés après rechargement, id des liens existants conservés", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN, GITHUB]);
    const seeded = await linksOf(profile.profileId);
    await signInToEditor(page, profile);
    await expect(linkGroups(page)).toHaveCount(2);
    await expectLinkGroup(page, 1, LINKEDIN);
    await expectLinkGroup(page, 2, GITHUB);

    await button(page, BUTTONS.addLink).click();
    await expect(linkGroups(page)).toHaveCount(3);
    await fillLink(linkGroup(page, 3), PORTFOLIO, "Site web");

    await button(linkGroup(page, 3), MOVE_UP).focus();
    await page.keyboard.press("Enter");
    await expectLinkGroup(page, 2, PORTFOLIO);
    await expectLinkGroup(page, 3, GITHUB);
    await expect(linkGroup(page, 2).locator(":focus"), "focus dans le lien déplacé").toHaveCount(1);

    await button(linkGroup(page, 1), MOVE_DOWN).focus();
    await page.keyboard.press("Space");
    await expectLinkGroup(page, 1, PORTFOLIO);
    await expectLinkGroup(page, 2, LINKEDIN);
    await expectLinkGroup(page, 3, GITHUB);
    await expect(button(linkGroup(page, 1), MOVE_UP)).toBeDisabled();
    await expect(button(linkGroup(page, 3), MOVE_DOWN)).toBeDisabled();

    await save(page);

    await expect.poll(async () => (await linksOf(profile.profileId)).map((link) => link.url)).toStrictEqual([
      PORTFOLIO.url,
      LINKEDIN.url,
      GITHUB.url,
    ]);
    const afterFirstSave = await linksOf(profile.profileId);
    expect(afterFirstSave.map((link) => link.position)).toStrictEqual([0, 1, 2]);
    expect(byUrl(afterFirstSave, LINKEDIN.url).id, "id LinkedIn conservé").toBe(byUrl(seeded, LINKEDIN.url).id);
    expect(byUrl(afterFirstSave, GITHUB.url).id, "id GitHub conservé").toBe(byUrl(seeded, GITHUB.url).id);
    expect(idsOf(seeded), "le nouveau lien reçoit un nouvel id").not.toContain(byUrl(afterFirstSave, PORTFOLIO.url).id);
    expect(byUrl(afterFirstSave, PORTFOLIO.url)).toMatchObject({ platform: "website", label: PORTFOLIO.label });

    await page.reload();
    await expect(linkGroups(page)).toHaveCount(3);
    await expectLinkGroup(page, 1, PORTFOLIO);
    await expect(linkGroup(page, 1).getByLabel(LABELS.linkLabel, { exact: true })).toHaveValue(PORTFOLIO.label ?? "");
    await expectLinkGroup(page, 2, LINKEDIN);
    await expectLinkGroup(page, 3, GITHUB);

    await button(linkGroup(page, 2), REMOVE).click();
    await expect(linkGroups(page)).toHaveCount(2);
    await save(page);

    await expect.poll(async () => (await linksOf(profile.profileId)).map((link) => link.url)).toStrictEqual([
      PORTFOLIO.url,
      GITHUB.url,
    ]);
    const afterRemoval = await linksOf(profile.profileId);
    expect(idsOf(afterRemoval)).toStrictEqual([byUrl(afterFirstSave, PORTFOLIO.url).id, byUrl(seeded, GITHUB.url).id]);
    expect(afterRemoval.map((link) => link.position)).toStrictEqual([0, 1]);
  });

  test("idempotence : enregistrer deux fois la même liste (rechargement entre les deux) → aucun lien en double, mêmes id et positions", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN, GITHUB]);
    const seeded = await linksOf(profile.profileId);
    await signInToEditor(page, profile);

    await save(page);
    await page.reload();
    await save(page);

    await expect.poll(() => linksOf(profile.profileId)).toStrictEqual(seeded);
  });

  test("critère 2 : 13e lien impossible — « Ajouter un lien » désactivé à 12, les 12 liens enregistrés", async ({ page }) => {
    const seededLinks = websiteLinks(MAX_LINKS - 1);
    const profile = await createProfile(BLANK_FIELDS, seededLinks);
    await signInToEditor(page, profile);
    await expect(linkGroups(page)).toHaveCount(MAX_LINKS - 1);
    await expect(button(page, BUTTONS.addLink)).toBeEnabled();

    await button(page, BUTTONS.addLink).click();
    await fillLink(linkGroup(page, MAX_LINKS), PORTFOLIO, "Site web");

    await expect(linkGroups(page)).toHaveCount(MAX_LINKS);
    await expect(button(page, BUTTONS.addLink)).toBeDisabled();
    await button(page, BUTTONS.addLink).click({ force: true }).catch(() => undefined);
    await expect(linkGroups(page)).toHaveCount(MAX_LINKS);

    await save(page);

    await expect.poll(async () => (await linksOf(profile.profileId)).map((link) => link.url)).toStrictEqual([
      ...seededLinks.map((link) => link.url),
      PORTFOLIO.url,
    ]);
  });

  test("critère 2, décision 12 : profil enregistré, liens refusés (URL en http://) → alerte complète, erreur sur le champ URL, profil écrit en base, liste inchangée, saisie conservée", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN]);
    const seeded = await linksOf(profile.profileId);
    const httpUrl = "http://e2e-editeur.example/portfolio";
    const jobTitle = "Poste enregistré malgré les liens";
    await signInToEditor(page, profile);

    await field(page, LABELS.jobTitle).fill(jobTitle);
    await button(page, BUTTONS.addLink).click();
    await fillLink(linkGroup(page, 2), { ...PORTFOLIO, url: httpUrl }, "Site web");
    await submit(page);

    await expect(checkFieldsAlert(page)).toHaveText(
      `${MESSAGES.checkFields} Vos informations ont été enregistrées, mais pas vos liens.`,
    );
    await expectFieldError(page, linkGroup(page, 2).getByLabel(LABELS.url, { exact: true }), MESSAGES.httpsRequired, httpUrl);
    await expect(linkGroup(page, 1).getByLabel(LABELS.url, { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    expect(await linksOf(profile.profileId)).toStrictEqual(seeded);
    expect((await profileFieldsOf(profile.profileId)).job_title, "profil écrit en base").toBe(jobTitle);

    await expect(field(page, LABELS.jobTitle), "saisie conservée").toHaveValue(jobTitle);
    await expect(linkGroups(page)).toHaveCount(2);
    await expectLinkGroup(page, 1, LINKEDIN);
    await expectLinkGroup(page, 2, { ...PORTFOLIO, url: httpUrl });
    const kept = linkGroup(page, 2);
    await expect(kept.getByLabel(LABELS.platform, { exact: true }).locator("option:checked")).toHaveText("Site web");
    await expect(kept.getByLabel(LABELS.linkLabel, { exact: true })).toHaveValue(PORTFOLIO.label ?? "");
  });

  test("décision 6 : lien WhatsApp → « ce numéro sera visible publiquement sur votre profil » dans le groupe du lien", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);

    await button(page, BUTTONS.addLink).click();
    const group = linkGroup(page, 1);
    await group.getByLabel(LABELS.platform, { exact: true }).selectOption({ label: "WhatsApp" });
    await group.getByLabel(LABELS.url, { exact: true }).fill("https://wa.me/33698765432");

    await expect(group.getByText(MESSAGES.publicNumber)).toBeVisible();
  });
});

test.describe("éditeur de profil : publication et revalidation (0020, critère 3 ; 0018, critère 5 reporté)", () => {
  test("critère 3 : 404 déjà en cache → publication → 200 ; modification → visible sur /p/{slug} et /v/{slug} ; dépublication → 404", async ({
    page,
    request,
  }) => {
    const profile = await createProfile({ ...BLANK_FIELDS, job_title: "Poste avant publication" });
    const publicPath = `/p/${profile.slug}`;
    const vcardPath = `/v/${profile.slug}`;
    const newJobTitle = "Paysagiste revalidé E2E";

    expect((await request.get(publicPath, { maxRedirects: 0 })).status(), "1re visite : 404").toBe(404);
    expect((await request.get(publicPath, { maxRedirects: 0 })).status(), "2e visite : 404 servi par le cache").toBe(404);

    await signInToEditor(page, profile);
    await expect(toggle(page, SWITCHES.published)).not.toBeChecked();
    await toggle(page, SWITCHES.published).check();
    await save(page);
    expect((await profileFieldsOf(profile.profileId)).is_published).toBe(true);

    const published = await request.get(publicPath, { maxRedirects: 0 });
    expect(published.status(), "après publication").toBe(200);
    expect(await published.text()).toContain(FULL_PROFILE.display_name);

    await field(page, LABELS.jobTitle).fill(newJobTitle);
    await save(page);

    const updated = await request.get(publicPath, { maxRedirects: 0 });
    expect(updated.status()).toBe(200);
    const updatedHtml = await updated.text();
    expect(updatedHtml, "nouveau poste sur /p/").toContain(newJobTitle);
    expect(updatedHtml, "ancien poste absent de /p/").not.toContain("Poste avant publication");
    const vcard = await request.get(vcardPath, { headers: { "x-forwarded-for": newClientAddress() }, maxRedirects: 0 });
    expect(vcard.status(), `GET ${vcardPath}`).toBe(200);
    expect(unfoldVCard((await vcard.body()).toString("utf8"))).toContain(`TITLE:${newJobTitle}`);

    await toggle(page, SWITCHES.published).uncheck();
    await save(page);

    expect((await request.get(publicPath, { maxRedirects: 0 })).status(), "après dépublication").toBe(404);
    const unpublishedVcard = await request.get(vcardPath, {
      headers: { "x-forwarded-for": newClientAddress() },
      maxRedirects: 0,
    });
    expect(unpublishedVcard.status(), `${vcardPath} après dépublication`).toBe(404);
  });
});

test.describe("éditeur de profil : accessibilité (0020, critère 5)", () => {
  test("critère 5 : champs et interrupteurs étiquetés, cibles ≥ 44 px", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN, GITHUB]);
    await signInToEditor(page, profile);

    for (const label of [LABELS.displayName, LABELS.jobTitle, LABELS.company, LABELS.bio, LABELS.contactEmail, LABELS.phone, LABELS.websiteUrl]) {
      await expect(field(page, label), label).toBeVisible();
      await expectMinTarget(field(page, label), label);
    }
    await expect(field(page, LABELS.bio)).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(field(page, LABELS.contactEmail)).toHaveAttribute("type", "email");
    await expect(field(page, LABELS.phone)).toHaveAttribute("type", "tel");

    for (const name of Object.values(SWITCHES)) {
      const control = toggle(page, name);
      await expect(control, name).toBeVisible();
      await expect(control).toHaveAttribute("type", "checkbox");
      const id = await control.getAttribute("id");
      const controlBox = await control.boundingBox();
      const labelBox = await labelOf(page, control, id).boundingBox();
      expect
        .soft(Math.max(controlBox?.height ?? 0, labelBox?.height ?? 0), `${name} : hauteur de la cible`)
        .toBeGreaterThanOrEqual(MIN_TARGET_PX);
    }

    for (const position of [1, 2]) {
      const group = linkGroup(page, position);
      for (const label of [LABELS.platform, LABELS.url, LABELS.linkLabel]) {
        await expectMinTarget(group.getByLabel(label, { exact: true }), `lien ${position} : ${label}`);
      }
      await expect(group.getByLabel(LABELS.platform, { exact: true })).toHaveJSProperty("tagName", "SELECT");
      for (const name of [MOVE_UP, MOVE_DOWN, REMOVE]) {
        await expectMinTarget(button(group, name), `lien ${position} : ${String(name)}`, true);
      }
    }
    await expectMinTarget(button(page, BUTTONS.addLink), BUTTONS.addLink, true);
    await expectMinTarget(button(page, BUTTONS.save), BUTTONS.save, true);
    await expectMinTarget(button(page, BUTTONS.edit), BUTTONS.edit, true);
    await expectMinTarget(button(page, BUTTONS.preview), BUTTONS.preview, true);
  });

  test("critère 5 : ordre de tabulation logique — champs dans l'ordre, puis liens, « Enregistrer » en dernier ; aucun tabindex positif", async ({
    page,
    browserName,
  }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN, GITHUB]);
    await signInToEditor(page, profile);

    const positiveTabIndexes = await page
      .locator("[tabindex]")
      .evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).tabIndex > 0).length);
    expect(positiveTabIndexes, "éléments à tabindex positif").toBe(0);

    const steps: [string, Locator][] = [
      ["displayName", field(page, LABELS.displayName)],
      ["jobTitle", field(page, LABELS.jobTitle)],
      ["company", field(page, LABELS.company)],
      ["bio", field(page, LABELS.bio)],
      ["contactEmail", field(page, LABELS.contactEmail)],
      ["phone", field(page, LABELS.phone)],
      ["websiteUrl", field(page, LABELS.websiteUrl)],
      ["link1.platform", linkGroup(page, 1).getByLabel(LABELS.platform, { exact: true })],
      ["link1.url", linkGroup(page, 1).getByLabel(LABELS.url, { exact: true })],
      ["link1.label", linkGroup(page, 1).getByLabel(LABELS.linkLabel, { exact: true })],
      ["link2.platform", linkGroup(page, 2).getByLabel(LABELS.platform, { exact: true })],
      ["link2.url", linkGroup(page, 2).getByLabel(LABELS.url, { exact: true })],
      ["link2.label", linkGroup(page, 2).getByLabel(LABELS.linkLabel, { exact: true })],
      ["published", toggle(page, SWITCHES.published)],
      ["indexable", toggle(page, SWITCHES.indexable)],
      ["addLink", button(page, BUTTONS.addLink)],
      ["save", button(page, BUTTONS.save)],
    ];
    for (const [name, target] of steps) {
      await target.evaluate((element, marker) => element.setAttribute("data-e2e-tab", marker), name);
    }

    // Safari only tabs to every control with Option (macOS); the Linux WebKit builds tab to all of them.
    const tabKey = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
    await field(page, LABELS.displayName).focus();
    const visited: string[] = ["displayName"];
    for (let press = 0; press < 80 && !visited.includes("save"); press += 1) {
      await page.keyboard.press(tabKey);
      const marker = await page.evaluate(() => document.activeElement?.getAttribute("data-e2e-tab") ?? null);
      if (marker !== null && !visited.includes(marker)) {
        visited.push(marker);
      }
    }

    expect(visited, "tous les contrôles atteints au clavier").toEqual(expect.arrayContaining(steps.map(([name]) => name)));
    const indexOf = (name: string): number => visited.indexOf(name);
    const fieldOrder = ["displayName", "jobTitle", "company", "bio", "contactEmail", "phone", "websiteUrl"];
    expect(fieldOrder.map(indexOf), "champs dans l'ordre affiché").toStrictEqual([...fieldOrder.map(indexOf)].sort((a, b) => a - b));
    const linkOrder = ["link1.platform", "link1.url", "link1.label", "link2.platform", "link2.url", "link2.label"];
    expect(linkOrder.map(indexOf), "liens dans l'ordre affiché").toStrictEqual([...linkOrder.map(indexOf)].sort((a, b) => a - b));
    expect(indexOf("save"), "« Enregistrer » en dernier").toBe(visited.length - 1);
  });

  test("critère 5 : thème sombre de l'application conservé quand l'appareil préfère le clair", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);
    await expect(preview(page).or(field(page, LABELS.displayName)).first()).toBeVisible();

    const body = await colorsOf(page.locator("body"));
    expect(cssRgb(body.ownBackground.rgb), "fond de body").toBe(CARBON_BLACK);
    const colorScheme = await page.locator("html").evaluate((html) => getComputedStyle(html).colorScheme);
    expect(colorScheme, "color-scheme de html").toBe("dark");
  });

  test("critère 5 : contrastes AA en thème sombre — libellés, compteur, mention publique, slug, bouton « Enregistrer », bordures et focus", async ({
    page,
  }) => {
    const profile = await createProfile(BLANK_FIELDS, [LINKEDIN]);
    await signInToEditor(page, profile);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });

    for (const label of [LABELS.jobTitle, LABELS.bio, LABELS.phone]) {
      const control = field(page, label);
      await expectDarkContrast(labelOf(page, control, await control.getAttribute("id")), TEXT_MIN, `libellé ${label}`);
    }
    await field(page, LABELS.bio).fill("Bio courte.");
    await expectDarkContrast(page.getByText(/^\s*11\s*\/\s*500\s*$/), TEXT_MIN, "compteur de la bio");
    await field(page, LABELS.phone).fill("+33 6 98 76 54 32");
    await expectDarkContrast(page.getByText(MESSAGES.publicNumber).first(), TEXT_MIN, "mention de numéro public");
    await expectDarkContrast(page.locator(`a[href$="/p/${profile.slug}"]`).first(), TEXT_MIN, "lien vers la page publique");

    const saveButton = button(page, BUTTONS.save);
    const saveColors = await colorsOf(saveButton);
    expect.soft(cssRgb(saveColors.background), "fond de « Enregistrer »").toBe(EMERALD);
    expect.soft(contrastRatio(saveColors.text, saveColors.background), "texte de « Enregistrer »").toBeGreaterThanOrEqual(TEXT_MIN);

    await expectControlVisible(field(page, LABELS.bio), "bordure de la bio (textarea)");
    await expectControlVisible(linkGroup(page, 1).getByLabel(LABELS.platform, { exact: true }), "bordure du select Plateforme");
    const published = toggle(page, SWITCHES.published);
    await expectControlVisible(published, "interrupteur désactivé");
    await published.check();
    await expectControlVisible(published, "interrupteur activé");

    for (const [label, target] of [
      ["bio", field(page, LABELS.bio)],
      ["interrupteur", published],
    ] as const) {
      const { border, outerBackground } = await colorsOf(target);
      await target.focus();
      const indicators = await focusIndicatorColorsOf(target, border);
      const best = Math.max(0, ...indicators.map((color) => contrastRatio(color, outerBackground)));
      expect
        .soft(best, `${label} : indicateur de focus [${indicators.map(cssRgb).join(", ")}] sur ${cssRgb(outerBackground)}`)
        .toBeGreaterThanOrEqual(NON_TEXT_MIN);
    }
  });

  test("critère 5 : message d'erreur de champ et alerte ≥ 4,5:1", async ({ page }) => {
    const profile = await createProfile(BLANK_FIELDS);
    await signInToEditor(page, profile);

    await field(page, LABELS.websiteUrl).fill("http://jardins-merel.example/");
    await button(page, BUTTONS.save).click();

    const website = field(page, LABELS.websiteUrl);
    await expect(website).toHaveAttribute("aria-invalid", "true");
    const errorId = (await website.getAttribute("aria-describedby"))?.split(/\s+/)[0] ?? "";
    await expectDarkContrast(page.locator(`[id="${errorId}"]`), TEXT_MIN, "message d'erreur du champ");
    await expectDarkContrast(checkFieldsAlert(page), TEXT_MIN, "alerte");
  });
});
