import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/lib/site-url";

// PUBLIC_URL is a runtime deployment setting. Do not bake the image builder's
// hostname into the otherwise-static robots response.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/"]
      }
    ],
    sitemap: absoluteSiteUrl("/sitemap.xml")
  };
}
