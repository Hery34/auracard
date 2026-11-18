import type { AnalyticsEvent } from "@/domain/analytics/analytics-event";
import type { Result } from "@/domain/shared/result";

/** Idempotent by `id`. Unknown or unpublished slug, or link of another profile: nothing written, same answer. */
export interface EventRecorder {
  record(event: AnalyticsEvent): Promise<Result<void, "unexpected">>;
}
