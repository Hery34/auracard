import { describe, expect, it } from "vitest";

import { scramble, unscramble } from "@/ui/features/profile/scrambled-text";

const SAMPLES = [
  ["accents", "Élodie Durand-Mérel, ça va à l'île ?"],
  ["emoji", "Atelier 🌿 👩‍💻 🇫🇷"],
  ["international phone", "+33 6 12 34 56 78"],
  ["tel: link", "tel:+33612345678"],
  ["e-mail address", "elodie.durand+carte@atelier-merel.example"],
  ["mailto: link", "mailto:elodie.durand+carte@atelier-merel.example"],
  ["WhatsApp link", "https://wa.me/33612345678"],
  ["empty string", ""],
] as const;

/** The two forms an attacker can read: the serialized codes (HTML / RSC payload) and the codes taken as text. */
function visibleForms(text: string): string[] {
  const codes = scramble(text);
  return [JSON.stringify(codes), String.fromCodePoint(...codes)];
}

function digitRuns(text: string, length: number): string[] {
  const digits = text.replace(/\D/g, "");
  const runs: string[] = [];
  for (let start = 0; start + length <= digits.length; start += 1) {
    runs.push(digits.slice(start, start + length));
  }
  return runs;
}

describe("scramble / unscramble — anti-scraping of the public contact (0018, decisions 8 and 9)", () => {
  it.each(SAMPLES)("round-trips exactly: %s", (_case, text) => {
    expect(unscramble(scramble(text))).toBe(text);
  });

  it.each(SAMPLES.filter(([, text]) => text !== ""))("does not expose the value in clear: %s", (_case, text) => {
    for (const form of visibleForms(text)) {
      expect(form).not.toContain(text);
      expect(form).not.toContain([...text].reverse().join(""));
    }
  });

  it.each(SAMPLES.filter(([, text]) => /\d{4}/.test(text.replace(/\D/g, ""))))(
    "does not expose four consecutive digits of the value: %s",
    (_case, text) => {
      for (const form of visibleForms(text)) {
        for (const run of digitRuns(text, 4)) {
          expect(form).not.toContain(run);
        }
      }
    },
  );

  it.each(["mailto:", "tel:", "wa.me"])("does not expose the scheme %s", (marker) => {
    const text = `${marker}elodie@atelier-merel.example`;
    for (const form of visibleForms(text)) {
      expect(form.toLowerCase()).not.toContain(marker);
    }
  });
});
