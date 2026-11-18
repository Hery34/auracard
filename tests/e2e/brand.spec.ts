/**
 * Contract frozen by test-engineer (0014): metadata file conventions of Next.js (`src/app/icon.svg`,
 * `apple-icon.png`, `favicon.ico`, `manifest.ts`, `opengraph-image.png` 1200 × 630) and an AppHeader logo link named
 * « AuraCard » leading to `/`. `og:image` is compared by path: its origin comes from `metadataBase` (SITE_URL).
 * A public profile without avatar shares the brand image; with an avatar, `og:image` is the avatar
 * (profile-images.spec.ts, 0021).
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { createProfile } from "./helpers/public-profile";
import { e2eSiteOrigin } from "./helpers/site-url";

const THEME = /^#0a0a0c$/i;
const PAGES = ["/", "/connexion"] as const;

const ICONS = [
  { path: "/icon.svg", contentType: /^image\/svg\+xml\b/i, rel: "icon" },
  { path: "/apple-icon.png", contentType: /^image\/png\b/i, rel: "apple-touch-icon" },
  { path: "/favicon.ico", contentType: /^image\/(?:x-icon|vnd\.microsoft\.icon)\b/i, rel: "icon" },
] as const;

const MANIFEST = { path: "/manifest.webmanifest", contentType: /^application\/manifest\+json\b/i } as const;
const OPEN_GRAPH = { path: "/opengraph-image.png", contentType: /^image\/png\b/i, width: 1200, height: 630 } as const;
/** Same value as the SITE_URL handed to `pnpm start` by playwright.config.ts. */
const SITE_ORIGIN = e2eSiteOrigin();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type HeadLink = { rel: string; pathname: string; href: string };

async function headLinks(page: Page): Promise<HeadLink[]> {
  return page.locator("head link[rel][href]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const link = node as HTMLLinkElement;
      return { rel: link.rel.toLowerCase(), pathname: new URL(link.href).pathname, href: link.href };
    }),
  );
}

async function expectServed(request: APIRequestContext, url: string, contentType: RegExp): Promise<Buffer> {
  const response = await request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  expect(response.headers()["content-type"] ?? "", `content-type de ${url}`).toMatch(contentType);
  const body = await response.body();
  expect(body.length, `corps de ${url} non vide`).toBeGreaterThan(0);
  return body;
}

