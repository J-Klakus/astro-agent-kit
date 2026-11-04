import type { ResolvedLlms, ScannedPage } from "./types.js";

/**
 * Render the llms.txt format: an H1, a blockquote summary, optional details,
 * and link lists under H2 sections.
 *
 * https://llmstxt.org/
 */
export function renderLlmsTxt(
  pages: ScannedPage[],
  options: ResolvedLlms,
  site: URL,
  siteName?: string,
): string {
  const title = options.title ?? siteName ?? site.hostname;
  const homepage = pages.find((page) => page.path === "/");
  const summary = options.summary ?? homepage?.description;
  const lines: string[] = [`# ${title}`, ""];

  if (summary) lines.push(`> ${collapse(summary)}`, "");
  if (options.details?.trim()) lines.push(options.details.trim(), "");

  const pagesWithLinks = pages.map((page) => ({
    page,
    line: linkLine(page, options.descriptions !== false),
  }));

  if (options.groups === false) {
    lines.push(...pagesWithLinks.map((entry) => entry.line), "");
  } else {
    const grouping = options.groups === true ? {} : options.groups;
    const groups = groupPages(pagesWithLinks, grouping);
    for (const [label, entries] of groups) {
      lines.push(`## ${label}`, "", ...entries.map((entry) => entry.line), "");
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

interface LinkEntry {
  page: ScannedPage;
  line: string;
}

function groupPages(
  entries: LinkEntry[],
  groups: Exclude<ResolvedLlms["groups"], boolean | undefined>,
): Map<string, LinkEntry[]> {
  const grouped = new Map<string, LinkEntry[]>();
  for (const entry of entries) {
    const label =
      typeof groups === "function" ? groups(entry.page) : labelFor(entry.page, groups);
    const list = grouped.get(label);
    if (list) list.push(entry);
    else grouped.set(label, [entry]);
  }

  return new Map(
    [...grouped.entries()].sort(([a], [b]) => {
      if (a === "Main") return b === "Main" ? 0 : -1;
      if (b === "Main") return 1;
      return a.localeCompare(b);
    }),
  );
}

function labelFor(page: ScannedPage, labels: Record<string, string>): string {
  if (page.path === "/") return labels.main ?? labels.Main ?? "Main";
  const segment = page.path.split("/").filter(Boolean)[0] ?? "";
  const key = segment.toLowerCase();
  return (
    labels[key] ??
    labels[segment] ??
    labels[key.charAt(0).toUpperCase() + key.slice(1)] ??
    titleCase(segment)
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function linkLine(page: ScannedPage, descriptions: boolean): string {
  const title = page.title ?? decodeURIComponent(page.path);
  const href = page.url.replace(/ /g, "%20").replace(/\)/g, "%29");
  const description = descriptions ? page.description : undefined;
  return `- [${escapeLinkText(title)}](${href})${description ? `: ${collapse(description)}` : ""}`;
}

function escapeLinkText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([[\]])/g, "\\$1");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
