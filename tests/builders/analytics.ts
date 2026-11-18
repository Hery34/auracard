import type { BeaconInput, ServerEventInput } from "@/server/use-cases/record-event";

/** Identifiers of the statistics tests (uuid v4, lower case). */
export const EVENT_ID = "3f2b8c1d-6e4a-4f7b-9c2d-1a0b9e8d7c6f";
export const OTHER_EVENT_ID = "8a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d";
export const PROFILE_ID = "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const LINK_ID = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";
export const PROFILE_SLUG = "elodie-durand-merel";
export const BEACON_CLIENT_ADDRESS = "203.0.113.77";

/** Ordinary browsers: never robots. */
export const MOBILE_USER_AGENTS: ReadonlyArray<readonly [label: string, userAgent: string]> = [
  [
    "Safari on iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ],
  [
    "Chrome on Android",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  ],
  [
    "LinkedIn in-app browser (iOS)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1234",
  ],
  [
    "Instagram in-app browser (iOS)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.21.101 (iPhone15,2; iOS 18_1; fr_FR; fr; scale=3.00; 1179x2556; 612345678)",
  ],
  [
    "Facebook in-app browser (Android)",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.40.109;]",
  ],
];

export const DESKTOP_USER_AGENTS: ReadonlyArray<readonly [label: string, userAgent: string]> = [
  [
    "Chrome on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ],
  [
    "Safari on macOS",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  ],
  ["Firefox on Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"],
];

/** Search engines and link previews (decision 2): never recorded. */
export const BOT_USER_AGENTS: ReadonlyArray<readonly [label: string, userAgent: string]> = [
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  [
    "Googlebot smartphone (Android-looking)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ],
  ["bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
  ["DuckDuckBot", "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)"],
  ["YandexBot", "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"],
  ["Baiduspider", "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)"],
  [
    "Applebot",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  ],
  ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["LinkedInBot", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"],
  ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
  ["WhatsApp", "WhatsApp/2.23.20.0 A"],
  ["Twitterbot", "Twitterbot/1.0"],
  ["TelegramBot", "TelegramBot (like TwitterBot)"],
  ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
];

export const IPHONE_USER_AGENT = MOBILE_USER_AGENTS[0]![1];
export const DESKTOP_USER_AGENT = DESKTOP_USER_AGENTS[0]![1];
export const PREVIEW_BOT_USER_AGENT = BOT_USER_AGENTS[7]![1];

/** Origin of a third-party page posting to `/api/beacon` (0029, point 10): never recorded. */
export const THIRD_PARTY_ORIGIN = "https://evil.example";

/** What `/api/beacon` receives, in the JSON of the page (snake_case `link_id`, optional). */
export type BeaconBody = { slug: string; id: string; type: string; source: string; link_id?: string };

export function aBeaconBody(overrides: Partial<BeaconBody> = {}): BeaconBody {
  return { slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view", source: "direct", ...overrides };
}

/** Input of `recordBeaconEvent` (use case): a `profile_view` of a mobile visitor, direct source. */
export function aBeaconInput(overrides: Partial<BeaconInput> = {}): BeaconInput {
  return {
    slug: PROFILE_SLUG,
    id: EVENT_ID,
    type: "profile_view",
    source: "direct",
    linkId: null,
    userAgent: IPHONE_USER_AGENT,
    clientAddress: BEACON_CLIENT_ADDRESS,
    ...overrides,
  };
}

/** Input of `recordServerEvent` (use case): an NFC scan by a mobile visitor. */
export function aServerEventInput(overrides: Partial<ServerEventInput> = {}): ServerEventInput {
  return {
    slug: PROFILE_SLUG,
    type: "nfc_scan",
    userAgent: IPHONE_USER_AGENT,
    clientAddress: BEACON_CLIENT_ADDRESS,
    ...overrides,
  };
}
