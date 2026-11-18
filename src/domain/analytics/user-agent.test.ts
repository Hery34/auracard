/**
 * Contract frozen by test-engineer (0029, decision 2; criterion 3).
 *
 * // src/domain/analytics/user-agent.ts
 * export type UserAgentClass = DeviceClass | "bot";            // DeviceClass from ./analytics-event
 * export function classifyUserAgent(userAgent: string | null): UserAgentClass;
 * // Search engines and link previews (facebookexternalhit, LinkedInBot, Slackbot, WhatsApp, Twitterbot, TelegramBot,
 * // Discordbot, Googlebot, bingbot, DuckDuckBot, YandexBot, Baiduspider, Applebot…) → "bot", even when the string
 * // looks like a phone; absent, empty or blank → "bot". In-app browsers (LinkedInApp, Instagram, FBAN/FBAV) are not
 * // robots. Phones → "mobile"; everything else → "desktop".
 */
import { describe, expect, it } from "vitest";

import { classifyUserAgent } from "@/domain/analytics/user-agent";

import { BOT_USER_AGENTS, DESKTOP_USER_AGENTS, MOBILE_USER_AGENTS } from "../../../tests/builders/analytics";

describe("classifyUserAgent", () => {
  it.each(BOT_USER_AGENTS)("decision 2 / criterion 3: %s → bot", (_label, userAgent) => {
    expect(classifyUserAgent(userAgent)).toBe("bot");
  });

  it.each([
    ["null (header absent)", null],
    ["empty", ""],
    ["blank", "   \t"],
  ])("decision 2: user-agent %s → bot", (_label, userAgent) => {
    expect(classifyUserAgent(userAgent)).toBe("bot");
  });

  it.each(MOBILE_USER_AGENTS)("%s → mobile (an in-app browser is a person, not a robot)", (_label, userAgent) => {
    expect(classifyUserAgent(userAgent)).toBe("mobile");
  });

  it.each(DESKTOP_USER_AGENTS)("%s → desktop", (_label, userAgent) => {
    expect(classifyUserAgent(userAgent)).toBe("desktop");
  });

  it("the robot markers are matched whatever their case (googlebot, LINKEDINBOT)", () => {
    expect(classifyUserAgent("Mozilla/5.0 (compatible; googlebot/2.1)")).toBe("bot");
    expect(classifyUserAgent("LINKEDINBOT/1.0")).toBe("bot");
  });
});
