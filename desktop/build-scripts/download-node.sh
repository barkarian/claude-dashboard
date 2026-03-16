#!/usr/bin/env bash
set -euo pipefail

# Downloads a standalone Node.js 20 LTS binary for the target platform/arch.
# Usage: ./download-node.sh [platform] [arch]
#   platform: darwin | win32    (default: auto-detect)
#   arch:     x64 | arm64      (default: auto-detect)

NODE_VERSION="v20.18.1"
PLATFORM="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${2:-$(uname -m)}"

# Normalize platform
case "$PLATFORM" in
  darwin|Darwin) PLATFORM="darwin" ;;
  linux|Linux)   PLATFORM="linux" ;;
  win32|MINGW*|MSYS*) PLATFORM="win" ;;
  *) echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

# Normalize arch
case "$ARCH" in
  x86_64|x64|amd64) ARCH="x64" ;;
  arm64|aarch64)     ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../src-tauri/resources"
mkdir -p "$RESOURCES_DIR"

if [ "$PLATFORM" = "win" ]; then
  URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-${ARCH}.zip"
  ARCHIVE="/tmp/node-${NODE_VERSION}-win-${ARCH}.zip"
  echo "Downloading Node.js $NODE_VERSION for win-$ARCH..."
  curl -fsSL "$URL" -o "$ARCHIVE"
  # Extract just the node.exe binary
  unzip -o -j "$ARCHIVE" "node-${NODE_VERSION}-win-${ARCH}/node.exe" -d "$RESOURCES_DIR"
  rm "$ARCHIVE"
  echo "Node binary: $RESOURCES_DIR/node.exe"
else
  URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
  ARCHIVE="/tmp/node-${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
  echo "Downloading Node.js $NODE_VERSION for $PLATFORM-$ARCH..."
  curl -fsSL "$URL" -o "$ARCHIVE"
  # Extract just the node binary
  tar -xzf "$ARCHIVE" -C /tmp "node-${NODE_VERSION}-${PLATFORM}-${ARCH}/bin/node"
  cp "/tmp/node-${NODE_VERSION}-${PLATFORM}-${ARCH}/bin/node" "$RESOURCES_DIR/node"
  chmod +x "$RESOURCES_DIR/node"
  rm -rf "/tmp/node-${NODE_VERSION}-${PLATFORM}-${ARCH}" "$ARCHIVE"
  echo "Node binary: $RESOURCES_DIR/node"
fi

echo "Done."
