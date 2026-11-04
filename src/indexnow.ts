import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedIndexNow, ScannedPage } from "./types.js";
import { routeToFile } from "./utils.js";

export interface IndexNowUrl {
  url: string;
  hash: string;
}

export interface IndexNowManifest {
  version: 1;
  host: string;
  key: string;
  keyFile: string;
  keyLocation: string;
  endpoint: string;
  sendKeyLocation: boolean;
  generatedAt: string;
  urls: IndexNowUrl[];
}

export interface IndexNowBuildResult {
  manifest: IndexNowManifest;
  skipped: number;
}

export function buildIndexNowManifest(
  pages: ScannedPage[],
  site: URL,
  options: ResolvedIndexNow,
): IndexNowBuildResult {
  const host = options.host ?? site.host;
  const seen = new Set<string>();
  const urls: IndexNowUrl[] = [];
  let skipped = 0;

  for (const page of pages) {
    if (page.noindex || seen.has(page.url)) continue;
    try {
      if (new URL(page.url).host !== host) {
        skipped += 1;
        continue;
      }
    } catch {
      skipped += 1;
      continue;
    }
    seen.add(page.url);
    urls.push({ url: page.url, hash: page.hash });
  }

  return {
    manifest: {
      version: 1,
      host,
      key: options.key,
      keyFile: options.keyFile,
      keyLocation: new URL(options.keyFile, site).href,
      endpoint: options.endpoint,
      sendKeyLocation: options.sendKeyLocation,
      generatedAt: new Date().toISOString(),
      urls,
    },
    skipped,
  };
}

export async function writeIndexNowManifest(
  projectRoot: string,
  manifest: IndexNowManifest,
): Promise<string> {
  const file = join(projectRoot, ".astro", "agent-kit", "indexnow.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export async function writeIndexNowKey(
  outputDir: string,
  keyFile: string,
  key: string,
): Promise<string> {
  const file = routeToFile(outputDir, keyFile);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, key);
  return file;
}

export interface SubmitIndexNowOptions {
  endpoint: string;
  host: string;
  key: string;
  urlList: string[];
  keyLocation?: string;
  /** Number of retries after the first attempt. Defaults to 3. */
  retries?: number;
  /** Base backoff in ms. Defaults to 1000. */
  retryDelay?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface SubmitIndexNowResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  attempts: number;
  retryable?: boolean;
  error?: string;
}

const MAX_URLS = 10_000;

/**
 * POST one batch to IndexNow. 200/202 are success; 429 and 5xx retry with
 * backoff; everything else fails immediately.
 */
export async function submitIndexNow(
  options: SubmitIndexNowOptions,
): Promise<SubmitIndexNowResult> {
  if (options.urlList.length === 0) {
    return { ok: true, attempts: 0 };
  }
  if (options.urlList.length > MAX_URLS) {
    return {
      ok: false,
      attempts: 0,
      retryable: false,
      error: `IndexNow accepts at most ${MAX_URLS} URLs per request`,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, (options.retries ?? 3) + 1);
  const baseDelay = options.retryDelay ?? 1000;
  const payload: Record<string, unknown> = {
    host: options.host,
    key: options.key,
    urlList: options.urlList,
  };
  if (options.keyLocation) payload.keyLocation = options.keyLocation;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal,
      });

      if (response.status === 200 || response.status === 202) {
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          attempts: attempt,
        };
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          attempts: attempt,
          retryable,
        };
      }

      const after = retryAfterMs(response.headers.get("retry-after"));
      await delay(after ?? backoff(baseDelay, attempt));
    } catch (error) {
      if (attempt === maxAttempts) {
        return {
          ok: false,
          attempts: attempt,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await delay(backoff(baseDelay, attempt));
    }
  }

  return { ok: false, attempts: maxAttempts, retryable: true };
}

function backoff(base: number, attempt: number): number {
  return Math.min(30_000, base * 2 ** (attempt - 1));
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
