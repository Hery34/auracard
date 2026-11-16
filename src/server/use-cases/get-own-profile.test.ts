import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetOwnProfile } from "@/server/use-cases/get-own-profile";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import {
  anOwnProfile,
  fakeProfileReader,
  type FakeProfileReaderOptions,
} from "../../../tests/builders/fake-profile-reader";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

function harness(overrides: { auth?: FakeAuthGatewayOptions; profiles?: FakeProfileReaderOptions } = {}) {
  const log = makeCallLog();
  const getOwnProfile = makeGetOwnProfile({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
  });

  return { log, getOwnProfile };
}

describe("getOwnProfile", () => {
  it("criterion 7: no session (currentUser → null) → err('unauthenticated') without any read of the profile", async () => {
    const { log, getOwnProfile } = harness({ auth: { currentUser: ok(null) } });

    expect(await getOwnProfile()).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 7: authenticated with a profile → ok({ profile }) carrying id, slug, displayName and isPublished as read", async () => {
    const profile = anOwnProfile({ isPublished: true });
    const { log, getOwnProfile } = harness({ profiles: { results: [ok(profile)] } });

    expect(await getOwnProfile()).toStrictEqual(ok({ profile }));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("criterion 7: the profile is read only once the session is verified (currentUser before getOwn)", async () => {
    const { log, getOwnProfile } = harness();

    await getOwnProfile();

    const sequence = log.sequence();
    expect(sequence.indexOf("auth.currentUser")).toBeLessThan(sequence.indexOf("profiles.getOwn"));
  });

  it("criterion 7 / 8: authenticated without a profile (cookie of an account of another project) → ok({ profile: null })", async () => {
    const { getOwnProfile } = harness({ profiles: { results: [ok(null)] } });

    expect(await getOwnProfile()).toStrictEqual(ok({ profile: null }));
  });

  it("criterion 7: reader 'unexpected' → err('unexpected')", async () => {
    const { getOwnProfile } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await getOwnProfile()).toStrictEqual(err("unexpected"));
  });

  it("currentUser 'unexpected' (GoTrue unreachable) → err('unexpected') without any read of the profile", async () => {
    const { log, getOwnProfile } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await getOwnProfile()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("replayed: a second call gives the same result and performs exactly one read per call (no state kept)", async () => {
    const { log, getOwnProfile } = harness();

    const first = await getOwnProfile();
    const second = await getOwnProfile();

    expect(first).toStrictEqual(ok({ profile: anOwnProfile() }));
    expect(second).toStrictEqual(first);
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn", "auth.currentUser", "profiles.getOwn"]);
  });
});
