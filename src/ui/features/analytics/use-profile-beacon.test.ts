/**
 * Contract frozen by test-engineer (0029, point 10): a failure of the measurement never breaks the page.
 *
 * // src/ui/features/analytics/use-profile-beacon.ts
 * export function useProfileBeacon(slug: string): void;
 * // Neither the mount effect nor the click listener lets an exception escape when navigator.sendBeacon or
 * // crypto.randomUUID is missing or throws, or when history.replaceState throws (silent try/catch).
 *
 * The unit project runs in Node without a DOM library: React's useRef / useEffect are replaced by a synchronous
 * stand-in (the effect runs at once) and the browser globals the hook touches are stubbed. Nothing of the domain
 * is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENT_ID, LINK_ID, PROFILE_SLUG } from "../../../../tests/builders/analytics";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: <T>(initial: T) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => {
    effect();
  },
}));

type ClickListener = (event: { isTrusted: boolean; target: unknown }) => void;

/** Stand-in for a DOM element marked by `beaconAttributes`: only what `beaconTargetOf` reads. */
class FakeElement {
  constructor(private readonly attributes: Record<string, string>) {}

  closest(): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

let listeners: ClickListener[];
let sendBeacon: ReturnType<typeof vi.fn>;
let randomUUID: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;
let hook: typeof import("./use-profile-beacon");

beforeEach(async () => {
  listeners = [];
  sendBeacon = vi.fn(() => true);
  randomUUID = vi.fn(() => EVENT_ID);
  replaceState = vi.fn();
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("window", {
    location: { href: `https://carnet.example/p/${PROFILE_SLUG}?s=nfc` },
    history: { replaceState },
  });
  vi.stubGlobal("document", {
    addEventListener: (_type: string, listener: ClickListener) => listeners.push(listener),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", { sendBeacon });
  vi.stubGlobal("crypto", { randomUUID });
  hook = await import("./use-profile-beacon");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(): void {
  hook.useProfileBeacon(PROFILE_SLUG);
}

function clickLink(): void {
  for (const listener of listeners) {
    listener({ isTrusted: true, target: new FakeElement({ "data-beacon-link": LINK_ID }) });
  }
}

function sentBodies(): unknown[] {
  return sendBeacon.mock.calls.map(([, body]) => JSON.parse(body as string) as unknown);
}

describe("useProfileBeacon", () => {
  it("non-regression: one profile_view on mount, one link_click per click, ?s= removed", () => {
    mount();
    clickLink();

    expect(sendBeacon.mock.calls.map(([path]) => path)).toStrictEqual(["/api/beacon", "/api/beacon"]);
    expect(sentBodies()).toStrictEqual([
      { slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view", source: "nfc" },
      { slug: PROFILE_SLUG, id: EVENT_ID, type: "link_click", source: "nfc", link_id: LINK_ID },
    ]);
    expect(replaceState).toHaveBeenCalledWith(null, "", `/p/${PROFILE_SLUG}`);
  });

  it.each([
    ["navigator.sendBeacon is missing", () => vi.stubGlobal("navigator", {})],
    [
      "navigator.sendBeacon throws",
      () =>
        sendBeacon.mockImplementation(() => {
          throw new TypeError("Beacon blocked");
        }),
    ],
    ["crypto.randomUUID is missing (insecure context)", () => vi.stubGlobal("crypto", {})],
    [
      "crypto.randomUUID throws",
      () =>
        randomUUID.mockImplementation(() => {
          throw new Error("no entropy");
        }),
    ],
    [
      "history.replaceState throws",
      () =>
        replaceState.mockImplementation(() => {
          throw new DOMException("denied", "SecurityError");
        }),
    ],
  ])("point 10: %s → neither the mount nor a click throws", (_label, breakMeasurement) => {
    breakMeasurement();

    expect(mount).not.toThrow();
    expect(clickLink).not.toThrow();
  });

  it.each([
    [
      "navigator.sendBeacon throws",
      () =>
        sendBeacon.mockImplementation(() => {
          throw new TypeError("Beacon blocked");
        }),
    ],
    [
      "crypto.randomUUID throws",
      () =>
        randomUUID.mockImplementation(() => {
          throw new Error("no entropy");
        }),
    ],
  ])("point 10: %s after a successful mount → the click listener does not throw", (_label, breakMeasurement) => {
    mount();
    expect(listeners).toHaveLength(1);
    breakMeasurement();

    expect(clickLink).not.toThrow();
  });
});
