/**
 * Contract frozen by test-engineer (0025, decision 4): robots.txt keeps /v/ (0018) and also disallows /t/, /q/ and
 * /activer/ for every user agent.
 */
import { describe, expect, it } from "vitest";

import robots from "@/app/robots";

function disallowed(): string[] {
  const { rules } = robots();
  const all = Array.isArray(rules) ? rules : [rules];
  const forEveryone = all.filter((rule) => (Array.isArray(rule.userAgent) ? rule.userAgent.includes("*") : rule.userAgent === "*"));
  return forEveryone.flatMap((rule) => (rule.disallow === undefined ? [] : Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow]));
}

describe("robots.txt", () => {
  it.each(["/v/", "/t/", "/q/", "/activer/"])("decision 4: disallows %s for every user agent", (path) => {
    expect(disallowed()).toContain(path);
  });

  it("allows nothing explicitly that the rules above forbid", () => {
    const { rules } = robots();
    const all = Array.isArray(rules) ? rules : [rules];
    const allowed = all.flatMap((rule) => (rule.allow === undefined ? [] : Array.isArray(rule.allow) ? rule.allow : [rule.allow]));

    expect(allowed.filter((path) => ["/t/", "/q/", "/activer/", "/v/"].some((prefix) => path.startsWith(prefix)))).toStrictEqual([]);
  });
});
