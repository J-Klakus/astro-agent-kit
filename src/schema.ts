import type { JsonLdNode, ScannedPage } from "./types.js";
import { isObject, stableStringify } from "./utils.js";

export interface SchemaFeed {
  nodes: JsonLdNode[];
  json: string;
  jsonl: string;
}

/**
 * Aggregate every page's JSON-LD into one graph.
 *
 * Nodes are deduplicated by `@id` (falling back to a stable serialization), so
 * the site-wide Organization emitted on several pages appears once.
 */
export function renderSchema(pages: ScannedPage[]): SchemaFeed | null {
  const nodes: JsonLdNode[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const node of page.jsonLd) {
      if (!isObject(node) || node["@type"] === undefined) continue;
      const key =
        typeof node["@id"] === "string" && node["@id"]
          ? `@id:${node["@id"]}`
          : `node:${stableStringify(node)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(node);
    }
  }

  if (nodes.length === 0) return null;

  const json = `${JSON.stringify(
    { "@context": "https://schema.org", "@graph": nodes },
    null,
    2,
  )}\n`;

  const jsonl = `${nodes
    .map((node) =>
      JSON.stringify(
        node["@context"] === undefined
          ? { "@context": "https://schema.org", ...node }
          : node,
      ),
    )
    .join("\n")}\n`;

  return { nodes, json, jsonl };
}
