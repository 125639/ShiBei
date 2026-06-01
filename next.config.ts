import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reduce CSS payload + better chunk hashing for repeat visits.
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  experimental: {
    optimizePackageImports: ["marked", "isomorphic-dompurify"]
  },
  // Cache static assets aggressively (revalidate on filename hash).
  async headers() {
    return [
      {
        source: "/uploads/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }]
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]
      }
    ];
  }
};

export default nextConfig;
