import type { MetadataRoute } from "next";

/** `/v/` serves vCards (0018, decision 10); `/t/`, `/q/` and `/activer/` are scan redirections (0025, decision 4). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: ["/v/", "/t/", "/q/", "/activer/"] } };
}
