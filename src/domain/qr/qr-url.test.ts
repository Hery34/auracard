/**
 * Contract frozen by test-engineer (0026, decision 2): see the header of `qr-style.test.ts`.
 *
 * // src/domain/qr/qr-url.ts
 * export function qrCodeUrl(siteUrl: string, code: string): string;   // `${siteUrl}/q/${code}`
 */
import { describe, expect, it } from "vitest";

import { qrCodeUrl } from "@/domain/qr/qr-url";

import { QR_CODE, QR_CODE_URL, QR_SITE_URL } from "../../../tests/builders/qr";

describe("qrCodeUrl (criterion 1, decision 2)", () => {
  it("criterion 1: encodes ${SITE_URL}/q/{code}", () => {
    expect(qrCodeUrl(QR_SITE_URL, QR_CODE)).toBe(QR_CODE_URL);
    expect(QR_CODE_URL).toBe("https://carnet.example/q/x4y5z6w7");
  });

  it("keeps the port of the origin (local development)", () => {
    expect(qrCodeUrl("http://localhost:3000", QR_CODE)).toBe(`http://localhost:3000/q/${QR_CODE}`);
  });

  it("depends on the code only, never on the slug: the same code always gives the same URL", () => {
    expect(qrCodeUrl(QR_SITE_URL, QR_CODE)).toBe(qrCodeUrl(QR_SITE_URL, QR_CODE));
    expect(qrCodeUrl(QR_SITE_URL, "a1b2c3d4")).not.toBe(qrCodeUrl(QR_SITE_URL, QR_CODE));
  });
});
