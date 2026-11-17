import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeDownloadVCard } from "@/server/use-cases/download-vcard";
import type { GetVCard } from "@/server/use-cases/get-vcard";

import { makeCallLog, type CallLog } from "../../../tests/builders/call-log";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";

const FILE = { fileName: "elodie-durand-merel.vcf", content: "BEGIN:VCARD\r\nEND:VCARD\r\n" };
const INPUT = { slug: "elodie-durand-merel", clientAddress: "203.0.113.7" };

function fakeGetVCard(log: CallLog, result: Awaited<ReturnType<GetVCard>> = ok(FILE)): GetVCard {
  return async (slug) => {
    log.record("getVCard", "of", slug);
    return result;
  };
}

function harness(limiter: Omit<FakeRateLimiterOptions, "log"> = {}, result?: Awaited<ReturnType<GetVCard>>) {
  const log = makeCallLog();
  const downloadVCard = makeDownloadVCard({
    rateLimiter: fakeRateLimiter({ log, ...limiter }),
    getVCard: fakeGetVCard(log, result),
  });
  return { log, downloadVCard };
}

describe("downloadVCard", () => {
  it("consumes the vcard counter of the address (30 per hour), then returns the file", async () => {
    const { log, downloadVCard } = harness();

    expect(await downloadVCard(INPUT)).toStrictEqual(ok(FILE));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "getVCard.of"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "vcard", subject: "203.0.113.7", limit: 30, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("getVCard", "of")).toStrictEqual(["elodie-durand-merel"]);
  });

  it("exhausted counter → err('rate_limited') without any read", async () => {
    const { log, downloadVCard } = harness({ deny: ["vcard"] });

    expect(await downloadVCard(INPUT)).toStrictEqual(err("rate_limited"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("failing limiter → err('unexpected') without any read (the door closes)", async () => {
    const { log, downloadVCard } = harness({ failing: true });

    expect(await downloadVCard(INPUT)).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("counts invalid or unknown slugs too: ok(null) is passed through after the consumption", async () => {
    const { log, downloadVCard } = harness({}, ok(null));

    expect(await downloadVCard({ ...INPUT, slug: "../admin" })).toStrictEqual(ok(null));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "getVCard.of"]);
  });

  it("passes a read failure through", async () => {
    const { downloadVCard } = harness({}, err("unexpected"));

    expect(await downloadVCard(INPUT)).toStrictEqual(err("unexpected"));
  });
});
