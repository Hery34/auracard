import type { ProfileUpdate } from "@/domain/profile/profile";
import { parsePhone, type Phone } from "@/domain/profile/phone";

import { aHttpsUrl } from "./https-url";

function aPhone(text: string): Phone {
  const result = parsePhone(text);
  if (!result.ok) {
    throw new Error(`aPhone: "${text}" is not a valid phone number (${result.error})`);
  }
  return result.value;
}

/** A complete, already validated profile update (full update: every editable field is present). */
export function aProfileUpdate(overrides: Partial<ProfileUpdate> = {}): ProfileUpdate {
  return {
    displayName: "Élodie Durand-Mérel",
    jobTitle: "Architecte d'intérieur",
    company: "Atelier Mérel",
    bio: "Aménagement de bureaux et de commerces.\nLyon et alentours.",
    contactEmail: "contact@atelier-merel.example",
    phone: aPhone("+33 6 12 34 56 78"),
    websiteUrl: aHttpsUrl("https://atelier-merel.example/"),
    isPublished: true,
    isIndexable: false,
    ...overrides,
  };
}
