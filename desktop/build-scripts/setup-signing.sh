#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Claw Dev Platform - Tauri Signing Key Setup
# ============================================================
# This script generates the signing keys required for Tauri's
# built-in auto-updater. Run this once per developer machine.
# ============================================================

KEY_DIR="$HOME/.tauri"
KEY_PATH="$KEY_DIR/claw-dev.key"
PUB_KEY_PATH="$KEY_DIR/claw-dev.key.pub"

echo ""
echo "======================================"
echo "  Claw Dev - Tauri Signing Key Setup"
echo "======================================"
echo ""

# --------------------------------------------------
# Step 1: Check that the tauri CLI is available
# --------------------------------------------------
echo "[1/3] Checking for tauri CLI..."

if ! command -v cargo-tauri &>/dev/null && ! cargo tauri --version &>/dev/null 2>&1; then
    echo ""
    echo "  ERROR: tauri CLI not found."
    echo ""
    echo "  Install it with:"
    echo ""
    echo "    cargo install tauri-cli"
    echo ""
    echo "  Then re-run this script."
    exit 1
fi

echo "  Found: $(cargo tauri --version)"
echo ""

# --------------------------------------------------
# Step 2: Generate signing keys
# --------------------------------------------------
echo "[2/3] Generating signing keys..."

if [ -f "$KEY_PATH" ]; then
    echo ""
    echo "  WARNING: A key already exists at $KEY_PATH"
    echo ""
    read -rp "  Overwrite? (y/N) " confirm
    if [[ "$confirm" != [yY] ]]; then
        echo "  Aborted. Using existing key."
    else
        rm -f "$KEY_PATH" "$PUB_KEY_PATH"
        cargo tauri signer generate -w "$KEY_PATH"
    fi
else
    mkdir -p "$KEY_DIR"
    cargo tauri signer generate -w "$KEY_PATH"
fi

echo ""

# --------------------------------------------------
# Step 3: Read public key and print instructions
# --------------------------------------------------
echo "[3/3] Reading public key..."
echo ""

if [ ! -f "$PUB_KEY_PATH" ]; then
    echo "  ERROR: Public key file not found at $PUB_KEY_PATH"
    echo "  Something went wrong during key generation."
    exit 1
fi

PUB_KEY=$(cat "$PUB_KEY_PATH")

echo "======================================"
echo "  Setup Complete - Next Steps"
echo "======================================"
echo ""
echo "  Your keys were saved to:"
echo "    Private key: $KEY_PATH"
echo "    Public key:  $PUB_KEY_PATH"
echo ""
echo "  ---- STEP A: Update tauri.conf.json ----"
echo ""
echo "  Copy the following public key into your tauri.conf.json"
echo "  at plugins -> updater -> pubkey:"
echo ""
echo "    \"plugins\": {"
echo "      \"updater\": {"
echo "        \"pubkey\": \"$PUB_KEY\""
echo "      }"
echo "    }"
echo ""
echo "  ---- STEP B: Add GitHub Secrets ----"
echo ""
echo "  1. Go to your GitHub repo -> Settings -> Secrets and variables -> Actions"
echo ""
echo "  2. Add the PRIVATE key as a repository secret:"
echo "       Name:  TAURI_SIGNING_PRIVATE_KEY"
echo "       Value: (paste the entire contents of $KEY_PATH)"
echo ""
echo "     To copy the private key to your clipboard:"
echo "       macOS:  cat $KEY_PATH | pbcopy"
echo "       Linux:  cat $KEY_PATH | xclip -selection clipboard"
echo ""
echo "  3. (Optional) If you set a password during key generation,"
echo "     add it as another secret:"
echo "       Name:  TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
echo "       Value: (the password you chose)"
echo ""
echo "======================================"
echo "  Done! You are ready to build signed releases."
echo "======================================"
echo ""
