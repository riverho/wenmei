# CI/CD and Release Tagging

This doc covers how the GitHub Actions Windows build gets triggered, the
tag conventions Wenmei follows, and the standard release flow. For the
build mechanics themselves (Tauri targets, code signing, DMG layout), see
[`PACKAGING.md`](./PACKAGING.md).

## What CI/CD does

Wenmei has one workflow today: **`.github/workflows/build-windows.yml`**.
It runs on `windows-latest` and produces:

- `wenmei-windows-msi` — the WiX-built `.msi` installer
- `wenmei-windows-nsis` — the NSIS-built `.exe` installer

Both land as **workflow artifacts** attached to the run; download them from
the run's summary page in the Actions tab.

The macOS DMG is currently built locally on a developer machine (see
`PACKAGING.md`). When the project moves to fully automated releases, a
`macos-latest` job will join the same workflow.

## When the workflow runs

It is **tag-driven on purpose** — casual commits to `main` do not trigger
a build. This keeps Actions minutes reserved for shipping.

| You do | Runs? |
|---|---|
| `git push` to any branch | ❌ |
| Open or update a PR | ❌ |
| `git push --tags` (when a `v*` tag is among them) | ✅ |
| Actions tab → "Build Windows" → "Run workflow" | ✅ (manual) |

The manual "Run workflow" button is the safety valve: use it when you want
a build off the current `main` without cutting a tag yet.

## Tag guide

### Format

Wenmei follows [SemVer](https://semver.org): tags are `vMAJOR.MINOR.PATCH`.

```
v0.1.0      # initial public-ish build
v0.2.0      # added paper-zoom feature
v0.2.1      # fixed crash on file rename
v1.0.0      # first stable
```

Pre-releases get a suffix:

```
v0.3.0-rc.1     # release candidate 1
v0.3.0-beta.2   # beta 2
```

The tag must start with a lowercase `v` — the workflow's `tags: ["v*"]`
trigger is anchored on that prefix. A tag like `0.2.0` (no `v`) will not
fire the build.

### When to bump which number

- **PATCH** (`v0.2.1` → `v0.2.2`): bug fixes, no new behavior, no breaking
  changes. The default for any release that isn't adding a feature.
- **MINOR** (`v0.2.x` → `v0.3.0`): new features, no breaking changes to
  saved state, vault layout, or the `wenmei` CLI surface.
- **MAJOR** (`v0.x` → `v1.0`): breaking changes — state.json schema bumps
  that aren't auto-migrated, removed CLI flags, vault-on-disk layout
  changes.

While Wenmei is pre-1.0, MINOR bumps are allowed to break things if the
breakage is documented in the release notes.

### Cutting a release

```bash
# 1. Make sure main is in the state you want to ship.
git switch main
git pull --ff-only

# 2. Update the version in src-tauri/tauri.conf.json and package.json
#    (must match the tag — Tauri embeds the conf.json version into the
#    MSI filename).

# 3. Commit the version bump.
git commit -am "release: v0.2.0"
git push

# 4. Tag and push the tag.
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

The push of the tag fires the workflow. About 12–15 min later (cold cache)
or 5–8 min (warm cache), the run completes and the MSI/NSIS artifacts are
downloadable from the run page.

### Deleting a bad tag

If you tagged the wrong commit or the build failed for transient reasons:

```bash
git tag -d v0.2.0                # delete locally
git push --delete origin v0.2.0  # delete on GitHub
# fix whatever's wrong, commit, then re-tag
```

Re-using the same tag number after a release that *people downloaded* is
strongly discouraged — bump the patch instead (`v0.2.1`).

## Downloading and verifying artifacts

1. Go to **Actions** → click the run for your tag.
2. Scroll to the **Artifacts** section at the bottom.
3. Click `wenmei-windows-msi` or `wenmei-windows-nsis` to download a
   ZIP containing the installer.

GitHub keeps workflow artifacts for **90 days by default**. For long-term
archival, attach them to a GitHub Release (manual step today; can be
automated by adding `softprops/action-gh-release` once we promote tags
to Releases).

## Caveats and future work

The current workflow gets you a build, not a polished distribution. Known
gaps:

- **No code signing.** The MSI/NSIS are unsigned, so Windows SmartScreen
  warns on first launch. Adding signing requires a code-signing
  certificate (EV recommended) stored as the GitHub secret
  `WINDOWS_CERT_PFX_BASE64` plus a password secret, then a `signtool`
  step before the upload.
- **No GitHub Release creation.** The workflow only attaches artifacts
  to the run. To turn a tag into a public Release page with download
  links, add a `softprops/action-gh-release@v2` step gated on
  `if: startsWith(github.ref, 'refs/tags/')`.
- **No macOS job yet.** macOS universal DMGs are still built manually.
  Adding a `macos-latest` job means setting up Apple notarization
  secrets (`APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`,
  `APPLE_CERTIFICATE`) — covered in `PACKAGING.md` once we get there.
- **Bundled `scripts/*.sh` ship inside the MSI** as inert files. To prune
  per-platform, add a `bundle.windows.resources` block in
  `tauri.conf.json` listing only the Windows-relevant resources.
- **No release-notes automation.** Currently you write release notes
  manually if you create a Release page. Conventional-commits +
  `release-please` is the usual upgrade.

## Local cross-check

To validate that the Windows build will compile *before* tagging, you can
type-check the Windows target on macOS without running CI:

```bash
rustup target add x86_64-pc-windows-gnu
brew install mingw-w64           # one-time, for tauri-winres' resource compiler
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-gnu
```

This catches platform-conditional compile errors locally. It does not
produce a runnable Windows binary — for that you still need the CI job
(or a real Windows host).
