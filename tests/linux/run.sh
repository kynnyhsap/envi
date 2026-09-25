#!/bin/sh
# Builds and runs the Linux test images. Docker must run. `bun run verify` does not run them.
set -eu

cd "$(dirname "$0")/../.."

for target in linux-secret-service linux-bare; do
  docker build --target "$target" --tag "envi-test:$target" --file tests/linux/Dockerfile .
  docker run --rm "envi-test:$target"
done
