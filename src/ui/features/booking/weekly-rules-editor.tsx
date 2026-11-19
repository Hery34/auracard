"use client";

import { flushSync } from "react-dom";

import { WEEKDAYS, type AvailabilityRule, type Weekday } from "@/domain/booking/availability";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import { MIDNIGHT_END_HINT, WEEKDAY_LABELS } from "@/ui/features/booking/messages";
import { toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { useWeeklyRules } from "@/ui/features/booking/use-weekly-rules";
import type { EditorRule } from "@/ui/features/booking/weekly-rules";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

function controlId(key: string, control: "start" | "end" | "error"): string {
  return `rule-${key}-${control}`;
}

function addButtonId(weekday: Weekday): string {
  return `rule-add-${weekday}`;
}

type RuleFieldsProps = {
  rule: EditorRule;
  error: string | undefined;
  onChange: (patch: Partial<Pick<EditorRule, "start" | "end">>) => void;
  onRemove: () => void;
};

/** Both times of a refused plage are flagged and described by the same message. */
function RuleFields({ rule, error, onChange, onRemove }: RuleFieldsProps) {
  const errorId = controlId(rule.key, "error");
  const flagged = error === undefined ? {} : { "aria-invalid": true, "aria-describedby": errorId };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field
          id={controlId(rule.key, "start")}
          label="Début"
          type="time"
          required
          value={rule.start}
          onChange={(event) => onChange({ start: event.target.value })}
          {...flagged}
        />
        <Field
          id={controlId(rule.key, "end")}
          label="Fin"
          type="time"
          required
          value={rule.end}
          onChange={(event) => onChange({ end: event.target.value })}
          {...flagged}
        />
      </div>
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" onClick={onRemove} className="self-start">
        Retirer la plage
      </Button>
    </div>
  );
}

export function WeeklyRulesEditor({ initial }: { initial: readonly AvailabilityRule[] }) {
  const { rules, answer, ruleErrors, pending, canAdd, add, update, remove, submit } = useWeeklyRules(initial);

  function addTo(weekday: Weekday) {
    let key = "";
    flushSync(() => {
      key = add(weekday);
    });
    document.getElementById(controlId(key, "start"))?.focus();
  }

  function removeFrom(weekday: Weekday, key: string) {
    flushSync(() => remove(key));
    document.getElementById(addButtonId(weekday))?.focus();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        {MIDNIGHT_END_HINT}
      </p>
      {WEEKDAYS.map((weekday) => (
        <fieldset key={weekday} className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-lg font-medium">{WEEKDAY_LABELS[weekday]}</legend>
          {rules
            .filter((rule) => rule.weekday === weekday)
            .map((rule) => (
              <RuleFields
                key={rule.key}
                rule={rule}
                error={ruleErrors[rule.key]}
                onChange={(patch) => update(rule.key, patch)}
                onRemove={() => removeFrom(weekday, rule.key)}
              />
            ))}
          <Button
            id={addButtonId(weekday)}
            type="button"
            variant="outline"
            disabled={!canAdd}
            onClick={() => addTo(weekday)}
            className="self-start"
          >
            Ajouter une plage
          </Button>
        </fieldset>
      ))}
      <Button type="submit" disabled={pending} className="self-start">
        Enregistrer les disponibilités
      </Button>
      <ActionFeedback feedback={toSettingsFeedback(answer, "rules")} />
    </form>
  );
}
