#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { submitIndexNow, type IndexNowManifest, type IndexNowUrl } from "./indexnow.js";
import { validateKey } from "./options.js";
import { resolveOutputDir, scanSite } from "./scan.js";

const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_BATCH_SIZE = 10_000;

const HELP = `astro-agent <command>

Commands:
  indexnow    Submit built URLs to IndexNow

IndexNow options:
  -m, --manifest <path>    Manifest written by the Astro build
  -d, --dir <path>         Build output, used when no manifest exists (default: dist)
  -k, --key <key>          Override the IndexNow key
      --host <host>        Override the hostname
  -e, --endpoint <url>     Submission endpoint (default: ${DEFAULT_ENDPOINT})
      --key-location <url> Override the key file URL
      --changed            Submit only URLs whose content hash changed
      --state <path>       State file (default: .astro/agent-kit/indexnow-state.json)
      --batch-size <n>     URLs per request (default: ${DEFAULT_BATCH_SIZE})
      --retries <n>        Retries after the first attempt (default: 3)
      --retry-delay <ms>   Base backoff (default: 1000)
      --dry-run            Print the plan without network calls
      --strict             Exit 1 if any batch fails
  -h, --help               Show this help
  -v, --version            Show the version
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string", short: "m" },
      dir: { type: "string", short: "d", default: "dist" },
      key: { type: "string", short: "k" },
      host: { type: "string" },
      endpoint: { type: "string", short: "e" },
      "key-location": { type: "string" },
      changed: { type: "boolean", default: false },
      state: { type: "string" },
      "batch-size": { type: "string" },
      retries: { type: "string" },
      "retry-delay": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) {
    console.log(await readVersion());
    return;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  const command = positionals[0];
  if (command !== "indexnow") {
    throw new Error(`unknown command "${command}" (try --help)`);
  }

  await runIndexNow(values);
}

async function runIndexNow(values: {
  manifest?: string;
  dir?: string;
  key?: string;
  host?: string;
  endpoint?: string;
  "key-location"?: string;
  changed?: boolean;
  state?: string;
  "batch-size"?: string;
  retries?: string;
  "retry-delay"?: string;
  "dry-run"?: boolean;
  strict?: boolean;
}): Promise<void> {
  const manifest = await loadManifest(values);
  const key = values.key ?? manifest.key;
  validateKey(key);
  const host = values.host ?? manifest.host;
  const endpoint = values.endpoint ?? manifest.endpoint ?? DEFAULT_ENDPOINT;
  const keyLocation =
    values["key-location"] ??
    (manifest.sendKeyLocation ? manifest.keyLocation : undefined);

  const statePath = values.state
    ? resolve(values.state)
    : join(process.cwd(), ".astro", "agent-kit", "indexnow-state.json");
  let state: Record<string, string> = {};
  if (values.changed && existsSync(statePath)) {
    try {
      state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, string>;
    } catch {
      state = {};
    }
  }

  const targets = values.changed
    ? manifest.urls.filter((item) => state[item.url] !== item.hash)
    : manifest.urls;
  const batchSize = clamp(
    Math.floor(numberValue(values["batch-size"], DEFAULT_BATCH_SIZE)),
    1,
    DEFAULT_BATCH_SIZE,
  );
  const retries = Math.max(0, Math.floor(numberValue(values.retries, 3)));
  const retryDelay = Math.max(0, Math.floor(numberValue(values["retry-delay"], 1000)));
  const batches = batch(targets, batchSize);

  console.log("astro-agent indexnow");
  console.log(`Host: ${host}`);
  console.log(
    `URLs: ${targets.length}${values.changed ? ` changed of ${manifest.urls.length}` : ""} (${
      batches.length
    } batch${batches.length === 1 ? "" : "es"})`,
  );

  if (targets.length === 0) {
    console.log("Nothing to submit.");
    return;
  }

  if (values["dry-run"]) {
    for (const [index, batchUrls] of batches.entries()) {
      console.log(`Batch ${index + 1}/${batches.length} (${batchUrls.length} URLs)`);
      for (const item of batchUrls) console.log(`  ${item.url}`);
    }
    console.log("Dry run: no requests sent.");
    return;
  }

  let ok = true;
  const submitted: IndexNowUrl[] = [];

  for (const [index, batchUrls] of batches.entries()) {
    const result = await submitIndexNow({
      endpoint,
      host,
      key,
      urlList: batchUrls.map((item) => item.url),
      keyLocation,
      retries,
      retryDelay,
    });

    if (result.ok) {
      submitted.push(...batchUrls);
      console.log(
        `ok: batch ${index + 1}/${batches.length} — ${batchUrls.length} URLs (${
          result.status ?? "ok"
        }; ${result.attempts} attempt${result.attempts === 1 ? "" : "s"})`,
      );
    } else {
      ok = false;
      const reason =
        result.status !== undefined
          ? `${result.status}${result.statusText ? ` ${result.statusText}` : ""}`
          : result.error ?? "network error";
      console.error(
        `fail: batch ${index + 1}/${batches.length} — ${batchUrls.length} URLs (${reason}; ${
          result.attempts
        } attempt${result.attempts === 1 ? "" : "s"})`,
      );
    }
  }

  if (submitted.length > 0) {
    for (const item of submitted) state[item.url] = item.hash;
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  console.log(`Done: ${submitted.length}/${targets.length} URLs submitted.`);
  if (!ok && values.strict) process.exitCode = 1;
}

async function loadManifest(values: {
  manifest?: string;
  dir?: string;
  key?: string;
  host?: string;
}): Promise<IndexNowManifest> {
  const cwd = process.cwd();
  const explicit = values.manifest ? resolve(values.manifest) : undefined;
  const file = explicit ?? join(cwd, ".astro", "agent-kit", "indexnow.json");

  if (existsSync(file)) {
    return JSON.parse(await readFile(file, "utf8")) as IndexNowManifest;
  }
  if (explicit) {
    throw new Error(`manifest not found: ${explicit}`);
  }

  const dir = resolve(values.dir ?? "dist");
  const output = await resolveOutputDir(pathToFileURL(dir));
  if (!output) {
    throw new Error(
      `no IndexNow manifest found and no HTML in ${dir}; run the Astro build first`,
    );
  }

  const host = values.host;
  const key = values.key;
  if (!host || !key) {
    throw new Error(
      "no IndexNow manifest found; pass --host and --key to scan the build output",
    );
  }
  validateKey(key);

  const site = new URL(`https://${host}`);
  const scan = await scanSite(output, site);
  const urls = scan.pages
    .filter((page) => !page.noindex)
    .map((page) => ({ url: page.url, hash: page.hash }));

  return {
    version: 1,
    host,
    key,
    keyFile: `/${key}.txt`,
    keyLocation: new URL(`/${key}.txt`, site).href,
    endpoint: DEFAULT_ENDPOINT,
    sendKeyLocation: false,
    generatedAt: new Date().toISOString(),
    urls,
  };
}

function batch(urls: IndexNowUrl[], size: number): IndexNowUrl[][] {
  const batches: IndexNowUrl[][] = [];
  for (let index = 0; index < urls.length; index += size) {
    batches.push(urls.slice(index, index + size));
  }
  return batches;
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main().catch((error: unknown) => {
  console.error(
    `astro-agent: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
