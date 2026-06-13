#!/usr/bin/env bash
# Harvest golden fixtures from the legacy FastAPI/SPLAT! backend.
#
# NOTE: the backend this script drives has been REMOVED from the repository
# (the site now computes coverage in the browser). To regenerate goldens,
# check out a commit that still contains app/ and the Python Dockerfile
# (the commit that introduced this script) and run it from there.
#
# Runs the backend via docker compose, posts every request in cases/*.json,
# saves the resulting GeoTIFFs to golden/<case>.tif, and dumps terrain
# pipeline goldens via dump_terrain_goldens.py.
#
# Usage: bash test/fixtures/generate.sh [--keep-up]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f test/fixtures/docker-compose.fixtures.yml)
BASE_URL="http://localhost:8080"
GOLDEN_DIR="test/fixtures/golden"
POLL_INTERVAL=5
MAX_POLLS=360 # 30 minutes per case

mkdir -p "$GOLDEN_DIR"

echo "==> Building backend image (this can take a while)..."
"${COMPOSE[@]}" build app

echo "==> Starting app + redis..."
"${COMPOSE[@]}" up -d app redis

cleanup() {
  if [[ "${KEEP_UP:-0}" != "1" ]]; then
    echo "==> Stopping containers..."
    "${COMPOSE[@]}" down --remove-orphans || true
  fi
}
[[ "${1:-}" == "--keep-up" ]] && KEEP_UP=1
trap cleanup EXIT

echo "==> Waiting for backend to come up..."
for _ in $(seq 1 60); do
  if curl -sf "$BASE_URL/docs" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -sf "$BASE_URL/docs" >/dev/null || { echo "backend did not come up"; exit 1; }

for case_file in test/fixtures/cases/*.json; do
  name="$(basename "$case_file" .json)"
  out="$GOLDEN_DIR/$name.tif"
  echo "==> Case $name"

  task_id="$(curl -sf -X POST "$BASE_URL/predict" \
    -H 'Content-Type: application/json' \
    --data @"$case_file" | python3 -c 'import sys,json; print(json.load(sys.stdin)["task_id"])')"
  echo "    task_id=$task_id"

  status="processing"
  for _ in $(seq 1 "$MAX_POLLS"); do
    status="$(curl -sf "$BASE_URL/status/$task_id" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')"
    [[ "$status" == "completed" || "$status" == "failed" ]] && break
    sleep "$POLL_INTERVAL"
  done

  if [[ "$status" != "completed" ]]; then
    echo "    case $name ended with status '$status'"
    curl -sf "$BASE_URL/result/$task_id" || true
    exit 1
  fi

  curl -sf "$BASE_URL/result/$task_id" -o "$out"
  echo "    wrote $out ($(wc -c <"$out") bytes)"
done

echo "==> Dumping terrain goldens..."
"${COMPOSE[@]}" exec -T app python /fixtures/dump_terrain_goldens.py

echo "==> Done. Goldens in $GOLDEN_DIR:"
ls -la "$GOLDEN_DIR"
