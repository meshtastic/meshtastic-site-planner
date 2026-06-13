#!/usr/bin/env bash
# Build the native engine CLI (golden generation / parity testing).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p engine/build
clang++ -O2 -std=gnu++11 -w \
  -o engine/build/splat_cli \
  engine/driver.cpp engine/native/main.cpp splat/itwom3.0.cpp
echo "built engine/build/splat_cli"
