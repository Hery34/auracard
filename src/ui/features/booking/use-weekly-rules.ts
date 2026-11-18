"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";

import { MAX_AVAILABILITY_RULES, type AvailabilityRule, type Weekday } from "@/domain/booking/availability";
import { replaceAvailabilityRulesAction, type BookingSettingsState } from "@/server/booking/actions";
import { ruleErrorsByKey, toEditorRules, toRulesField, type EditorRule } from "@/ui/features/booking/weekly-rules";

type SaveState = { answer: BookingSettingsState; keys: readonly string[] };
type SavePayload = { data: FormData; keys: readonly string[] };

const NOT_SAVED: SaveState = { answer: { status: "idle" }, keys: [] };

async function save(previous: SaveState, { data, keys }: SavePayload): Promise<SaveState> {
  return { answer: await replaceAvailabilityRulesAction(previous.answer, data), keys };
}

/** The weekly list edited as a whole, then replaced in one action (ADR 0016 §1). */
export function useWeeklyRules(initial: readonly AvailabilityRule[]) {
  const [rules, setRules] = useState<readonly EditorRule[]>(() => toEditorRules(initial));
  const [{ answer, keys }, dispatch, pending] = useActionState(save, NOT_SAVED);
  const ruleErrors = answer.status === "error" ? ruleErrorsByKey(answer.ruleIssues ?? [], keys) : {};

  /** Returns the key of the new plage. */
  function add(weekday: Weekday): string {
    const key = crypto.randomUUID();
    setRules((current) => [...current, { key, weekday, start: "", end: "" }]);
    return key;
  }

  function update(key: string, patch: Partial<Pick<EditorRule, "start" | "end">>) {
    setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)));
  }

  function remove(key: string) {
    setRules((current) => current.filter((rule) => rule.key !== key));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData();
    data.set("rules", toRulesField(rules));
    const sent = rules.map((rule) => rule.key);
    startTransition(() => dispatch({ data, keys: sent }));
  }

  return {
    rules,
    answer,
    ruleErrors,
    pending,
    canAdd: rules.length < MAX_AVAILABILITY_RULES,
    add,
    update,
    remove,
    submit,
  };
}
