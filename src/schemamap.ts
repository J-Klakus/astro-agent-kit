import { escapeXml } from "./utils.js";

/**
 * Render a schemamap in the NLWeb sitemap shape:
 * https://github.com/nlweb-ai/NLWeb/blob/main/docs/schemamap.md
 */
export function renderSchemamap(feedUrl: string, lastmod?: string): string {
  const lastmodLine = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1">
  <url>
    <loc>${escapeXml(feedUrl)}</loc>${lastmodLine}
    <sf:contentType>structuredData/schema.org</sf:contentType>
  </url>
</urlset>
`;
}
