import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeRegisterUser } from "@/server/use-cases/register-user";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { fakeRegistrar, PROFILE_ID, type FakeRegistrarOptions } from "../../../tests/builders/fake-registrar";
import { fixedIds } from "../../../tests/builders/fixed-ids";

const input = {
  email: "elodie@example.test",
  password: "correct horse battery staple",
  displayName: "Élodie Durand-Mérel",
  clientAddress: "203.0.113.9",
};

const BASE_SLUG = "elodie-durand-merel";
const SIGNUP_CONSUME = { scope: "signup", subject: "203.0.113.9", limit: 10, windowSeconds: 3600 };

function harness(
  overrides: { auth?: FakeAuthGatewayOptions; registrar?: FakeRegistrarOptions; limiter?: FakeRateLimiterOptions } = {},
) {
  const log = makeCallLog();
  const registerUser = makeRegisterUser({
    auth: fakeAuthGateway({ log, ...overrides.auth }),
    registrar: fakeRegistrar({ log, ...overrides.registrar }),
    ids: fixedIds(),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
  });

  return { log, registerUser };
}

describe("registerUser", () => {
  describe("rate limiting", () => {
    it("criterion 4: consumes the signup counter of the client address before anything else", async () => {
      const { log, registerUser } = harness();

      await registerUser(input);

      expect(log.sequence()[0]).toBe("rateLimiter.consume");
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([SIGNUP_CONSUME]);
    });

    it("criterion 4: err('rate_limited') before any call to the gateway when the limiter refuses", async () => {
      const { log, registerUser } = harness({ limiter: { deny: ["signup"] } });

      expect(await registerUser(input)).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });

    it("fails closed: limiter 'unexpected' → err('unexpected') without any call to the gateway", async () => {
      const { log, registerUser } = harness({ limiter: { failing: true } });

      expect(await registerUser(input)).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });
  });

  describe("sign-up", () => {
    it("criterion 4: success → ok with the profileId and needsEmailConfirmation false when a session was created", async () => {
      const { log, registerUser } = harness();

      expect(await registerUser(input)).toStrictEqual(ok({ profileId: PROFILE_ID, needsEmailConfirmation: false }));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "auth.signUp", "registrar.register"]);
      expect(log.inputsOf("auth", "signUp")).toStrictEqual([{ email: input.email, password: input.password }]);
    });

    // Option (a), Hery 16/11/2026: without a session the account is not authenticated (GoTrue may answer for an
    // existing unconfirmed account of another project), so nothing is written; carnet is joined at the first
    // confirmed sign-in (sign-in → ensure-membership).
    it("criterion 4: no session (confirmation pending) → ok({ needsEmailConfirmation: true }) without profileId and without any call to the registrar", async () => {
      const { log, registerUser } = harness({
        auth: { signUp: ok({ userId: GATEWAY_USER_ID, sessionCreated: false }) },
      });

      expect(await registerUser(input)).toStrictEqual(ok({ needsEmailConfirmation: true }));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "auth.signUp"]);
    });

    it("criterion 4: with a session → the registrar is called once with the gateway identifier", async () => {
      const { log, registerUser } = harness({
        auth: { signUp: ok({ userId: GATEWAY_USER_ID, sessionCreated: true }) },
      });

      expect(await registerUser(input)).toStrictEqual(ok({ profileId: PROFILE_ID, needsEmailConfirmation: false }));
      expect(log.inputsOf("registrar", "register")).toHaveLength(1);
    });

    it("registers the identifier returned by the gateway, the display name and the slug derived from it", async () => {
      const { log, registerUser } = harness();

      await registerUser(input);

      expect(log.inputsOf("registrar", "register")).toStrictEqual([
        { userId: GATEWAY_USER_ID, displayName: "Élodie Durand-Mérel", slug: BASE_SLUG },
      ]);
    });

    it("criterion 4: email_taken → err('email_taken') without any call to the registrar", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("email_taken") } });

      expect(await registerUser(input)).toStrictEqual(err("email_taken"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "auth.signUp"]);
    });

    it("criterion 4: weak_password → err('weak_password') without any call to the registrar", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("weak_password") } });

      expect(await registerUser(input)).toStrictEqual(err("weak_password"));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([]);
    });

    it("gateway 'unexpected' → err('unexpected') without any call to the registrar", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("unexpected") } });

      expect(await registerUser(input)).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([]);
    });

    it("gateway rate_limited (GoTrue quota) → err('rate_limited') without any call to the registrar", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("rate_limited") } });

      expect(await registerUser(input)).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "auth.signUp"]);
    });

    it("gateway registration_closed (sign-ups disabled) → err('registration_closed') without any call to the registrar", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("registration_closed") } });

      expect(await registerUser(input)).toStrictEqual(err("registration_closed"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "auth.signUp"]);
    });
  });

  describe("slug collisions", () => {
    it("criterion 4: slug_taken then success → two calls, the second slug suffixed with the first 4 hex characters of ids.uuid()", async () => {
      const { log, registerUser } = harness({
        registrar: { results: [err("slug_taken"), ok({ profileId: PROFILE_ID })] },
      });

      expect(await registerUser(input)).toStrictEqual(ok({ profileId: PROFILE_ID, needsEmailConfirmation: false }));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([
        { userId: GATEWAY_USER_ID, displayName: input.displayName, slug: BASE_SLUG },
        { userId: GATEWAY_USER_ID, displayName: input.displayName, slug: `${BASE_SLUG}-1a2b` },
      ]);
    });

    it("criterion 4: three slug_taken → err('slug_unavailable') after exactly three attempts with distinct suffixes", async () => {
      const { log, registerUser } = harness({ registrar: { results: [err("slug_taken")] } });

      expect(await registerUser(input)).toStrictEqual(err("slug_unavailable"));
      expect(log.inputsOf("registrar", "register").map((call) => (call as { slug: string }).slug)).toStrictEqual([
        BASE_SLUG,
        `${BASE_SLUG}-1a2b`,
        `${BASE_SLUG}-5e6f`,
      ]);
    });

    it("keeps the suffixed slug within 40 characters for a long display name", async () => {
      const { log, registerUser } = harness({
        registrar: { results: [err("slug_taken"), ok({ profileId: PROFILE_ID })] },
      });

      await registerUser({ ...input, displayName: "abcde ".repeat(10) });

      const slugs = log.inputsOf("registrar", "register").map((call) => (call as { slug: string }).slug);
      expect(slugs[1]).toMatch(/-1a2b$/);
      expect(slugs[1]?.length).toBeLessThanOrEqual(40);
    });
  });

  describe("registrar failures", () => {
    it("criterion 4: project_inactive → err('registration_closed') after a single attempt", async () => {
      const { log, registerUser } = harness({ registrar: { results: [err("project_inactive")] } });

      expect(await registerUser(input)).toStrictEqual(err("registration_closed"));
      expect(log.inputsOf("registrar", "register")).toHaveLength(1);
    });

    it("registrar 'unexpected' → err('unexpected') after a single attempt", async () => {
      const { log, registerUser } = harness({ registrar: { results: [err("unexpected")] } });

      expect(await registerUser(input)).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("registrar", "register")).toHaveLength(1);
    });
  });

  describe("replay", () => {
    it("executed twice with the same input → same result and identical registrar inputs (no suffix drift)", async () => {
      const { log, registerUser } = harness();

      const first = await registerUser(input);
      const second = await registerUser(input);

      expect(second).toStrictEqual(first);
      expect(log.inputsOf("registrar", "register")).toStrictEqual([
        { userId: GATEWAY_USER_ID, displayName: input.displayName, slug: BASE_SLUG },
        { userId: GATEWAY_USER_ID, displayName: input.displayName, slug: BASE_SLUG },
      ]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([SIGNUP_CONSUME, SIGNUP_CONSUME]);
    });

    it("a replay that GoTrue rejects as email_taken creates nothing more", async () => {
      const { log, registerUser } = harness({ auth: { signUp: err("email_taken") } });

      await registerUser(input);
      await registerUser(input);

      expect(log.inputsOf("registrar", "register")).toStrictEqual([]);
    });
  });
});
