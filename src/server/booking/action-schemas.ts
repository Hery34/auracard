import { z } from "zod";

import { MAX_AVAILABILITY_RULES } from "@/domain/booking/availability";
import { MAX_EVENT_TYPES } from "@/domain/booking/event-type";

/** Client-generated or stored id, lower-cased. */
export const bookingIdSchema = z.uuid().transform((id) => id.toLowerCase());

/** Field `ids` of the reordering: the full order of the types. */
export const eventTypeOrderSchema = z.array(bookingIdSchema).min(1).max(MAX_EVENT_TYPES);

/**
 * Field `rules` of the weekly editor; the values are then checked by `parseAvailabilityRules`. One element over the cap
 * still reaches it (`too_many`).
 */
export const availabilityRulesSchema = z
  .array(z.object({ weekday: z.number(), start: z.string().max(16), end: z.string().max(16) }))
  .max(MAX_AVAILABILITY_RULES + 1);

/** "true" / "false" of a hidden field. */
export const booleanFieldSchema = z.enum(["true", "false"]).transform((value) => value === "true");

/** Decimal digits only (no sign, exponent nor hexadecimal); anything else is `NaN`, refused by the domain. */
export function integerField(value: string | undefined): number {
  return value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
}

/** Unparsable or absent → `undefined`, refused by the schema. */
export function jsonField(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
