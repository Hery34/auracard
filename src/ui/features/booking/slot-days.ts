export type SlotChoice = { start: string; end: string; time: string };
export type SlotDay = { date: string; slots: SlotChoice[] };

type Slot = { start: string; end: string };

function partsOf(formatter: Intl.DateTimeFormat, at: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
}

/** "UTC+02:00", "UTC+05:30", "UTC" for a zero offset. */
function offsetLabel(formatter: Intl.DateTimeFormat, at: Date): string {
  return (partsOf(formatter, at).timeZoneName ?? "").replace(/^GMT/, "UTC");
}

/**
 * Slots grouped by local day of `timeZone` (the browser's, passed in), in time order. On a fall-back day, two slots
 * with the same "HH:MM" get their UTC offset appended so that their names stay distinct.
 */
export function groupSlotsByDay(slots: readonly Slot[], timeZone: string): SlotDay[] {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  const days = new Map<string, { at: Date; slot: Slot; time: string }[]>();
  for (const slot of slots) {
    const at = new Date(slot.start);
    const parts = partsOf(local, at);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const entries = days.get(date) ?? [];
    entries.push({ at, slot, time: `${parts.hour}:${parts.minute}` });
    days.set(date, entries);
  }
  return [...days].map(([date, entries]) => ({
    date,
    slots: entries.map(({ at, slot, time }) => ({
      start: slot.start,
      end: slot.end,
      time: entries.filter((other) => other.time === time).length > 1 ? `${time} (${offsetLabel(offset, at)})` : time,
    })),
  }));
}

/** Decision 2: the owner's zone is mentioned only when it differs from the browser's. */
export function ownerTimeZoneShown(ownerTimeZone: string, browserTimeZone: string): boolean {
  return ownerTimeZone !== browserTimeZone;
}

/** "lundi 23 novembre" in `timeZone`: the accessible name of a day choice. */
export function dayLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date(instant));
}
