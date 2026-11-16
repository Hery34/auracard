import type { IdGenerator } from "@/domain/shared/ports/id-generator";

/** First four hex characters: `1a2b`, `5e6f`, `9c0d` (slug suffixes expected by the use case tests). */
export const FIXED_UUIDS = [
  "1a2b3c4d-0000-4000-8000-000000000001",
  "5e6f7a8b-0000-4000-8000-000000000002",
  "9c0d1e2f-0000-4000-8000-000000000003",
] as const;

export function fixedIds(uuids: readonly string[] = FIXED_UUIDS): IdGenerator {
  let index = 0;

  return {
    uuid() {
      const value = uuids[index];
      if (value === undefined) {
        throw new Error(`fixedIds: exhausted after ${uuids.length} call(s)`);
      }
      index += 1;
      return value;
    },
  };
}
