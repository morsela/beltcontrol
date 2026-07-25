#!/usr/bin/env bash
# Local dev server. http://localhost and http://127.0.0.1 both count as secure
# contexts, so Web Bluetooth works here without TLS. Opening the built files as
# file:// does NOT work.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing dependencies…"
  npm install
fi

PORT="${1:-8080}"
echo "  dashboard  http://localhost:${PORT}/"
echo
echo "Open in Chrome or Edge. Ctrl-C to stop."
exec npx vite --host 127.0.0.1 --port "$PORT"
