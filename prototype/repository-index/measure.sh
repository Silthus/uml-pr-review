#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
repo="${REPO:-$HOME/dev/posthog}"
cache="/tmp/uml-pr-review-prototype-cache.sqlite"

run() {
  local label="$1"
  shift
  /usr/bin/time -l bun prototype/repository-index/index.ts --repo "$repo" --label "$label" "$@" 2>"/tmp/$label.time" >/dev/null
  local rss footprint real
  real=$(awk '/real/ {print $1}' "/tmp/$label.time")
  rss=$(awk '/maximum resident set size/ {printf "%d", $1/1e6}' "/tmp/$label.time")
  footprint=$(awk '/peak memory footprint/ {printf "%d", $1/1e6}' "/tmp/$label.time")
  echo "$label real=${real}s maxRss=${rss}MB footprint=${footprint}MB $(jq -c '{extractMs: .timingsMs.extract, parsed: .extraction.parsed, hits: .extraction.cacheHits, symbols: .extraction.symbols}' "prototype/repository-index/out/runs/$label.json")"
}

case "${1:-all}" in
  cold)
    run cold-imports-18w --mode imports --workers 18
    run cold-imports-8w --mode imports --workers 8
    run cold-imports-4w --mode imports --workers 4
    run cold-imports-1w --mode imports --workers 1
    run cold-v1-18w --mode v1 --workers 18
    run cold-v1-1w --mode v1 --workers 1
    ;;
  cache)
    rm -f "$cache" "$cache-wal" "$cache-shm"
    run cold-imports-18w-cachewrite --workers 18 --cache "$cache"
    run warm-imports --cache "$cache"
    run warm-imports-analyze --cache "$cache" --analyze
    ls -l "$cache"
    ;;
esac
