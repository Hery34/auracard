/**
 * Contract frozen by test-engineer (0025, decision 8): one row of « Mes puces ».
 *
 * // src/ui/features/nfc/tag-row.ts — pure, no React.
 * export type NfcTagRow = {
 *   id: string;                                  // tag id, sent by the row's forms as `tagId`
 *   shortId: string;                             // nfcTagShortId(uid): last 4 characters
 *   statusLabel: "Active" | "Désactivée";
 *   activatedOn: string | null;                  // French long date in Europe/Paris, e.g. "17 novembre 2026"
 *   enabled: boolean;                            // status === "assigned"
 *   toggleLabel: "Désactiver" | "Réactiver";     // action offered by the toggle button (sends enabled = !enabled)
 * };
 * export function toNfcTagRow(tag: OwnNfcTag): NfcTagRow;
 */
import { describe, expect, it } from "vitest";

import { toNfcTagRow } from "@/ui/features/nfc/tag-row";

import { anOwnNfcTag, TAG_ID } from "../../../../tests/builders/nfc";

describe("toNfcTagRow", () => {
  it("assigned tag → « Active », toggle « Désactiver », last 4 characters, French date", () => {
    expect(toNfcTagRow(anOwnNfcTag())).toStrictEqual({
      id: TAG_ID,
      shortId: "8r3s",
      statusLabel: "Active",
      activatedOn: "17 novembre 2026",
      enabled: true,
      toggleLabel: "Désactiver",
    });
  });

  it("disabled tag → « Désactivée », toggle « Réactiver »", () => {
    const row = toNfcTagRow(anOwnNfcTag({ status: "disabled" }));

    expect(row.statusLabel).toBe("Désactivée");
    expect(row.enabled).toBe(false);
    expect(row.toggleLabel).toBe("Réactiver");
  });

  it("the date is the day in Paris, not in UTC (23:30 UTC on 17/11 is 18/11 in Paris)", () => {
    expect(toNfcTagRow(anOwnNfcTag({ activatedAt: "2026-11-17T22:30:00.000Z" })).activatedOn).toBe("17 novembre 2026");
    expect(toNfcTagRow(anOwnNfcTag({ activatedAt: "2026-11-17T23:30:00.000Z" })).activatedOn).toBe("18 novembre 2026");
  });

  it("summer time: 22:30 UTC on 30/06 is already 01/07 in Paris", () => {
    expect(toNfcTagRow(anOwnNfcTag({ activatedAt: "2026-06-30T22:30:00.000Z" })).activatedOn).toBe("1 juillet 2026");
  });

  it("no activation date → null", () => {
    expect(toNfcTagRow(anOwnNfcTag({ activatedAt: null })).activatedOn).toBeNull();
  });

  it("an unparsable date → null (never « Invalid Date »)", () => {
    expect(toNfcTagRow(anOwnNfcTag({ activatedAt: "not a date" })).activatedOn).toBeNull();
  });
});
