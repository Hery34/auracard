import {
  isExceptionKind,
  isWeekday,
  type AvailabilityException,
  type AvailabilityRule,
} from "@/domain/booking/availability";
import type { AvailabilityRepository } from "@/domain/booking/ports";
import { parseTimeZone } from "@/domain/booking/time-zone";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** Under PostgREST `max_rows` (100 locally and on the shared instance, `docs/rules/supabase.md`). */
const PAGE_SIZE = 100;

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INSUFFICIENT_PRIVILEGE = "42501";
/** Raised by the cap triggers `availability_rules_limit` and `availability_exceptions_limit` (0038 point 6). */
const LIMIT_REACHED = "CN004";

/** Raised by `carnet.replace_availability_rules` (0038) and the constraints of `availability_rules`. */
const REPLACE_ERRORS: ReadonlyMap<string, "not_found" | "overlap" | "limit_reached" | "invalid_input"> = new Map([
  [INSUFFICIENT_PRIVILEGE, "not_found"],
  ["23P01", "overlap"],
  [LIMIT_REACHED, "limit_reached"],
  [CHECK_VIOLATION, "invalid_input"],
  ["22023", "invalid_input"],
]);

/** `[lower,upper)` as PostgREST prints a tstzrange, bounds quoted or not. */
const RANGE_TEXT = /^\["?([^",]+)"?,"?([^",]+)"?\)$/;

type ExceptionRow = { id: string; kind: string; range: unknown };
type RuleRow = { weekday: number; start_time: string; end_time: string };

/**
 * Time zone (`carnet.profiles`), rules and exceptions under the session of the server client (RLS `*_own`,
 * `replace_availability_rules` security invoker). Logs the SQLSTATE only, never the Postgres message.
 */
export function makeSupabaseAvailabilityRepository(server: CarnetClient): AvailabilityRepository {
  return {
    async getTimeZone(profileId) {
      const { data, error } = await server.from("profiles").select("time_zone").eq("id", profileId).maybeSingle();
      if (error !== null) {
        logInfrastructureError("profiles.select_time_zone", error.code);
        return err("unexpected");
      }
      if (data === null) {
        return err("not_found");
      }
      const timeZone = parseTimeZone(data.time_zone);
      if (timeZone === null) {
        logInfrastructureError("profiles.select_time_zone", "unexpected_time_zone");
        return err("unexpected");
      }
      return ok(timeZone);
    },

    async setTimeZone(profileId, timeZone) {
      const { data, error } = await server
        .from("profiles")
        .update({ time_zone: timeZone })
        .eq("id", profileId)
        .select("id")
        .maybeSingle();
      if (error !== null) {
        if (error.code === CHECK_VIOLATION) {
          return err("invalid_input");
        }
        logInfrastructureError("profiles.update_time_zone", error.code);
        return err("unexpected");
      }
      return data === null ? err("not_found") : ok(undefined);
    },

    /** At most 50 rows (trigger `availability_rules_limit`): direct read. */
    async listRules(profileId) {
      const { data, error } = await server
        .from("availability_rules")
        .select("weekday, start_time, end_time")
        .eq("profile_id", profileId)
        .order("weekday")
        .order("start_time");
      if (error !== null) {
        logInfrastructureError("availability_rules.select_own", error.code);
        return err("unexpected");
      }
      return toRules("availability_rules.select_own", data);
    },

    async replaceRules(profileId, rules) {
      const { data, error } = await server.rpc("replace_availability_rules", {
        p_profile_id: profileId,
        p_rules: rules.map(({ weekday, start, end }) => ({ weekday, start_time: start, end_time: end })),
      });
      if (error !== null) {
        const mapped = REPLACE_ERRORS.get(error.code);
        if (mapped !== undefined) {
          return err(mapped);
        }
        logInfrastructureError("replace_availability_rules", error.code);
        return err("unexpected");
      }
      return toRules("replace_availability_rules", data);
    },

    /** At most 200 upcoming rows (trigger `availability_exceptions_limit`), read by pages ordered by id. */
    async listUpcomingExceptions(profileId, now) {
      const rows: ExceptionRow[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await server
          .from("availability_exceptions")
          .select("id, kind, range")
          .eq("profile_id", profileId)
          .overlaps("range", `[${now.toISOString()},)`)
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error !== null) {
          logInfrastructureError("availability_exceptions.select_own", error.code);
          return err("unexpected");
        }
        rows.push(...data);
        if (data.length < PAGE_SIZE) {
          break;
        }
      }
      const exceptions = toExceptions("availability_exceptions.select_own", rows);
      if (!exceptions.ok) {
        return exceptions;
      }
      return ok(
        exceptions.value.sort((a, b) => compareText(a.startsAt, b.startsAt) || compareText(a.id, b.id)),
      );
    },

    async addException(profileId, exception) {
      const { data, error } = await server
        .from("availability_exceptions")
        .insert({
          id: exception.id,
          profile_id: profileId,
          kind: exception.kind,
          range: `[${exception.startsAt},${exception.endsAt})`,
        })
        .select("id, kind, range")
        .single();
      if (error === null) {
        return toException("availability_exceptions.insert_own", data);
      }
      if (error.code === UNIQUE_VIOLATION) {
        return storedReplay(server, profileId, exception.id);
      }
      if (error.code === INSUFFICIENT_PRIVILEGE) {
        return err("not_found");
      }
      if (error.code === LIMIT_REACHED) {
        return err("limit_reached");
      }
      if (error.code === CHECK_VIOLATION) {
        return err("invalid_input");
      }
      logInfrastructureError("availability_exceptions.insert_own", error.code);
      return err("unexpected");
    },

    async removeException(profileId, id) {
      const { error } = await server.from("availability_exceptions").delete().eq("id", id).eq("profile_id", profileId);
      if (error !== null) {
        logInfrastructureError("availability_exceptions.delete_own", error.code);
        return err("unexpected");
      }
      return ok(undefined);
    },
  };
}

