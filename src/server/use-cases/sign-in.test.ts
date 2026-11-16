import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSignIn } from "@/server/use-cases/sign-in";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import {
  fakeMembershipReader,
  type FakeMembershipReaderOptions,
} from "../../../tests/builders/fake-membership-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { fakeRegistrar, PROFILE_ID, type FakeRegistrarOptions } from "../../../tests/builders/fake-registrar";
import { fixedIds } from "../../../tests/builders/fixed-ids";

const input = {
  email: "Elodie@Example.test",
  password: "correct horse battery staple",
  clientAddress: "203.0.113.9",
};
const withName = { ...input, displayName: "Élodie Durand-Mérel" };

const BASE_SLUG = "elodie-durand-merel";
const LOGIN_CONSUME = { scope: "login", subject: "203.0.113.9", limit: 10, windowSeconds: 900 };
const LOGIN_ACCOUNT_CONSUME = { scope: "login-account", subject: "elodie@example.test", limit: 10, windowSeconds: 900 };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    membership?: FakeMembershipReaderOptions;
    registrar?: FakeRegistrarOptions;
    limiter?: FakeRateLimiterOptions;
  } = {},
) {
  const log = makeCallLog();
  const signIn = makeSignIn({
    auth: fakeAuthGateway({ log, ...overrides.auth }),
    membership: fakeMembershipReader({ log, ...overrides.membership }),
    registrar: fakeRegistrar({ log, ...overrides.registrar }),
    ids: fixedIds(),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
  });

  return { log, signIn };
}

