import { describe, expect, it } from "vitest";

import { initialsOf } from "@/ui/features/profile/initials";

describe("initialsOf — avatar fallback (0018, decision 5)", () => {
  it("takes the first letters of the first and last words, without diacritics", () => {
    expect(initialsOf("Élodie Durand-Merel")).toBe("ED");
  });

  it("keeps a single initial for a single word", () => {
    expect(initialsOf("Élodie")).toBe("E");
  });

  it("ignores multiple and surrounding spaces", () => {
    expect(initialsOf("  Élodie \t  Durand-Merel  ")).toBe("ED");
  });

  it("uses the last word after particles", () => {
    expect(initialsOf("Jean de La Fontaine")).toBe("JF");
  });

  it("upper-cases lower-case names", () => {
    expect(initialsOf("élodie durand")).toBe("ED");
  });

  it("ignores a decorative emoji word", () => {
    expect(initialsOf("Élodie Durand 🌿")).toBe("ED");
  });

  it("returns an empty string for an empty or blank name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
