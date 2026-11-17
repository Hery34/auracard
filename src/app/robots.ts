import type { MetadataRoute } from "next";

/** `/v/` serves vCards: rate-limited and never meant for crawlers (0018, decision 10). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/v/" } };
}
