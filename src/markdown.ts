/**
 * Markdown alternates.
 *
 * This API and the `X-Markdown-Tokens` convention are adapted from
 * @jdevalk/astro-seo-graph (https://github.com/jdevalk/astro-seo-graph).
 * The implementation here is independent and dependency-free, but the
 * `createMarkdownEndpoint` / `renderMarkdownAlternate` shape and the
 * frontmatter/header behavior deliberately follow that project.
 */
import type { APIRoute } from "astro";
import { toIsoDate } from "./utils.js";

export interface MarkdownFrontmatter {
  title?: string;
  canonical?: string;
  description?: string;
  pubDate?: string | Date;
  updatedDate?: string | Date;
  author?: string;
  tags?: string[];
  categories?: string[];
  [key: string]: unknown;
}

export interface MarkdownAlternateInput {
  frontmatter: MarkdownFrontmatter;
  /** Markdown body, kept byte-for-byte. */
  body: string;
}

export interface RenderMarkdownOptions {
  /** Defaults to `Math.ceil(markdown.length / 4)`. */
  estimateTokens?: (markdown: string) => number;
}

export interface RenderedMarkdown {
  markdown: string;
  tokenCount: number;
  canonicalHref?: string;
}

export interface MarkdownEndpointContext<TProps> {
  props: TProps;
  params: Record<string, string | undefined>;
  canonical?: string;
}

export interface CreateMarkdownEndpointOptions<TProps = Record<string, never>> {
  /**
   * Map the `props` supplied by your `getStaticPaths` to frontmatter + body.
   * Return `null` to emit a 404 for that entry.
   */
  map: (
    props: TProps,
    params: Record<string, string | undefined>,
  ) =>
    | MarkdownAlternateInput
    | null
    | undefined
    | Promise<MarkdownAlternateInput | null | undefined>;
  /** Defaults to `public, max-age=300`. */
  cacheControl?: string;
  /** Extra response headers, static or derived from the request. */
  extraHeaders?:
    | Record<string, string>
    | ((context: MarkdownEndpointContext<TProps>) => Record<string, string>);
  /** Defaults to `Math.ceil(markdown.length / 4)`. */
  estimateTokens?: (markdown: string) => number;
}

const FRONTMATTER_ORDER = [
  "title",
  "canonical",
  "description",
  "pubDate",
  "updatedDate",
  "author",
  "tags",
  "categories",
];

/**
 * Render `---` frontmatter plus the untouched body. Frontmatter keys are
 * ordered for stable diffs; unknown keys follow in insertion order.
 */
export function renderMarkdownAlternate(
  input: MarkdownAlternateInput,
  options: RenderMarkdownOptions = {},
): RenderedMarkdown {
  const yaml = renderFrontmatter(input.frontmatter);
  const markdown = yaml ? `---\n${yaml}\n---\n\n${input.body}` : input.body;
  const estimate = options.estimateTokens ?? ((value) => Math.ceil(value.length / 4));
  const canonical = input.frontmatter.canonical;

  return {
    markdown,
    tokenCount: estimate(markdown),
    canonicalHref: typeof canonical === "string" && canonical ? canonical : undefined,
  };
}

export function renderFrontmatter(frontmatter: MarkdownFrontmatter): string {
  const known = FRONTMATTER_ORDER.filter(
    (key) => frontmatter[key] !== undefined && frontmatter[key] !== null,
  );
  const extra = Object.keys(frontmatter).filter(
    (key) => !FRONTMATTER_ORDER.includes(key),
  );
  const lines: string[] = [];

  for (const key of [...known, ...extra]) {
    const serialized = serializeValue(frontmatter[key]);
    if (serialized !== undefined) lines.push(`${key}: ${serialized}`);
  }

  return lines.join("\n");
}

/**
 * Create a GET endpoint for a `.md` route. The caller owns the filename and
 * `getStaticPaths`; this only renders the response.
 *
 * @example
 * export const GET = createMarkdownEndpoint({
 *   map: ({ post }) => ({
 *     frontmatter: { title: post.data.title, canonical: post.data.canonical },
 *     body: post.body ?? "",
 *   }),
 * });
 */
export function createMarkdownEndpoint<TProps = Record<string, never>>(
  options: CreateMarkdownEndpointOptions<TProps>,
): APIRoute {
  return async ({ props, params }) => {
    const typedProps = (props ?? {}) as TProps;
    const input = await options.map(typedProps, params);
    if (!input) {
      return new Response("Not Found\n", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const rendered = renderMarkdownAlternate(input, {
      estimateTokens: options.estimateTokens,
    });
    const headers = new Headers({
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": options.cacheControl ?? "public, max-age=300",
      "X-Robots-Tag": "noindex, follow",
      "X-Markdown-Tokens": String(rendered.tokenCount),
    });

    if (rendered.canonicalHref) {
      headers.set("Link", `<${rendered.canonicalHref}>; rel="canonical"`);
    }

    const extra =
      typeof options.extraHeaders === "function"
        ? options.extraHeaders({
            props: typedProps,
            params,
            canonical: rendered.canonicalHref,
          })
        : options.extraHeaders;
    for (const [key, value] of Object.entries(extra ?? {})) {
      headers.set(key, value);
    }

    return new Response(rendered.markdown, { status: 200, headers });
  };
}

function serializeValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return serializeScalar(toIsoDate(value));
  if (Array.isArray(value)) {
    const items = value
      .map((item) => serializeScalar(item))
      .filter((item): item is string => item !== undefined);
    return `[${items.join(", ")}]`;
  }
  return serializeScalar(value);
}

function serializeScalar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return serializeScalar(toIsoDate(value));
  if (typeof value === "string") {
    if (value === "") return '""';
    return needsQuotes(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function needsQuotes(value: string): boolean {
  if (value !== value.trim()) return true;
  if (/[\[\]{}#"'&*!|>%@`,:]/.test(value)) return true;
  if (value.includes(" #")) return true;
  if (value.startsWith("-") || value.startsWith("?") || value.startsWith(":")) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^[+-]?(?:\d|\.\d)/.test(value)) return true;
  return false;
}
