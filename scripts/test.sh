#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

echo "==> build"
pnpm build

echo "==> typecheck"
pnpm check

echo "==> fixture build"
pnpm --dir test/fixture build

echo "==> static output"
node scripts/verify.mjs

echo "==> indexnow"
node scripts/indexnow-test.mjs

echo "All tests passed."
