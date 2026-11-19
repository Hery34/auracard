import { BROWSER_TIME_ZONE_NOTICE, ownerTimeZoneNotice } from "@/ui/features/booking/public-messages";
import { ownerTimeZoneShown } from "@/ui/features/booking/slot-days";

type Props = { timeZone: string | null; ownerTimeZone: string; ownerName: string };

/** Decision 2: the browser's zone, and the owner's when it differs. Nothing in the static HTML (zone unknown there). */
export function TimeZoneNotice({ timeZone, ownerTimeZone, ownerName }: Props) {
  if (timeZone === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>
        {BROWSER_TIME_ZONE_NOTICE} : {timeZone}.
      </p>
      {ownerTimeZoneShown(ownerTimeZone, timeZone) && <p>{ownerTimeZoneNotice(ownerName, ownerTimeZone)}</p>}
    </div>
  );
}
