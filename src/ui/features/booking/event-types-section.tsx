import type { EventType } from "@/domain/booking/event-type";
import { CreateEventTypeForm } from "@/ui/features/booking/create-event-type-form";
import { EventTypeList } from "@/ui/features/booking/event-type-list";
import { toEventTypeRows } from "@/ui/features/booking/event-type-row";
import { SettingsSection } from "@/ui/features/booking/settings-section";

type Props = { eventTypes: readonly EventType[]; newEventTypeId: string };

export function EventTypesSection({ eventTypes, newEventTypeId }: Props) {
  return (
    <SettingsSection title="Types de rendez-vous">
      <EventTypeList rows={toEventTypeRows(eventTypes)} />
      <h3 className="text-lg font-semibold">Nouveau type</h3>
      <CreateEventTypeForm id={newEventTypeId} />
    </SettingsSection>
  );
}
