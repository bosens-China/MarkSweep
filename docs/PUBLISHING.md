# Publishing

MarkSweep is published as the scoped public npm package `@boses/marksweep`.

## Current npm Publishing Model

npm recommends Trusted Publishing with OIDC for CI/CD releases. This avoids storing long-lived npm tokens in GitHub Secrets.

Trusted Publishing requires:

- npm CLI `>=11.5.1`
- Node.js `>=22.14.0`
- A supported hosted CI provider

This project uses GitHub Actions with Node.js `24`.

## First Publish

The first publish should be done manually because npm Trusted Publisher settings are configured from the npm package settings page after the package exists.

Prerequisites:

- npm organization `@boses` exists.
- npm user `yliu` has permission to publish packages under `@boses`.
- Local npm login has 2FA configured as required by npm.

Manual first publish:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm pack --dry-run
npm publish --access public
```

The `--access public` flag is required for public scoped packages because scoped packages are private by default.

## Configure Trusted Publishing

After the first version is published, open the package settings on npmjs.com and add a Trusted Publisher.

Use these values:

```txt
Provider: GitHub Actions
Organization or user: bosens-China
Repository: MarkSweep
Workflow filename: release.yml
Environment name: leave blank
```

The workflow filename must be exactly `release.yml`, because the publishing workflow lives at:

```txt
.github/workflows/release.yml
```

After saving the Trusted Publisher, select npm's recommended publishing access option that requires two-factor
authentication and disallows tokens. Trusted Publishing continues to work through OIDC.

In GitHub, enable `Settings > Actions > General > Allow GitHub Actions to create and approve pull requests` so Release
Please can maintain its release PR.

## Release Flow

Release automation uses `googleapis/release-please-action`.

1. Merge normal changes to `main` using Conventional Commit messages.
2. Release Please reads those commits and opens or updates a release PR.
3. The release PR updates `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
4. Merge the release PR when ready.
5. Release Please creates the version tag and GitHub Release.
6. The `publish` job publishes `@boses/marksweep` to npm using Trusted Publishing with provenance.

Useful commit prefixes:

```txt
fix:   patch version
feat:  minor version
feat!: major version
```

## References

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers/
- npm scoped public packages: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- Release Please action: https://github.com/googleapis/release-please-action