/** The id is taken: the caller's own row (a replay) is returned as stored; another profile's id is `invalid_input`. */
async function storedReplay(
  server: CarnetClient,
  profileId: string,
  id: string,
): Promise<Result<AvailabilityException, "invalid_input" | "unexpected">> {
  const { data, error } = await server
    .from("availability_exceptions")
    .select("id, kind, range")
    .eq("id", id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error !== null) {
    logInfrastructureError("availability_exceptions.select_replay", error.code);
    return err("unexpected");
  }
  return data === null ? err("invalid_input") : toException("availability_exceptions.select_replay", data);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "HH:MM:SS" of a `time` column → "HH:MM" (an end of day reads `END_OF_DAY`). */
function toRules(source: string, rows: readonly RuleRow[]): Result<AvailabilityRule[], "unexpected"> {
  const rules: AvailabilityRule[] = [];
  for (const { weekday, start_time, end_time } of rows) {
    if (!isWeekday(weekday)) {
      logInfrastructureError(source, "unknown_weekday");
      return err("unexpected");
    }
    rules.push({ weekday, start: start_time.slice(0, 5), end: end_time.slice(0, 5) });
  }
  return ok(rules);
}

function toInstantIso(text: string): string {
  return new Date(Temporal.Instant.from(text).epochMilliseconds).toISOString();
}

/** `availability_exceptions_range_check` and `_kind_check` guarantee the shape; anything else means the schema drifted. */
function toException(source: string, row: ExceptionRow): Result<AvailabilityException, "unexpected"> {
  const match = RANGE_TEXT.exec(String(row.range));
  if (match === null || !isExceptionKind(row.kind)) {
    logInfrastructureError(source, "unexpected_exception_row");
    return err("unexpected");
  }
  try {
    return ok({ id: row.id, kind: row.kind, startsAt: toInstantIso(match[1] ?? ""), endsAt: toInstantIso(match[2] ?? "") });
  } catch {
    logInfrastructureError(source, "unexpected_exception_range");
    return err("unexpected");
  }
}

function toExceptions(source: string, rows: readonly ExceptionRow[]): Result<AvailabilityException[], "unexpected"> {
  const exceptions: AvailabilityException[] = [];
  for (const row of rows) {
    const exception = toException(source, row);
    if (!exception.ok) {
      return exception;
    }
    exceptions.push(exception.value);
  }
  return ok(exceptions);
}
