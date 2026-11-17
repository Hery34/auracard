/**
 * Anti-scraping for the public e-mail and phone (`docs/rules/security.md`): the server ships code points, xored and
 * reversed, the browser rebuilds the text on click. Neither the address, the digits nor the URL scheme appear
 * in the static HTML or the RSC payload.
 */
export type ScrambledText = readonly number[];

const KEY = 0x5a;

export function scramble(text: string): ScrambledText {
  return Array.from(text, (character) => (character.codePointAt(0) ?? 0) ^ KEY).reverse();
}

export function unscramble(codes: ScrambledText): string {
  return String.fromCodePoint(...[...codes].reverse().map((code) => code ^ KEY));
}
