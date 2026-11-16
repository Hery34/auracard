import { deleteE2eAccounts } from "./helpers/admin";

/**
 * Playwright `globalTeardown` (declared in `playwright.config.ts`): removes the `e2e-*` accounts of this
 * run and of any earlier run that could not clean up. Runs after the suite, whatever its outcome.
 */
export default async function globalTeardown(): Promise<void> {
  const deleted = await deleteE2eAccounts();
  if (deleted > 0) {
    console.log(`[e2e] ${deleted} compte(s) e2e-* supprimé(s) de la pile locale`);
  }
}
