/**
 * Contract frozen by test-engineer (0026, decision 4): see the header of `qr-style.test.ts`.
 *
 * // src/domain/qr/contrast.ts
 * export function relativeLuminance(color: string): number;          // WCAG 2.x, `#rrggbb` lower case
 * export function contrastRatio(first: string, second: string): number; // (lighter + 0.05) / (darker + 0.05), unrounded
 */
import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance } from "@/domain/qr/contrast";

import { JUST_OVER_MIN_CONTRAST_FG, JUST_UNDER_MIN_CONTRAST_FG } from "../../../tests/builders/qr";

describe("relativeLuminance (WCAG 2.x)", () => {
  it.each([
    ["#000000", 0],
    ["#ffffff", 1],
    ["#ff0000", 0.2126],
    ["#00ff00", 0.7152],
    ["#0000ff", 0.0722],
    ["#808080", 0.2158605],
    ["#777777", 0.184475],
    ["#767676", 0.1811642],
  ])("%s → %f", (color, expected) => {
    expect(relativeLuminance(color)).toBeCloseTo(expected, 6);
  });

  it("the linear segment applies up to 0.04045 (#0a0a0a = 10/255/12.92)", () => {
    expect(relativeLuminance("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 9);
  });
});

describe("contrastRatio (WCAG 2.x)", () => {
  it("black and white → 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 9);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(contrastRatio("#000000", "#ffffff"));
    expect(contrastRatio("#1a2b4c", "#fdf6e3")).toBe(contrastRatio("#fdf6e3", "#1a2b4c"));
  });

  it("a colour against itself → 1", () => {
    expect(contrastRatio("#336699", "#336699")).toBe(1);
  });

  it.each([
    ["#777777", 4.478089],
    ["#767676", 4.542225],
    ["#0000ff", 8.592471],
    ["#ff0000", 3.998477],
  ])("%s on white → %f", (color, expected) => {
    expect(contrastRatio(color, "#ffffff")).toBeCloseTo(expected, 5);
  });

  it("is never rounded: 4.4998… stays under 4.5, 4.5003… is at least 4.5", () => {
    expect(contrastRatio(JUST_UNDER_MIN_CONTRAST_FG, "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio(JUST_UNDER_MIN_CONTRAST_FG, "#ffffff")).toBeGreaterThan(4.499);
    expect(contrastRatio(JUST_OVER_MIN_CONTRAST_FG, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(JUST_OVER_MIN_CONTRAST_FG, "#ffffff")).toBeLessThan(4.501);
  });
});
