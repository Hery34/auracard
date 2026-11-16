import { expect, test, type Locator, type Page } from "@playwright/test";

import { newAccount, workerAddress } from "./helpers/accounts";
import { createMember } from "./helpers/admin";
import { colorsOf, contrastRatio, cssRgb, focusIndicatorColorsOf, relativeLuminance, type Rgb } from "./helpers/contrast";

/** Same per-worker address as auth.spec.ts: the only sign-in of this file stays within the login budget. */
test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const CARBON_BLACK = "rgb(10, 10, 12)";
const EMERALD = "rgb(0, 200, 150)";
const THEME_COLOR = /^#0a0a0c$/i;
const BRAND = /aura\s*card/i;
const TECHNICAL_NAME = /carnet/i;
const FONT = /montserrat/i;

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

const PUBLIC_PAGES = ["/inscription", "/connexion", "/verifier-email"] as const;
const PRIMARY_BUTTONS = { "/inscription": "Créer mon compte", "/connexion": "Se connecter" } as const;
const PRIVACY_NOTICE = /Votre adresse e-mail et votre nom affiché servent uniquement/;

/** Dark theme: the text is lighter than its background, and the ratio reaches the WCAG minimum. */
async function expectContrast(target: Locator, minimum: number, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  expect(relativeLuminance(text), `${label} : texte ${cssRgb(text)} plus clair que le fond ${cssRgb(background)}`).toBeGreaterThan(
    relativeLuminance(background),
  );
  const ratio = contrastRatio(text, background);
  expect(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
    minimum,
  );
}

