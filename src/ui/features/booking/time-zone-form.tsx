"use client";

import { saveTimeZoneAction } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import { TIME_ZONE_FIELD_ERROR_MESSAGE } from "@/ui/features/booking/messages";
import { SelectField } from "@/ui/features/booking/select-field";
import { fieldErrorsOf, toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { useSettingsForm } from "@/ui/features/booking/use-settings-form";
import { Button } from "@/ui/primitives/button";

const FIELD_MESSAGES = { timeZone: TIME_ZONE_FIELD_ERROR_MESSAGE } as const;

export function TimeZoneForm({ timeZone, timeZones }: { timeZone: string; timeZones: readonly string[] }) {
  const { state, pending, submit } = useSettingsForm(saveTimeZoneAction);
  const feedback = toSettingsFeedback(state);
  const errors = fieldErrorsOf(feedback, FIELD_MESSAGES);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <SelectField id="booking-time-zone" name="timeZone" label="Fuseau horaire" defaultValue={timeZone} error={errors.timeZone}>
        {timeZones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </SelectField>
      <Button type="submit" disabled={pending} className="self-start">
        Enregistrer le fuseau
      </Button>
      <ActionFeedback feedback={feedback} />
    </form>
  );
}
