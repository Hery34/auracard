import type { Result } from "@/domain/shared/result";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import type { GetVCard, VCardFile } from "@/server/use-cases/get-vcard";
import { enforceRateLimits, type RateLimitError } from "@/server/use-cases/shared/enforce-rate-limits";

export type DownloadVCardInput = { slug: string; clientAddress: string };

export type DownloadVCard = (input: DownloadVCardInput) => Promise<Result<VCardFile | null, RateLimitError>>;

/** Rate limit `vcard` (address), counted on every request whatever the slug, then the file. */
export function makeDownloadVCard(deps: { rateLimiter: RateLimiter; getVCard: GetVCard }): DownloadVCard {
  return async ({ slug, clientAddress }) => {
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "vcard", subject: clientAddress }]);
    if (!limited.ok) {
      return limited;
    }
    return deps.getVCard(slug);
  };
}
