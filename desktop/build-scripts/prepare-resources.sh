#!/usr/bin/env bash
set -euo pipefail

# Copies server/ and shared/ into desktop/src-tauri/resources/ so Tauri can
# bundle them as sidecar payload. Runs as part of desktop:dev and desktop:build.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/../.."
RESOURCES_DIR="$SCRIPT_DIR/../src-tauri/resources"

echo "Preparing Tauri resources..."

# Ensure resources dir exists
mkdir -p "$RESOURCES_DIR"

# --- Copy server/ ---
echo "→ Copying server/..."
rm -rf "$RESOURCES_DIR/server"
mkdir -p "$RESOURCES_DIR/server"

# Copy source files and config
cp -R "$DASHBOARD_DIR/server/"*.ts "$RESOURCES_DIR/server/" 2>/dev/null || true
cp "$DASHBOARD_DIR/server/package.json" "$RESOURCES_DIR/server/"
cp "$DASHBOARD_DIR/server/tsconfig.json" "$RESOURCES_DIR/server/" 2>/dev/null || true

# Copy subdirectories
for dir in routes services sockets data public adapters; do
  if [ -d "$DASHBOARD_DIR/server/$dir" ]; then
    cp -R "$DASHBOARD_DIR/server/$dir" "$RESOURCES_DIR/server/"
  fi
done

# --- Copy shared/ ---
echo "→ Copying shared/..."
rm -rf "$RESOURCES_DIR/shared"
cp -R "$DASHBOARD_DIR/shared" "$RESOURCES_DIR/shared"

# --- Copy adapters/ ---
# server/adapters/loader.ts resolves adapter modules from ../../adapters
# (sibling of server/ under resources/). Adapter server.ts files import
# npm deps like node-pty, so node_modules must be reachable at or above
# resources/ — we install it at the resources/ root below.
echo "→ Copying adapters/..."
rm -rf "$RESOURCES_DIR/adapters"
cp -R "$DASHBOARD_DIR/adapters" "$RESOURCES_DIR/adapters"

# --- Install flat node_modules at resources/ root ---
# Placed at resources/ (not resources/server/) so Node's parent-walk
# resolves deps identically for both resources/server/*.ts and
# resources/adapters/<name>/server.ts. pnpm's symlink layout isn't portable.
echo "→ Installing production dependencies (flat node_modules at resources/)..."
cp "$DASHBOARD_DIR/server/package.json" "$RESOURCES_DIR/package.json"
rm -rf "$RESOURCES_DIR/server/node_modules"
cd "$RESOURCES_DIR"
npm install --omit=dev --ignore-scripts 2>&1 | tail -3
# Rebuild native modules for the current platform
echo "→ Rebuilding native modules..."
npm rebuild better-sqlite3 2>&1 | tail -3
npm rebuild node-pty 2>&1 | tail -3
cd "$DASHBOARD_DIR"

echo "Resources prepared at $RESOURCES_DIR"
