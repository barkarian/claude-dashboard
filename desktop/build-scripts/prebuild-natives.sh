#!/usr/bin/env bash
set -euo pipefail

# Rebuilds native Node.js modules (better-sqlite3, node-pty) for the target platform.
# Must be run after `npm install` in the server directory.
#
# Usage: ./prebuild-natives.sh [target_arch]
#   target_arch: x64 | arm64    (default: auto-detect)

TARGET_ARCH="${1:-$(uname -m)}"

# Normalize arch
case "$TARGET_ARCH" in
  x86_64|x64|amd64) TARGET_ARCH="x64" ;;
  arm64|aarch64)     TARGET_ARCH="arm64" ;;
  *) echo "Unsupported arch: $TARGET_ARCH"; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../../server"

echo "Rebuilding native modules for arch=$TARGET_ARCH..."

cd "$SERVER_DIR"

# Rebuild better-sqlite3
echo "→ Rebuilding better-sqlite3..."
npx node-gyp rebuild \
  --directory=node_modules/better-sqlite3 \
  --arch="$TARGET_ARCH" \
  --release 2>&1 | tail -5

# Rebuild node-pty
echo "→ Rebuilding node-pty..."
npx node-gyp rebuild \
  --directory=node_modules/node-pty \
  --arch="$TARGET_ARCH" \
  --release 2>&1 | tail -5

echo "Native modules rebuilt for $TARGET_ARCH."
