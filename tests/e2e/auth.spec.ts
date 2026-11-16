import { expect, test, type APIResponse, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { newAccount, workerAddress, type Account } from "./helpers/accounts";
import { countUsers, createAccount, createMember, findUser, profilesOf } from "./helpers/admin";

/** Under `pnpm start` the application keys its per-address counters on this header: one bucket per worker. */
test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const LABELS = { email: "Adresse e-mail", password: "Mot de passe", displayName: "Nom affiché" } as const;
const BUTTONS = { signUp: "Créer mon compte", signIn: "Se connecter", signOut: "Se déconnecter" } as const;
const MESSAGES = {
  emailTaken: "Un compte existe déjà avec cette adresse.",
  invalidCredentials: "Adresse ou mot de passe incorrect.",
  displayNameRequired: "Indiquez le nom à afficher sur votre profil.",
  checkFields: "Vérifiez les champs signalés.",
} as const;

const PUBLIC_PAGES = ["/inscription", "/connexion", "/verifier-email"] as const;
const MIN_TARGET_SIZE = 44;
const REDIRECT_STATUSES = [302, 303, 307, 308];
/** Header values historically used to make Next.js skip its middleware (CVE-2025-29927 and earlier). */
const PROXY_BYPASS_VALUES = [
  "middleware",
  "src/middleware",
  "proxy",
  "src/proxy",
  "middleware:middleware:middleware:middleware:middleware",
];

function field(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

function alertWith(page: Page, text: string): Locator {
  return page.getByRole("alert").filter({ hasText: text });
}

async function alertTexts(page: Page): Promise<string[]> {
  const texts = await page.getByRole("alert").allTextContents();
  return texts.map((text) => text.trim()).filter((text) => text !== "");
}

/** What assistive technology hears: `role="alert"` regions, plus the description of a field flagged `aria-invalid`. */
async function announcedErrors(page: Page, invalidField: Locator): Promise<string[]> {
  const texts = await alertTexts(page);
  if ((await invalidField.getAttribute("aria-invalid")) === "true") {
    const describedBy = (await invalidField.getAttribute("aria-describedby")) ?? "";
    for (const id of describedBy.split(/\s+/).filter((candidate) => candidate !== "")) {
      const text = (await page.locator(`[id="${id}"]`).allTextContents()).join(" ").trim();
      if (text !== "") {
        texts.push(text);
      }
    }
  }
  return texts;
}

async function sessionCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-")).map((cookie) => cookie.name);
}

async function fillCredentials(page: Page, { email, password }: Pick<Account, "email" | "password">): Promise<void> {
  await field(page, LABELS.email).fill(email);
  await field(page, LABELS.password).fill(password);
}

async function signUp(page: Page, account: Account): Promise<void> {
  await page.goto("/inscription");
  await fillCredentials(page, account);
  await field(page, LABELS.displayName).fill(account.displayName);
  await page.getByRole("button", { name: BUTTONS.signUp }).click();
}

async function signIn(page: Page, credentials: Pick<Account, "email" | "password">): Promise<void> {
  await page.goto("/connexion");
  await fillCredentials(page, credentials);
  await page.getByRole("button", { name: BUTTONS.signIn }).click();
}

async function expectDashboardOf(page: Page, account: Account): Promise<void> {
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await expect(page.getByText(account.displayName).first()).toBeVisible();
  await expect(page.getByText(account.slug).first()).toBeVisible();
}

function expectRedirectToSignIn(response: APIResponse, label: string): void {
  expect(REDIRECT_STATUSES, `${label}: statut ${response.status()}`).toContain(response.status());
  expect(response.headers()["location"], `${label}: en-tête location`).toMatch(/\/connexion(\?|$)/);
}

test.describe("inscription", () => {
  test("critère 1 : inscription valide → /tableau-de-bord avec le nom affiché et le slug, document en français", async ({
    page,
  }) => {
    const account = newAccount();

    await signUp(page, account);

    await expectDashboardOf(page, account);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const user = await findUser(account.email);
    expect(user).toBeDefined();
    expect(await profilesOf(user?.id ?? "")).toStrictEqual([
      { slug: account.slug, display_name: account.displayName, is_published: false },
    ]);
  });

  test("critère 1 : formulaire accessible (labels, autocomplete, cibles ≥ 44 px) ; mot de passe de 7 caractères → erreur annoncée, aucun compte créé", async ({
    page,
  }) => {
    const account = newAccount();
    await page.goto("/inscription");
    const email = field(page, LABELS.email);
    const password = field(page, LABELS.password);
    const displayName = field(page, LABELS.displayName);
    const submit = page.getByRole("button", { name: BUTTONS.signUp });

    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await expect(displayName).toHaveAttribute("autocomplete", "name");
    for (const target of [email, password, displayName, submit]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
    }

    await email.fill(account.email);
    await password.fill("1234567");
    await displayName.fill(account.displayName);
    await submit.click();

    await expect.poll(() => announcedErrors(page, password)).not.toStrictEqual([]);
    expect((await announcedErrors(page, password)).join(" ")).not.toContain("1234567");
    await expect(alertWith(page, MESSAGES.checkFields)).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/inscription$/);
    expect(await findUser(account.email)).toBeUndefined();
  });

  test("critère 2 : e-mail déjà inscrit → « Un compte existe déjà » avec un lien vers /connexion, aucune création", async ({
    page,
  }) => {
    const account = newAccount();
    const userId = await createMember(account);

    await signUp(page, account);

    const alert = alertWith(page, MESSAGES.emailTaken);
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link")).toHaveAttribute("href", "/connexion");
    await expect(page).toHaveURL(/\/inscription$/);
    expect(await countUsers(account.email)).toBe(1);
    expect(await profilesOf(userId)).toHaveLength(1);
  });
});

