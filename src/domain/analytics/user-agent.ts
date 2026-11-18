import type { DeviceClass } from "@/domain/analytics/analytics-event";

export type UserAgentClass = DeviceClass | "bot";

/** Search engines, link previews and generic crawlers; checked before the device (some robots look like phones). */
const BOT_PATTERN =
  /bot\b|spider|crawl|facebookexternalhit|linkedinbot|slackbot|whatsapp|twitterbot|telegrambot|discordbot|googlebot|bingbot|duckduckbot|yandexbot|baiduspider|applebot|skypeuripreview/i;

const MOBILE_PATTERN = /mobile|iphone|ipod|android|ipad/i;

export function classifyUserAgent(userAgent: string | null): UserAgentClass {
  if (userAgent === null || userAgent.trim() === "" || BOT_PATTERN.test(userAgent)) {
    return "bot";
  }
  return MOBILE_PATTERN.test(userAgent) ? "mobile" : "desktop";
}