/** Width and height from the IHDR chunk, which always follows the 8-byte PNG signature. */
function pngSize(body: Buffer): { width: number; height: number } {
  expect(body.subarray(0, 8).equals(PNG_SIGNATURE), "signature PNG").toBe(true);
  expect(body.subarray(12, 16).toString("ascii"), "premier bloc IHDR").toBe("IHDR");
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

/** `og:image` must be absolute on the SITE_URL origin (`metadataBase`), or link previews break in production. */
async function expectOgImageOnSiteOrigin(page: Page): Promise<void> {
  const contents = await page.locator('meta[property="og:image"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content") ?? ""));
  expect(contents, "og:image").toHaveLength(1);
  const content = contents[0] ?? "";
  expect(content, "og:image absolue").toMatch(/^https?:\/\//);
  expect(new URL(content).origin, `origine de ${content}`).toBe(SITE_ORIGIN);
}

async function ogImagePaths(page: Page): Promise<string[]> {
  return page
    .locator('meta[property="og:image"]')
    .evaluateAll((nodes) => nodes.map((node) => new URL(node.getAttribute("content") ?? "", document.baseURI).pathname));
}

test.describe("logo et favicon AuraCard (0014)", () => {
  for (const { path, contentType } of [...ICONS, MANIFEST]) {
    test(`critère 1 : GET ${path} répond 200 avec le bon type`, async ({ request }) => {
      await expectServed(request, path, contentType);
    });
  }

  for (const pagePath of PAGES) {
    test(`critère 1 : le HTML de ${pagePath} référence l'icône SVG, l'apple-icon, le favicon et le manifeste`, async ({
      page,
      request,
    }) => {
      await page.goto(pagePath);
      const links = await headLinks(page);

      for (const { path, contentType, rel } of ICONS) {
        const match = links.find((link) => link.rel.split(/\s+/).includes(rel) && link.pathname === path);
        expect(match, `<link rel="${rel}"> vers ${path} dans ${JSON.stringify(links)}`).toBeDefined();
        if (match) await expectServed(request, match.href, contentType);
      }

      const manifest = links.find((link) => link.rel === "manifest");
      expect(manifest?.pathname, '<link rel="manifest">').toBe(MANIFEST.path);
    });
  }

  test("critère 1 : le manifeste nomme « AuraCard », theme_color et background_color #0A0A0C, icônes servies", async ({
    request,
    baseURL,
  }) => {
    const body = await expectServed(request, MANIFEST.path, MANIFEST.contentType);
    const manifest = JSON.parse(body.toString("utf8")) as {
      name?: unknown;
      short_name?: unknown;
      theme_color?: unknown;
      background_color?: unknown;
      icons?: { src?: unknown; type?: unknown }[];
    };

    expect(manifest.name).toBe("AuraCard");
    expect.soft(manifest.short_name ?? "AuraCard").toBe("AuraCard");
    expect(manifest.theme_color).toMatch(THEME);
    expect(manifest.background_color).toMatch(THEME);

    const icons = manifest.icons ?? [];
    expect(icons.length, "icônes du manifeste").toBeGreaterThan(0);
    for (const icon of icons) {
      expect(typeof icon.src, `src de ${JSON.stringify(icon)}`).toBe("string");
      const url = new URL(String(icon.src), new URL(MANIFEST.path, baseURL ?? "http://localhost:3000"));
      await expectServed(request, url.href, /^image\//i);
    }
  });

  for (const pagePath of PAGES) {
    test(`critère 2 : sur ${pagePath}, l'en-tête affiche un logo graphique dont le nom accessible est « AuraCard », lien vers /`, async ({
      page,
    }) => {
      await page.goto(pagePath);

      const logo = page.getByRole("banner").getByRole("link", { name: "AuraCard", exact: true });
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute("href", "/");

      const graphic = logo.locator("svg, img").first();
      await expect(graphic, "logo graphique (SVG en ligne ou image) dans le lien").toBeVisible();
      const box = await graphic.boundingBox();
      const viewport = page.viewportSize();
      expect(box, "boîte du logo").not.toBeNull();
      expect(box?.height ?? 0, "hauteur du logo").toBeGreaterThan(0);
      expect(box?.width ?? Infinity, "largeur du logo tient dans l'écran mobile").toBeLessThanOrEqual(viewport?.width ?? 0);
    });
  }

  test("critère 2 : cliquer sur le logo depuis /connexion mène à /", async ({ page }) => {
    await page.goto("/connexion");

    await page.getByRole("banner").getByRole("link", { name: "AuraCard", exact: true }).locator("svg, img").first().click();

    await expect(page).toHaveURL(new URL("/", page.url()).href);
  });

  test("image d'aperçu : GET /opengraph-image.png répond 200, image/png de 1200 × 630", async ({ request }) => {
    const body = await expectServed(request, OPEN_GRAPH.path, OPEN_GRAPH.contentType);

    expect(pngSize(body)).toStrictEqual({ width: OPEN_GRAPH.width, height: OPEN_GRAPH.height });
  });

  for (const pagePath of PAGES) {
    test(`image d'aperçu : ${pagePath} déclare og:image vers /opengraph-image.png`, async ({ page, request }) => {
      await page.goto(pagePath);

      expect(await ogImagePaths(page)).toStrictEqual([OPEN_GRAPH.path]);
      const content = (await page.locator('meta[property="og:image"]').getAttribute("content")) ?? "";
      await expectServed(request, new URL(content).pathname + new URL(content).search, OPEN_GRAPH.contentType);
    });
  }

  test("image d'aperçu : /p/{slug} d'un profil publié sans avatar déclare og:image vers /opengraph-image.png", async ({
    page,
  }) => {
    const profile = await createProfile();

    const response = await page.goto(`/p/${profile.slug}`);

    expect(response?.status()).toBe(200);
    expect(await ogImagePaths(page)).toStrictEqual([OPEN_GRAPH.path]);
  });

  test("image d'aperçu : og:image de / est absolue sur l'origine de SITE_URL", async ({ page }) => {
    await page.goto("/");

    await expectOgImageOnSiteOrigin(page);
  });

  test("image d'aperçu : og:image de /p/{slug} sans avatar est absolue sur l'origine de SITE_URL", async ({ page }) => {
    const profile = await createProfile();

    await page.goto(`/p/${profile.slug}`);

    await expectOgImageOnSiteOrigin(page);
  });
});
