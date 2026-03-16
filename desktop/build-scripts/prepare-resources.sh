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
for dir in routes services sockets data public; do
  if [ -d "$DASHBOARD_DIR/server/$dir" ]; then
    cp -R "$DASHBOARD_DIR/server/$dir" "$RESOURCES_DIR/server/"
  fi
done

# Copy node_modules (needed at runtime)
if [ -d "$DASHBOARD_DIR/server/node_modules" ]; then
  cp -R "$DASHBOARD_DIR/server/node_modules" "$RESOURCES_DIR/server/"
fi

# --- Copy shared/ ---
echo "→ Copying shared/..."
rm -rf "$RESOURCES_DIR/shared"
cp -R "$DASHBOARD_DIR/shared" "$RESOURCES_DIR/shared"

echo "Resources prepared at $RESOURCES_DIR"
