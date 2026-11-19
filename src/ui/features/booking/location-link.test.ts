/**
 * Contract frozen by test-engineer (0039, reported from the 0037/0038 audit: « lieu video = texte libre → rendu en
 * lien seulement si le schéma est https: (jamais javascript:), échappé partout »; ADR 0016 §3).
 *
 * // src/ui/features/booking/location-link.ts (frontend) — wherever a type's location is shown (confirmation recap,
 * // later the owner's lists of 0042): the text is always rendered as React text (escaped), and only a `video`
 * // location that parseHttpsUrl accepts (absolute https:, dotted host, no credentials) becomes an <a href>.
 * export function videoLocationHref(kind: LocationKind, text: string | null): string | null;
 * // Note: the public page never receives the visio link (get_public_booking_page exposes location_text for
 * // in_person only, 0036 point 14); an in_person address is never a link.
 */
import { describe, expect, it } from "vitest";

import { videoLocationHref } from "@/ui/features/booking/location-link";

describe("videoLocationHref (audit 0037/0038)", () => {
  it("video + https link → the normalized href", () => {
    expect(videoLocationHref("video", "https://meet.example.com/abc-defg-hij")).toBe("https://meet.example.com/abc-defg-hij");
  });

  it.each([
    ["javascript:", "javascript:alert(document.cookie)"],
    ["javascript: in upper case", "JavaScript:alert(1)"],
    ["javascript: with a tab inside", "java\tscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["http:", "http://meet.example.com/abc"],
    ["protocol-relative", "//meet.example.com/abc"],
    ["credentials", "https://user:secret@meet.example.com/abc"],
    ["an IPv4 host", "https://192.168.1.10/visio"],
    ["free text around a link", "Lien : https://meet.example.com/abc"],
    ["leading space", " https://meet.example.com/abc"],
    ["no link at all", "Le lien vous sera envoyé par e-mail"],
  ])("video + %s → no link (rendered as text)", (_label, text) => {
    expect(videoLocationHref("video", text)).toBeNull();
  });

  it("null text → no link", () => {
    expect(videoLocationHref("video", null)).toBeNull();
  });

  it.each(["in_person", "phone"] as const)("%s: never a link, even for an https text", (kind) => {
    expect(videoLocationHref(kind, "https://meet.example.com/abc")).toBeNull();
  });
});
