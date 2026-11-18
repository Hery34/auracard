import type { AvailabilityRule, RuleIssue, Weekday } from "@/domain/booking/availability";
import { END_OF_DAY } from "@/domain/booking/time-zone";
import { RULE_ISSUE_MESSAGES } from "@/ui/features/booking/messages";

/** One plage of the weekly editor; `key` identifies it on the page only. */
export type EditorRule = { key: string; weekday: Weekday; start: string; end: string };

/** `<input type="time">` cannot show "24:00": an end of day is typed and shown as "00:00". */
const MIDNIGHT = "00:00";

export function toEditorRules(rules: readonly AvailabilityRule[]): EditorRule[] {
  return rules.map((rule, index) => ({ ...rule, key: `stored-${index}`, end: rule.end === END_OF_DAY ? MIDNIGHT : rule.end }));
}

/** `rules` field of `replaceAvailabilityRulesAction`, in the editor order (the order of the `ruleIssues` indexes). */
export function toRulesField(rules: readonly EditorRule[]): string {
  return JSON.stringify(
    rules.map(({ weekday, start, end }) => ({ weekday, start, end: end === MIDNIGHT ? END_OF_DAY : end })),
  );
}

/** Message of each refused plage, by key; `keys` are the keys in the submitted order. */
export function ruleErrorsByKey(issues: readonly RuleIssue[], keys: readonly string[]): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const { index, reason } of issues) {
    const key = keys[index];
    if (key !== undefined) {
      errors[key] = RULE_ISSUE_MESSAGES[reason];
    }
  }
  return errors;
}
