import type { MetadataRoute } from "next";
import { SITE } from "@/site";

export const dynamic = "force-static";

// Add each new public page here.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE.url}/`, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
