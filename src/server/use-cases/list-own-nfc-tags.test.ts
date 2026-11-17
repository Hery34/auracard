/**
 * Contract frozen by test-engineer (0025, decision 8).
 *
 * // src/server/use-cases/list-own-nfc-tags.ts
 * export type ListOwnNfcTagsError = "unauthenticated" | "unexpected";
 * export type ListOwnNfcTags = () => Promise<Result<OwnNfcTag[], ListOwnNfcTagsError>>;
 * export function makeListOwnNfcTags(deps: { auth: AuthGateway; tags: NfcTagRepository }): ListOwnNfcTags;
 * // Session verified with GoTrue, then tags.listOwn() (RLS: the caller's tags only; another project's account → []).
 * // No rate limit on this read.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeListOwnNfcTags } from "@/server/use-cases/list-own-nfc-tags";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { fakeNfcTagRepository, type FakeNfcTagRepositoryOptions } from "../../../tests/builders/fake-nfc-tag-repository";
import { anOwnNfcTag, OTHER_TAG_ID, OTHER_TAG_UID } from "../../../tests/builders/nfc";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

function harness(overrides: { auth?: FakeAuthGatewayOptions; tags?: FakeNfcTagRepositoryOptions } = {}) {
  const log = makeCallLog();
  const listOwnNfcTags = makeListOwnNfcTags({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    tags: fakeNfcTagRepository({ log, ...overrides.tags }),
  });
  return { log, listOwnNfcTags };
}

describe("listOwnNfcTags", () => {
  it("criterion 5: session → the caller's tags as the repository returns them", async () => {
    const tags = [anOwnNfcTag(), anOwnNfcTag({ id: OTHER_TAG_ID, uid: OTHER_TAG_UID, status: "disabled" })];
    const { log, listOwnNfcTags } = harness({ tags: { listResults: [ok(tags)] } });

    expect(await listOwnNfcTags()).toStrictEqual(ok(tags));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "nfcTags.listOwn"]);
  });

  it("no tag → ok([]) (empty state)", async () => {
    const { listOwnNfcTags } = harness();

    expect(await listOwnNfcTags()).toStrictEqual(ok([]));
  });

  it("no session → err('unauthenticated'), nothing read", async () => {
    const { log, listOwnNfcTags } = harness({ auth: { currentUser: ok(null) } });

    expect(await listOwnNfcTags()).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable → err('unexpected'), nothing read", async () => {
    const { log, listOwnNfcTags } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await listOwnNfcTags()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("read failure → err('unexpected')", async () => {
    const { listOwnNfcTags } = harness({ tags: { listResults: [err("unexpected")] } });

    expect(await listOwnNfcTags()).toStrictEqual(err("unexpected"));
  });
});
