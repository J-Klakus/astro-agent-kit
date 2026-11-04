/** A schema.org JSON-LD node, kept loose: the package does not validate vocabularies. */
export type JsonLdNode = Record<string, unknown>;

/** One prerendered HTML page discovered at build time. */
export interface ScannedPage {
  /** Absolute canonical URL when available, otherwise `site` + `path`. */
  url: string;
  /** Route path, e.g. `/`, `/about/`, `/feed.xml` never appears here. */
  path: string;
  /** Absolute path of the built HTML file. */
  file: string;
  title?: string;
  description?: string;
  canonical?: string;
  noindex: boolean;
  /** `YYYY-MM-DD` from article metadata, when present. */
  lastmod?: string;
  /** Content signature used by `--changed` IndexNow submissions. */
  hash: string;
  jsonLd: JsonLdNode[];
}

export interface ScanResult {
  pages: ScannedPage[];
  warnings: string[];
  siteName?: string;
}

export interface AgentKitOptions {
  /**
   * Site origin, e.g. `https://example.com`. Defaults to Astro's `site`.
   * Required whenever any feature is enabled.
   */
  site?: string | URL;
  /** `/llms.txt`. Defaults to on. Set `false` to manage it yourself. */
  llmsTxt?: boolean | LlmsTxtOptions;
  /** `/schema/pages.json` + `/schema/pages.jsonl`. Defaults to on. */
  schema?: boolean | SchemaOptions;
  /** `/schemamap.xml`. Defaults to on when a schema feed exists. */
  schemamap?: boolean | SchemamapOptions;
  /** Append `Schemamap:` to `/robots.txt`. Defaults to on. */
  robots?: boolean | RobotsOptions;
  /** Markdown alternates: head links and `_headers` entries. Defaults to off. */
  markdownAlternate?: boolean | MarkdownAlternateOptions;
  /** IndexNow key file + build manifest for `astro-agent indexnow`. Off by default. */
  indexnow?: false | IndexNowOptions;
}

export interface LlmsTxtOptions {
  /** Route path. Defaults to `/llms.txt`. */
  path?: string;
  /** H1 title. Defaults to `og:site_name`, then the hostname. */
  title?: string;
  /** Blockquote summary. Defaults to the homepage description. */
  summary?: string;
  /** Optional paragraph(s) after the summary. */
  details?: string;
  /** Include `: description` on each link. Defaults to true. */
  descriptions?: boolean;
  /**
   * `true` groups by first path segment, `false` renders one flat list, a
   * record renames group keys, a function returns the label for a page.
   */
  groups?: boolean | Record<string, string> | ((page: ScannedPage) => string);
}

export interface SchemaOptions {
  /** Route directory. Defaults to `/schema`. */
  path?: string;
  /** Feed name without extension. Defaults to `pages`. */
  name?: string;
}

export interface SchemamapOptions {
  /** Route path. Defaults to `/schemamap.xml`. */
  path?: string;
  /** Emit `<lastmod>`. Defaults to true. */
  lastmod?: boolean;
}

export interface RobotsOptions {
  /** Route path. Defaults to `/robots.txt`. */
  path?: string;
  /** Create the file when it does not exist. Defaults to true. */
  create?: boolean;
}

export interface IndexNowOptions {
  /** 8–128 characters, `[A-Za-z0-9-]`. */
  key: string;
  /** Hostname only, no scheme. Defaults to the site host. */
  host?: string;
  /** Key file route. Defaults to `/<key>.txt`. */
  keyFile?: string;
  /** Submission endpoint. Defaults to `https://api.indexnow.org/indexnow`. */
  endpoint?: string;
  /**
   * Include `keyLocation` in the payload. Defaults to false: the root key
   * file is preferred and some endpoints reject the field.
   */
  sendKeyLocation?: boolean;
}

export interface MarkdownAlternateOptions {
  /** Inject `<link rel="alternate" type="text/markdown">` where a `.md` exists. Defaults to true. */
  link?: boolean;
  /** Write `_headers` rules with `X-Markdown-Tokens`. Defaults to true. */
  headers?: boolean;
  /** Generate `/index.md` when the build has none. Defaults to true. */
  index?: boolean;
  /** `Cache-Control` for `.md` responses. Defaults to `public, max-age=300`. */
  cacheControl?: string;
}

export interface ResolvedLlms extends LlmsTxtOptions {
  path: string;
  descriptions: boolean;
  groups: NonNullable<LlmsTxtOptions["groups"]>;
}

export interface ResolvedSchema {
  path: string;
  name: string;
}

export interface ResolvedSchemamap {
  path: string;
  lastmod: boolean;
}

export interface ResolvedRobots {
  path: string;
  create: boolean;
}

export interface ResolvedIndexNow {
  key: string;
  host?: string;
  keyFile: string;
  endpoint: string;
  sendKeyLocation: boolean;
}

export interface ResolvedMarkdown {
  link: boolean;
  headers: boolean;
  index: boolean;
  cacheControl: string;
}

export interface ResolvedConfig {
  site: URL | null;
  root: string;
  output: string;
  llmsTxt: ResolvedLlms | false;
  schema: ResolvedSchema | false;
  schemamap: ResolvedSchemamap | false;
  robots: ResolvedRobots | false;
  markdownAlternate: ResolvedMarkdown | false;
  indexnow: ResolvedIndexNow | false;
}
