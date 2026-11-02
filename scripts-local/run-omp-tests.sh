#!/bin/sh
# Run the local TypeScript/Rust suite, script tests, and CLI smoke tests.
# Usage: sh scripts-local/run-omp-tests.sh

CDPATH='' cd "$(dirname "$0")/.." || exit 1

CI=1 OMP_TEST_CONCURRENCY="${OMP_TEST_CONCURRENCY:-4}" bun run test || exit "$?"
bun run test:scripts || exit "$?"
exec bun run ci:test:smoke
