import type { DailyAggregate, DayRange } from "@/domain/analytics/stats";
import type { DailyAggregateReader } from "@/domain/analytics/ports";
import type { Clock } from "@/domain/shared/ports/clock";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

/** Wednesday 18 November 2026, 11:00 in Paris (CET): the "now" of the statistics tests. */
export const STATS_NOW = "2026-11-18T10:00:00.000Z";
export const STATS_TODAY = "2026-11-18";

/** `link_id` of links deleted from the profile: their aggregates stay under these uuids (0028, decision 4). */
export const DELETED_LINK_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
export const OTHER_DELETED_LINK_ID = "6b5a4f3e-2d1c-4b0a-9f8e-7d6c5b4a3f2e";

/** Clock frozen at `iso`: no test reads the real time. */
export function fixedClock(iso: string = STATS_NOW): Clock {
  return {
    now() {
      return new Date(iso);
    },
  };
}

/** One row of `carnet.analytics_daily`: a direct view, today, counted once. */
export function aDailyAggregate(overrides: Partial<DailyAggregate> = {}): DailyAggregate {
  return { day: STATS_TODAY, metric: "profile_view", linkId: null, source: "direct", value: 1, ...overrides };
}

/** The same row as returned in the jsonb array of `rpc("get_own_daily_aggregates")` (snake_case keys). */
export function aDailyAggregateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { day, metric, linkId, source, value } = aDailyAggregate();
  return { day, metric, link_id: linkId, source, value, ...overrides };
}

export type ListAggregatesResult = Result<DailyAggregate[], "unexpected">;

export type FakeDailyAggregateReaderOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to no aggregate. */
  results?: readonly ListAggregatesResult[];
};

/** Records `{ profileId, range }` for each `listOwn`. */
export function fakeDailyAggregateReader(options: FakeDailyAggregateReaderOptions = {}): DailyAggregateReader {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<ListAggregatesResult>(options.results, ok([]));

  return {
    async listOwn(profileId: string, range: DayRange) {
      log.record("aggregates", "listOwn", { profileId, range });
      return nextResult();
    },
  };
}
