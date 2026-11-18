import type { AnalyticsEvent } from "@/domain/analytics/analytics-event";
import type { DailyAggregate, DayRange } from "@/domain/analytics/stats";
import type { Result } from "@/domain/shared/result";

/** Idempotent by `id`. Unknown or unpublished slug, or link of another profile: nothing written, same answer. */
export interface EventRecorder {
  record(event: AnalyticsEvent): Promise<Result<void, "unexpected">>;
}

/**
 * Rows of `profileId` whose day is in `range` (inclusive), under the session: a profile the caller cannot read
 * gives []. Every row, never truncated by a row limit.
 */
export interface DailyAggregateReader {
  listOwn(profileId: string, range: DayRange): Promise<Result<DailyAggregate[], "unexpected">>;
}
