import { expect, test } from "@playwright/test";

import { colorsOf, cssRgb } from "./helpers/contrast";

const BRAND = /aura\s*card/i;

test.describe("home page", () => {
  test("GET / responds 200 with a French document titled AuraCard showing the text AuraCard", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle(BRAND);
    await expect(page.getByText(BRAND).first()).toBeVisible();
  });

  test("critère 2 : GET / en thème sombre (#0A0A0C), aucun « carnet » visible", async ({ page }) => {
    await page.goto("/");

    const body = await colorsOf(page.locator("body"));
    expect.soft(cssRgb(body.ownBackground.rgb), "fond calculé de body").toBe("rgb(10, 10, 12)");
    expect.soft(body.ownBackground.alpha, "fond de body opaque").toBe(255);
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect.soft(visibleText, "texte visible").not.toMatch(/carnet/i);
  });

  test("GET / carries the security headers and no X-Powered-By", async ({ page }) => {
    const response = await page.goto("/");
    if (response === null) {
      throw new Error("GET / returned no response");
    }

    expect(response.status()).toBe(200);

    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
