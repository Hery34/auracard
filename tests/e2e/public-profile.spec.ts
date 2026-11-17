import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

import { newClientAddress } from "./helpers/accounts";
import { colorsOf, contrastRatio, cssRgb } from "./helpers/contrast";
import {
  ALL_PLATFORM_LINKS,
  FULL_PROFILE,
  FULL_PROFILE_INITIALS,
  PHONE_DIGITS,
  WHATSAPP_DIGITS,
  createProfile,
  updateProfileBehindTheCache,
  type LinkFixture,
  type ProfileFixture,
} from "./helpers/public-profile";

/**
 * Contrat de balisage attendu de `/p/{slug}` (fiche 0018) :
 * - nom affiché : `heading` de niveau 1 ; poste, entreprise et bio en texte visible ;
 * - avatar absent → initiales visibles en texte (« ED »), sur fond émeraude #00C896 ;
 * - bouton vCard (décision 10, choix de Hery) : un contrôle (`button` ou `link`) nommé exactement « Ajouter aux contacts »,
 *   d'au moins 44 × 44 px, fond émeraude ; ni `/v/{slug}` ni `href` vers `/v/` dans le HTML servi ni dans le DOM avant
 *   le clic ; au clic, le navigateur télécharge `/v/{slug}` (fichier `{slug}.vcf`) ;
 * - e-mail (décision 10) : revalidé à l'affichage (format strict) ; une valeur hors format n'est ni affichée ni révélée ;
 * - `GET /robots.txt` : `Disallow: /v/` ;
 * - liens du profil (sauf WhatsApp) : `<a href={url}>` dans l'ordre des positions, nom accessible portant la
 *   plateforme (ou le libellé pour `website` et `document`), un `svg[aria-hidden="true"]` et aucun autre svg,
 *   `rel` contenant `noopener noreferrer nofollow ugc`, `target="_blank"` ;
 * - site du profil (`website_url`) : `<a href={url}>`, `rel` contenant `noopener noreferrer`, `target="_blank"` ;
 * - téléphone, e-mail, WhatsApp : ni numéro, ni adresse, ni `tel:`/`mailto:`/`wa.me/<numéro>` dans le HTML servi
 *   ni dans le DOM avant interaction ; un contrôle (`button` ou `link`) nommé /téléphone|appeler/, /e-mail|écrire/,
 *   /WhatsApp/ ; au clic, le DOM contient un `<a href="tel:…">`, `<a href="mailto:…">` ou `<a href="https://wa.me/…">`
 *   (ou bien `window.open` reçoit l'URL) — une affectation de `location` n'est pas observable et ne suffit pas.
 */

const EMERALD = "rgb(0, 200, 150)";
const BACKGROUNDS = { light: "rgb(252, 252, 253)", dark: "rgb(10, 10, 12)" } as const;
const TEXT_MIN = 4.5;

const VCARD_BUTTON = "Ajouter aux contacts";
const VCARD_CONTROL = /^\s*Ajouter aux contacts\s*$/;
const MIN_TARGET_PX = 44;
/** Stored as is through `service_role` (the database only checks length and controls): never shown. */
const INJECTED_EMAIL = "x@y.fr?bcc=a@b.c";
const PHONE_CONTROL = /t[ée]l[ée]phone|appeler/i;
const EMAIL_CONTROL = /e-?mail|[ée]crire/i;
const WHATSAPP_CONTROL = /whatsapp/i;
const IN_APP_MESSAGE = /ouvr\w*[^.]{0,80}navigateur/i;

const ACCESSIBLE_NAMES: Record<LinkFixture["platform"], RegExp> = {
  linkedin: /linkedin/i,
  github: /github/i,
  instagram: /instagram/i,
  x: /\bX\b|twitter/,
  facebook: /facebook/i,
  youtube: /youtube/i,
  tiktok: /tiktok/i,
  website: /Mon blog/,
  document: /Plaquette/,
  whatsapp: /whatsapp/i,
};

const BRAND_PLATFORMS = ["linkedin", "github", "instagram", "x", "facebook", "youtube", "tiktok"] as const;
const ANCHOR_LINKS = ALL_PLATFORM_LINKS.filter((link) => link.platform !== "whatsapp");

/** The digits with any common separator between them (spaces, dots, dashes, brackets). */
function digitsPattern(digits: string): RegExp {
  return new RegExp(digits.split("").join("[\\s.()\\-]{0,3}"));
}

function host(url: string): string {
  return new URL(url).hostname;
}

