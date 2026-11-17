/**
 * Contract frozen by test-engineer (0025, decision 13: one `textFields` for auth.ts, profile.ts and nfc.ts).
 *
 * // src/server/actions/form-fields.ts — module without directive.
 * // Each requested name → its first value when it is a string, else undefined (absent, File). Other fields ignored.
 * export function textFields(formData: FormData, names: readonly string[]): Record<string, string | undefined>;
 */
import { describe, expect, it } from "vitest";

import { textFields } from "@/server/actions/form-fields";

describe("textFields", () => {
  it("keeps the requested string fields as typed (no trimming), undefined for an absent one, ignores the others", () => {
    const data = new FormData();
    data.set("uid", "7k2m9p4q8r3s");
    data.set("code", "  abcde-fgh23 ");
    data.set("extra", "ignored");

    expect(textFields(data, ["uid", "code", "missing"])).toStrictEqual({
      uid: "7k2m9p4q8r3s",
      code: "  abcde-fgh23 ",
      missing: undefined,
    });
  });

  it("a File → undefined", () => {
    const data = new FormData();
    data.set("code", new File(["ABCDE-FGH23"], "code.txt"));

    expect(textFields(data, ["code"])).toStrictEqual({ code: undefined });
  });

  it("a repeated field → its first value only", () => {
    const data = new FormData();
    data.append("suivant", "//evil.example");
    data.append("suivant", "/activer/7k2m9p4q8r3s");

    expect(textFields(data, ["suivant"])).toStrictEqual({ suivant: "//evil.example" });
  });

  it("an empty string stays an empty string", () => {
    const data = new FormData();
    data.set("displayName", "");

    expect(textFields(data, ["displayName"])).toStrictEqual({ displayName: "" });
  });
});
