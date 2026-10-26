#!/usr/bin/env bash
set -euo pipefail
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
paraco_repo=${PARACO_REPO:-"$plugin_root/../paraco"}
paraco_binary=${PARACO_BIN:-"$paraco_repo/target/debug/paraco"}
if [[ ! -x "$paraco_binary" ]]; then
  echo "Build the sibling Paraco checkout first (cargo build --locked), or set PARACO_BIN." >&2
  exit 1
fi
export PATH="$paraco_repo/node_modules/.bin:$PATH"
exec "$paraco_binary" serve --config "$plugin_root/server.json" --port "${PARACO_PORT:-3000}"
