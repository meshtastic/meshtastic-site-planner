#!/usr/bin/env bash
# Build the WebAssembly coverage engine into src/engine/generated/.
#
# Default: runs em++ inside the pinned emscripten/emsdk Docker image so the
# committed artifacts are reproducible (CI rebuilds and diffs them).
# Use --local to build with an em++ from PATH instead.
set -euo pipefail

EMSDK_IMAGE="emscripten/emsdk:4.0.20"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR=src/engine/generated
mkdir -p "$OUT_DIR"

EMCC_ARGS=(
  -O3
  -std=gnu++11
  -w
  engine/driver.cpp
  splat/itwom3.0.cpp
  -o "$OUT_DIR/splat_driver.mjs"
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createSplatModule
  -sENVIRONMENT=web,worker,node
  -sFILESYSTEM=0
  --no-entry
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=64MB
  -sMAXIMUM_MEMORY=1024MB
  -sEXPORTED_FUNCTIONS=@engine/exports.json
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPF64
  -sASSERTIONS=0
)

if [[ "${1:-}" == "--local" ]]; then
  em++ "${EMCC_ARGS[@]}"
else
  docker run --rm -v "$REPO_ROOT:/src" -w /src "$EMSDK_IMAGE" \
    em++ "${EMCC_ARGS[@]}"
fi

ls -la "$OUT_DIR"
