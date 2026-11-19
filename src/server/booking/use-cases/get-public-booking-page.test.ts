/**
 * Contract frozen by test-engineer (0039, criterion 3: « Profil non publié ou sans type actif : pas de bouton, page
 * 404 »). Read by the Server Component of /p/{slug}/rdv and, for the « Prendre rendez-vous » link, by /p/{slug}.
 *
 * // src/server/booking/use-cases/get-public-booking-page.ts
 * export type GetPublicBookingPage = (slug: string) => Promise<Result<PublicBookingPage, "not_found" | "unexpected">>;
 * export function makeGetPublicBookingPage(deps: { pages: PublicBookingReader }): GetPublicBookingPage;
 * // malformed slug → not_found without any read; null (unknown or unpublished) → not_found; no active type →
 * // not_found; otherwise the page as read (types by position, rules "HH:MM", time zone of the profile).
 * // PublicContainer gains getPublicBookingPage (anonymous client, cached with the profile's tag, see the report).
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetPublicBookingPage } from "@/server/booking/use-cases/get-public-booking-page";

import { aPublicBookingPage, BOOKING_SLUG } from "../../../../tests/builders/booking";
import { makeCallLog } from "../../../../tests/builders/call-log";
import { fakePublicBookingReader } from "../../../../tests/builders/fake-public-booking-reader";

describe("getPublicBookingPage (criterion 3)", () => {
  it("published profile with active types → the page", async () => {
    const getPublicBookingPage = makeGetPublicBookingPage({ pages: fakePublicBookingReader() });

    expect(await getPublicBookingPage(BOOKING_SLUG)).toStrictEqual(ok(aPublicBookingPage()));
  });

  it("criterion 3: unknown or unpublished profile → not_found", async () => {
    const getPublicBookingPage = makeGetPublicBookingPage({ pages: fakePublicBookingReader({ published: [] }) });

    expect(await getPublicBookingPage(BOOKING_SLUG)).toStrictEqual(err("not_found"));
  });

  it("criterion 3: published profile without any active type → not_found (no link, page 404)", async () => {
    const getPublicBookingPage = makeGetPublicBookingPage({
      pages: fakePublicBookingReader({ page: aPublicBookingPage({ eventTypes: [] }) }),
    });

    expect(await getPublicBookingPage(BOOKING_SLUG)).toStrictEqual(err("not_found"));
  });

  it("malformed slug → not_found, nothing read", async () => {
    const log = makeCallLog();
    const getPublicBookingPage = makeGetPublicBookingPage({ pages: fakePublicBookingReader({ log }) });

    expect(await getPublicBookingPage("../admin")).toStrictEqual(err("not_found"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("failing read → unexpected", async () => {
    const getPublicBookingPage = makeGetPublicBookingPage({ pages: fakePublicBookingReader({ failingPage: true }) });

    expect(await getPublicBookingPage(BOOKING_SLUG)).toStrictEqual(err("unexpected"));
  });
});