/** Critère 2 : thème sombre, nom commercial, police, color-scheme et theme-color, sur la page affichée. */
async function expectAuraCardTheme(page: Page): Promise<void> {
  const body = await colorsOf(page.locator("body"));
  expect.soft(cssRgb(body.ownBackground.rgb), "fond calculé de body").toBe(CARBON_BLACK);
  expect.soft(body.ownBackground.alpha, "fond de body opaque").toBe(255);

  await expect.soft(page).toHaveTitle(BRAND);

  const banner = page.getByRole("banner");
  await expect(banner).toBeVisible();
  const ariaLabels = await banner
    .locator("[aria-label]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  const bannerName = [await banner.innerText(), ...ariaLabels].join(" ").replace(/\s+/g, "");
  expect.soft(bannerName, "en-tête (texte ou nom accessible)").toMatch(/auracard/i);

  const visibleText = await page.evaluate(() => document.body.innerText);
  expect.soft(visibleText, "texte visible").not.toMatch(TECHNICAL_NAME);

  const colorScheme = await page.locator("html").evaluate((html) => getComputedStyle(html).colorScheme);
  expect.soft(colorScheme, "color-scheme de html").toBe("dark");
  await expect.soft(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", THEME_COLOR);

  const fontFamily = await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
  const firstFamily = fontFamily.split(",")[0]?.trim() ?? "";
  expect.soft(firstFamily, `première famille de « ${fontFamily} »`).toMatch(FONT);
}

test.describe("thème AuraCard (0012)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`critère 2 : ${path} en thème sombre (#0A0A0C), titre et en-tête AuraCard, aucun « carnet » visible, Montserrat`, async ({
      page,
    }) => {
      await page.goto(path);

      await expectAuraCardTheme(page);
    });

    test(`critère 3 : ${path} — texte courant et titre ≥ 4,5:1`, async ({ page }) => {
      await page.goto(path);

      await expectContrast(page.getByRole("heading", { level: 1 }), TEXT_MIN, "titre");
      await expectContrast(page.locator("main p").first(), TEXT_MIN, "texte courant");
    });

    test(`critère 3 : ${path} — texte atténué (mention RGPD) ≥ 4,5:1`, async ({ page }) => {
      await page.goto(path);

      await expectContrast(page.getByText(PRIVACY_NOTICE), TEXT_MIN, "mention RGPD");
    });
  }

  for (const [path, name] of Object.entries(PRIMARY_BUTTONS)) {
    test(`critère 3 : ${path} — bouton primaire « ${name} » : texte foncé sur émeraude (#00C896), ≥ 4,5:1`, async ({
      page,
    }) => {
      await page.goto(path);

      const { text, background } = await colorsOf(page.getByRole("button", { name }));
      expect(cssRgb(background), "fond du bouton primaire").toBe(EMERALD);
      expect(relativeLuminance(text), `texte ${cssRgb(text)} plus foncé que le fond`).toBeLessThan(
        relativeLuminance(background),
      );
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }

  test("critère 3 : /inscription — libellé et bordure de champ (≥ 3:1), anneau de focus (≥ 3:1)", async ({ page }) => {
    await page.goto("/inscription");
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const email = page.getByLabel("Adresse e-mail", { exact: true });

    await expectContrast(page.locator('label[for="field-email"]'), TEXT_MIN, "libellé de champ");

    const { border, outerBackground } = await colorsOf(email);
    expect(cssRgb(outerBackground), "fond autour du champ").toBe(CARBON_BLACK);
    expect(border, "le champ a une bordure visible").not.toBeNull();
    const borderRatio = contrastRatio(border ?? outerBackground, outerBackground);
    expect(
      borderRatio,
      `bordure ${cssRgb(border ?? outerBackground)} sur ${cssRgb(outerBackground)} = ${borderRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);

    await email.focus();
    const indicators = await focusIndicatorColorsOf(email, border);
    const best = Math.max(0, ...indicators.map((color) => contrastRatio(color, outerBackground)));
    expect(
      best,
      `anneau de focus [${indicators.map(cssRgb).join(", ")}] sur ${cssRgb(outerBackground)} = ${best.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  test("critère 3 : /inscription soumis vide (aucune inscription) — message d'erreur de champ et alerte ≥ 4,5:1", async ({
    page,
  }) => {
    await page.goto("/inscription");
    const email = page.getByLabel("Adresse e-mail", { exact: true });

    await page.getByRole("button", { name: PRIMARY_BUTTONS["/inscription"] }).click();

    await expect(email).toHaveAttribute("aria-invalid", "true");
    const errorId = (await email.getAttribute("aria-describedby"))?.split(/\s+/)[0] ?? "";
    const fieldError = page.locator(`[id="${errorId}"]`);
    await expect(fieldError).toBeVisible();
    await expectContrast(fieldError, TEXT_MIN, "message d'erreur de champ");
    await expectContrast(page.getByRole("alert").filter({ hasText: "Vérifiez les champs signalés." }), TEXT_MIN, "alerte");
  });

  test("critère 3 : /inscription soumis vide (aucune inscription) — champ invalide focalisé : anneau de focus ≥ 3:1, distinct de l'état invalide sans focus", async ({
    page,
  }) => {
    await page.goto("/inscription");
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const email = page.getByLabel("Adresse e-mail", { exact: true });

    await page.getByRole("button", { name: PRIMARY_BUTTONS["/inscription"] }).click();
    await expect(email).toHaveAttribute("aria-invalid", "true");

    await email.evaluate((element) => (element as HTMLElement).blur());
    const { border: invalidBorder, outerBackground } = await colorsOf(email);
    const invalidIndicators = await focusIndicatorColorsOf(email, null);

    await email.focus();
    await expect(email).toBeFocused();
    const focusedIndicators = await focusIndicatorColorsOf(email, invalidBorder);
    const sameAs = (color: Rgb) => (other: Rgb) => other.every((channel, index) => channel === color[index]);
    const focusOnly = focusedIndicators.filter((color) => !invalidIndicators.some(sameAs(color)));
    const best = Math.max(0, ...focusOnly.map((color) => contrastRatio(color, outerBackground)));
    expect(
      best,
      `focus [${focusedIndicators.map(cssRgb).join(", ")}] vs invalide sans focus [${invalidIndicators.map(cssRgb).join(", ")}] sur ${cssRgb(outerBackground)} : meilleur indicateur propre au focus = ${best.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  test("critère 3 : /inscription — bouton primaire « Créer mon compte » focalisé au clavier : indicateur de focus ≥ 3:1 contre le fond extérieur", async ({
    page,
    browserName,
  }) => {
    await page.goto("/inscription");
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const button = page.getByRole("button", { name: PRIMARY_BUTTONS["/inscription"] });

    const { border: restingBorder, outerBackground, background } = await colorsOf(button);
    const restingIndicators = await focusIndicatorColorsOf(button, null);

    await page.getByLabel("Adresse e-mail", { exact: true }).focus();
    // WebKit on macOS skips buttons on a plain Tab (Safari default); Alt+Tab includes them, and WebKit Linux ignores Alt on Tab.
    for (let presses = 0; presses < 10 && !(await button.evaluate((element) => element === document.activeElement)); presses += 1) {
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    }
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => element.matches(":focus-visible")), "bouton en :focus-visible").toBe(true);

    const focusedIndicators = await focusIndicatorColorsOf(button, restingBorder);
    const sameAs = (color: Rgb) => (other: Rgb) => other.every((channel, index) => channel === color[index]);
    const focusOnly = focusedIndicators.filter((color) => !restingIndicators.some(sameAs(color)));
    const best = Math.max(0, ...focusOnly.map((color) => contrastRatio(color, outerBackground)));
    expect(
      best,
      `focus [${focusedIndicators.map(cssRgb).join(", ")}] (bouton ${cssRgb(background)}) sur ${cssRgb(outerBackground)} = ${best.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  test("critère 4 : /inscription — polices servies depuis l'application, aucune requête vers Google Fonts ni autre hôte", async ({
    page,
    baseURL,
  }) => {
    const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
    const requested: string[] = [];
    const fontRequests: string[] = [];
    const servedWoff2: string[] = [];
    page.on("request", (request) => {
      requested.push(request.url());
      if (request.resourceType() === "font" || /\.woff2(?:$|\?)/i.test(request.url())) {
        fontRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      if (/^font\//i.test(contentType)) {
        fontRequests.push(url);
      }
      if (/\.woff2(?:$|\?)/i.test(url) && new URL(url).origin === appOrigin && response.ok()) {
        servedWoff2.push(url);
      }
    });

    await page.goto("/inscription", { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForLoadState("networkidle");

    const googleFonts = requested.filter((url) => /(?:^|\.)fonts\.(?:googleapis|gstatic)\.com$/i.test(new URL(url).hostname));
    expect(googleFonts, "requêtes vers Google Fonts").toEqual([]);
    const foreignFonts = fontRequests.filter((url) => new URL(url).origin !== appOrigin);
    expect(foreignFonts, `polices hors de ${appOrigin}`).toEqual([]);
    expect(servedWoff2.length, `au moins une police .woff2 servie depuis ${appOrigin}`).toBeGreaterThan(0);
  });

  test("critères 2 et 3 : /tableau-de-bord d'un membre en thème AuraCard, textes ≥ 4,5:1", async ({ page }) => {
    const member = newAccount();
    await createMember(member);
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(member.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(member.password);
    await page.getByRole("button", { name: PRIMARY_BUTTONS["/connexion"] }).click();
    await expect(page).toHaveURL(/\/tableau-de-bord$/);
    await expect(page.getByText(member.displayName).first()).toBeVisible();

    await expectAuraCardTheme(page);
    await expectContrast(page.getByRole("heading", { level: 1 }), TEXT_MIN, "titre");
    await expectContrast(page.getByText(member.displayName).first(), TEXT_MIN, "texte courant");
    await expectContrast(page.locator("dt").first(), TEXT_MIN, "texte atténué");
  });
});
