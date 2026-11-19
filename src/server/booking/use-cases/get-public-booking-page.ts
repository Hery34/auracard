import type { PublicBookingPage, PublicBookingReader } from "@/domain/booking/ports";
import { SLUG_PATTERN } from "@/domain/profile/slug";
import { err, ok, type Result } from "@/domain/shared/result";

export type GetPublicBookingPage = (slug: string) => Promise<Result<PublicBookingPage, "not_found" | "unexpected">>;

/** Unknown, unpublished or without any active type: one single answer, `not_found` (no link, page 404). */
export function makeGetPublicBookingPage(deps: { pages: PublicBookingReader }): GetPublicBookingPage {
  return async (slug) => {
    if (!SLUG_PATTERN.test(slug)) {
      return err("not_found");
    }
    const page = await deps.pages.page(slug);
    if (!page.ok) {
      return err("unexpected");
    }
    if (page.value === null || page.value.eventTypes.length === 0) {
      return err("not_found");
    }
    return ok(page.value);
  };
}
