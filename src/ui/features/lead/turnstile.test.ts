/**
 * Contract frozen by test-engineer (0032, decision 14): the widget binds its token to the form and to the profile.
 *
 * // src/ui/features/lead/turnstile.ts
 * // Options given to turnstile.render: the action LEAD_CHALLENGE_ACTION (src/domain/lead/lead.ts) and the slug as
 * // cData are echoed by siteverify (`action`, `cdata`) and compared by the server (src/server/use-cases/capture-lead.ts).
 * export function turnstileRenderOptions(siteKey: string, slug: string):
 *   { sitekey: string; theme: "auto"; language: "fr"; action: typeof LEAD_CHALLENGE_ACTION; cData: string };
 * // Injects Cloudflare's script on first call only. A failed load — `onerror`, or `onload` without `window.turnstile`
 * // — rejects and resets the cache: the next call injects the script again.
 * export function loadTurnstile(): Promise<TurnstileApi>;
 *
 * The unit project runs in node: `document` and `window` are stubbed (only what the loader touches).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";
import type { TurnstileApi } from "@/ui/features/lead/turnstile";

import { TURNSTILE_TEST_SITE_KEY } from "../../../../tests/builders/env";
import { LEAD_SLUG } from "../../../../tests/builders/lead";

type FakeScript = { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; remove: () => void };

function stubBrowser() {
  const scripts: FakeScript[] = [];
  const window: { turnstile?: TurnstileApi } = {};
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", {
    createElement: () => ({ src: "", async: false, onload: null, onerror: null, remove: () => undefined }) satisfies FakeScript,
    head: { append: (script: FakeScript) => scripts.push(script) },
  });
  return { scripts, window };
}

const API: TurnstileApi = { render: () => "widget", reset: () => undefined, remove: () => undefined };

async function loader() {
  vi.resetModules();
  return (await import("@/ui/features/lead/turnstile")).loadTurnstile;
}

describe("turnstileRenderOptions (decision 14)", () => {
  it("action LEAD_CHALLENGE_ACTION and the slug as cData, besides the site key, the theme and the language", async () => {
    const { turnstileRenderOptions } = await import("@/ui/features/lead/turnstile");

    expect(turnstileRenderOptions(TURNSTILE_TEST_SITE_KEY, LEAD_SLUG)).toStrictEqual({
      sitekey: TURNSTILE_TEST_SITE_KEY,
      theme: "auto",
      language: "fr",
      action: LEAD_CHALLENGE_ACTION,
      cData: LEAD_SLUG,
    });
  });
});

describe("loadTurnstile", () => {
  let browser: ReturnType<typeof stubBrowser>;

  beforeEach(() => {
    browser = stubBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects the script once; concurrent calls share the same load", async () => {
    const loadTurnstile = await loader();

    const first = loadTurnstile();
    const second = loadTurnstile();
    browser.window.turnstile = API;
    browser.scripts[0]?.onload?.();

    expect(browser.scripts).toHaveLength(1);
    await expect(first).resolves.toBe(API);
    await expect(second).resolves.toBe(API);
  });

  it("onerror → rejected; the next call injects the script again", async () => {
    const loadTurnstile = await loader();

    const failed = loadTurnstile();
    browser.scripts[0]?.onerror?.();
    await expect(failed).rejects.toThrow();

    const retried = loadTurnstile();
    expect(browser.scripts).toHaveLength(2);
    browser.window.turnstile = API;
    browser.scripts[1]?.onload?.();
    await expect(retried).resolves.toBe(API);
  });

  it("onload without window.turnstile → rejected; the cache is reset and the next call injects the script again", async () => {
    const loadTurnstile = await loader();

    const failed = loadTurnstile();
    browser.scripts[0]?.onload?.();
    await expect(failed).rejects.toThrow();

    const retried = loadTurnstile();
    expect(browser.scripts).toHaveLength(2);
    browser.window.turnstile = API;
    browser.scripts[1]?.onload?.();
    await expect(retried).resolves.toBe(API);
  });
});
