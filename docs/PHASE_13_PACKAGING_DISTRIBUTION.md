# Phase 13 Packaging And Distribution

Phase 13 makes GIVEMEUI downloadable as a local CLI app package while keeping native desktop installers as a later milestone.

## Current Distribution Shape

The current production shape is:

- npm-compatible `.tgz` package generated from this repository;
- installed globally with npm from a GitHub Release artifact;
- local CLI command: `givemeui`;
- local app served at `http://127.0.0.1:<port>`;
- local command execution through trusted executable previews.

This is not a hosted web app. The browser is only the local control surface.

## Build And Package Commands

```bash
npm ci
npm run release:check
npm run package:local
```

`npm run package:local` writes release artifacts into `release/`:

- `givemeui-<version>.tgz`
- `givemeui-<version>.tgz.sha256`
- `givemeui-<version>-release-manifest.json`

The generated manifest records package name, version, Node version, supported platforms, file size, and SHA-256 hash.

## Install From Release Artifact

```bash
shasum -a 256 -c givemeui-0.1.0.tgz.sha256
npm install -g ./givemeui-0.1.0.tgz
givemeui --open
```

The package supports macOS and Linux for the current alpha. Debian/Kali users should install Node.js 20 or newer before installing the tarball.

## App Icon And Metadata

Metadata lives in `packaging/app-metadata.json`.

Current icon:

- `public/favicon.svg`

The native desktop wrapper is intentionally deferred. When a wrapper is added, it should use the same metadata source and icon path.

## Update Strategy

Auto-update is not enabled in this phase.

Manual update flow:

1. Download the newer `.tgz` and `.sha256` from GitHub Releases.
2. Verify the checksum.
3. Run `npm install -g ./givemeui-<version>.tgz`.
4. Start `givemeui --open`.

This keeps update behavior explicit and avoids background network activity.

## Signing And Notarization

macOS signing and notarization are not configured because the current deliverable is a CLI package, not a `.app`, `.dmg`, or `.pkg`.

When native macOS packaging is added:

- sign the app bundle with a Developer ID certificate;
- enable hardened runtime;
- notarize the archive;
- staple the notarization ticket;
- document Gatekeeper verification commands.

## Linux And Windows Packages

Linux users can install the tarball today on supported Node versions.

Future native package targets:

- macOS `.dmg` or `.pkg` after the wrapper is chosen;
- Linux `.deb`, `.rpm`, and AppImage after macOS packaging is stable;
- Windows installer after the Unix-like V1 path is stable.

## Crash And Error Reporting

No crash or error reports leave the device in this phase.

Future reporting must be:

- local-first;
- opt-in;
- clear about captured data;
- able to export a local diagnostic bundle without uploading it automatically.

## Release Checklist

1. Confirm version in `package.json`.
2. Move changelog entries out of `Unreleased`.
3. Run `npm ci`.
4. Run `npm run release:check`.
5. Run `npm run package:local`.
6. Verify `release/*.sha256`.
7. Install the generated tarball globally on a clean machine or test user.
8. Run `givemeui --port 5183 --no-open`.
9. Check `http://127.0.0.1:5183/api/health`.
10. Discover and run a harmless command such as `echo "hello"`.
11. Tag the release and push tags.
12. Confirm GitHub Release artifacts include `.tgz`, `.sha256`, and release manifest.

## Exit Criteria Status

- A user can download, install, and run the app: complete for GitHub release tarballs.
- The app can execute local commands with appropriate permissions: complete through trusted local execution gates.
- Releases are reproducible: complete through `release:check`, `package:local`, checksum files, and release manifests.
