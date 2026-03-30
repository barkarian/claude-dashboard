# Claw Dev Desktop - Release Guide

## Prerequisites

### Signing Keys

Before you can publish a release, you need Tauri updater signing keys. Run the setup script once:

```bash
chmod +x build-scripts/setup-signing.sh
./build-scripts/setup-signing.sh
```

This generates a key pair at `~/.tauri/claw-dev.key` (private) and `~/.tauri/claw-dev.key.pub` (public). The public key must be set in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

### GitHub Secrets

The following secrets must be configured in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret | Required | Description |
|--------|----------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Yes | Contents of `~/.tauri/claw-dev.key`. Used to sign update bundles so the updater can verify authenticity. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | If set | Password for the private key (set during key generation). Leave unset if you chose no password. |
| `APPLE_CERTIFICATE` | Yes (macOS) | Base64-encoded `.p12` Developer ID Application certificate for macOS code signing. |
| `APPLE_CERTIFICATE_PASSWORD` | Yes (macOS) | Password for the `.p12` certificate file. |
| `APPLE_SIGNING_IDENTITY` | Yes (macOS) | Name of the signing identity, e.g. `Developer ID Application: Your Name (TEAM_ID)`. |
| `APPLE_ID` | Yes (macOS) | Apple ID email used for notarization. |
| `APPLE_PASSWORD` | Yes (macOS) | App-specific password for the Apple ID (generate at appleid.apple.com). |
| `APPLE_TEAM_ID` | Yes (macOS) | Your Apple Developer Team ID (10-character string). |

## How to Release a New Version

Follow these steps to publish a new desktop release:

### 1. Bump the version

Update the version string in **both** of these files:

- `src-tauri/tauri.conf.json` — the `version` field
- `desktop/package.json` — the `version` field

Both must match. Use [semver](https://semver.org/) (e.g. `0.2.0`, `1.0.0`).

### 2. Update versions.json

Edit `../../versions.json` (at the repo root) with the new version information so clients and the website know about the latest release.

### 3. Commit the changes

```bash
git add src-tauri/tauri.conf.json package.json ../../versions.json
git commit -m "release: desktop v0.2.0"
```

### 4. Create and push a version tag

The tag **must** start with `v`:

```bash
git tag v0.2.0
git push origin v0.2.0
```

### 5. Wait for the CI build

Pushing the tag triggers GitHub Actions which will:

1. Build the app for all configured platforms (macOS, Windows, Linux).
2. Code-sign the macOS build with your Apple Developer certificate.
3. Notarize the macOS build with Apple.
4. Sign the update bundles with the Tauri signing key.
5. Generate a `latest.json` manifest for the auto-updater.
6. Create a **draft** GitHub Release with all artifacts attached.

### 6. Review and publish

1. Go to **GitHub > Releases** and find the new draft.
2. Review the attached artifacts and the auto-generated release notes.
3. Edit the release notes if needed.
4. Click **Publish release**.

Once published, the auto-updater will start serving the new version to users.

## How the Auto-Updater Works

The Tauri updater plugin is configured in `src-tauri/tauri.conf.json` under `plugins.updater`. It works as follows:

- On app launch, and then **every 6 hours** while running, the app fetches the `latest.json` file from the update endpoint.
- `latest.json` contains the latest version number, download URLs per platform, and a signature for each artifact.
- If a newer version is available, the user is prompted to update.
- The downloaded update bundle is verified against the public key embedded in the app before installation.
- Users can also trigger a manual update check via the update check button in the app UI.

## Testing Updates Locally

Before pushing a release tag, you can verify the build works on your machine:

### Build the app

```bash
cd src-tauri
cargo tauri build
```

This produces a full release build in `src-tauri/target/release/bundle/`. Inspect the output for errors and test the generated app binary.

### Test the full signing flow

To verify that signing works end-to-end:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/claw-dev.key)"
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"  # if applicable
cargo tauri build
```

This produces signed update bundles (`.tar.gz.sig` on macOS/Linux, `.nsis.zip.sig` on Windows). You can verify the signature file exists alongside the bundle in the output directory.

### Dry-run checklist

1. Version in `tauri.conf.json` is correct.
2. Public key in `tauri.conf.json` matches your key pair.
3. `cargo tauri build` completes without errors.
4. The built app launches and runs correctly.
5. Signed update artifacts are present in the bundle output.
