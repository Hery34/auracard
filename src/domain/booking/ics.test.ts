/**
 * Contract frozen by test-engineer (0039, decision 5: « ajout à l'agenda (.ics téléchargeable) »).
 *
 * // src/domain/booking/ics.ts — pure (RFC 5545), built in the browser after the confirmation; the clock is injected.
 * export type BookingIcsInput = {
 *   bookingId: string;            // UID = `${bookingId}@carnet` (stable: a second download replaces the same event)
 *   start: Temporal.Instant; end: Temporal.Instant;
 *   title: string;                // type title (single line in base, escaped anyway)
 *   ownerName: string;            // SUMMARY = the title and the owner's name
 *   location: string | null;      // address of an in_person type; null (phone, video) → no LOCATION line
 *   now: Temporal.Instant;        // DTSTAMP
 * };
 * export function bookingIcs(input: BookingIcsInput): string;
 * // VCALENDAR (VERSION:2.0, PRODID, METHOD:PUBLISH) with one VEVENT; times in UTC "YYYYMMDDTHHMMSSZ";
 * // CRLF line endings, lines folded at 75 octets (UTF-8) with a leading space; TEXT values escaped (\\ ; , \n).
 * // Nothing about the visitor (no name, e-mail, phone, message) and no cancel token.
 */
import { describe, expect, it } from "vitest";

import { bookingIcs, type BookingIcsInput } from "@/domain/booking/ics";

import { BOOKING_IDS, BOOKING_NOW, SLOT_START } from "../../../tests/builders/booking";
import { instant } from "../../../tests/builders/booking-slots";

function anIcsInput(overrides: Partial<BookingIcsInput> = {}): BookingIcsInput {
  return {
    bookingId: BOOKING_IDS[0],
    start: instant(SLOT_START),
    end: instant(SLOT_START).add({ minutes: 30 }),
    title: "Appel découverte",
    ownerName: "Élodie Durand-Merel",
    location: null,
    now: instant(BOOKING_NOW),
    ...overrides,
  };
}

/** RFC 5545 §3.1: a CRLF followed by one space or tab continues the previous line. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

function property(ics: string, name: string): string[] {
  return unfold(ics)
    .filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`))
    .map((line) => line.slice(line.indexOf(":") + 1));
}

describe("bookingIcs (decision 5)", () => {
  it("one VEVENT in a VCALENDAR 2.0, CRLF line endings", () => {
    const ics = bookingIcs(anIcsInput());

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(property(ics, "VERSION")).toStrictEqual(["2.0"]);
    expect(property(ics, "PRODID")).toHaveLength(1);
    expect(property(ics, "METHOD")).toStrictEqual(["PUBLISH"]);
    expect(unfold(ics).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(unfold(ics).filter((line) => line === "END:VEVENT")).toHaveLength(1);
  });

  it("UID from the booking id, DTSTAMP from the injected clock, DTSTART / DTEND in UTC", () => {
    const ics = bookingIcs(anIcsInput());

    expect(property(ics, "UID")).toStrictEqual([`${BOOKING_IDS[0]}@carnet`]);
    expect(property(ics, "DTSTAMP")).toStrictEqual(["20270301T120000Z"]);
    expect(property(ics, "DTSTART")).toStrictEqual(["20270303T080000Z"]);
    expect(property(ics, "DTEND")).toStrictEqual(["20270303T083000Z"]);
  });

  it("criterion 4 (DST): the instants are written as is, a slot after the spring change keeps its UTC time", () => {
    const start = instant("2027-03-28T01:30:00Z");
    const ics = bookingIcs(anIcsInput({ start, end: start.add({ minutes: 45 }) }));

    expect(property(ics, "DTSTART")).toStrictEqual(["20270328T013000Z"]);
    expect(property(ics, "DTEND")).toStrictEqual(["20270328T021500Z"]);
  });

  it("SUMMARY names the type and the owner", () => {
    const [summary = ""] = property(bookingIcs(anIcsInput()), "SUMMARY");

    expect(summary).toContain("Appel découverte");
    expect(summary).toContain("Élodie Durand-Merel");
  });

  it("TEXT values escaped: backslash, semicolon, comma and line breaks never break the structure", () => {
    const ics = bookingIcs(
      anIcsInput({
        title: "Bilan, suivi; note \\ fin",
        location: "12 rue des Lilas\nBÂTIMENT B, 69003 Lyon\r\nEND:VEVENT",
      }),
    );

    const [summary = ""] = property(ics, "SUMMARY");
    expect(summary).toContain("Bilan\\, suivi\\; note \\\\ fin");
    expect(property(ics, "LOCATION")).toStrictEqual(["12 rue des Lilas\\nBÂTIMENT B\\, 69003 Lyon\\nEND:VEVENT"]);
    expect(unfold(ics).filter((line) => line === "END:VEVENT")).toHaveLength(1);
  });

  it("LOCATION only when the type has a public address (in_person)", () => {
    expect(property(bookingIcs(anIcsInput({ location: null })), "LOCATION")).toStrictEqual([]);
    expect(property(bookingIcs(anIcsInput({ location: "12 rue des Lilas, 69003 Lyon" })), "LOCATION")).toStrictEqual([
      "12 rue des Lilas\\, 69003 Lyon",
    ]);
  });

  it("RFC 5545 §3.1: no line longer than 75 octets; a long accented title is folded and unfolds intact", () => {
    const title = "Accompagnement à la rénovation énergétique d’une maison ancienne ".repeat(2).trim().slice(0, 80);
    const ics = bookingIcs(anIcsInput({ title, location: "Résidence « Les Érables », 12 rue des Lilas, 69003 Lyon, bâtiment B, escalier C" }));

    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    }
    const [summary = ""] = property(ics, "SUMMARY");
    expect(summary).toContain(title.replace(/,/g, "\\,"));
  });

  it("nothing about the visitor nor any token", () => {
    const ics = bookingIcs(anIcsInput());

    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|mailto:/i);
    expect(ics).not.toContain("Jean");
  });

  it("deterministic: the same input gives the same file", () => {
    expect(bookingIcs(anIcsInput())).toBe(bookingIcs(anIcsInput()));
  });
});
