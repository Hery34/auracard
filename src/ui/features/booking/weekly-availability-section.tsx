import type { AvailabilityRule } from "@/domain/booking/availability";
import { SettingsSection } from "@/ui/features/booking/settings-section";
import { WeeklyRulesEditor } from "@/ui/features/booking/weekly-rules-editor";

export function WeeklyAvailabilitySection({ rules }: { rules: readonly AvailabilityRule[] }) {
  return (
    <SettingsSection title="Disponibilités hebdomadaires">
      <p>Vos plages de réservation de chaque semaine, enregistrées ensemble.</p>
      <WeeklyRulesEditor initial={rules} />
    </SettingsSection>
  );
}
