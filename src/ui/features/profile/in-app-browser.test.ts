import { describe, expect, it } from "vitest";

import { isInAppBrowser } from "@/ui/features/profile/in-app-browser";

const IN_APP = [
  [
    "Instagram on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 325.0.0.18.92 (iPhone14,2; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 589012345)",
  ],
  [
    "LinkedIn on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6148",
  ],
  [
    "Facebook on iOS (FBAN/FBIOS)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/575123456;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  ],
  [
    "Facebook on Android (FBAV)",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 [FBAV/452.0.0.40.109;]",
  ],
] as const;

const REGULAR = [
  [
    "Safari on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ],
  [
    "Chrome on Android",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36",
  ],
  [
    "Chrome on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1",
  ],
  [
    "Chrome on desktop",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ],
  ["empty user agent", ""],
] as const;

describe("isInAppBrowser — vCard download notice (0018, decision 6)", () => {
  it.each(IN_APP)("detects %s", (_case, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(true);
  });

  it.each(REGULAR)("does not flag %s", (_case, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false);
  });
});
