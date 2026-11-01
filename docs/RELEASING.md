# Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on a Windows machine.
You don't need Windows or Inno Setup yourself.

## Steps

1. **Pick the version number.** Use `MAJOR.MINOR.PATCH`, e.g. `0.2.0`. Bump PATCH for fixes,
   MINOR for new features. Every installed dashboard compares this number with its own.
2. **Change `version` in `package.json`** to that number, plus the matching `"version"` lines
   near the top of `package-lock.json`. The easiest way:
   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```
   Commit and push it to `main`.
3. **Optional: test the build first.** On GitHub go to **Actions → Release → Run workflow**
   (on `main`). It builds everything without publishing; download the files from the run's
   **Artifacts** and try the installer on a Windows PC.
4. **Tag and push:**
   ```bash
   git tag v0.2.0
   ```
   ```bash
   git push origin v0.2.0
   ```
   The workflow checks that the tag matches `package.json`. It builds and smoke-tests the
   helper, then publishes the release with:
   - `KenkuEnhanced-Setup-v0.2.0.exe`: the installer;
   - `KenkuEnhanced-v0.2.0-windows.zip`: the portable copy, which is also what one-click
     updates download;
   - `SHA256SUMS.txt`: fingerprints the updater checks.

   The release notes are generated from the commits since the last release. You can edit
   them on GitHub afterwards; the dashboard's update window shows them.
5. Within a few hours (or straight away after a restart), installed dashboards show
   **Update available: v0.2.0**.

## Good to know
- **Don't delete or replace the files of a published release.** Dashboards may be downloading
  them. If a release is broken, publish a new, higher version instead.
- Pre-releases (ticked "This is a pre-release" on GitHub) are ignored by the update check, so
  you can use them for testing.
- The installer is **unsigned**, so Windows SmartScreen warns about it ("Windows protected your
  PC"). Signing needs a paid code-signing certificate. If you get one, add a signing step
  after "Build the installer" in the workflow.
- The installer's `AppId` in `installer/KenkuEnhanced.iss` must never change, or Windows will
  treat new versions as a different app.
- Node.js is bundled from the version the workflow installs (`node-version: "22"`). Bump it
  there when Node 22 reaches end of life.

## How one-click updates work
See the comments at the top of `helper/update.js` and `helper/updater.js`. In short:
1. The helper downloads the ZIP and checks its SHA-256 against `SHA256SUMS.txt`.
2. It unzips into `update/staging`.
3. It starts the **new** `updater.js` (with the new `node.exe`), then exits with code 75.
   `Start KenkuEnhanced.bat` closes its window on that code.
4. The updater waits for the old helper to close. It moves the old files to
   `update/backup-<version>-<time>`, copies the new ones in, and starts the helper again.
   If anything fails, it rolls back.

It never touches `config.json`, `data/`, `downloads/` or `update/`.
To test it locally without GitHub, set `KE_GITHUB_API` and `KE_DOWNLOAD_PREFIX` to point at a
fake server (see the top of `helper/update.js`).
