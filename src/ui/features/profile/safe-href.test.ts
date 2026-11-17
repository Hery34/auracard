import { describe, expect, it } from "vitest";

import { safeHttpsHref } from "@/ui/features/profile/safe-href";

describe("safeHttpsHref — revalidation of stored URLs at display time (0018, decision 8)", () => {
  it("keeps an https URL with its normalized href and ASCII host", () => {
    expect(safeHttpsHref("HTTPS://Www.Example.COM/Path?q=1#top")).toEqual({
      href: "https://www.example.com/Path?q=1#top",
      host: "www.example.com",
    });
  });

  it("adds the trailing slash of an empty path", () => {
    expect(safeHttpsHref("https://example.com")).toEqual({ href: "https://example.com/", host: "example.com" });
  });

  it("shows an internationalized host name in punycode", () => {
    expect(safeHttpsHref("https://café.example/menu")).toEqual({
      href: "https://xn--caf-dma.example/menu",
      host: "xn--caf-dma.example",
    });
  });

  it("returns null for a missing value", () => {
    expect(safeHttpsHref(null)).toBeNull();
  });

  it.each([
    ["javascript: scheme", "javascript:alert(1)"],
    ["javascript: scheme, mixed case", "JaVaScRiPt:alert(document.cookie)"],
    ["data: scheme", "data:text/html,<script>alert(1)</script>"],
    ["http: scheme", "http://example.com/"],
    ["relative path", "/profil/elodie"],
    ["relative name", "example.com/page"],
    ["protocol-relative URL", "//example.com/page"],
    ["user name", "https://user@example.com/"],
    ["user name and password", "https://user:secret@example.com/"],
    ["space inside", "https://exa mple.com/"],
    ["leading space", " https://example.com/"],
    ["tab", "https://example.com/\tpage"],
    ["line feed", "https://example.com/\npage"],
    ["NUL control character", "https://example.com/\u0000"],
    ["DEL control character", "https://example.com/\u007f"],
    ["IPv4 host", "https://192.168.1.10/"],
    ["IPv4 host as a single integer", "https://3232235786/"],
    ["host without a dot", "https://localhost/"],
    ["empty string", ""],
  ])("returns null for %s", (_case, value) => {
    expect(safeHttpsHref(value)).toBeNull();
  });
});
