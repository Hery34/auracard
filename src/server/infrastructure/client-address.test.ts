import { describe, expect, it } from "vitest";

import { clientAddressFrom } from "@/server/infrastructure/client-address";

const production = { trustedProxyHops: 1, production: true };
const development = { trustedProxyHops: 1, production: false };

function headersWith(forwardedFor?: string): Headers {
  const headers = new Headers();
  if (forwardedFor !== undefined) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  return headers;
}

const INVALID_OR_ABSENT: Array<string | undefined> = [
  undefined,
  "",
  "not-an-ip",
  "203.0.113",
  "203.0.113.9.1",
  "2001:db8::zz",
  "198.51.100.7, not-an-ip",
];

describe("clientAddressFrom", () => {
  describe("x-forwarded-for element selection", () => {
    it("criterion 8: takes the last element (set by the trusted proxy), never the first (client-controlled)", () => {
      expect(clientAddressFrom(headersWith("198.51.100.7, 203.0.113.9"), production)).toBe("203.0.113.9");
    });

    it("tolerates spaces around the elements", () => {
      expect(clientAddressFrom(headersWith("  198.51.100.7 ,   203.0.113.9  "), production)).toBe("203.0.113.9");
    });

    it("returns the only element when the header has one", () => {
      expect(clientAddressFrom(headersWith("203.0.113.9"), production)).toBe("203.0.113.9");
    });

    it("trustedProxyHops: 2 → the element before the last one", () => {
      expect(
        clientAddressFrom(headersWith("198.51.100.7, 203.0.113.9, 10.0.0.1"), {
          trustedProxyHops: 2,
          production: true,
        }),
      ).toBe("203.0.113.9");
    });
  });

  describe("normalization", () => {
    it("criterion 8: IPv4-mapped IPv6 → the IPv4 address", () => {
      expect(clientAddressFrom(headersWith("::ffff:203.0.113.9"), production)).toBe("203.0.113.9");
    });

    it.each([
      ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::"],
      ["2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2::"],
      ["2001:db8::1", "2001:db8::"],
      ["2001:DB8::1", "2001:db8::"],
      ["fe80::1%eth0", "fe80::"],
    ])("criterion 8: IPv6 %s → canonical /64 prefix %s (zone removed)", (address, expected) => {
      expect(clientAddressFrom(headersWith(address), production)).toBe(expected);
    });

    it("keeps a plain IPv4 address as is", () => {
      expect(clientAddressFrom(headersWith("203.0.113.9"), development)).toBe("203.0.113.9");
    });
  });

  describe("absent or invalid header", () => {
    it.each(INVALID_OR_ABSENT)("criterion 8: %j → 'unknown' in production", (forwardedFor) => {
      expect(clientAddressFrom(headersWith(forwardedFor), production)).toBe("unknown");
    });

    it.each(INVALID_OR_ABSENT)("criterion 8: %j → '127.0.0.1' outside production", (forwardedFor) => {
      expect(clientAddressFrom(headersWith(forwardedFor), development)).toBe("127.0.0.1");
    });
  });

  it("is pure: the same headers give the same address and the headers are left untouched", () => {
    const headers = headersWith("198.51.100.7, 203.0.113.9");

    expect(clientAddressFrom(headers, production)).toBe(clientAddressFrom(headers, production));
    expect(headers.get("x-forwarded-for")).toBe("198.51.100.7, 203.0.113.9");
  });
});
