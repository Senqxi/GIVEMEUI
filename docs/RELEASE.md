# Release Process

This is the release checklist for maintainers.

## Version Checklist

1. Confirm the target version in `package.json`.
2. Move changelog entries from `Unreleased` into the target version.
3. Run local verification:

```bash
npm ci
npm run release:check
npm run package:local
```

4. Verify the local package checksum:

```bash
cd release
shasum -a 256 -c givemeui-0.1.0.tgz.sha256
cd ..
```

5. Smoke test the packaged CLI from the generated tarball:

```bash
npm install -g ./release/givemeui-0.1.0.tgz
givemeui --port 5183 --no-open
curl http://127.0.0.1:5183/api/health
```

6. Run one harmless command through the UI, such as:

```bash
echo "hello"
```

7. Commit the release changes.
8. Tag the release:

```bash
git tag v0.1.0
git push origin main --tags
```

9. Download the package artifact from the release workflow and inspect it.
10. Confirm the GitHub release includes:

- `givemeui-<version>.tgz`
- `givemeui-<version>.tgz.sha256`
- `givemeui-<version>-release-manifest.json`

11. Create or edit GitHub release notes from `CHANGELOG.md`.

## Manual Updates

GIVEMEUI does not auto-update in the current alpha.

Users update manually:

```bash
shasum -a 256 -c givemeui-0.1.0.tgz.sha256
npm install -g ./givemeui-0.1.0.tgz
```

## NPM Publishing

NPM publishing should stay manual until the package name, ownership, and provenance setup are confirmed.

When ready:

```bash
npm publish --access public
```

## Release Criteria

- Users can install from a GitHub release tarball.
- `givemeui` starts a local app with no hosted backend.
- Discovery, schema editing, command preview, execution, and run history work.
- CI passes on supported Node versions.
- Release artifacts include checksums and manifest metadata.
