import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const fixture = join(root, "test", "fixture");
const cli = join(root, "dist", "cli.js");
const manifestPath = join(fixture, ".astro", "agent-kit", "indexnow.json");
const statePath = join(fixture, ".astro", "agent-kit", "indexnow-state-test.json");
const originalManifest = await readFile(manifestPath, "utf8");

const requests = [];
let mode = "retry";

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    requests.push(JSON.parse(body));
    if (mode === "ok") {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (requests.length === 1) {
      response.writeHead(429, { "Retry-After": "0" });
      response.end("slow down");
      return;
    }
    if (requests.length === 2) {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    response.writeHead(202);
    response.end("accepted");
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}/indexnow`;

function command(extra = []) {
  return run(
    process.execPath,
    [
      cli,
      "indexnow",
      "--batch-size",
      "2",
      "--retry-delay",
      "1",
      "--endpoint",
      endpoint,
      "--state",
      statePath,
      "--strict",
      ...extra,
    ],
    { cwd: fixture },
  );
}

try {
  await rm(statePath, { force: true });

  const first = await command();
  assert.match(first.stdout, /URLs: 4 \(2 batches\)/);
  assert.match(first.stdout, /Done: 4\/4 URLs submitted\./);
  assert.equal(requests.length, 3, "expected 429 + retry + second batch");
  assert.equal(requests[0].host, "example.com");
  assert.equal(requests[0].key, "testkey1234567890");
  assert.equal(requests[0].urlList.length, 2);
  assert.deepEqual(requests[0].urlList, requests[1].urlList);
  assert.equal(requests[2].urlList.length, 2);
  assert.ok(!("keyLocation" in requests[0]), "root key file should not send keyLocation");
  assert.equal(new Set(requests.flatMap((entry) => entry.urlList)).size, 4);
  assert.equal(JSON.parse(await readFile(statePath, "utf8"))["https://example.com/"] !== undefined, true);

  const beforeDryRun = requests.length;
  const dry = await command(["--dry-run"]);
  assert.match(dry.stdout, /URLs: 4 \(2 batches\)/);
  assert.match(dry.stdout, /Batch 1\/2 \(2 URLs\)/);
  assert.match(dry.stdout, /Dry run: no requests sent\./);
  assert.equal(requests.length, beforeDryRun, "dry run must not send requests");

  mode = "ok";
  await rm(statePath, { force: true });

  const changed = await command(["--changed", "--batch-size", "10"]);
  assert.match(changed.stdout, /URLs: 4 changed of 4 \(1 batch\)/);
  const afterChanged = requests.length;
  assert.equal(afterChanged, beforeDryRun + 1);

  const unchanged = await command(["--changed", "--batch-size", "10"]);
  assert.match(unchanged.stdout, /URLs: 0 changed of 4 \(0 batches\)/);
  assert.match(unchanged.stdout, /Nothing to submit\./);
  assert.equal(requests.length, afterChanged, "unchanged run must not send requests");

  const manifest = JSON.parse(originalManifest);
  manifest.urls[0].hash = "changed-hash";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const one = await command(["--changed", "--batch-size", "10"]);
  assert.match(one.stdout, /URLs: 1 changed of 4 \(1 batch\)/);
  assert.equal(requests.length, afterChanged + 1);
  assert.deepEqual(requests.at(-1).urlList, [manifest.urls[0].url]);

  console.log("ok: IndexNow retry, batching, dry run, and changed mode");
} finally {
  await writeFile(manifestPath, originalManifest);
  await rm(statePath, { force: true });
  await new Promise((resolve) => server.close(resolve));
}
