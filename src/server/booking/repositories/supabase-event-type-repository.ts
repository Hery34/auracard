import { isLocationKind, type EventType } from "@/domain/booking/event-type";
import type { EventTypeRepository, EventTypeWriteError } from "@/domain/booking/ports";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";
import type { Database } from "@/server/infrastructure/supabase/database.types";

type EventTypeRow = Pick<
  Database["carnet"]["Tables"]["event_types"]["Row"],
  | "id"
  | "title"
  | "duration_min"
  | "buffer_min"
  | "min_notice_min"
  | "location_kind"
  | "location_text"
  | "is_active"
  | "position"
>;

const COLUMNS = "id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position";

/** 42501: RLS refusal (another account's profile); 23505: id or position taken; 23514: bounds of the table. */
const CREATE_ERRORS: ReadonlyMap<string, EventTypeWriteError> = new Map([
  ["42501", "not_found"],
  ["23505", "conflict"],
  ["23514", "invalid_input"],
]);

/** Raised by `carnet.reorder_event_types` (0038). */
const REORDER_ERRORS: ReadonlyMap<string, "not_found" | "invalid_input"> = new Map([
  ["42501", "not_found"],
  ["22023", "invalid_input"],
]);

/** `bookings_event_type_id_profile_id_fkey` (on delete no action). */
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/**
 * `carnet.event_types` under the session of the server client (RLS `event_types_*_own`, `reorder_event_types`
 * security invoker). At most 10 rows per profile: direct reads. Logs the SQLSTATE only.
 */
export function makeSupabaseEventTypeRepository(server: CarnetClient): EventTypeRepository {
  return {
    async listOwn(profileId) {
      const { data, error } = await server
        .from("event_types")
        .select(COLUMNS)
        .eq("profile_id", profileId)
        .order("position");
      if (error !== null) {
        logInfrastructureError("event_types.select_own", error.code);
        return err("unexpected");
      }
      return toEventTypes("event_types.select_own", data);
    },

    async create(profileId, eventType) {
      const { data, error } = await server
        .from("event_types")
        .insert({ id: eventType.id, profile_id: profileId, position: eventType.position, ...toColumns(eventType) })
        .select(COLUMNS)
        .single();
      if (error !== null) {
        const mapped = CREATE_ERRORS.get(error.code);
        if (mapped !== undefined) {
          return err(mapped);
        }
        logInfrastructureError("event_types.insert_own", error.code);
        return err("unexpected");
      }
      return toEventType("event_types.insert_own", data);
    },

    async update(profileId, id, draft) {
      const { data, error } = await server
        .from("event_types")
        .update(toColumns(draft))
        .eq("id", id)
        .eq("profile_id", profileId)
        .select(COLUMNS)
        .maybeSingle();
      if (error !== null) {
        if (error.code === CHECK_VIOLATION) {
          return err("invalid_input");
        }
        logInfrastructureError("event_types.update_own", error.code);
        return err("unexpected");
      }
      return data === null ? err("not_found") : toEventType("event_types.update_own", data);
    },

    async setActive(profileId, id, isActive) {
      const { data, error } = await server
        .from("event_types")
        .update({ is_active: isActive })
        .eq("id", id)
        .eq("profile_id", profileId)
        .select(COLUMNS)
        .maybeSingle();
      if (error !== null) {
        logInfrastructureError("event_types.set_active_own", error.code);
        return err("unexpected");
      }
      return data === null ? err("not_found") : toEventType("event_types.set_active_own", data);
    },

    async reorder(profileId, ids) {
      const { data, error } = await server.rpc("reorder_event_types", { p_profile_id: profileId, p_order: [...ids] });
      if (error !== null) {
        const mapped = REORDER_ERRORS.get(error.code);
        if (mapped !== undefined) {
          return err(mapped);
        }
        logInfrastructureError("reorder_event_types", error.code);
        return err("unexpected");
      }
      return toEventTypes("reorder_event_types", data);
    },

    async remove(profileId, id) {
      const { error } = await server.from("event_types").delete().eq("id", id).eq("profile_id", profileId);
      if (error !== null) {
        if (error.code === FOREIGN_KEY_VIOLATION) {
          return err("has_bookings");
        }
        logInfrastructureError("event_types.delete_own", error.code);
        return err("unexpected");
      }
      return ok(undefined);
    },
  };
}

function toColumns(draft: {
  title: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  locationKind: string;
  locationText: string | null;
}) {
  return {
    title: draft.title,
    duration_min: draft.durationMin,
    buffer_min: draft.bufferMin,
    min_notice_min: draft.minNoticeMin,
    location_kind: draft.locationKind,
    location_text: draft.locationText,
  };
}

/** `event_types_location_kind_check` guarantees the kind; any other value means the schema drifted. */
function toEventType(source: string, row: EventTypeRow): Result<EventType, "unexpected"> {
  if (!isLocationKind(row.location_kind)) {
    logInfrastructureError(source, "unknown_location_kind");
    return err("unexpected");
  }
  return ok({
    id: row.id,
    title: row.title,
    durationMin: row.duration_min,
    bufferMin: row.buffer_min,
    minNoticeMin: row.min_notice_min,
    locationKind: row.location_kind,
    locationText: row.location_text,
    isActive: row.is_active,
    position: row.position,
  });
}

function toEventTypes(source: string, rows: readonly EventTypeRow[]): Result<EventType[], "unexpected"> {
  const eventTypes: EventType[] = [];
  for (const row of rows) {
    const eventType = toEventType(source, row);
    if (!eventType.ok) {
      return eventType;
    }
    eventTypes.push(eventType.value);
  }
  return ok(eventTypes);
}
