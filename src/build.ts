import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { AstroIntegrationLogger } from "astro";
import { injectHeadLinks } from "./head.js";
import { writeMarkdownHeaders } from "./headers.js";
import {
  buildIndexNowManifest,
  writeIndexNowKey,
  writeIndexNowManifest,
} from "./indexnow.js";
import { renderLlmsTxt } from "./llms.js";
import { ensureSchemamap } from "./robots.js";
import { scanSite } from "./scan.js";
import { renderSchema, type SchemaFeed } from "./schema.js";
import { renderSchemamap } from "./schemamap.js";
import type { ResolvedConfig, ScannedPage } from "./types.js";
import { routeToFile, toDay, writeRoute } from "./utils.js";

const SKIP_DIRS = new Set(["_astro", "node_modules", ".git", ".wrangler"]);

export interface BuildSummary {
  pages: number;
  publicPages: number;
  schemaNodes: number;
  markdownFiles: number;
  warnings: number;
}

/**
 * Generate every enabled surface from the built HTML. Runs in
 * `astro:build:done`, so routes and markdown endpoints already exist on disk.
 */
export async function runBuild(
  config: ResolvedConfig,
  outputDir: string,
  logger: AstroIntegrationLogger,
): Promise<BuildSummary> {
  const site = config.site;
  if (!site) throw new Error("[astro-agent-kit] site is required");

  const scan = await scanSite(outputDir, site);
  for (const warning of scan.warnings) logger.warn(warning);

  if (scan.pages.length === 0) {
    logger.warn(
      "no prerendered HTML found; agent surfaces need a static build (run `astro build`)",
    );
    return {
      pages: 0,
      publicPages: 0,
      schemaNodes: 0,
      markdownFiles: 0,
      warnings: scan.warnings.length,
    };
  }

  const publicPages = scan.pages.filter((page) => !page.noindex);
  let schemaFeed: SchemaFeed | null = null;

  if (config.schema) {
    schemaFeed = renderSchema(publicPages);
    if (!schemaFeed) {
      logger.warn("no JSON-LD found in built pages; skipping the schema feed and schemamap");
    }
  }

  if (config.llmsTxt) {
    const text = renderLlmsTxt(publicPages, config.llmsTxt, site, scan.siteName);
    await writeRoute(outputDir, config.llmsTxt.path, text);
    logger.info(`wrote ${config.llmsTxt.path} (${publicPages.length} pages)`);
  }

  if (config.schema && schemaFeed) {
    const base = `${config.schema.path}/${config.schema.name}`;
    await writeRoute(outputDir, `${base}.json`, schemaFeed.json);
    await writeRoute(outputDir, `${base}.jsonl`, schemaFeed.jsonl);
    logger.info(
      `wrote ${base}.json and ${base}.jsonl (${schemaFeed.nodes.length} JSON-LD nodes)`,
    );
  }

  let schemamapPath: string | undefined;
  if (config.schemamap && config.schema && schemaFeed) {
    const feedUrl = new URL(
      `${config.schema.path}/${config.schema.name}.jsonl`,
      site,
    ).href;
    const lastmod = config.schemamap.lastmod ? toDay(new Date()) : undefined;
    await writeRoute(
      outputDir,
      config.schemamap.path,
      renderSchemamap(feedUrl, lastmod),
    );
    schemamapPath = config.schemamap.path;
    logger.info(`wrote ${config.schemamap.path}`);

    if (config.robots) {
      await addSchemamapToRobots(
        outputDir,
        config,
        new URL(config.schemamap.path, site).href,
        logger,
      );
    }
  } else if (config.schemamap && !config.schema) {
    logger.warn("schemamap is enabled but schema is off; nothing to list");
  }

  if (config.indexnow) {
    await writeIndexNowKey(outputDir, config.indexnow.keyFile, config.indexnow.key);
    const { manifest, skipped } = buildIndexNowManifest(
      scan.pages,
      site,
      config.indexnow,
    );
    await writeIndexNowManifest(config.root, manifest);
    logger.info(
      `wrote ${config.indexnow.keyFile} and an IndexNow manifest with ${manifest.urls.length} URLs${
        skipped ? ` (${skipped} skipped)` : ""
      }`,
    );
    if (manifest.urls.length === 0) {
      logger.warn("the IndexNow manifest is empty");
    }
  }

  let markdownFiles: string[] = [];
  if (config.markdownAlternate) {
    markdownFiles = await collectMarkdown(outputDir);
    if (
      config.markdownAlternate.index &&
      !markdownFiles.some(
        (file) => relative(outputDir, file).split(sep).join("/") === "index.md",
      )
    ) {
      const indexPath = join(outputDir, "index.md");
      await writeFile(indexPath, renderMarkdownIndex(publicPages, site, scan.siteName));
      markdownFiles.push(indexPath);
      logger.info("wrote /index.md");
    }
    markdownFiles.sort();

    if (markdownFiles.length === 0) {
      logger.warn(
        "markdownAlternate is on but no .md files were built; add createMarkdownEndpoint() routes",
      );
    } else {
      const markdownByPath = new Map<string, string>();
      for (const file of markdownFiles) {
        const route = `/${relative(outputDir, file).split(sep).join("/")}`;
        markdownByPath.set(pagePathForMarkdown(route), route);
      }

      if (config.markdownAlternate.link) {
        const changed = await injectHeadLinks(scan.pages, {
          schemamapPath,
          markdownByPath,
        });
        if (changed > 0) {
          logger.info(`added discovery links to ${changed} pages`);
        }
      }

      if (config.markdownAlternate.headers) {
        const rules = await writeMarkdownHeaders(
          outputDir,
          markdownFiles,
          config.markdownAlternate.cacheControl,
        );
        if (rules > 0) {
          logger.info(`wrote ${rules} markdown rules to _headers`);
        }
      }
    }
  }

  return {
    pages: scan.pages.length,
    publicPages: publicPages.length,
    schemaNodes: schemaFeed?.nodes.length ?? 0,
    markdownFiles: markdownFiles.length,
    warnings: scan.warnings.length,
  };
}

async function addSchemamapToRobots(
  outputDir: string,
  config: ResolvedConfig,
  url: string,
  logger: AstroIntegrationLogger,
): Promise<void> {
  if (!config.robots) return;
  const robotsFile = routeToFile(outputDir, config.robots.path);
  let existing: string | null = null;
  try {
    existing = await readFile(robotsFile, "utf8");
  } catch {
    // handled by ensureSchemamap
  }

  const patch = ensureSchemamap(existing, url, config.robots.create);
  if (!patch?.changed) return;

  await writeRoute(outputDir, config.robots.path, patch.text);
  logger.info(`added a Schemamap directive to ${config.robots.path}`);
}

async function collectMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
      } else if (entry.isFile() && basename(entry.name).endsWith(".md")) {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out.sort();
}

/** `/blog/hello.md` -> `/blog/hello/`; `/index.md` -> `/`. */
function pagePathForMarkdown(route: string): string {
  if (route === "/index.md") return "/";
  if (route.endsWith("/index.md")) {
    return route.slice(0, -"index.md".length);
  }
  return route.replace(/\.md$/, "/");
}

function renderMarkdownIndex(
  pages: ScannedPage[],
  site: URL,
  siteName?: string,
): string {
  const lines = [`# ${siteName ?? site.hostname}`, ""];
  for (const page of pages) {
    const title = (page.title ?? page.path).replace(/\\/g, "\\\\").replace(/([[\]])/g, "\\$1");
    lines.push(`- [${title}](${page.url})`);
  }
  return `${lines.join("\n")}\n`;
}
