/**
 * Contract frozen by test-engineer (0038 point 6, after audit): the field `rules` of the weekly editor is bounded
 * before its elements matter.
 *
 * // src/server/booking/action-schemas.ts
 * export const availabilityRulesSchema; // z.array(z.object({ weekday: number, start: string ≤ 16, end: string ≤ 16 }))
 * //                                       .max(MAX_AVAILABILITY_RULES + 1): 51 elements still reach
 * //                                       parseAvailabilityRules ("too_many"), 52 or more fail with a `too_big` issue.
 */
import { describe, expect, it } from "vitest";

import { MAX_AVAILABILITY_RULES } from "@/domain/booking/availability";
import { availabilityRulesSchema } from "@/server/booking/action-schemas";

import { aRule } from "../../../tests/builders/booking-settings";

function rules(count: number) {
  return Array.from({ length: count }, () => aRule());
}

describe("availabilityRulesSchema — 0038 point 6 (bounded to MAX_AVAILABILITY_RULES + 1)", () => {
  it("MAX_AVAILABILITY_RULES + 1 well-formed elements pass (the domain answers too_many)", () => {
    expect(availabilityRulesSchema.safeParse(rules(MAX_AVAILABILITY_RULES + 1)).success).toBe(true);
  });

  it("MAX_AVAILABILITY_RULES + 2 elements fail with a too_big issue", () => {
    const parsed = availabilityRulesSchema.safeParse(rules(MAX_AVAILABILITY_RULES + 2));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.code)).toContain("too_big");
  });
});
