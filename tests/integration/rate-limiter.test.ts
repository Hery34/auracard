import { describe, expect, it } from "vitest";

import { ok } from "@/domain/shared/result";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";

import { adminClient } from "./setup/clients";
import { RUN_SECRET, uniqueAddress } from "./setup/fixtures";

describe("makeSupabaseRateLimiter against the local Supabase stack", () => {
  const limiter = makeSupabaseRateLimiter(adminClient(), RUN_SECRET);
  const signup = (subject: string) => ({ scope: "signup" as const, subject, limit: 10, windowSeconds: 3600 });

  async function exhaust(subject: string): Promise<void> {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(await limiter.consume(signup(subject)), `attempt ${attempt}`).toStrictEqual(ok({ allowed: true }));
    }
  }

  it("criterion 6: 10 signup calls from one address are allowed, the 11th is refused and refusals keep counting", async () => {
    const address = uniqueAddress();

    await exhaust(address);

    expect(await limiter.consume(signup(address))).toStrictEqual(ok({ allowed: false }));
    expect(await limiter.consume(signup(address))).toStrictEqual(ok({ allowed: false }));
  });

  it("another address of the same scope keeps its own counter", async () => {
    const exhausted = uniqueAddress();
    const other = uniqueAddress();
    await exhaust(exhausted);

    expect(await limiter.consume(signup(other))).toStrictEqual(ok({ allowed: true }));
  });

  it("another scope for the same subject keeps its own counter", async () => {
    const address = uniqueAddress();
    await exhaust(address);

    expect(
      await limiter.consume({ scope: "login", subject: address, limit: 10, windowSeconds: 900 }),
    ).toStrictEqual(ok({ allowed: true }));
  });

  it("executed twice, both calls count (ADR 0011, documented exception to idempotence): with limit 2 the third call is refused", async () => {
    const input = { scope: "login-account" as const, subject: `${uniqueAddress()}@example.test`, limit: 2, windowSeconds: 900 };

    expect(await limiter.consume(input)).toStrictEqual(ok({ allowed: true }));
    expect(await limiter.consume(input)).toStrictEqual(ok({ allowed: true }));
    expect(await limiter.consume(input)).toStrictEqual(ok({ allowed: false }));
  });

  it("a limiter built with another secret does not see the counters of this one", async () => {
    const address = uniqueAddress();
    await exhaust(address);
    const otherLimiter = makeSupabaseRateLimiter(adminClient(), RUN_SECRET.split("").reverse().join(""));

    expect(await otherLimiter.consume(signup(address))).toStrictEqual(ok({ allowed: true }));
  });
});
