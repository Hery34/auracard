import { selectableTimeZones } from "@/domain/booking/time-zone-choice";
import { SettingsSection } from "@/ui/features/booking/settings-section";
import { TimeZoneForm } from "@/ui/features/booking/time-zone-form";

export function TimeZoneSection({ timeZone }: { timeZone: string }) {
  return (
    <SettingsSection title="Fuseau horaire">
      <p>Vos disponibilités, absences et ouvertures ponctuelles se lisent à l’heure de ce fuseau.</p>
      <TimeZoneForm timeZone={timeZone} timeZones={selectableTimeZones()} />
    </SettingsSection>
  );
}
