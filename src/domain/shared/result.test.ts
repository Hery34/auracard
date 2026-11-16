import { describe, expect, expectTypeOf, it } from "vitest";

import { err, ok, type Result } from "@/domain/shared/result";

type Profile = { id: string; slug: string };
type ProfileError = { type: "ProfileSlugTaken"; slug: string };

const profile: Profile = { id: "profile-1", slug: "hery" };
const slugTaken: ProfileError = { type: "ProfileSlugTaken", slug: "hery" };

describe("Result", () => {
  describe("ok(value)", () => {
    it("returns exactly { ok: true, value } for an object", () => {
      expect(ok(profile)).toStrictEqual({ ok: true, value: profile });
    });

    it("returns exactly { ok: true, value: undefined } for undefined", () => {
      expect(ok(undefined)).toStrictEqual({ ok: true, value: undefined });
    });

    it("has no side effect: two calls with the same input give equal but distinct results", () => {
      const first = ok(profile);
      const second = ok(profile);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });

  describe("err(error)", () => {
    it("returns exactly { ok: false, error } for a discriminated error", () => {
      expect(err(slugTaken)).toStrictEqual({ ok: false, error: slugTaken });
    });

    it("has no side effect: two calls with the same input give equal but distinct results", () => {
      const first = err(slugTaken);
      const second = err(slugTaken);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });

  describe("Result<T, E>", () => {
    it("is the union { ok: true; value: T } | { ok: false; error: E }", () => {
      expectTypeOf<Result<Profile, ProfileError>>().toEqualTypeOf<
        { ok: true; value: Profile } | { ok: false; error: ProfileError }
      >();
    });

    it("narrows on the ok discriminant: value in the ok branch, error in the else branch", () => {
      const inspect = (result: Result<Profile, ProfileError>): void => {
        if (result.ok) {
          expectTypeOf(result.value).toEqualTypeOf<Profile>();
        } else {
          expectTypeOf(result.error).toEqualTypeOf<ProfileError>();
        }
      };

      inspect(ok(profile));
      inspect(err(slugTaken));
    });
  });
});
