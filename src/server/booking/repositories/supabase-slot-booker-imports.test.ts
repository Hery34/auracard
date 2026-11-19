/**
 * Contract frozen by test-engineer (0039; ADR 0011 avenant phase 5: « chacune appelée par un adaptateur dédié injecté
 * par container.ts (règle ESLint adminAdapters étendue) »).
 *
 * // eslint.config.mjs — the `adminAdapters` group of no-restricted-imports gains the adapter of carnet.book_slot
 * // (src/server/booking/repositories/supabase-slot-booker.ts): only src/server/container.ts (and the tests) import it.
 * // The public reader (anonymous client) stays importable by the server code like the other session adapters.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImports(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((message) => message.ruleId === "no-restricted-imports").map((message) => message.message);
}

const IMPORT_BOOKER = [
  'import { makeSupabaseSlotBooker } from "@/server/booking/repositories/supabase-slot-booker";',
  "export const booker = makeSupabaseSlotBooker;",
  "",
].join("\n");

const IMPORT_BOOKER_RELATIVE = [
  'import { makeSupabaseSlotBooker } from "./supabase-slot-booker";',
  "export const booker = makeSupabaseSlotBooker;",
  "",
].join("\n");

describe("ADR 0011: the book_slot adapter is wired by the composition root only", () => {
  it.each([
    ["a use case", "src/server/booking/use-cases/book-slot.ts", IMPORT_BOOKER],
    ["the public Server Actions", "src/server/booking/public-actions.ts", IMPORT_BOOKER],
    ["a sibling adapter (relative import)", "src/server/booking/repositories/supabase-public-booking-reader.ts", IMPORT_BOOKER_RELATIVE],
  ])("imported by %s → refused by no-restricted-imports (ADR 0011)", async (_label, filePath, code) => {
    const messages = await restrictedImports(code, filePath);

    expect(messages.join("\n")).toMatch(/ADR 0011/);
  }, 30_000);

  it("imported by src/server/container.ts → allowed", async () => {
    expect(await restrictedImports(IMPORT_BOOKER, "src/server/container.ts")).toStrictEqual([]);
  }, 30_000);
});
