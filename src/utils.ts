import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the handful of entities Astro emits in `<title>` and meta content. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

/** Reject traversal and query strings before turning a route into a file path. */
export function normalizeRoute(value: string, label: string): string {
  if (!value.startsWith("/")) {
    throw new Error(`[astro-agent-kit] ${label} must start with "/" (got "${value}")`);
  }
  if (value.includes("..") || value.includes("?") || value.includes("#")) {
    throw new Error(`[astro-agent-kit] ${label} must be a clean path (got "${value}")`);
  }
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function normalizeFileRoute(value: string, label: string): string {
  const route = normalizeRoute(value, label);
  if (route === "/") {
    throw new Error(`[astro-agent-kit] ${label} must name a file, not "/"`);
  }
  return route;
}

export function routeToFile(root: string, route: string): string {
  return join(root, route.replace(/^\/+/, ""));
}

export async function writeRoute(root: string, route: string, content: string): Promise<string> {
  const file = routeToFile(root, route);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function toIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toDay(value: unknown): string | undefined {
  return toIsoDate(value)?.slice(0, 10);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Strip tags/scripts/styles so a hash tracks content, not asset hashes. */
export function contentSignature(html: string, fields: Array<string | undefined>): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const text = decodeEntities(
    body
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
  return [...fields.filter((field): field is string => Boolean(field)), collapse(text)].join("\n");
}
