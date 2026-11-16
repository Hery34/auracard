import type { Locator } from "@playwright/test";

export type Rgb = readonly [number, number, number];

/**
 * Colours of an element as the eye sees them, resolved by the browser itself: each CSS colour (rgb, oklch,
 * lab, with or without alpha) is painted on a 1×1 canvas over the stack of ancestor backgrounds (white canvas
 * at the bottom, like the viewport), then read back as sRGB.
 * - `background`: the element's own background composited over its ancestors';
 * - `outerBackground`: what surrounds the element (the parent's composited background);
 * - `text`: `color` over `background`;
 * - `border`: top border colour over `outerBackground`, `null` when the element has no visible border;
 * - `ownBackground`: the element's own `background-color` alone, with its alpha (0–255).
 */
export type ElementColors = {
  text: Rgb;
  background: Rgb;
  outerBackground: Rgb;
  border: Rgb | null;
  ownBackground: { rgb: Rgb; alpha: number };
};

export async function colorsOf(locator: Locator): Promise<ElementColors> {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("canvas 2d context unavailable");
    }
    const paint = (colors: readonly string[]): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a];
    };
    const backgroundStack = (from: Element | null): string[] => {
      const layers: string[] = [];
      for (let node = from; node !== null; node = node.parentElement) {
        layers.unshift(getComputedStyle(node).backgroundColor);
      }
      return ["rgb(255, 255, 255)", ...layers];
    };
    const rgb = ([r, g, b]: readonly number[]): [number, number, number] => [r ?? 0, g ?? 0, b ?? 0];

    const style = getComputedStyle(element);
    const inner = backgroundStack(element);
    const outer = backgroundStack(element.parentElement);
    const hasBorder = style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0;
    const own = paint([style.backgroundColor]);
    return {
      text: rgb(paint([...inner, style.color])),
      background: rgb(paint(inner)),
      outerBackground: rgb(paint(outer)),
      border: hasBorder ? rgb(paint([...outer, style.borderTopColor])) : null,
      ownBackground: { rgb: rgb(own), alpha: own[3] },
    };
  });
}

/**
 * Colours that can signal focus on a focused element, each composited over what surrounds it: the outline
 * when drawn, every non-transparent box-shadow with a spread or a blur (Tailwind `ring-*`), and the border
 * when it differs from `unfocusedBorder`.
 */
export async function focusIndicatorColorsOf(locator: Locator, unfocusedBorder: Rgb | null): Promise<Rgb[]> {
  return locator.evaluate(
    (element, previousBorder) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        throw new Error("canvas 2d context unavailable");
      }
      const paint = (colors: readonly string[]): [number, number, number, number] => {
        context.clearRect(0, 0, 1, 1);
        for (const color of colors) {
          context.fillStyle = "rgba(0, 0, 0, 0)";
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        }
        const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a];
      };
      const outer: string[] = [];
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        outer.unshift(getComputedStyle(node).backgroundColor);
      }
      outer.unshift("rgb(255, 255, 255)");
      const visible = (color: string): boolean => paint([color])[3] > 0;
      const over = (color: string): [number, number, number] => {
        const [r, g, b] = paint([...outer, color]);
        return [r, g, b];
      };

      const style = getComputedStyle(element);
      const candidates: [number, number, number][] = [];
      if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 && visible(style.outlineColor)) {
        candidates.push(over(style.outlineColor));
      }
      const shadows: string[] = [];
      let depth = 0;
      let current = "";
      for (const character of style.boxShadow) {
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
        if (character === "," && depth === 0) {
          shadows.push(current);
          current = "";
        } else {
          current += character;
        }
      }
      shadows.push(current);
      for (const shadow of shadows) {
        const color = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i.exec(shadow)?.[0];
        if (color === undefined || !visible(color)) continue;
        const lengths = shadow
          .replace(color, "")
          .replace(/inset/i, "")
          .trim()
          .split(/\s+/)
          .map((length) => parseFloat(length))
          .filter((length) => !Number.isNaN(length));
        const [, , blur = 0, spread = 0] = lengths;
        if (blur > 0 || spread > 0) {
          candidates.push(over(color));
        }
      }
      if (style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0) {
        const border = over(style.borderTopColor);
        if (previousBorder === null || border.some((channel, index) => channel !== previousBorder[index])) {
          candidates.push(border);
        }
      }
      return candidates;
    },
    unfocusedBorder === null ? null : [...unfocusedBorder],
  );
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio, from 1 to 21, independent of the order of the two colours. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

export function cssRgb([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}
