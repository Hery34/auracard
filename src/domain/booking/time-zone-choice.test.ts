/**
 * Contract frozen by test-engineer (0038, note of 0036: time zone limited to `Intl.supportedValuesOf('timeZone')`,
 * since `pg_timezone_names` accepts names that `Intl` refuses; ADR 0016 §2: one IANA zone per profile).
 *
 * // src/domain/booking/time-zone-choice.ts — the zones an owner may choose.
 * // Intl.supportedValuesOf("timeZone") of the running engine, in its order (alphabetical), read once.
 * export function selectableTimeZones(): readonly string[];
 * // 0038 point 6: a name of selectableTimeZones() (exact membership, case included; no offset, no alias outside the
 * // list) that parseTimeZone (0037) also accepts → that TimeZone value object; anything else → null.
 * export function parseSelectableTimeZone(name: string): TimeZone | null;
 * // DEFAULT_TIME_ZONE is removed if it stays unused (0038 point 6); isSelectableTimeZone likewise once replaced.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { parseTimeZone, type TimeZone } from "@/domain/booking/time-zone";
import { parseSelectableTimeZone, selectableTimeZones } from "@/domain/booking/time-zone-choice";

describe("time zone choice (ADR 0016 §2, note of 0036, 0038 point 6)", () => {
  it("the list is exactly Intl.supportedValuesOf('timeZone')", () => {
    expect([...selectableTimeZones()]).toStrictEqual(Intl.supportedValuesOf("timeZone"));
  });

  it("point 6: parseSelectableTimeZone returns a TimeZone value object (or null)", () => {
    expectTypeOf(parseSelectableTimeZone).returns.toEqualTypeOf<TimeZone | null>();
  });

  it("point 6: every zone of the list is parsed to itself, and is a TimeZone of parseTimeZone", () => {
    for (const name of Intl.supportedValuesOf("timeZone")) {
      expect(parseSelectableTimeZone(name), name).toBe(name);
      expect(parseTimeZone(name), name).toBe(name);
    }
  });

  it.each(["Europe/Paris", "America/New_York", "Asia/Tokyo", "Pacific/Auckland", "America/Sao_Paulo"])(
    "point 6: %s is selectable",
    (name) => {
      expect(parseSelectableTimeZone(name)).toBe(name);
    },
  );

  it.each([
    ["an unknown zone", "Mars/Olympus"],
    ["a wrong case (exact names only)", "europe/paris"],
    ["a POSIX offset", "+02:00"],
    ["an empty name", ""],
    ["surrounding spaces", " Europe/Paris "],
  ])("point 6: refuses %s → null", (_label, name) => {
    expect(parseSelectableTimeZone(name)).toBeNull();
  });

  it("point 6: refuses names that PostgreSQL knows but Intl does not list (legacy aliases, POSIX rules) → null", () => {
    const listed = new Set(Intl.supportedValuesOf("timeZone"));
    for (const name of ["US/Eastern", "EST5EDT", "Factory", "posixrules"]) {
      expect(listed.has(name), `${name} must be absent from the Intl list for this test to hold`).toBe(false);
      expect(parseSelectableTimeZone(name), name).toBeNull();
    }
  });

  it("point 6: a zone Temporal knows but Intl does not list is not selectable (both checks combined)", () => {
    const name = ["UTC", "Asia/Kolkata", "Etc/UTC"].find(
      (candidate) => !new Set(Intl.supportedValuesOf("timeZone")).has(candidate) && parseTimeZone(candidate) !== null,
    );
    if (name === undefined) {
      throw new Error("no zone known to Temporal and absent from the Intl list on this engine");
    }

    expect(parseSelectableTimeZone(name)).toBeNull();
  });
});
