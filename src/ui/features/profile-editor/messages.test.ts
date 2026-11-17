import { describe, expect, it } from "vitest";

import { IMAGE_ERROR_MESSAGES, toFieldErrors } from "@/ui/features/profile-editor/messages";

const SENT_KEYS = ["row-a", "row-b", "row-c"] as const;

describe("toFieldErrors", () => {
  it("no fields → no error", () => {
    expect(toFieldErrors(undefined, SENT_KEYS)).toStrictEqual({ profile: {}, links: {}, list: null });
  });

  it("criterion 2: an error on links.{i} lands on the row sent at position i (its key)", () => {
    const errors = toFieldErrors({ "links.1": "invalid_url" }, SENT_KEYS);

    expect(Object.keys(errors.links)).toStrictEqual(["row-b"]);
    expect(errors.links["row-b"]?.url).toMatch(/https:\/\//);
    expect(errors.list).toBeNull();
  });

  it.each([
    ["invalid_platform", "platform"],
    ["invalid_url", "url"],
    ["host_mismatch", "url"],
    ["invalid_label", "label"],
  ] as const)("criterion 2: the code %s is shown on the %s field", (code, field) => {
    const errors = toFieldErrors({ "links.0": code }, SENT_KEYS);

    expect(Object.keys(errors.links["row-a"] ?? {})).toStrictEqual([field]);
    expect(errors.links["row-a"]?.[field]).toEqual(expect.any(String));
  });

  it("criterion 2: host_mismatch has its own message (platform named), distinct from invalid_url", () => {
    const mismatch = toFieldErrors({ "links.0": "host_mismatch" }, SENT_KEYS).links["row-a"]?.url;
    const invalid = toFieldErrors({ "links.0": "invalid_url" }, SENT_KEYS).links["row-a"]?.url;

    expect(mismatch).toMatch(/plateforme/);
    expect(mismatch).not.toBe(invalid);
  });

  it("a path links.{i}.{field} wins over the code", () => {
    const errors = toFieldErrors({ "links.2.label": "Invalid input: expected string" }, SENT_KEYS);

    expect(Object.keys(errors.links["row-c"] ?? {})).toStrictEqual(["label"]);
  });

  it("errors on several fields of the same row are all kept", () => {
    const errors = toFieldErrors({ "links.0.platform": "x", "links.0.label": "y" }, SENT_KEYS);

    expect(Object.keys(errors.links["row-a"] ?? {}).sort()).toStrictEqual(["label", "platform"]);
  });

  it("an error on the whole list (too many, duplicate id) or on an unknown position → list message", () => {
    expect(toFieldErrors({ links: "duplicate_id" }, SENT_KEYS).list).toEqual(expect.any(String));
    expect(toFieldErrors({ "links.7": "invalid_url" }, SENT_KEYS).list).toEqual(expect.any(String));
  });

  it("profile fields get a French message that never echoes the submitted value", () => {
    const errors = toFieldErrors({ bio: "Too big: expected string to have <=500 characters", websiteUrl: "invalid_url" }, []);

    expect(errors.profile.bio).toMatch(/500/);
    expect(errors.profile.bio).not.toMatch(/Too big/);
    expect(errors.profile.websiteUrl).toMatch(/https:\/\//);
  });

  it("an unknown path is ignored", () => {
    expect(toFieldErrors({ slug: "x" }, SENT_KEYS)).toStrictEqual({ profile: {}, links: {}, list: null });
  });
});

/**
 * 0021 (contract frozen by test-engineer):
 * // src/ui/features/profile-editor/messages.ts
 * export const IMAGE_ERROR_MESSAGES: Readonly<Record<Exclude<ProfileImageActionError, "unauthenticated">, string>>;
 * // French, announced by role="alert" next to the image control; `unauthenticated` sends to the sign-in page.
 * // The same `invalid_file` message is shown when the browser itself cannot decode the chosen file (before any upload).
 */
describe("IMAGE_ERROR_MESSAGES", () => {
  it("one French message per error code of the image actions", () => {
    expect(Object.keys(IMAGE_ERROR_MESSAGES).sort()).toStrictEqual(
      ["invalid_file", "invalid_input", "not_found", "rate_limited", "too_large", "unexpected"].sort(),
    );
    for (const message of Object.values(IMAGE_ERROR_MESSAGES)) {
      expect(message).toMatch(/^\p{Lu}.*\.$/u);
    }
  });

  it("criterion 2: invalid_file names the accepted formats", () => {
    expect(IMAGE_ERROR_MESSAGES.invalid_file).toMatch(/JPEG/);
    expect(IMAGE_ERROR_MESSAGES.invalid_file).toMatch(/PNG/);
    expect(IMAGE_ERROR_MESSAGES.invalid_file).toMatch(/WebP/);
  });

  it("criterion 2: too_large gives the limit of 2 Mo", () => {
    expect(IMAGE_ERROR_MESSAGES.too_large).toMatch(/2\s?Mo/);
  });

  it("rate_limited is the message of the profile form", () => {
    expect(IMAGE_ERROR_MESSAGES.rate_limited).toMatch(/Trop de modifications/);
  });
});