test.describe("connexion", () => {
  test("critère 3 : identifiants valides → /tableau-de-bord ; le HTML ne porte aucune donnée d'un autre compte (RLS)", async ({
    page,
  }) => {
    const member = newAccount();
    const other = newAccount();
    await createMember(member);
    await createMember(other);

    await signIn(page, member);

    await expectDashboardOf(page, member);
    const html = await page.content();
    for (const personal of [other.displayName, other.slug, other.email]) {
      expect(html).not.toContain(personal);
    }
  });

  test("critère 3 : mot de passe faux et e-mail inconnu → le même message générique, sans énumération", async ({ page }) => {
    const account = newAccount();
    await createAccount(account);

    await signIn(page, { email: account.email, password: "not the password" });
    await expect(alertWith(page, MESSAGES.invalidCredentials)).toBeVisible();
    const afterWrongPassword = await alertTexts(page);

    await signIn(page, { email: newAccount().email, password: account.password });
    await expect(alertWith(page, MESSAGES.invalidCredentials)).toBeVisible();
    const afterUnknownEmail = await alertTexts(page);

    expect(afterWrongPassword).toStrictEqual([MESSAGES.invalidCredentials]);
    expect(afterUnknownEmail).toStrictEqual(afterWrongPassword);
    await expect(page).toHaveURL(/\/connexion$/);
  });

  test("critères 3 et 8 : compte existant non membre → nom demandé ; session sans profil refusée au tableau de bord ; avec le nom → appartenance, profil et tableau de bord", async ({
    page,
  }) => {
    const account = newAccount();
    const userId = await createAccount(account);

    await signIn(page, account);

    await expect(page.getByText(MESSAGES.displayNameRequired)).toBeVisible();
    await expect(field(page, LABELS.displayName)).toBeVisible();
    await expect.poll(() => alertTexts(page)).not.toStrictEqual([]);
    await expect(page).toHaveURL(/\/connexion$/);
    expect(await profilesOf(userId)).toStrictEqual([]);

    // GoTrue may already have opened a session (cookie) for this profile-less account: the dashboard must not render it.
    const dashboard = await page.request.get("/tableau-de-bord", { maxRedirects: 0 });
    expectRedirectToSignIn(dashboard, "session sans profil");
    expect(await dashboard.text()).not.toContain(account.email);

    await fillCredentials(page, account);
    await field(page, LABELS.displayName).fill(account.displayName);
    await page.getByRole("button", { name: BUTTONS.signIn }).click();

    await expectDashboardOf(page, account);
    expect(await profilesOf(userId)).toStrictEqual([
      { slug: account.slug, display_name: account.displayName, is_published: false },
    ]);
  });
});

test.describe("tableau de bord", () => {
  test("critère 4 : /tableau-de-bord sans session → redirection /connexion (proxy)", async ({ page }) => {
    await page.goto("/tableau-de-bord");

    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByRole("button", { name: BUTTONS.signOut })).toHaveCount(0);
  });

  test("critère 4 : GET /tableau-de-bord sans cookie, proxy contourné (x-middleware-subrequest) → redirection rendue par la page, aucun contenu", async ({
    request,
  }) => {
    for (const value of [undefined, ...PROXY_BYPASS_VALUES]) {
      const response = await request.get("/tableau-de-bord", {
        headers: value === undefined ? {} : { "x-middleware-subrequest": value },
        maxRedirects: 0,
      });

      expectRedirectToSignIn(response, `x-middleware-subrequest=${value ?? "<absent>"}`);
      expect(await response.text()).not.toContain(BUTTONS.signOut);
    }
  });

  test("critère 5 : déconnexion → /connexion, cookies de session effacés, retour arrière et /tableau-de-bord sans données", async ({
    page,
    context,
  }) => {
    const member = newAccount();
    await createMember(member);
    await signIn(page, member);
    await expectDashboardOf(page, member);
    expect(await sessionCookies(context)).not.toStrictEqual([]);

    await page.getByRole("button", { name: BUTTONS.signOut }).click();

    await expect(page).toHaveURL(/\/connexion$/);
    expect(await sessionCookies(context)).toStrictEqual([]);

    await page.goBack();
    await expect(page.getByText(member.displayName)).toHaveCount(0);
    await expect(page.getByText(member.slug)).toHaveCount(0);

    await page.goto("/tableau-de-bord");
    await expect(page).toHaveURL(/\/connexion$/);
  });
});

test.describe("en-têtes et langue", () => {
  for (const path of PUBLIC_PAGES) {
    test(`critère 6 : GET ${path} répond 200 en français avec les en-têtes de sécurité et sans X-Powered-By`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      if (response === null) {
        throw new Error(`GET ${path} returned no response`);
      }

      expect(response.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");

      const headers = response.headers();

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
      expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("décision 4 : /verifier-email invite à consulter sa boîte e-mail", async ({ page }) => {
    await page.goto("/verifier-email");

    await expect(page.getByText(/bo[iî]te/i).first()).toBeVisible();
  });
});
