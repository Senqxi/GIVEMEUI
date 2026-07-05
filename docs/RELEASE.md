# Release Process

This is the release checklist for maintainers.

## Version Checklist

1. Confirm the target version in `package.json`.
2. Move changelog entries from `Unreleased` into the target version.
3. Run local verification:

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run pack:check
```

4. Smoke test the packaged CLI:

```bash
node bin/givemeui.mjs --port 5183 --no-open
curl http://127.0.0.1:5183/api/health
```

5. Commit the release changes.
6. Tag the release:

```bash
git tag v0.1.0
git push origin main --tags
```

7. Download the package artifact from the release workflow and inspect it.
8. Create GitHub release notes from `CHANGELOG.md`.

## NPM Publishing

NPM publishing should stay manual until the package name, ownership, and provenance setup are confirmed.

When ready:

```bash
npm publish --access public
```

## Release Criteria

- Users can install from source.
- `givemeui` starts a local app with no hosted backend.
- Discovery, schema editing, command preview, execution, and run history work.
- CI passes on supported Node versions.
