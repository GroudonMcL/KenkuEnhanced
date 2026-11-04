# Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on a Windows machine.
You don't need Windows or Inno Setup yourself.

## Steps

1. On GitHub go to **Actions → Release → Run workflow**, keep the branch on `main`, and pick
   the kind of version:
   - **patch** (the default) for fixes: `0.1.1` → `0.1.2`;
   - **minor** for new features: `0.1.1` → `0.2.0`;
   - **major**: `0.1.1` → `1.0.0`.

   Every installed dashboard compares this number with its own.
2. The workflow does the rest:
   - it changes `version` in `package.json` and `package-lock.json`, commits that to `main`
     ("Release v0.1.2") and tags it `v0.1.2`. If the version already in `package.json` was
     never released, it releases that one as is instead of skipping it;
   - it builds and smoke-tests the helper, then publishes the release with:
     - `KenkuEnhanced-Setup-v0.1.2.exe`: the installer;
     - `KenkuEnhanced-v0.1.2-windows.zip`: the portable copy, which is also what one-click
       updates download;
     - `SHA256SUMS.txt`: fingerprints the updater checks.

   The release notes are generated from the commits since the last release. You can edit
   them on GitHub afterwards; the dashboard's update window shows them.
3. Within a few hours (or straight away after a restart), installed dashboards show
   **Update available: v0.1.2**.

After a release, `main` has a new commit from the workflow: pull before you work on it.

**Test build first (optional):** pick **test-build-only** instead. It builds everything on the
branch you choose without a new version or a release; download the files from the run's
**Artifacts** and try the installer on a Windows PC.

**By hand (still works):** set the version yourself (`npm version 0.2.0 --no-git-tag-version`),
commit and push it to `main`, then `git tag v0.2.0` and `git push origin v0.2.0`. The
workflow checks that the tag matches `package.json`, then builds and publishes.

## Good to know
- The version step pushes to `main` with the workflow's own token. If you ever protect `main`
  so that only pull requests can change it, allow GitHub Actions to push there (or release by
  hand as above).
- **Don't delete or replace the files of a published release.** Dashboards may be downloading
  them. If a release is broken, publish a new, higher version instead.
- Pre-releases (ticked "This is a pre-release" on GitHub) are ignored by the update check, so
  you can use them for testing.
- The installer is **unsigned**, so Windows SmartScreen warns about it ("Windows protected your
  PC"). Signing needs a paid code-signing certificate. If you get one, add a signing step
  after "Build the installer" in the workflow.
- The installer's `AppId` in `installer/KenkuEnhanced.iss` must never change, or Windows will
  treat new versions as a different app.
- `KenkuEnhanced.exe` (what the shortcuts start) is compiled from `installer/launcher/KenkuEnhanced.cs`
  by the C# compiler that comes with Windows, in the workflow. The smoke test checks it starts the
  helper in the background and that `launch.js --stop` stops it.
- Node.js is bundled from the version the workflow installs (`node-version: "22"`). Bump it
  there when Node 22 reaches end of life.

## How one-click updates work
See the comments at the top of `helper/update.js` and `helper/updater.js`. In short:
1. The helper downloads the ZIP and checks its SHA-256 against `SHA256SUMS.txt`.
2. It unzips into `update/staging`.
3. It starts the **new** `updater.js` (with the new `node.exe`), then exits with code 75.
   `Start KenkuEnhanced.bat` closes its window on that code.
   It tells the updater how the helper ran (`--restart window` = in the background behind the
   KenkuEnhanced window, `--restart console` = in a black window), so it comes back the same way.
4. The updater waits for the old helper to close. It moves the old files to
   `update/backup-<version>-<time>`, copies the new ones in, and starts the helper again.
   If anything fails, it rolls back.

It never touches `config.json`, `data/`, `downloads/`, `update/` or `logs/`.
To test it locally without GitHub, set `KE_GITHUB_API` and `KE_DOWNLOAD_PREFIX` to point at a
fake server (see the top of `helper/update.js`).
