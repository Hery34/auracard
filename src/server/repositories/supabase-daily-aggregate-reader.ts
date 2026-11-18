import { isAnalyticsEventType, isAnalyticsSource } from "@/domain/analytics/analytics-event";
import type { DailyAggregateReader } from "@/domain/analytics/ports";
import type { DailyAggregate } from "@/domain/analytics/stats";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const SOURCE = "get_own_daily_aggregates";

/**
 * `get_own_daily_aggregates` (0030) under the session of the server client: filtered by `profileId` (index),
 * the RLS `analytics_daily_select_own` stays the guard. One jsonb value, never truncated by PostgREST `max_rows`.
 */
export function makeSupabaseDailyAggregateReader(server: CarnetClient): DailyAggregateReader {
  return {
    async listOwn(profileId, range) {
      const { data, error } = await server.rpc("get_own_daily_aggregates", {
        p_profile_id: profileId,
        p_from: range.from,
        p_to: range.to,
      });
      if (error !== null) {
        logInfrastructureError(SOURCE, error.code);
        return err("unexpected");
      }
      if (!Array.isArray(data)) {
        logInfrastructureError(SOURCE, "malformed_rows");
        return err("unexpected");
      }
      const aggregates: DailyAggregate[] = [];
      for (const row of data) {
        const aggregate = toDailyAggregate(row);
        if (aggregate === null) {
          logInfrastructureError(SOURCE, "malformed_row");
          return err("unexpected");
        }
        aggregates.push(aggregate);
      }
      return ok(aggregates);
    },
  };
}

function toDailyAggregate(row: unknown): DailyAggregate | null {
  if (
    typeof row !== "object" ||
    row === null ||
    !("day" in row) ||
    !("metric" in row) ||
    !("link_id" in row) ||
    !("source" in row) ||
    !("value" in row)
  ) {
    return null;
  }
  const { day, metric, link_id: linkId, source, value } = row;
  if (
    typeof day !== "string" ||
    !isCalendarDay(day) ||
    typeof metric !== "string" ||
    !isAnalyticsEventType(metric) ||
    (linkId !== null && typeof linkId !== "string") ||
    (source !== null && (typeof source !== "string" || !isAnalyticsSource(source))) ||
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    return null;
  }
  return { day, metric, linkId, source, value };
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(day: string): boolean {
  if (!CALENDAR_DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
