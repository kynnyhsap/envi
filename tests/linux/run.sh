#!/bin/sh
# Builds and runs the Linux test images. Docker must run. `bun run verify` does not run them.
# Without arguments, the script runs every target. CI passes one target for each job.
#
#   bun run test:linux
#   bun run test:linux linux-bare
set -eu

cd "$(dirname "$0")/../.."

targets="${*:-linux-secret-service linux-bare}"

# The Bun of the images is the Bun of `packageManager`, and the Node is the major of the Node floor
# in `engines`, both from the root manifest.
bun_version=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)
node_major=$(sed -n 's/.*"node": ">=\([0-9]*\)\..*/\1/p' package.json)

for target in $targets; do
  docker build --build-arg "BUN_VERSION=$bun_version" --build-arg "NODE_MAJOR=$node_major" --target "$target" --tag "envi-test:$target" --file tests/linux/Dockerfile .
  docker run --rm "envi-test:$target"
done
