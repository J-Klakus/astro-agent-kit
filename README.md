# astro-agent-kit

Agent discovery for Astro, without a manifest: `llms.txt`, site-wide schema feeds, a schemamap, IndexNow submission, and markdown alternates.

The three HTML-derived surfaces are generated from the pages Astro already built. Point the integration at your site, build, and the files appear in `dist/`:

```txt
/llms.txt
/schema/pages.json
/schema/pages.jsonl
/schemamap.xml
/robots.txt          (Schemamap: line added)
/<indexnow-key>.txt  (when IndexNow is on)
```

Markdown alternates are the one source-aware piece. They use a small route factory so you keep the real content instead of converting rendered HTML back to markdown.

> The markdown-alternate API is based on [@jdevalk/astro-seo-graph](https://github.com/jdevalk/astro-seo-graph). See [Credits](#credits).

## Install

```sh
pnpm add astro-agent-kit
```

Requires Astro 5, 6, or 7 and Node 20+.

## Use

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import agentDiscovery from "astro-agent-kit";

export default defineConfig({
  site: "https://example.com",
  integrations: [
    agentDiscovery({
      llmsTxt: { title: "Acme", summary: "Practical notes on scheduling." },
      schema: true,
      schemamap: true,
      robots: true,
      indexnow: { key: process.env.INDEXNOW_KEY ?? "" },
      markdownAlternate: true,
    }),
  ],
});
```

`site` is required whenever a feature is enabled. You can pass it to the integration instead of setting `site` in Astro config.

Every surface can be turned off with `false`. `llmsTxt`, `schema`, `schemamap`, and `robots` are on by default; `markdownAlternate` and `indexnow` are off.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `site` | Astro `site` | Absolute origin used for URLs in every file. |
| `llmsTxt` | on | `/llms.txt` with an H1, summary, and grouped link lists. |
| `schema` | on | `/schema/pages.json` and `/schema/pages.jsonl`. |
| `schemamap` | on | `/schemamap.xml` in the NLWeb sitemap shape. |
| `robots` | on | Adds `Schemamap:` to `/robots.txt`. |
| `markdownAlternate` | off | Head links, `/index.md`, and `_headers` rules for existing `.md` files. |
| `indexnow` | off | Key file plus a build manifest for `astro-agent indexnow`. |

### `llmsTxt`

```ts
llmsTxt: {
  path: "/llms.txt",
  title: "Acme",
  summary: "One sentence for the blockquote.",
  details: "Optional paragraph after the summary.",
  descriptions: true,
  groups: { blog: "Writing", docs: "Documentation" },
}
```

`groups` defaults to the first path segment, with `/` under `Main`. Pass `false` for one flat list, a record to rename groups, or a function `(page) => string`. Pages with `<meta name="robots" content="noindex">` are omitted.

### `schema`

```ts
schema: { path: "/schema", name: "pages" }
```

The feed aggregates every JSON-LD node found in the built HTML, flattens `@graph`, and deduplicates by `@id` (or a stable serialization). The `.json` file is a convenience graph:

```json
{ "@context": "https://schema.org", "@graph": [] }
```

The `.jsonl` file is the NLWeb schema feed: one JSON-LD object per line, each with `@context` and `@type`. The schemamap points at the `.jsonl`.

### `schemamap` and `robots`

```ts
schemamap: { path: "/schemamap.xml", lastmod: true },
robots: { path: "/robots.txt", create: true },
```

The schemamap lists the JSONL feed with `sf:contentType` `structuredData/schema.org`, following the [NLWeb schemamap shape](https://github.com/nlweb-ai/NLWeb/blob/main/docs/schemamap.md). Existing `robots.txt` content is preserved; the directive is only appended. With `create: true`, a minimal `User-agent: *` file is created when none exists.

If `schema` is off, no schemamap is written because there is no feed to list.

### `markdownAlternate`

```ts
markdownAlternate: {
  link: true,          // <link rel="alternate" type="text/markdown">
  headers: true,       // _headers rules with X-Markdown-Tokens
  index: true,         // generate /index.md when the build has none
  cacheControl: "public, max-age=300",
}
```

The build hook only links `.md` files that actually exist. A page with no markdown alternate gets no markdown link. The generated `/index.md` is a link index of public pages, useful for the Cloudflare root rule below.

### `indexnow`

```ts
indexnow: {
  key: process.env.INDEXNOW_KEY ?? "", // 8–128 chars, [A-Za-z0-9-]
  host: "example.com",           // optional; defaults to the site host
  keyFile: "/<key>.txt",         // optional
  endpoint: "https://api.indexnow.org/indexnow",
  sendKeyLocation: false,        // root key file is preferred
}
```

A missing key is a no-op with a warning, so local builds and PR previews do not fail when `INDEXNOW_KEY` is unset.

The build writes the key file and `.astro/agent-kit/indexnow.json`. The CLI submits the URLs **after** the deploy, which is what `wrangler deploy` needs:

```json
{
  "scripts": {
    "deploy": "pnpm build && wrangler deploy && astro-agent indexnow"
  }
}
```

IndexNow is only useful once the new files are live, so do not run the ping from `astro:build:done`.

## Markdown alternates

Create one route per collection. Your `getStaticPaths` supplies the entries; the factory only serializes the response.

```ts
// src/pages/blog/[...slug].md.ts
import type { GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { createMarkdownEndpoint } from "astro-agent-kit/markdown";

export const getStaticPaths = (async () => {
  const posts = await getCollection("blog");
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET = createMarkdownEndpoint<{ post: CollectionEntry<"blog"> }>({
  map: ({ post }) => ({
    frontmatter: {
      title: post.data.title,
      canonical: `https://example.com/blog/${post.id}/`,
      description: post.data.description,
      pubDate: post.data.pubDate,
      tags: post.data.tags,
    },
    body: post.body ?? "",
  }),
});
```

`map` can return `null` to emit a 404 for an entry. The body is not transformed: markdown stays markdown. For MDX, strip imports/JSX yourself before returning the body.

The response carries:

```txt
Content-Type: text/markdown; charset=utf-8
Cache-Control: public, max-age=300
X-Robots-Tag: noindex, follow
X-Markdown-Tokens: 312
Link: <https://example.com/blog/post/>; rel="canonical"
```

Token counts default to `ceil(characters / 4)`; pass `estimateTokens` to use a real tokenizer.

For static hosting the build hook writes the same headers into `_headers`, so the `.md` files keep them without a server:

```txt
/blog/post.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex, follow
  X-Markdown-Tokens: 312
  Cache-Control: public, max-age=300
```

## Content negotiation on Cloudflare

Agents that send `Accept: text/markdown` to a canonical URL need a rewrite. Two Transform Rules cover it on the free plan (`wildcard_replace` is free; `regex_replace` is not):

**Rule 1 — non-root pages**

```txt
Filter:
  http.request.headers["accept"][0] contains "text/markdown"
  and ends_with(http.request.uri.path, "/")
  and http.request.uri.path ne "/"

Path:
  wildcard_replace(http.request.uri.path, "*/", "${1}.md")
```

**Rule 2 — the homepage**

```txt
Filter:
  http.request.headers["accept"][0] contains "text/markdown"
  and http.request.uri.path eq "/"

Path:
  /index.md
```

Do not add `Vary: Accept`: Cloudflare strips custom `Vary` values. The rewritten URL is a separate cache entry.

## When it runs

The HTML-derived files are written in `astro:build:done` from prerendered HTML:

- `dist/` for a normal static build
- `dist/client/` for adapter builds

This means:

- It runs on static builds. SSR/on-demand builds are skipped with a warning, because there is no HTML to read.
- JSON-LD must be in the built HTML, not injected client-side. `SchemaBlocks.astro` and `astro-seo-kit` already do this.
- `noindex` pages are excluded from `llms.txt`, schema feeds, and the generated `/index.md`.
- `@astrojs/sitemap` can stay installed. Both integrations append to `robots.txt`; neither overwrites the other.

Markdown endpoints are real routes, so they work in `astro dev` and on servers. Only the automatic head links and `_headers` rules are build-output work.

## CLI

```sh
astro-agent indexnow --dry-run
astro-agent indexnow --changed
astro-agent indexnow --strict
```

| Flag | Default | Use |
| --- | --- | --- |
| `-m, --manifest` | `.astro/agent-kit/indexnow.json` | Manifest written by the build. |
| `-d, --dir` | `dist` | Fallback HTML scan when no manifest exists. |
| `-k, --key` | manifest key | Override the key. |
| `--host` | manifest host | Override the hostname. |
| `-e, --endpoint` | manifest endpoint | Submission endpoint. |
| `--key-location` | manifest setting | Override the key file URL. |
| `--changed` | off | Submit only URLs whose content hash changed. |
| `--state` | `.astro/agent-kit/indexnow-state.json` | Changed-mode state file. |
| `--batch-size` | `10000` | URLs per request. |
| `--retries` | `3` | Retries after the first attempt. |
| `--retry-delay` | `1000` | Base backoff in ms. |
| `--dry-run` | off | Print the plan, send nothing. |
| `--strict` | off | Exit 1 if any batch fails. |

`--changed` compares the hash in the manifest with the state file. The state file lives in `.astro/`, which is normally gitignored; cache it in CI if you want incremental submissions across runs. Without it, the first run submits every URL.

The CLI also works without a build manifest if you pass `--dir`, `--host`, and `--key`; it scans the built HTML directly.

## Verify

```sh
curl -s https://example.com/llms.txt
curl -s https://example.com/schema/pages.jsonl | head
curl -s https://example.com/schemamap.xml
curl -sI https://example.com/blog/post.md
curl -s -H 'Accept: text/markdown' https://example.com/blog/post/ | head
```

## Credits

Markdown alternates are based on [@jdevalk/astro-seo-graph](https://github.com/jdevalk/astro-seo-graph). That project established the `createMarkdownEndpoint` / `renderMarkdownAlternate` API, the frontmatter conventions, the `X-Markdown-Tokens` header, and the Cloudflare content-negotiation approach. This package reimplements the idea without Astro component coupling so it stays dependency-free and can share build-time discovery with the other surfaces.

The schemamap shape follows the [NLWeb schema feed specification](https://github.com/nlweb-ai/NLWeb/blob/main/docs/schemamap.md). `llms.txt` follows [llmstxt.org](https://llmstxt.org/).

## License

MIT
