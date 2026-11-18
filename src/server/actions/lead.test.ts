/**
 * Contract frozen by test-engineer (0032, decisions 2, 5, 9 and 14; criteria 1 to 4; ADR 0012).
 *
 * // src/server/actions/lead.ts — "use server"
 * // Decision 14: the type of the errors the page displays is exported here (src/ui never imports a use case).
 * export type CaptureLeadActionError = "invalid_input" | CaptureLeadError;
 * export type CaptureLeadState =
 *   | { status: "idle" }
 *   | { status: "error"; error: CaptureLeadActionError; fields?: LeadInvalidField[] }
 *   | { status: "sent" };
 * // Fields: slug (hidden), name, email, message, consent (checkbox "on"), idempotencyKey (hidden, generated at mount),
 * // cf-turnstile-response (Turnstile's own field). parseLeadSubmission (src/server/actions/lead-schemas.ts) refuses →
 * // { status: "error", error: "invalid_input", fields } before any container (field names only, never a value).
 * // Otherwise createPublicContainer().captureLead(input, await headers()) with input = the validated submission
 * // { name, email, message, idempotencyKey } (trimmed, \r\n → \n, key lower-cased, consent dropped) + { slug,
 * // challengeToken } — the only validation (decision 14); ok → { status: "sent" }; any error → { status: "error",
 * // error }. No submitted value (name, e-mail, message, token) in any state.
 * export async function captureLeadAction(previous: CaptureLeadState, formData: FormData): Promise<CaptureLeadState>;
 *
 * export type DeleteLeadActionError = "invalid_input" | Exclude<DeleteOwnLeadError, "unauthenticated">;
 * export type DeleteLeadState = { status: "idle" } | { status: "error"; error: DeleteLeadActionError } | { status: "deleted" };
 * // Field leadId (uuid) → else invalid_input before createContainer. createContainer().deleteOwnLead(leadId):
 * // err("unauthenticated") → redirect("/connexion"); ok → refresh /tableau-de-bord/messages (revalidatePath or
 * // refresh() of next/cache), { status: "deleted" }; other errors as is. The confirmation is asked by the page.
 * export async function deleteLeadAction(previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState>;
 *
 * // src/server/container.ts
 * // PublicContainer gains captureLead: CaptureLeadFromRequest =
 * //   (input: Omit<CaptureLeadInput, "userAgent" | "clientAddress">, headers: Headers) => Promise<Result<{ leadId: string }, CaptureLeadError>>;
 * //   built on demand like recordBeaconEvent: makeCaptureLead({ rateLimiter: makeSupabaseRateLimiter(admin, RATE_LIMIT_SECRET),
 * //   challenge: makeTurnstileVerifier({ secretKey: env.TURNSTILE_SECRET_KEY, fetch: globalThis.fetch,
 * //   timeoutMs: TURNSTILE_TIMEOUT_MS }), leads: makeSupabaseLeadCapturer(admin) }); userAgent = headers.get("user-agent"),
 * //   clientAddress = requestClientAddress(headers).
 * // Container gains listOwnLeads: ListOwnLeads and deleteOwnLead: DeleteOwnLead (session client, never service_role,
 * //   except the rate limiter as for the other actions).
 * // export const turnstileSiteKey: string = env.TURNSTILE_SITE_KEY;   // read by the public page (Server Component)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { CaptureLeadActionError, CaptureLeadState, DeleteLeadState } from "@/server/actions/lead";

import { IPHONE_USER_AGENT } from "../../../tests/builders/analytics";
import { stubValidEnv } from "../../../tests/builders/env";
import { aLeadDraft, CHALLENGE_TOKEN, IDEMPOTENCY_KEY, LEAD_IDS, LEAD_SLUG } from "../../../tests/builders/lead";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  createPublicContainer: vi.fn(),
  captureLead: vi.fn(),
  deleteOwnLead: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/server/container", () => ({
  createContainer: mocks.createContainer,
  createPublicContainer: mocks.createPublicContainer,
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: [url: string, type?: string]): never => {
    const [url] = args;
    mocks.redirect(...args);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": IPHONE_USER_AGENT }),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  refresh: mocks.refresh,
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
}));

const MESSAGES_PATH = "/tableau-de-bord/messages";
const idleCapture: CaptureLeadState = { status: "idle" };
const idleDelete: DeleteLeadState = { status: "idle" };

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function leadForm(overrides: Record<string, string | undefined> = {}): FormData {
  return form({ slug: LEAD_SLUG, ...aLeadDraft(), "cf-turnstile-response": CHALLENGE_TOKEN, ...overrides });
}

function messagesRefreshed(): boolean {
  return mocks.revalidatePath.mock.calls.some(([path]) => path === MESSAGES_PATH) || mocks.refresh.mock.calls.length > 0;
}

let actions: typeof import("@/server/actions/lead");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/lead");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPublicContainer.mockImplementation(() => ({ captureLead: mocks.captureLead }));
  mocks.createContainer.mockImplementation(async () => ({ deleteOwnLead: mocks.deleteOwnLead }));
  mocks.captureLead.mockResolvedValue(ok({ leadId: LEAD_IDS[0] }));
  mocks.deleteOwnLead.mockResolvedValue(ok(undefined));
});

describe("captureLeadAction (decision 2)", () => {
  it("decision 14: CaptureLeadActionError = invalid_input + the errors of the use case", () => {
    expectTypeOf<CaptureLeadActionError>().toEqualTypeOf<
      "invalid_input" | "not_found" | "challenge_failed" | "challenge_unavailable" | "rate_limited" | "unexpected"
    >();
    expectTypeOf<Extract<CaptureLeadState, { status: "error" }>["error"]>().toEqualTypeOf<CaptureLeadActionError>();
  });

  it("criterion 1 / decision 14: passes the validated submission, the slug, the token and the request headers → { status: 'sent' }", async () => {
    expect(await actions.captureLeadAction(idleCapture, leadForm())).toStrictEqual({ status: "sent" });

    expect(mocks.captureLead).toHaveBeenCalledTimes(1);
    const [input, headers] = mocks.captureLead.mock.calls[0] as [Record<string, unknown>, Headers];
    expect(input).toStrictEqual({
      slug: LEAD_SLUG,
      name: "Jean Visiteur",
      email: "jean.visiteur@example.test",
      message: "Bonjour,\nje souhaite un devis pour l'aménagement de mon bureau.",
      idempotencyKey: IDEMPOTENCY_KEY,
      challengeToken: CHALLENGE_TOKEN,
    });
    expect(headers.get("user-agent")).toBe(IPHONE_USER_AGENT);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("decision 14: the use case receives the values as validated (trimmed, \\r\\n → \\n, key in lower case)", async () => {
    await actions.captureLeadAction(
      idleCapture,
      leadForm({ name: "  Jean  ", email: " jean@example.test ", message: " Ligne 1\r\nLigne 2 ", idempotencyKey: IDEMPOTENCY_KEY.toUpperCase() }),
    );

    const [input] = mocks.captureLead.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({ name: "Jean", email: "jean@example.test", message: "Ligne 1\nLigne 2", idempotencyKey: IDEMPOTENCY_KEY });
    expect(input).not.toHaveProperty("consent");
  });

  it("decision 9: consent not ticked → invalid_input on consent, before any container", async () => {
    expect(await actions.captureLeadAction(idleCapture, leadForm({ consent: undefined }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
      fields: ["consent"],
    });
    expect(mocks.createPublicContainer).not.toHaveBeenCalled();
    expect(mocks.captureLead).not.toHaveBeenCalled();
  });

  it("criterion 6: every invalid field is named (announced next to the field), no value echoed", async () => {
    const state = await actions.captureLeadAction(
      idleCapture,
      leadForm({ name: "", email: "SENTINEL-EMAIL", message: "m".repeat(2001) }),
    );

    expect(state).toStrictEqual({ status: "error", error: "invalid_input", fields: ["name", "email", "message"] });
    expect(JSON.stringify(state)).not.toContain("SENTINEL");
    expect(mocks.createPublicContainer).not.toHaveBeenCalled();
  });

  it.each([
    ["challenge_failed"],
    ["challenge_unavailable"],
    ["rate_limited"],
    ["not_found"],
    ["unexpected"],
  ] as const)("criterion 2: use case error %s → { status: 'error', error } as is", async (error) => {
    mocks.captureLead.mockResolvedValue(err(error));

    expect(await actions.captureLeadAction(idleCapture, leadForm())).toStrictEqual({ status: "error", error });
  });

  it("criterion 2: a missing Turnstile token is passed as absent (the use case refuses it)", async () => {
    mocks.captureLead.mockResolvedValue(err("challenge_failed"));

    await actions.captureLeadAction(idleCapture, leadForm({ "cf-turnstile-response": undefined }));

    const [input] = mocks.captureLead.mock.calls[0] as [Record<string, unknown>];
    expect(input.challengeToken).toBeUndefined();
  });

  it("idempotence: the same form submitted twice reaches the use case twice with the same key", async () => {
    await actions.captureLeadAction(idleCapture, leadForm());
    await actions.captureLeadAction(idleCapture, leadForm());

    const keys = mocks.captureLead.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toStrictEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
  });

  it("no submitted value in the returned state, whatever the outcome", async () => {
    const sentinel = leadForm({ name: "SENTINEL-NAME", email: "sentinel@example.test", message: "SENTINEL-MESSAGE" });
    mocks.captureLead.mockResolvedValue(err("challenge_failed"));

    const state = JSON.stringify(await actions.captureLeadAction(idleCapture, sentinel));

    expect(state).not.toContain("SENTINEL");
    expect(state).not.toContain("sentinel@example.test");
    expect(state).not.toContain(CHALLENGE_TOKEN);
  });
});

describe("deleteLeadAction (decision 5)", () => {
  it("criterion 4: deletes the message by id, refreshes the list → { status: 'deleted' }", async () => {
    expect(await actions.deleteLeadAction(idleDelete, form({ leadId: LEAD_IDS[0] }))).toStrictEqual({ status: "deleted" });

    expect(mocks.deleteOwnLead).toHaveBeenCalledWith(LEAD_IDS[0]);
    expect(messagesRefreshed()).toBe(true);
  });

  it.each([
    ["absent", undefined],
    ["not a uuid", "1; delete from carnet.leads"],
  ])("leadId %s → invalid_input before createContainer", async (_label, leadId) => {
    expect(await actions.deleteLeadAction(idleDelete, form({ leadId }))).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("not signed in → redirect('/connexion')", async () => {
    mocks.deleteOwnLead.mockResolvedValue(err("unauthenticated"));

    await expect(actions.deleteLeadAction(idleDelete, form({ leadId: LEAD_IDS[0] }))).rejects.toThrow("NEXT_REDIRECT:/connexion");
    expect(mocks.redirect).toHaveBeenCalledWith("/connexion");
  });

  it.each([["not_found"], ["rate_limited"], ["unexpected"]] as const)("error %s → { status: 'error', error }, nothing refreshed", async (error) => {
    mocks.deleteOwnLead.mockResolvedValue(err(error));

    expect(await actions.deleteLeadAction(idleDelete, form({ leadId: LEAD_IDS[0] }))).toStrictEqual({ status: "error", error });
    expect(messagesRefreshed()).toBe(false);
  });

  it("idempotence: deleted twice → 'deleted' twice", async () => {
    expect(await actions.deleteLeadAction(idleDelete, form({ leadId: LEAD_IDS[0] }))).toStrictEqual({ status: "deleted" });
    expect(await actions.deleteLeadAction(idleDelete, form({ leadId: LEAD_IDS[0] }))).toStrictEqual({ status: "deleted" });
  });
});
