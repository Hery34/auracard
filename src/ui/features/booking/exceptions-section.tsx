import type { AvailabilityException } from "@/domain/booking/availability";
import { AddExceptionForm } from "@/ui/features/booking/add-exception-form";
import { toExceptionRows } from "@/ui/features/booking/exception-row";
import { NO_EXCEPTIONS_MESSAGE } from "@/ui/features/booking/messages";
import { RemoveExceptionForm } from "@/ui/features/booking/remove-exception-form";
import { SettingsSection } from "@/ui/features/booking/settings-section";

type Props = { exceptions: readonly AvailabilityException[]; timeZone: string; newExceptionId: string };

export function ExceptionsSection({ exceptions, timeZone, newExceptionId }: Props) {
  const rows = toExceptionRows(exceptions, timeZone);
  return (
    <SettingsSection title="Absences et ouvertures ponctuelles">
      <p>Une absence ferme la période à la réservation ; une ouverture ponctuelle l’ouvre en plus de la semaine type.</p>
      {rows.length === 0 ? (
        <p>{NO_EXCEPTIONS_MESSAGE}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground">
              <p className="font-medium">{row.kindLabel}</p>
              <p>{row.periodLabel}</p>
              <RemoveExceptionForm row={row} />
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-lg font-semibold">Nouvelle période</h3>
      <AddExceptionForm id={newExceptionId} timeZone={timeZone} />
    </SettingsSection>
  );
}
