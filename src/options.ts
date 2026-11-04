import type {
  AgentKitOptions,
  IndexNowOptions,
  MarkdownAlternateOptions,
  ResolvedConfig,
  ResolvedIndexNow,
  ResolvedLlms,
  ResolvedMarkdown,
  ResolvedRobots,
  ResolvedSchema,
  ResolvedSchemamap,
} from "./types.js";
import { normalizeFileRoute, normalizeRoute } from "./utils.js";

const DEFAULT_LLMS = {
  path: "/llms.txt",
  descriptions: true,
  groups: true as const,
};

const DEFAULT_SCHEMA = { path: "/schema", name: "pages" };
const DEFAULT_SCHEMAMAP = { path: "/schemamap.xml", lastmod: true };
const DEFAULT_ROBOTS = { path: "/robots.txt", create: true };
const DEFAULT_MARKDOWN = {
  link: true,
  headers: true,
  index: true,
  cacheControl: "public, max-age=300",
};

export function resolveOptions(options: AgentKitOptions = {}): ResolvedConfig {
  const site = options.site ? new URL(options.site) : null;
  if (site && site.protocol !== "http:" && site.protocol !== "https:") {
    throw new Error("[astro-agent-kit] site must be an http(s) URL");
  }

  return {
    site,
    root: "",
    output: "static",
    llmsTxt: resolveLlms(options.llmsTxt),
    schema: resolveSchema(options.schema),
    schemamap: resolveSchemamap(options.schemamap),
    robots: resolveRobots(options.robots),
    markdownAlternate: resolveMarkdown(options.markdownAlternate),
    indexnow: resolveIndexNow(options.indexnow),
  };
}

/** Any surface requires absolute URLs, so `site` is mandatory unless all are off. */
export function needsSite(config: ResolvedConfig): boolean {
  return Boolean(
    config.llmsTxt ||
      config.schema ||
      config.schemamap ||
      config.robots ||
      config.markdownAlternate ||
      config.indexnow,
  );
}

function resolveLlms(value: AgentKitOptions["llmsTxt"]): ResolvedLlms | false {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  const groups = options.groups ?? DEFAULT_LLMS.groups;
  return {
    ...options,
    path: normalizeFileRoute(options.path ?? DEFAULT_LLMS.path, "llmsTxt.path"),
    descriptions: options.descriptions ?? DEFAULT_LLMS.descriptions,
    groups,
  };
}

function resolveSchema(value: AgentKitOptions["schema"]): ResolvedSchema | false {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  const name = options.name ?? DEFAULT_SCHEMA.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new Error(
      `[astro-agent-kit] schema.name must be a bare filename (got "${name}")`,
    );
  }
  return {
    path: normalizeRoute(options.path ?? DEFAULT_SCHEMA.path, "schema.path"),
    name,
  };
}

function resolveSchemamap(value: AgentKitOptions["schemamap"]): ResolvedSchemamap | false {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  return {
    path: normalizeFileRoute(options.path ?? DEFAULT_SCHEMAMAP.path, "schemamap.path"),
    lastmod: options.lastmod ?? DEFAULT_SCHEMAMAP.lastmod,
  };
}

function resolveRobots(value: AgentKitOptions["robots"]): ResolvedRobots | false {
  if (value === false) return false;
  const options = value === true || value === undefined ? {} : value;
  return {
    path: normalizeFileRoute(options.path ?? DEFAULT_ROBOTS.path, "robots.path"),
    create: options.create ?? DEFAULT_ROBOTS.create,
  };
}

function resolveMarkdown(
  value: AgentKitOptions["markdownAlternate"],
): ResolvedMarkdown | false {
  if (value === false || value === undefined) return false;
  const options: MarkdownAlternateOptions = value === true ? {} : value;
  return {
    link: options.link ?? DEFAULT_MARKDOWN.link,
    headers: options.headers ?? DEFAULT_MARKDOWN.headers,
    index: options.index ?? DEFAULT_MARKDOWN.index,
    cacheControl: options.cacheControl ?? DEFAULT_MARKDOWN.cacheControl,
  };
}

function resolveIndexNow(value: AgentKitOptions["indexnow"]): ResolvedIndexNow | false {
  if (!value) return false;
  const options: IndexNowOptions = value;
  // Missing key is a no-op so `key: process.env.INDEXNOW_KEY` on a local build
  // does not fail the build; the integration warns once.
  if (!options.key) return false;
  validateKey(options.key);
  const host = options.host?.trim();
  if (host && !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    throw new Error(
      `[astro-agent-kit] indexnow.host must be a hostname without a scheme (got "${host}")`,
    );
  }
  const endpoint = options.endpoint ?? "https://api.indexnow.org/indexnow";
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") {
    throw new Error("[astro-agent-kit] indexnow.endpoint must be an http(s) URL");
  }
  return {
    key: options.key,
    host,
    keyFile: normalizeFileRoute(options.keyFile ?? `/${options.key}.txt`, "indexnow.keyFile"),
    endpoint,
    sendKeyLocation: options.sendKeyLocation ?? false,
  };
}

export function validateKey(key: string): void {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    throw new Error(
      "[astro-agent-kit] IndexNow keys are 8–128 characters of A-Z, a-z, 0-9, or hyphen",
    );
  }
}
