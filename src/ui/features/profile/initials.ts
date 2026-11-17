/** First letter of the first and last words that start with a letter, without diacritics: « Élodie Durand 🌿 » → « ED ». */
export function initialsOf(displayName: string): string {
  const letters = displayName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/u)
    .map((word) => /^\p{L}/u.exec(word)?.[0])
    .filter((letter) => letter !== undefined);
  const first = letters[0];
  if (first === undefined) {
    return "";
  }
  const last = letters.length > 1 ? letters[letters.length - 1] : "";
  return `${first}${last}`.toLocaleUpperCase("fr");
}
