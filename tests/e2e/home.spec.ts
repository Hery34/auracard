import { expect, test } from "@playwright/test";

test.describe("home page", () => {
  test("GET / responds 200 with a French document titled carnet showing the text carnet", async ({
    page,
  }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle("carnet");
    await expect(page.getByText("carnet", { exact: true }).first()).toBeVisible();
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
