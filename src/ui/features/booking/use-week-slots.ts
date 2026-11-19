"use client";

import { useCallback, useRef, useState } from "react";

import { listSlotsAction, type ListSlotsActionResult } from "@/server/booking/public-actions";
import { slotsOfWeek, weekRange, type WeekRange } from "@/ui/features/booking/slot-week";

type Slot = { start: string; end: string };
type ListError = Extract<ListSlotsActionResult, { status: "error" }>["error"];
type Shown = { eventTypeId: string; week: number; range: WeekRange; result: ListSlotsActionResult };

export type WeekSlots = {
  /** The type and week whose list is shown: a choice takes effect once its slots are read. */
  eventTypeId: string | null;
  week: number;
  loading: boolean;
  slots: Slot[];
  error: ListError | null;
  /** Reads a type's week; resolves to false when a later request superseded it. */
  show: (eventTypeId: string, week: number) => Promise<boolean>;
};

/** One week of a type's slots, read by `listSlotsAction` on demand; the previous list stays shown while reading. */
export function useWeekSlots(slug: string): WeekSlots {
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  const show = useCallback(
    async (eventTypeId: string, week: number) => {
      latest.current += 1;
      const request = latest.current;
      setLoading(true);
      const range = weekRange(new Date(), week);
      const result = await listSlotsAction({ slug, eventTypeId, from: range.from, to: range.to }).catch(
        (): ListSlotsActionResult => ({ status: "error", error: "unexpected" }),
      );
      if (request !== latest.current) {
        return false;
      }
      setShown({ eventTypeId, week, range, result });
      setLoading(false);
      return true;
    },
    [slug],
  );

  return {
    eventTypeId: shown?.eventTypeId ?? null,
    week: shown?.week ?? 0,
    loading,
    slots: shown?.result.status === "ok" ? slotsOfWeek(shown.result.slots, shown.range) : [],
    error: shown?.result.status === "error" ? shown.result.error : null,
    show,
  };
}