/** Opened URLs recorded, and default navigation to tel:/mailto:/WhatsApp cancelled once the page's own handlers ran. */
const REVEAL_PROBE = `
  window.__opened = [];
  window.open = function (url) { window.__opened.push(String(url)); return null; };
  window.addEventListener("click", function (event) {
    var anchor = event.target instanceof Element ? event.target.closest("a") : null;
    var href = anchor ? anchor.getAttribute("href") || "" : "";
    if (/^(tel|mailto):/i.test(href) || /wa\\.me|whatsapp\\.com/i.test(href)) event.preventDefault();
  });
`;

async function revealedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...Array.from(document.querySelectorAll("a[href]"), (anchor) => anchor.getAttribute("href") ?? ""),
    ...((window as unknown as { __opened?: string[] }).__opened ?? []),
  ]);
}

function control(page: Page, name: RegExp): Locator {
  return page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
}

function profilePath(slug: string): string {
  return `/p/${slug}`;
}

async function open(page: Page, slug: string): Promise<Response> {
  const response = await page.goto(profilePath(slug));
  if (response === null) {
    throw new Error(`GET ${profilePath(slug)} returned no response`);
  }
  return response;
}

/** The route must serve the published profile: a 404 page never satisfies a test by accident. */
async function openPublished(page: Page, slug: string): Promise<Response> {
  const response = await open(page, slug);
  expect(response.status(), `GET ${profilePath(slug)}`).toBe(200);
  return response;
}