describe("signIn", () => {
  describe("rate limiting", () => {
    it("criterion 5: consumes 'login' (address) then 'login-account' (lowercased e-mail) before calling the gateway", async () => {
      const { log, signIn } = harness();

      await signIn(input);

      expect(log.sequence().slice(0, 3)).toStrictEqual(["rateLimiter.consume", "rateLimiter.consume", "auth.signIn"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LOGIN_CONSUME, LOGIN_ACCOUNT_CONSUME]);
    });

    it("criterion 5: 'login' refused → err('rate_limited') without any call to the gateway", async () => {
      const { log, signIn } = harness({ limiter: { deny: ["login"] } });

      expect(await signIn(input)).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).not.toContain("auth.signIn");
    });

    it("criterion 5: 'login-account' refused → err('rate_limited') without any call to the gateway", async () => {
      const { log, signIn } = harness({ limiter: { deny: ["login-account"] } });

      expect(await signIn(input)).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).not.toContain("auth.signIn");
    });

    it("fails closed: limiter 'unexpected' → err('unexpected') without any call to the gateway", async () => {
      const { log, signIn } = harness({ limiter: { failing: true } });

      expect(await signIn(input)).toStrictEqual(err("unexpected"));
      expect(log.sequence()).not.toContain("auth.signIn");
    });
  });

  describe("authentication", () => {
    it("passes the password and the e-mail to the gateway", async () => {
      const { log, signIn } = harness();

      await signIn(input);

      const [call] = log.inputsOf("auth", "signIn") as Array<{ email: string; password: string }>;
      expect(call?.password).toBe(input.password);
      expect(call?.email.toLowerCase()).toBe("elodie@example.test");
    });

    it("criterion 5: invalid credentials → err('invalid_credentials') without membership lookup or registration", async () => {
      const { log, signIn } = harness({ auth: { signIn: err("invalid_credentials") } });

      expect(await signIn(withName)).toStrictEqual(err("invalid_credentials"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "rateLimiter.consume", "auth.signIn"]);
    });

    it("gateway 'unexpected' → err('unexpected')", async () => {
      const { signIn } = harness({ auth: { signIn: err("unexpected") } });

      expect(await signIn(withName)).toStrictEqual(err("unexpected"));
    });

    it("gateway email_not_confirmed → err('email_not_confirmed') without membership lookup or registration", async () => {
      const { log, signIn } = harness({ auth: { signIn: err("email_not_confirmed") } });

      expect(await signIn(withName)).toStrictEqual(err("email_not_confirmed"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "rateLimiter.consume", "auth.signIn"]);
    });

    it("gateway rate_limited (GoTrue quota) → err('rate_limited') without membership lookup or registration", async () => {
      const { log, signIn } = harness({ auth: { signIn: err("rate_limited") } });

      expect(await signIn(withName)).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "rateLimiter.consume", "auth.signIn"]);
    });
  });

  describe("membership", () => {
    it("criterion 5: member → ok({ joined: false }) without any call to the registrar", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(true)] } });

      expect(await signIn(withName)).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: false }));
      expect(log.sequence()).toStrictEqual([
        "rateLimiter.consume",
        "rateLimiter.consume",
        "auth.signIn",
        "membership.isMember",
      ]);
    });

    it("reads the membership of the session established by signIn (after it, never before)", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(true)] } });

      await signIn(input);

      const sequence = log.sequence();
      expect(sequence.indexOf("membership.isMember")).toBeGreaterThan(sequence.indexOf("auth.signIn"));
    });

    it("membership 'unexpected' → err('unexpected') without any call to the registrar", async () => {
      const { log, signIn } = harness({ membership: { results: [err("unexpected")] } });

      expect(await signIn(withName)).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([]);
    });

    it("criterion 5: not a member and no display name → err('display_name_required') without any call to the registrar", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(false)] } });

      expect(await signIn(input)).toStrictEqual(err("display_name_required"));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([]);
    });
  });

  describe("joining carnet", () => {
    it("criterion 5: not a member with a display name → registrar called with the identifier returned by signIn → ok({ joined: true })", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(false)] } });

      expect(await signIn(withName)).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: true }));
      expect(log.inputsOf("registrar", "register")).toStrictEqual([
        { userId: GATEWAY_USER_ID, displayName: "Élodie Durand-Mérel", slug: BASE_SLUG },
      ]);
    });

    it("criterion 5: replayed with the same input → same result and identical registrar inputs", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(false)] } });

      const first = await signIn(withName);
      const second = await signIn(withName);

      expect(first).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: true }));
      expect(second).toStrictEqual(first);
      expect(log.inputsOf("registrar", "register")).toStrictEqual([
        { userId: GATEWAY_USER_ID, displayName: "Élodie Durand-Mérel", slug: BASE_SLUG },
        { userId: GATEWAY_USER_ID, displayName: "Élodie Durand-Mérel", slug: BASE_SLUG },
      ]);
    });

    it("once the account has joined, a new sign-in is a plain connection: ok({ joined: false }) and no registration", async () => {
      const { log, signIn } = harness({ membership: { results: [ok(false), ok(true)] } });

      expect(await signIn(withName)).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: true }));
      expect(await signIn(withName)).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: false }));
      expect(log.inputsOf("registrar", "register")).toHaveLength(1);
    });

    it("slug_taken then success → second attempt with the slug suffixed by the first 4 hex characters of ids.uuid()", async () => {
      const { log, signIn } = harness({
        registrar: { results: [err("slug_taken"), ok({ profileId: PROFILE_ID })] },
      });

      expect(await signIn(withName)).toStrictEqual(ok({ userId: GATEWAY_USER_ID, joined: true }));
      expect(log.inputsOf("registrar", "register").map((call) => (call as { slug: string }).slug)).toStrictEqual([
        BASE_SLUG,
        `${BASE_SLUG}-1a2b`,
      ]);
    });

    it("three slug_taken → err('slug_unavailable') after exactly three attempts", async () => {
      const { log, signIn } = harness({ registrar: { results: [err("slug_taken")] } });

      expect(await signIn(withName)).toStrictEqual(err("slug_unavailable"));
      expect(log.inputsOf("registrar", "register")).toHaveLength(3);
    });

    it("project_inactive → err('registration_closed')", async () => {
      const { signIn } = harness({ registrar: { results: [err("project_inactive")] } });

      expect(await signIn(withName)).toStrictEqual(err("registration_closed"));
    });

    it("registrar 'unexpected' → err('unexpected')", async () => {
      const { signIn } = harness({ registrar: { results: [err("unexpected")] } });

      expect(await signIn(withName)).toStrictEqual(err("unexpected"));
    });
  });
});
