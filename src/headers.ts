import { readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Write `_headers` rules for markdown alternates. Cloudflare Workers static
 * assets (and Pages / Netlify) apply these, so static `.md` files keep the
 * same headers the endpoint sets in dev.
 */
export async function writeMarkdownHeaders(
  outputDir: string,
  mdFiles: string[],
  cacheControl: string,
): Promise<number> {
  if (mdFiles.length === 0) return 0;

  const headersPath = join(outputDir, "_headers");
  let existing = "";
  try {
    existing = await readFile(headersPath, "utf8");
  } catch {
    // first write
  }

  const blocks: string[] = [];
  for (const file of mdFiles) {
    const route = `/${relative(outputDir, file).split(sep).join("/")}`;
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^\\s*${escaped}\\s*$`, "m").test(existing)) continue;

    const markdown = await readFile(file, "utf8");
    const tokens = Math.ceil(markdown.length / 4);
    blocks.push(
      [
        route,
        "  Content-Type: text/markdown; charset=utf-8",
        "  X-Robots-Tag: noindex, follow",
        `  X-Markdown-Tokens: ${tokens}`,
        `  Cache-Control: ${cacheControl}`,
      ].join("\n"),
    );
  }

  if (blocks.length === 0) return 0;

  const base = existing.trimEnd();
  const next = `${base}${base ? "\n\n" : ""}${blocks.join("\n\n")}\n`;
  await writeFile(headersPath, next);
  return blocks.length;
}