async function expectInDocumentOrder(page: Page, locators: Locator[]): Promise<void> {
  const handles = await Promise.all(locators.map((locator) => locator.elementHandle()));
  const ordered = await page.evaluate(
    (nodes) =>
      nodes.every(
        (node, index) =>
          index === 0 || ((nodes[index - 1] as Node).compareDocumentPosition(node as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    handles,
  );
  expect(ordered, "liens dans l'ordre de leurs positions").toBe(true);
}

async function expectTextContrast(target: Locator, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  const ratio = contrastRatio(text, background);
  expect.soft(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
}

async function robotsDirectives(page: Page, response: Response): Promise<string> {
  const metas = await page
    .locator('meta[name="robots"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content") ?? ""));
  return [...metas, response.headers()["x-robots-tag"] ?? ""].join(" ");
}

test.describe("page profil publique /p/{slug} (0018)", () => {
  let published: ProfileFixture;

  test.beforeAll(async () => {
    published = await createProfile({}, ALL_PLATFORM_LINKS);
  });

  test("critère 1 : profil publié — nom (h1), poste, entreprise, bio et initiales sur fond émeraude faute d'avatar", async ({
    page,
  }) => {
    await openPublished(page, published.slug);

    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    await expect(page.getByText(FULL_PROFILE.job_title ?? "").first()).toBeVisible();
    await expect(page.getByText(FULL_PROFILE.company ?? "").first()).toBeVisible();
    await expect(page.getByText(FULL_PROFILE.bio ?? "").first()).toBeVisible();

    const initials = page.getByText(FULL_PROFILE_INITIALS, { exact: true });
    await expect(initials).toBeVisible();
    const { background } = await colorsOf(initials);
    expect(cssRgb(background), "fond des initiales").toBe(EMERALD);
  });

  test("décision 10 : ni /v/{slug} ni href vers /v/ dans le HTML servi et le DOM avant clic", async ({ page }) => {
    const response = await openPublished(page, published.slug);
    await page.waitForLoadState("networkidle");

    const sources = { "HTML servi": await response.text(), "DOM avant clic": await page.content() };
    for (const [source, html] of Object.entries(sources)) {
      expect.soft(html, `${source} : /v/${published.slug}`).not.toContain(`/v/${published.slug}`);
      expect.soft(html, `${source} : href vers /v/`).not.toMatch(/href=["'][^"']*\/v\//i);
    }
    await expect(page.locator('a[href*="/v/"]'), "lien vers /v/ avant clic").toHaveCount(0);
  });

  test("critère 1 / décision 10 : contrôle « Ajouter aux contacts » visible, activable, ≥ 44 px, sur émeraude", async ({
    page,
  }) => {
    await openPublished(page, published.slug);

    const vcard = control(page, VCARD_CONTROL);
    await expect(vcard).toBeVisible();
    await expect(vcard).toBeEnabled();
    await expect(vcard).toHaveAccessibleName(VCARD_CONTROL);
    const box = await vcard.boundingBox();
    expect(box, "boîte du contrôle").not.toBeNull();
    expect(box?.height ?? 0, "hauteur de la cible").toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box?.width ?? 0, "largeur de la cible").toBeGreaterThanOrEqual(MIN_TARGET_PX);
    const { background } = await colorsOf(vcard);
    expect(cssRgb(background), "fond du contrôle").toBe(EMERALD);

    await vcard.focus();
    await expect(vcard, "atteignable au clavier").toBeFocused();
  });

  test("critère 1 / décision 10 : au clic, téléchargement de /v/{slug} sous le nom {slug}.vcf", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": newClientAddress() });
    await openPublished(page, published.slug);
    await page.waitForLoadState("networkidle");

    const vcardResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/v/${published.slug}`,
    );
    const download = page.waitForEvent("download");
    await control(page, VCARD_CONTROL).click();

    expect((await vcardResponse).status(), `GET /v/${published.slug}`).toBe(200);
    const file = await download;
    expect(new URL(file.url()).pathname).toBe(`/v/${published.slug}`);
    expect(file.suggestedFilename()).toBe(`${published.slug}.vcf`);
  });

  test("décision 10 / limite vcard : un clic sur « Ajouter aux contacts » compte une seule requête (429 à la 31e au total)", async ({
    page,
  }) => {
    const address = { "x-forwarded-for": newClientAddress() };
    const vcardPath = `/v/${published.slug}`;
    await page.setExtraHTTPHeaders(address);
    await openPublished(page, published.slug);
    await page.waitForLoadState("networkidle");

    const seen: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === vcardPath) seen.push(`request ${request.method()}`);
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === vcardPath) seen.push(`response ${response.status()}`);
    });
    const download = page.waitForEvent("download");
    await control(page, VCARD_CONTROL).click();
    expect(new URL((await download).url()).pathname).toBe(vcardPath);
    await page.waitForLoadState("networkidle");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await page.request.get(vcardPath, { headers: address, maxRedirects: 0 });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }

    const firstRejected = statuses.indexOf(429);
    expect(
      firstRejected === -1 ? null : firstRejected + 2,
      `rang total de la 1re 429 (clic = 1) ; navigateur : [${seen.join(", ")}] ; directes : [${statuses.join(", ")}]`,
    ).toBe(31);
  });

  test("critère 1 : liens dans l'ordre, nom accessible par plateforme, rel « noopener noreferrer nofollow ugc », target _blank", async ({
    page,
  }) => {
    await openPublished(page, published.slug);

    const anchors: Locator[] = [];
    for (const link of ANCHOR_LINKS) {
      const anchor = page.locator(`a[href="${link.url}"]`);
      await expect(anchor, `lien ${link.platform}`).toHaveCount(1);
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveAccessibleName(ACCESSIBLE_NAMES[link.platform]);
      if (link.label !== null) {
        await expect(anchor).toContainText(link.label);
      }
      await expect(anchor).toHaveAttribute("target", "_blank");
      const rel = (await anchor.getAttribute("rel"))?.split(/\s+/) ?? [];
      expect(rel, `rel du lien ${link.platform}`).toEqual(expect.arrayContaining(["noopener", "noreferrer", "nofollow", "ugc"]));
      anchors.push(anchor);
    }
    const whatsapp = control(page, WHATSAPP_CONTROL);
    await expect(whatsapp).toBeVisible();

    await expectInDocumentOrder(page, [...anchors, whatsapp]);
  });

  test("critère 1 : une icône SVG décorative (aria-hidden) par lien, distincte pour chaque plateforme de marque", async ({
    page,
  }) => {
    await openPublished(page, published.slug);

    const icons = new Map<string, string>();
    const targets: [string, Locator][] = [
      ...ANCHOR_LINKS.map((link): [string, Locator] => [link.platform, page.locator(`a[href="${link.url}"]`)]),
      ["whatsapp", control(page, WHATSAPP_CONTROL)],
    ];
    for (const [platform, target] of targets) {
      await expect(target.locator('svg[aria-hidden="true"]').first(), `icône ${platform}`).toBeAttached();
      await expect(target.locator('svg:not([aria-hidden="true"])'), `svg non décoratif dans ${platform}`).toHaveCount(0);
      icons.set(platform, await target.locator('svg[aria-hidden="true"]').first().innerHTML());
    }
    const brandIcons = [...BRAND_PLATFORMS, "whatsapp"].map((platform) => icons.get(platform));
    expect(new Set(brandIcons).size, "icônes de marque toutes différentes").toBe(brandIcons.length);
  });

  test("critère 1 : site web du profil — lien externe https, rel « noopener noreferrer », target _blank", async ({ page }) => {
    await openPublished(page, published.slug);

    const website = page.locator(`a[href="${FULL_PROFILE.website_url}"]`);
    await expect(website).toHaveCount(1);
    await expect(website).toBeVisible();
    await expect(website).toHaveAttribute("target", "_blank");
    const rel = (await website.getAttribute("rel"))?.split(/\s+/) ?? [];
    expect(rel).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  });

  test("décision 8 : téléphone, e-mail et WhatsApp absents du HTML servi et du DOM avant toute interaction", async ({ page }) => {
    const response = await openPublished(page, published.slug);
    await page.waitForLoadState("networkidle");

    const sources = { "HTML servi": await response.text(), "DOM avant interaction": await page.content() };
    for (const [source, html] of Object.entries(sources)) {
      expect.soft(html, `${source} : numéro de téléphone`).not.toMatch(digitsPattern(PHONE_DIGITS));
      expect.soft(html, `${source} : numéro WhatsApp`).not.toMatch(digitsPattern(WHATSAPP_DIGITS));
      expect.soft(html, `${source} : wa.me/<numéro>`).not.toMatch(/wa\.me\/\+?\d/);
      expect.soft(html, `${source} : api.whatsapp.com`).not.toMatch(/api\.whatsapp\.com\/send/);
      expect.soft(html, `${source} : tel:`).not.toMatch(/tel:\+?\d/i);
      expect.soft(html, `${source} : mailto:`).not.toMatch(/mailto:/i);
      expect.soft(html, `${source} : adresse e-mail`).not.toContain(FULL_PROFILE.contact_email ?? "");
    }
    await expect(control(page, PHONE_CONTROL)).toBeVisible();
    await expect(control(page, EMAIL_CONTROL)).toBeVisible();
    await expect(control(page, WHATSAPP_CONTROL)).toBeVisible();
  });

  test("décision 8 : au clic, le numéro de téléphone est assemblé côté client (tel:)", async ({ page }) => {
    await page.addInitScript(REVEAL_PROBE);
    await openPublished(page, published.slug);

    await control(page, PHONE_CONTROL).click();

    await expect
      .poll(async () => (await revealedUrls(page)).some((url) => /^tel:/i.test(url) && url.replace(/\D/g, "").endsWith(PHONE_DIGITS)))
      .toBe(true);
  });

  test("décision 8 : au clic, l'adresse e-mail est assemblée côté client (mailto:)", async ({ page }) => {
    await page.addInitScript(REVEAL_PROBE);
    await openPublished(page, published.slug);

    await control(page, EMAIL_CONTROL).click();

    await expect
      .poll(async () => (await revealedUrls(page)).some((url) => url.startsWith(`mailto:${FULL_PROFILE.contact_email}`)))
      .toBe(true);
  });

  test("décision 8 : au clic, le lien WhatsApp est assemblé côté client (wa.me/<numéro>)", async ({ page }) => {
    await page.route(/^https:\/\/(?:wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 204 }));
    await page.addInitScript(REVEAL_PROBE);
    await openPublished(page, published.slug);

    await control(page, WHATSAPP_CONTROL).click();

    await expect
      .poll(async () =>
        (await revealedUrls(page)).some(
          (url) => /^https:\/\/(?:wa\.me|api\.whatsapp\.com)\//.test(url) && url.replace(/\D/g, "").includes(`33${WHATSAPP_DIGITS}`),
        ),
      )
      .toBe(true);
  });

  test("décision 10 : un e-mail hors format (« ?bcc= ») n'est ni affiché ni révélé en mailto: avec « ? »", async ({ page }) => {
    const injected = await createProfile({ contact_email: INJECTED_EMAIL });
    await page.addInitScript(REVEAL_PROBE);

    const response = await openPublished(page, injected.slug);
    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const sources = { "HTML servi": await response.text(), "DOM": await page.content() };
    for (const [source, html] of Object.entries(sources)) {
      expect.soft(html, `${source} : adresse`).not.toContain("x@y.fr");
      expect.soft(html, `${source} : bcc`).not.toMatch(/bcc/i);
      expect.soft(html, `${source} : mailto:`).not.toMatch(/mailto:/i);
    }
    await expect(control(page, EMAIL_CONTROL), "contrôle e-mail").toHaveCount(0);

    const contactButtons = await page.getByRole("button").filter({ hasNotText: VCARD_CONTROL }).elementHandles();
    for (const button of contactButtons) {
      await button.click();
    }
    const mailtos = (await revealedUrls(page)).filter((url) => /^mailto:/i.test(url));
    expect(mailtos, "mailto: révélés").toStrictEqual([]);
    expect(await page.evaluate(() => document.body.innerText)).not.toContain("x@y.fr");
  });

  test("décision 7 : aucun identifiant interne ni e-mail de compte dans le HTML", async ({ page }) => {
    const response = await openPublished(page, published.slug);
    const html = await response.text();

    expect(html, "owner_id").not.toContain(published.userId);
    expect(html, "id du profil").not.toContain(published.profileId);
    expect(html, "e-mail du compte").not.toContain(published.email);
  });

  test("critère 4 : noindex par défaut (is_indexable = false)", async ({ page }) => {
    const response = await openPublished(page, published.slug);

    expect(await robotsDirectives(page, response)).toMatch(/noindex/i);
  });

  test("critère 4 : pas de noindex si is_indexable", async ({ page }) => {
    const indexable = await createProfile({ is_indexable: true });

    const response = await openPublished(page, indexable.slug);

    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    expect(await robotsDirectives(page, response)).not.toMatch(/noindex/i);
  });

  test("décision 4 : métadonnées Open Graph (nom et poste)", async ({ page }) => {
    await openPublished(page, published.slug);

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(FULL_PROFILE.display_name));
    const ogContents = await page
      .locator('meta[property^="og:"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content") ?? "").join(" "));
    expect(ogContents).toContain(FULL_PROFILE.job_title);
  });

  test("décision 4 et sécurité : lang=\"fr\", en-têtes de sécurité, pas de X-Powered-By", async ({ page }) => {
    const response = await openPublished(page, published.slug);

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const headers = response.headers();
    expect.soft(headers["x-content-type-options"]).toBe("nosniff");
    expect.soft(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect.soft(headers["permissions-policy"]).toMatch(/camera=\(\)/);
    expect.soft(headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect.soft(headers["x-powered-by"]).toBeUndefined();
  });

  test("décision 2 : rendu statique — réponse publique en cache, une écriture en base hors Server Action reste invisible (revalidation par tag seulement)", async ({
    page,
  }) => {
    const cached = await createProfile();
    const first = await openPublished(page, cached.slug);
    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    expect(first.headers()["cache-control"] ?? "", "Cache-Control d'une page statique ou ISR").not.toMatch(/private|no-store/);

    await updateProfileBehindTheCache(cached.slug, { display_name: "Nom modifié hors cache" });
    await openPublished(page, cached.slug);

    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
  });
});

test.describe("page profil publique : 404 sans énumération (0018, critère 2)", () => {
  test("critère 2 : profil non publié et slug inexistant → même 404, aucune donnée du profil", async ({ page }) => {
    const unpublished = await createProfile({ is_published: false }, ALL_PLATFORM_LINKS);
    const missingSlug = `e2e-absent-${randomUUID().slice(0, 8)}`;
    const witness = await createProfile();
    expect((await open(page, witness.slug)).status(), "témoin : la route existe et sert un profil publié").toBe(200);

    const unpublishedResponse = await open(page, unpublished.slug);
    const unpublishedHtml = await unpublishedResponse.text();
    const unpublishedText = await page.evaluate(() => document.body.innerText);
    const unpublishedTitle = await page.title();

    const missingResponse = await open(page, missingSlug);
    const missingText = await page.evaluate(() => document.body.innerText);

    expect(unpublishedResponse.status()).toBe(404);
    expect(missingResponse.status()).toBe(404);
    expect(unpublishedText, "texte visible identique").toBe(missingText);
    expect(unpublishedTitle, "titre identique").toBe(await page.title());

    const secrets = [
      FULL_PROFILE.display_name,
      FULL_PROFILE.job_title,
      FULL_PROFILE.company,
      FULL_PROFILE.bio,
      FULL_PROFILE.contact_email,
      host(FULL_PROFILE.website_url ?? "https://absent.example"),
      unpublished.userId,
      unpublished.profileId,
      ...ALL_PLATFORM_LINKS.map((link) => host(link.url)),
    ];
    for (const secret of secrets) {
      expect.soft(unpublishedHtml, `HTML du 404 : ${secret}`).not.toContain(secret ?? "");
    }
    expect.soft(unpublishedHtml).not.toMatch(digitsPattern(PHONE_DIGITS));
    expect.soft(unpublishedHtml).not.toMatch(digitsPattern(WHATSAPP_DIGITS));
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`page profil publique en thème ${scheme === "light" ? "clair" : "sombre"} émulé (0018, critère 3)`, () => {
    test.use({ colorScheme: scheme });

    let published: ProfileFixture;

    test.beforeAll(async () => {
      published = await createProfile({}, ALL_PLATFORM_LINKS);
    });

    test(`critère 3 : ${scheme} — fond de page ${BACKGROUNDS[scheme]}, color-scheme ${scheme}`, async ({ page }) => {
      await openPublished(page, published.slug);

      const body = await colorsOf(page.locator("body"));
      expect.soft(cssRgb(body.background), "fond de body").toBe(BACKGROUNDS[scheme]);
      const colorScheme = await page.locator("html").evaluate((html) => getComputedStyle(html).colorScheme);
      expect.soft(colorScheme, "color-scheme de html").toContain(scheme);
    });

    test(`critère 3 : ${scheme} — nom, poste, entreprise, bio ≥ 4,5:1`, async ({ page }) => {
      await openPublished(page, published.slug);

      await expectTextContrast(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name }), "nom");
      await expectTextContrast(page.getByText(FULL_PROFILE.job_title ?? "").first(), "poste");
      await expectTextContrast(page.getByText(FULL_PROFILE.company ?? "").first(), "entreprise");
      await expectTextContrast(page.getByText(FULL_PROFILE.bio ?? "").first(), "bio");
    });

    test(`critère 3 : ${scheme} — liens, site, contrôles de contact ≥ 4,5:1 (émeraude assombri en clair)`, async ({ page }) => {
      await openPublished(page, published.slug);

      for (const link of ANCHOR_LINKS) {
        await expectTextContrast(page.locator(`a[href="${link.url}"]`), `lien ${link.platform}`);
      }
      await expectTextContrast(page.locator(`a[href="${FULL_PROFILE.website_url}"]`), "site web");
      await expectTextContrast(control(page, PHONE_CONTROL), "téléphone");
      await expectTextContrast(control(page, EMAIL_CONTROL), "e-mail");
      await expectTextContrast(control(page, WHATSAPP_CONTROL), "WhatsApp");
    });

    test(`critère 3 : ${scheme} — bouton « ${VCARD_BUTTON} » et initiales : texte foncé sur émeraude #00C896, ≥ 4,5:1`, async ({
      page,
    }) => {
      await openPublished(page, published.slug);

      for (const [label, target] of [
        ["bouton vCard", control(page, VCARD_CONTROL)],
        ["initiales", page.getByText(FULL_PROFILE_INITIALS, { exact: true })],
      ] as const) {
        const { background } = await colorsOf(target);
        expect.soft(cssRgb(background), `fond ${label}`).toBe(EMERALD);
        await expectTextContrast(target, label);
      }
    });
  });
}

const IN_APP_BROWSERS = {
  Instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,3; iOS 18_1; fr_FR; fr; scale=3.00; 1290x2796; 654321)",
  LinkedIn:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 [LinkedInApp]/4.1.1015",
  Facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.0;FBBV/650000000;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBLC/fr_FR]",
} as const;

for (const [app, userAgent] of Object.entries(IN_APP_BROWSERS)) {
  test.describe(`page profil publique dans le navigateur intégré ${app} (0018, décision 6)`, () => {
    test.use({ userAgent });

    test(`décision 6 : ${app} — message invitant à ouvrir la page dans le navigateur`, async ({ page }) => {
      const profile = await createProfile();
      await openPublished(page, profile.slug);

      await expect(page.getByText(IN_APP_MESSAGE).first()).toBeVisible();
      await expect(control(page, VCARD_CONTROL)).toBeVisible();
    });
  });
}

test.describe("page profil publique dans le navigateur de l'appareil (0018, décision 6)", () => {
  test("décision 6 : navigateur ordinaire — aucun message de navigateur intégré", async ({ page }) => {
    const profile = await createProfile();
    await openPublished(page, profile.slug);
    await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(IN_APP_MESSAGE)).toHaveCount(0);
  });
});

test.describe("robots.txt (0018, décision 10)", () => {
  test("décision 10 : GET /robots.txt interdit /v/ aux robots", async ({ request }) => {
    const response = await request.get("/robots.txt", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toMatch(/^text\/plain/);
    const body = await response.text();
    expect(body).toMatch(/^User-Agent:\s*\*\s*$/im);
    expect(body).toMatch(/^Disallow:\s*\/v\/\s*$/m);
  });
});
