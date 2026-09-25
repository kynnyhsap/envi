#!/bin/sh
# Builds and runs the Linux test images. Docker must run. `bun run verify` does not run them.
# Without arguments, the script runs every target. CI passes one target for each job.
#
#   bun run test:linux
#   bun run test:linux linux-bare
set -eu

cd "$(dirname "$0")/../.."

targets="${*:-linux-secret-service linux-bare}"

for target in $targets; do
  docker build --target "$target" --tag "envi-test:$target" --file tests/linux/Dockerfile .
  docker run --rm "envi-test:$target"
done
