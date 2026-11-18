/**
 * Contract frozen by test-engineer (0032, decisions 2, 6 and 11; ADR 0008). `fetch` is simulated: Cloudflare is never
 * called by the unit tests.
 *
 * // src/server/adapters/turnstile.ts (agent integrations) — no npm dependency (decision 11)
 * export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
 * export const TURNSTILE_TIMEOUT_MS = 5000;
 * export function makeTurnstileVerifier(deps: {
 *   secretKey: string;                 // env.TURNSTILE_SECRET_KEY in the container
 *   fetch: typeof globalThis.fetch;    // globalThis.fetch in the container
 *   timeoutMs: number;                 // TURNSTILE_TIMEOUT_MS in the container (whole exchange)
 * }): BotChallengeVerifier;
 * // One POST to TURNSTILE_SITEVERIFY_URL, body (form-urlencoded or JSON) with exactly `secret` and `response` (the
 * // token). Decision 14, after the second audit: no `idempotency_key` — each token is validated once by Cloudflare (a
 * // replayed token → timeout-or-duplicate → { passed: false }). No `remoteip` (minimization: the visitor's address is
 * // not sent). `redirect: "error"`, aborted after timeoutMs.
 * // Decision 14 — token bound to the form and to the profile: input = { token, expectedAction, expectedCData }
 * //   (expectedAction LEAD_CHALLENGE_ACTION, expectedCData the slug; neither is sent to siteverify, which has no such
 * //   parameter: they are compared with the `action` and `cdata` of the answer).
 * // 2xx JSON { success: true, action, cdata } with action === expectedAction and cdata === expectedCData
 * //   → ok({ passed: true });
 * // 2xx JSON { success: true } with an `action` or a `cdata` (string) different from the expected one
 * //   → ok({ passed: false }) (token issued for another form or another profile, e.g. replayed on another slug);
 * // 2xx JSON { success: true } without `action` / `cdata`:
 * //   - `metadata.result_with_testing_key === true` → ok({ passed: true }): Cloudflare's test secrets answer without
 * //     `action` nor `cdata` whatever the widget sent (observed 18/11/2026, verbatim in TEST_KEY_ANSWER below);
 * //     env.ts refuses the test keys in production outside localhost / 127.0.0.1 (decision 14);
 * //   - otherwise → err("unavailable") + log "malformed_answer" (a real key always echoes them: never passed);
 * // `action` or `cdata` present but not a string → err("unavailable") (malformed answer);
 * // 2xx JSON { success: false } with token errors (invalid-input-response, missing-input-response,
 * //   timeout-or-duplicate) → ok({ passed: false });
 * // anything else → err("unavailable") + logInfrastructureError("turnstile", <error code or HTTP status>):
 * //   network error, timeout, non-2xx status, body that is not JSON, `success` not a boolean, configuration errors
 * //   (invalid-input-secret, missing-input-secret, internal-error, bad-request). A malformed answer never passes.
 * // Never throws; the log line carries neither the token nor the secret.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";
import { err, ok } from "@/domain/shared/result";
import { makeTurnstileVerifier, TURNSTILE_SITEVERIFY_URL, TURNSTILE_TIMEOUT_MS } from "@/server/adapters/turnstile";

import { CHALLENGE_TOKEN, IDEMPOTENCY_KEY, LEAD_SLUG, OTHER_LEAD_SLUG } from "../../../tests/builders/lead";

/** Cloudflare's "always passes" test secret (decision 6): a fixture, never a real secret. */
const SECRET = "1x0000000000000000000000000000000AA";
const TEST_TIMEOUT_MS = 80;

type FetchCall = { url: string; init: RequestInit | undefined };

function fetchAnswering(answer: (init: RequestInit | undefined) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    return answer(init);
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Never answers until the request is aborted. */
function hangingUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  });
}

/** The fields of the request body, whether sent form-urlencoded (string or URLSearchParams), as FormData or as JSON. */
function bodyFields(init: RequestInit | undefined): Record<string, string> {
  const body = init?.body;
  if (body instanceof URLSearchParams || body instanceof FormData) {
    return Object.fromEntries([...body.entries()].map(([name, value]) => [name, String(value)]));
  }
  if (typeof body === "string") {
    return body.trim().startsWith("{")
      ? (JSON.parse(body) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(body).entries());
  }
  throw new Error(`unexpected body: ${String(body)}`);
}

