import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "test", "fixture", "dist");
const read = (path) => readFileSync(join(dist, path), "utf8");
const json = (path) => JSON.parse(read(path));

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`ok: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name}\n  ${error.message}`);
  }
}

check("llms.txt exists with the site header and summary", () => {
  const text = read("llms.txt");
  assert.match(text, /^# Fixture Site\n/);
  assert.match(text, /> A fixture for astro-agent-kit\./);
});

check("llms.txt lists public pages and omits the noindex draft", () => {
  const text = read("llms.txt");
  for (const path of ["/", "/about/", "/blog/hello/", "/contact/"]) {
    assert.ok(text.includes(`https://example.com${path}`), `missing ${path}`);
  }
  assert.ok(!text.includes("/draft/"), "draft leaked into llms.txt");
  assert.match(text, /## Main\n/);
  assert.match(text, /## Blog\n/);
});

check("schema JSON is one deduplicated graph", () => {
  const feed = json("schema/pages.json");
  assert.equal(feed["@context"], "https://schema.org");
  assert.equal(feed["@graph"].length, 5);
  const types = feed["@graph"].map((node) => node["@type"]);
  for (const type of ["WebSite", "Organization", "AboutPage", "Article", "BreadcrumbList"]) {
    assert.ok(types.includes(type), `missing ${type}`);
  }
  assert.ok(
    !feed["@graph"].some((node) => String(node["@id"]).includes("/draft/")),
    "draft leaked into the schema feed",
  );
});

check("schema JSONL has one node per line", () => {
  const lines = read("schema/pages.jsonl").trimEnd().split("\n");
  assert.equal(lines.length, 5);
  for (const line of lines) {
    const node = JSON.parse(line);
    assert.equal(node["@context"], "https://schema.org");
    assert.ok(node["@type"], "missing @type");
  }
});

check("schemamap points at the JSONL feed", () => {
  const xml = read("schemamap.xml");
  assert.match(xml, /<loc>https:\/\/example\.com\/schema\/pages\.jsonl<\/loc>/);
  assert.match(xml, /xmlns:sf="http:\/\/schema\.org\/schemas\/schemafeed\/0\.1"/);
  assert.match(xml, /<sf:contentType>structuredData\/schema\.org<\/sf:contentType>/);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

check("robots.txt keeps the sitemap and gains the schemamap", () => {
  const text = read("robots.txt");
  assert.match(text, /Sitemap: https:\/\/example\.com\/sitemap-index\.xml/);
  assert.match(text, /Schemamap: https:\/\/example\.com\/schemamap\.xml/);
});

check("IndexNow key file contains only the key", () => {
  assert.equal(read("testkey1234567890.txt"), "testkey1234567890");
});

check("IndexNow manifest records the build URLs", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "test", "fixture", ".astro", "agent-kit", "indexnow.json"), "utf8"),
  );
  assert.equal(manifest.host, "example.com");
  assert.equal(manifest.key, "testkey1234567890");
  assert.equal(manifest.sendKeyLocation, false);
  assert.deepEqual(
    manifest.urls.map((entry) => entry.url).sort(),
    [
      "https://example.com/",
      "https://example.com/about/",
      "https://example.com/blog/hello/",
      "https://example.com/contact/",
    ],
  );
  assert.ok(!manifest.urls.some((entry) => entry.url.includes("/draft/")));
});

check("markdown alternate keeps frontmatter and body", () => {
  const markdown = read("blog/hello.md");
  assert.match(markdown, /^---\n/);
  assert.match(markdown, /^title: Hello World$/m);
  assert.match(markdown, /^canonical: "https:\/\/example\.com\/blog\/hello\/"$/m);
  assert.match(markdown, /^description: A markdown post for agents\.$/m);
  assert.match(markdown, /^pubDate: "2026-01-02T00:00:00\.000Z"$/m);
  assert.match(markdown, /^tags: \[astro, agents\]$/m);
  assert.match(markdown, /Hello from markdown\./);
  assert.match(markdown, /This body must survive byte-for-byte\./);
});

check("generated index.md lists public pages only", () => {
  const markdown = read("index.md");
  assert.match(markdown, /^# Fixture Site$/m);
  assert.match(markdown, /https:\/\/example\.com\/about\//);
  assert.match(markdown, /https:\/\/example\.com\/blog\/hello\//);
  assert.ok(!markdown.includes("/draft/"));
});

check("_headers has markdown content types and token counts", () => {
  const headers = read("_headers");
  const rules = headers.split("\n");
  for (const path of ["/blog/hello.md", "/index.md"]) {
    assert.ok(rules.includes(path), `missing rule for ${path}`);
    assert.match(headers, /Content-Type: text\/markdown; charset=utf-8/);
    assert.match(headers, /X-Robots-Tag: noindex, follow/);
  }
  const tokens = Math.ceil(read("blog/hello.md").length / 4);
  assert.ok(
    headers.includes(`X-Markdown-Tokens: ${tokens}`),
    `expected ${tokens} tokens for /blog/hello.md`,
  );
});

check("head links advertise the schemamap and markdown alternates", () => {
  const index = read("index.html");
  assert.match(index, /rel="schemamap"[^>]*href="\/schemamap\.xml"/);
  assert.match(index, /rel="alternate" type="text\/markdown" href="\/index\.md"/);

  const about = read("about/index.html");
  assert.match(about, /rel="schemamap"/);
  assert.ok(!about.includes('type="text/markdown"'), "about has no .md endpoint");

  const blog = read("blog/hello/index.html");
  assert.match(blog, /rel="alternate" type="text\/markdown" href="\/blog\/hello\.md"/);
});

check("all expected files were written", () => {
  for (const path of [
    "llms.txt",
    "schemamap.xml",
    "robots.txt",
    "schema/pages.json",
    "schema/pages.jsonl",
    "index.md",
    "_headers",
  ]) {
    assert.ok(existsSync(join(dist, path)), `missing ${path}`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
