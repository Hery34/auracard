/**
 * Origin of the SITE_URL handed to `pnpm start` by `playwright.config.ts` (same rule:
 * `SITE_URL` ?? origin of `E2E_BASE_URL` ?? `http://localhost:3000`). Single source for the E2E.
 */
export function e2eSiteOrigin(): string {
  const { SITE_URL, E2E_BASE_URL } = process.env;
  return new URL(SITE_URL ?? (E2E_BASE_URL ? new URL(E2E_BASE_URL).origin : "http://localhost:3000")).origin;
}
