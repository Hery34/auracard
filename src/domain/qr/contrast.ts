const LINEAR_THRESHOLD = 0.04045;

/** WCAG 2.x relative luminance of a `#rrggbb` lower-case colour: 0 for black, 1 for white. */
export function relativeLuminance(color: string): number {
  return 0.2126 * linearChannel(color, 1) + 0.7152 * linearChannel(color, 3) + 0.0722 * linearChannel(color, 5);
}

/** WCAG 2.x contrast ratio, symmetric, between 1 and 21, never rounded. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function linearChannel(color: string, start: number): number {
  const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
  return channel <= LINEAR_THRESHOLD ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
