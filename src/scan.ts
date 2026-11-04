import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonLdNode, ScanResult, ScannedPage } from "./types.js";
import {
  collapse,
  contentSignature,
  decodeEntities,
  hashContent,
  isObject,
  toDay,
} from "./utils.js";

const SKIP_DIRS = new Set(["_astro", "node_modules", ".git", ".wrangler"]);

export async function resolveOutputDir(dir: URL): Promise<string | null> {
  const base = fileURLToPath(dir);
  const candidates = [base, join(base, "client"), join(base, "..", "client")];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const files = await collectHtml(candidate);
      if (files.length > 0) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function collectHtml(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        out.push(join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out.sort();
}

export async function scanSite(root: string, site: URL): Promise<ScanResult> {
  const files = await collectHtml(root);
  const pages: ScannedPage[] = [];
  const warnings: string[] = [];
  let siteName: string | undefined;

  for (const file of files) {
    const name = basename(file);
    if (name === "404.html" || name === "500.html") continue;
    const html = await readFile(file, "utf8");
    const rel = relative(root, file).split(sep).join("/");
    const parsed = parsePage(html, rel, file, site, warnings);
    if (!parsed) continue;
    pages.push(parsed.page);
    siteName ??= parsed.siteName;
  }

  pages.sort(comparePages);
  return { pages, warnings, siteName };
}

function comparePages(a: ScannedPage, b: ScannedPage): number {
  if (a.path === "/") return b.path === "/" ? 0 : -1;
  if (b.path === "/") return 1;
  return a.path.localeCompare(b.path);
}

function parsePage(
  html: string,
  rel: string,
  file: string,
  site: URL,
  warnings: string[],
): { page: ScannedPage; siteName?: string } | null {
  const path = routePath(rel);
  const title = pageTitle(html);
  const description = pageDescription(html);
  const noindex = isNoindex(html);
  const canonical = canonicalUrl(html, site);
  const jsonLd = jsonLdNodes(html, rel, warnings);
  const lastmod = pageLastmod(html, jsonLd);
  const url = canonical ?? new URL(path, site).href;
  const siteName = metaContent(html, "property", "og:site_name");

  return {
    page: {
      url,
      path,
      file,
      title,
      description,
      canonical,
      noindex,
      lastmod,
      hash: hashContent(
        contentSignature(html, [title, description, canonical, JSON.stringify(jsonLd)]),
      ),
      jsonLd,
    },
    siteName,
  };
}

function routePath(rel: string): string {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

function pageTitle(html: string): string | undefined {
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = raw
    ? collapse(decodeEntities(raw.replace(/<[^>]+>/g, "")))
    : undefined;
  return title || metaContent(html, "property", "og:title");
}

function pageDescription(html: string): string | undefined {
  return (
    metaContent(html, "name", "description") ??
    metaContent(html, "property", "og:description") ??
    metaContent(html, "name", "twitter:description")
  );
}

function isNoindex(html: string): boolean {
  for (const name of ["robots", "googlebot"]) {
    const content = metaContent(html, "name", name);
    if (content && /\b(noindex|none)\b/i.test(content)) return true;
  }
  return false;
}

function canonicalUrl(html: string, site: URL): string | undefined {
  const href = linkHref(html, "canonical");
  if (!href) return undefined;
  try {
    return new URL(href, site).href;
  } catch {
    return undefined;
  }
}

function pageLastmod(html: string, jsonLd: JsonLdNode[]): string | undefined {
  const meta =
    metaContent(html, "property", "article:modified_time") ??
    metaContent(html, "property", "og:updated_time") ??
    metaContent(html, "property", "article:published_time");
  const fromMeta = toDay(meta);
  if (fromMeta) return fromMeta;

  for (const node of jsonLd) {
    const value = node.dateModified ?? node.datePublished;
    const day = toDay(value);
    if (day) return day;
  }
  return undefined;
}

function jsonLdNodes(html: string, rel: string, warnings: string[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re =
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      for (const node of flattenJsonLd(parsed)) {
        if (!isObject(node)) continue;
        const type = node["@type"];
        if (typeof type === "string" || Array.isArray(type)) nodes.push(node);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`JSON-LD parse failed in ${rel}: ${message}`);
    }
  }
  return nodes;
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (isObject(value) && Array.isArray(value["@graph"])) {
    return value["@graph"].flatMap(flattenJsonLd);
  }
  return [value];
}

export function metaContent(
  html: string,
  attr: "name" | "property",
  value: string,
): string | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${escaped}["'][^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    const content = match[0].match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content !== undefined) return collapse(decodeEntities(content));
  }
  return undefined;
}

function linkHref(html: string, rel: string): string | undefined {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<link\\b[^>]*\\brel=["']${escaped}["'][^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    const href = match[0].match(/\bhref=["']([^"']*)["']/i)?.[1];
    if (href !== undefined) return decodeEntities(href);
  }
  return undefined;
}