function verifier(fetch: typeof globalThis.fetch) {
  return makeTurnstileVerifier({ secretKey: SECRET, fetch, timeoutMs: TEST_TIMEOUT_MS });
}

const INPUT = { token: CHALLENGE_TOKEN, expectedAction: LEAD_CHALLENGE_ACTION, expectedCData: LEAD_SLUG };

/** What a production secret answers for a token of the contact form of LEAD_SLUG (documented shape of siteverify). */
function passing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    challenge_ts: "2026-11-18T14:04:35.587Z",
    hostname: "carnet.example",
    "error-codes": [],
    action: LEAD_CHALLENGE_ACTION,
    cdata: LEAD_SLUG,
    metadata: { ephemeral_id: "x:ephemeral" },
    ...overrides,
  };
}

/** Verbatim answer of siteverify to the « always passes » test secret (1x…AA), observed on 18/11/2026. */
const TEST_KEY_ANSWER = {
  challenge_ts: "2026-11-18T14:04:35.587Z",
  "error-codes": [],
  hostname: "example.com",
  metadata: { result_with_testing_key: true },
  success: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeTurnstileVerifier", () => {
  it("exports the siteverify endpoint and a 5 s delay", () => {
    expect(TURNSTILE_SITEVERIFY_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(TURNSTILE_TIMEOUT_MS).toBe(5000);
  });

  it("ADR 0008 / decision 14: one POST to siteverify with the secret and the token, nothing else (no idempotency_key)", async () => {
    const { calls, fetch } = fetchAnswering(() => json(passing()));

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: true }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(bodyFields(calls[0]?.init)).toStrictEqual({ secret: SECRET, response: CHALLENGE_TOKEN });
  });

  it("ADR 0008: hostname not checked (configured on the key at Cloudflare, decision 13)", async () => {
    const { fetch } = fetchAnswering(() => json(passing({ hostname: "example.com" })));

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: true }));
  });

  describe("decision 14: token bound to the form (action) and to the profile (cdata)", () => {
    it("action and cdata expected → { passed: true }; neither is sent to siteverify", async () => {
      const { calls, fetch } = fetchAnswering(() => json(passing()));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: true }));
      expect(Object.keys(bodyFields(calls[0]?.init)).sort()).toStrictEqual(["response", "secret"]);
    });

    it("same token replayed on another slug: cdata of the first profile → { passed: false }", async () => {
      const { fetch } = fetchAnswering(() => json(passing({ cdata: LEAD_SLUG })));

      expect(await verifier(fetch).verify({ ...INPUT, expectedCData: OTHER_LEAD_SLUG })).toStrictEqual(ok({ passed: false }));
    });

    it.each([
      ["another action (token of another form)", { action: "login" }],
      ["an empty action (widget rendered without action)", { action: "" }],
      ["another cdata", { cdata: OTHER_LEAD_SLUG }],
      ["an empty cdata (widget rendered without cData)", { cdata: "" }],
      ["a cdata differing by case", { cdata: LEAD_SLUG.toUpperCase() }],
    ])("success with %s → { passed: false }", async (_label, overrides) => {
      const { fetch } = fetchAnswering(() => json(passing(overrides)));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: false }));
    });

    it("Cloudflare test secret: answer without action nor cdata, result_with_testing_key → { passed: true }", async () => {
      const { fetch } = fetchAnswering(() => json(TEST_KEY_ANSWER));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: true }));
    });

    it("test secret answering an action or a cdata nevertheless → compared like any other answer", async () => {
      const { fetch } = fetchAnswering(() => json({ ...TEST_KEY_ANSWER, cdata: OTHER_LEAD_SLUG }));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: false }));
    });

    it.each([
      ["without action nor cdata", { action: undefined, cdata: undefined }],
      ["without cdata", { cdata: undefined }],
      ["without action", { action: undefined }],
      ["result_with_testing_key not strictly true", { action: undefined, cdata: undefined, metadata: { result_with_testing_key: "true" } }],
    ])("success %s, real key → unavailable, logged, never passed", async (_label, overrides) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { fetch } = fetchAnswering(() => json(passing(overrides)));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
      expect(error).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: "error", source: "turnstile" });
    });

    it.each([
      ["action as a number", { action: 1 }],
      ["cdata as an object", { cdata: { slug: LEAD_SLUG } }],
      ["cdata null", { cdata: null }],
    ])("malformed %s → unavailable, never passed", async (_label, overrides) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { fetch } = fetchAnswering(() => json(passing(overrides)));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
    });

    it("a refusal stays a refusal whatever action and cdata say", async () => {
      const { fetch } = fetchAnswering(() => json({ ...passing(), success: false, "error-codes": ["timeout-or-duplicate"] }));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: false }));
    });
  });

  it.each([["invalid-input-response"], ["timeout-or-duplicate"], ["missing-input-response"]])(
    "criterion 2: token refused (%s) → { passed: false }",
    async (code) => {
      const { fetch } = fetchAnswering(() => json({ success: false, "error-codes": [code] }));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: false }));
    },
  );

  it("criterion 2: refusal without error code → { passed: false }", async () => {
    const { fetch } = fetchAnswering(() => json({ success: false }));

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(ok({ passed: false }));
  });

  it.each([["invalid-input-secret"], ["missing-input-secret"], ["internal-error"], ["bad-request"]])(
    "ADR 0008: configuration or provider error (%s) → unavailable, logged",
    async (code) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { fetch } = fetchAnswering(() => json({ success: false, "error-codes": [code] }));

      expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
      expect(error).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: "error", source: "turnstile" });
    },
  );

  it("criterion 2: network error → unavailable, never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = fetchAnswering(() => {
      throw new TypeError("fetch failed");
    });

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
  });

  it("criterion 2: Cloudflare not answering → unavailable once the delay has elapsed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = fetchAnswering(hangingUntilAborted);
    const started = Date.now();

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each([
    ["503", () => new Response("Service Unavailable", { status: 503 })],
    ["500 with a JSON success (status wins)", () => json({ success: true }, 500)],
    ["429", () => json({ success: false }, 429)],
    ["a redirection refused by fetch", () => Promise.reject(new TypeError("unexpected redirect"))],
  ])("criterion 2: HTTP %s → unavailable", async (_label, answer) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = fetchAnswering(answer);

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
  });

  it.each([
    ["HTML instead of JSON", () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["empty body", () => new Response("", { status: 200 })],
    ["JSON without success", () => json({ hostname: "example.com" })],
    ["success as a string", () => json({ success: "true" })],
    ["success as a number", () => json({ success: 1 })],
    ["a JSON array", () => json([{ success: true }])],
    ["JSON null", () => json(null)],
  ])("malformed answer (%s) → unavailable, never passed", async (_label, answer) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = fetchAnswering(answer);

    expect(await verifier(fetch).verify(INPUT)).toStrictEqual(err("unavailable"));
  });

  it("the log line carries neither the token nor the secret", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = fetchAnswering(() => json({ success: false, "error-codes": ["invalid-input-secret"] }));

    await verifier(fetch).verify(INPUT);

    const lines = error.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).not.toContain(CHALLENGE_TOKEN);
    expect(lines).not.toContain(SECRET);
  });

  it("decision 14: the same token verified twice → two calls; the replay refused by Cloudflare (timeout-or-duplicate) → { passed: false }", async () => {
    let answered = 0;
    const { calls, fetch } = fetchAnswering(() => {
      answered += 1;
      return answered === 1 ? json(passing()) : json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    });
    const turnstile = verifier(fetch);

    expect(await turnstile.verify(INPUT)).toStrictEqual(ok({ passed: true }));
    expect(await turnstile.verify(INPUT)).toStrictEqual(ok({ passed: false }));

    expect(calls.map((call) => bodyFields(call.init))).toStrictEqual([
      { secret: SECRET, response: CHALLENGE_TOKEN },
      { secret: SECRET, response: CHALLENGE_TOKEN },
    ]);
  });

  it("decision 14: an extra idempotencyKey in the input (stale caller) is never sent to siteverify", async () => {
    const { calls, fetch } = fetchAnswering(() => json(passing()));

    await verifier(fetch).verify({ ...INPUT, idempotencyKey: IDEMPOTENCY_KEY } as typeof INPUT);

    expect(JSON.stringify(bodyFields(calls[0]?.init))).not.toContain(IDEMPOTENCY_KEY);
  });
});
