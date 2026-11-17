/**
 * Contract frozen by test-engineer (0025, decisions 1 and 3). Port: NfcTagResolver (see src/domain/nfc/nfc-tag.test.ts).
 *
 * // src/server/use-cases/resolve-nfc-tag.ts
 * export type ResolveNfcTag = (uid: string) => Promise<Result<NfcResolution, "unexpected">>;
 * export function makeResolveNfcTag(deps: { tags: NfcTagResolver }): ResolveNfcTag;
 * // uid outside NFC_TAG_UID_PATTERN → ok({ state: "not_found" }) without calling the port (no database request);
 * // else the port's answer as is. No rate limit, no side effect (phase 4 adds the scan event).
 */
import { describe, expect, it } from "vitest";

import type { NfcResolution } from "@/domain/nfc/nfc-tag";
import { err, ok } from "@/domain/shared/result";
import { makeResolveNfcTag } from "@/server/use-cases/resolve-nfc-tag";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeNfcTagResolver, type NfcResolutionResult } from "../../../tests/builders/fake-nfc-tag-resolver";
import { MALFORMED_TAG_UIDS, TAG_UID } from "../../../tests/builders/nfc";

function harness(results?: readonly NfcResolutionResult[]) {
  const log = makeCallLog();
  const resolveNfcTag = makeResolveNfcTag({ tags: fakeNfcTagResolver({ log, results }) });
  return { log, resolveNfcTag };
}

describe("resolveNfcTag", () => {
  it.each<NfcResolution>([
    { state: "active", slug: "elodie-durand-merel" },
    { state: "activation" },
    { state: "not_found" },
  ])("criterion 1: a well-formed uid is resolved by the database, answer $state passed through", async (resolution) => {
    const { log, resolveNfcTag } = harness([ok(resolution)]);

    expect(await resolveNfcTag(TAG_UID)).toStrictEqual(ok(resolution));
    expect(log.sequence()).toStrictEqual(["nfcTags.resolve"]);
    expect(log.inputsOf("nfcTags", "resolve")).toStrictEqual([TAG_UID]);
  });

  it.each(MALFORMED_TAG_UIDS)("criterion 1: uid with %s → not_found without any database request", async (_label, uid) => {
    const { log, resolveNfcTag } = harness([ok({ state: "active", slug: "should-never-be-read" })]);

    expect(await resolveNfcTag(uid)).toStrictEqual(ok({ state: "not_found" }));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("a database failure → err('unexpected')", async () => {
    const { resolveNfcTag } = harness([err("unexpected")]);

    expect(await resolveNfcTag(TAG_UID)).toStrictEqual(err("unexpected"));
  });

  it("replayable: resolved twice → same answer, one read each time, nothing written", async () => {
    const { log, resolveNfcTag } = harness([ok({ state: "active", slug: "elodie-durand-merel" })]);

    const first = await resolveNfcTag(TAG_UID);
    const second = await resolveNfcTag(TAG_UID);

    expect(second).toStrictEqual(first);
    expect(log.sequence()).toStrictEqual(["nfcTags.resolve", "nfcTags.resolve"]);
  });
});
