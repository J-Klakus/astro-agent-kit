import { readFile, writeFile } from "node:fs/promises";
import type { ScannedPage } from "./types.js";
import { escapeHtml } from "./utils.js";

export interface HeadLinkOptions {
  /** Route path of the schemamap, e.g. `/schemamap.xml`. */
  schemamapPath?: string;
  /** Route path (`/about/`) -> markdown href (`/about.md`). */
  markdownByPath: Map<string, string>;
}

/** Add discovery links to built HTML, idempotently. */
export async function injectHeadLinks(
  pages: ScannedPage[],
  options: HeadLinkOptions,
): Promise<number> {
  let changed = 0;

  for (const page of pages) {
    const html = await readFile(page.file, "utf8");
    const tags: string[] = [];

    if (options.schemamapPath && !/rel=["']schemamap["']/i.test(html)) {
      tags.push(
        `<link rel="schemamap" type="application/xml" href="${escapeHtml(
          options.schemamapPath,
        )}" title="Schemamap">`,
      );
    }

    const markdownHref = options.markdownByPath.get(page.path);
    if (
      markdownHref &&
      !(
        /rel=["']alternate["']/i.test(html) &&
        /type=["']text\/markdown["']/i.test(html)
      )
    ) {
      tags.push(
        `<link rel="alternate" type="text/markdown" href="${escapeHtml(
          markdownHref,
        )}" title="Markdown">`,
      );
    }

    if (tags.length === 0) continue;
    if (!/<\/head>/i.test(html)) continue;

    const injected = html.replace(/<\/head>/i, `  ${tags.join("\n  ")}\n</head>`);
    await writeFile(page.file, injected);
    changed += 1;
  }

  return changed;
}
