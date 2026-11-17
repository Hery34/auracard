import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },
  // 2 MiB image (bucket carnet-media) + form overhead (0021).
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
};

export default nextConfig;
