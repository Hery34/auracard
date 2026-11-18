import type { DailyAggregateReader } from "@/domain/analytics/ports";
import { buildStats, parisDay, parseStatsPeriod, statsRange, type Stats } from "@/domain/analytics/stats";
import type { LinkRepository, ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { Clock } from "@/domain/shared/ports/clock";
import { err, ok, type Result } from "@/domain/shared/result";

export type GetOwnStatsError = "invalid_period" | "unauthenticated" | "no_profile" | "unexpected";

export type GetOwnStats = (input: { period: string }) => Promise<Result<Stats, GetOwnStatsError>>;

/**
 * Read only, always on the caller's own profile (no id comes from the input). "Today" is the Paris day of the clock.
 * An authenticated account without a carnet profile (another project of the instance) is `no_profile`.
 */
export function makeGetOwnStats(deps: {
  auth: AuthGateway;
  profiles: ProfileReader;
  links: LinkRepository;
  aggregates: DailyAggregateReader;
  clock: Clock;
}): GetOwnStats {
  return async ({ period: rawPeriod }) => {
    const period = parseStatsPeriod(rawPeriod);
    if (!period.ok) {
      return period;
    }
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const profile = await deps.profiles.getOwn();
    if (!profile.ok) {
      return err("unexpected");
    }
    if (profile.value === null) {
      return err("no_profile");
    }
    const profileId = profile.value.id;
    const today = parisDay(deps.clock.now());
    const [links, aggregates] = await Promise.all([
      deps.links.listOwn(profileId),
      deps.aggregates.listOwn(profileId, statsRange(period.value, today)),
    ]);
    if (!links.ok || !aggregates.ok) {
      return err("unexpected");
    }
    return ok(buildStats({ period: period.value, today, aggregates: aggregates.value, links: links.value }));
  };
}
