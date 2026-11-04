// helper/update.js
// "Update available" badge + one-click updates from GitHub Releases.
//
//   GET  /api/version         → { current, latest, updateAvailable, url, notes, canSelfUpdate, why }
//   POST /api/update/install  → starts downloading the new version (answers straight away)
//   GET  /api/update/status   → { state, percent, message }  (the dashboard polls this)
//
// How an update works:
//   1. Download KenkuEnhanced-vX.Y.Z-windows.zip and SHA256SUMS.txt from the
//      latest GitHub release, and check the zip's fingerprint (SHA-256) matches.
//   2. Unzip it into update/staging/.
//   3. Start helper/updater.js FROM THE NEW COPY, then this helper exits.
//      The updater waits for us to close, moves the old files to update/backup/,
//      copies the new ones in (config.json, data/ and downloads/ are never touched),
//      and starts the helper again. If anything goes wrong it puts the old files back.
//   4. The dashboard sees the new version on /health and reloads itself.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { Readable } = require("stream");
const express = require("express");
const pkg = require("../package.json");

const ROOT = path.join(__dirname, "..");
const UPDATE_DIR = path.join(ROOT, "update");
const REPO = "GroudonMcL/KenkuEnhanced";
// Overridable so the tests can use a fake GitHub.
const API = process.env.KE_GITHUB_API || "https://api.github.com";
const DOWNLOAD_PREFIX = process.env.KE_DOWNLOAD_PREFIX || `https://github.com/${REPO}/releases/download/`;
const ZIP_PATTERN = /^KenkuEnhanced-v[\d.]+-windows\.zip$/;
const EXIT_FOR_UPDATE = 75; // Start KenkuEnhanced.bat closes its window on this exit code

// "0.2.0" newer than "0.1.5"?
function isNewer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Can this copy update itself? Not when it's a Git checkout (use git pull), and
// not if we can't write to the folder (e.g. installed for all users in Program Files).
function selfUpdateBlocker() {
  if (fs.existsSync(path.join(ROOT, ".git"))) return "This copy was downloaded with Git. Update it with \"git pull\", then run \"npm install\".";
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    fs.accessSync(UPDATE_DIR, fs.constants.W_OK);
  } catch {
    return `Can't write to ${ROOT}. Download the new version from GitHub instead.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Latest release (asked at most once an hour)
// ---------------------------------------------------------------------------
let releaseCache = { at: 0, release: null };

async function latestRelease(force) {
  if (force || Date.now() - releaseCache.at > 60 * 60 * 1000) {
    const r = await fetch(`${API}/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "KenkuEnhanced" },
      signal: AbortSignal.timeout(8000),
    });
    // 404 just means "no releases published yet"
    releaseCache = { at: Date.now(), release: r.ok ? await r.json() : null };
  }
  return releaseCache.release;
}

function findAssets(release) {
  const assets = release?.assets || [];
  return {
    zip: assets.find((a) => ZIP_PATTERN.test(a.name)),
    sums: assets.find((a) => a.name === "SHA256SUMS.txt"),
  };
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------
let job = { state: "idle", percent: 0, message: "" };
const setJob = (state, message = "", percent = job.percent) => {
  job = { state, message, percent };
  if (state === "error") console.error(`!! Update failed: ${message}`);
  else if (message) console.log(`  Update: ${message}`);
};

async function download(url, file, onProgress) {
  if (!url.startsWith(DOWNLOAD_PREFIX)) throw new Error(`Unexpected download address: ${url}`);
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "KenkuEnhanced" }, signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${path.basename(file)}`);
  const total = Number(r.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash("sha256");
  let done = 0;
  try {
    for await (const chunk of Readable.fromWeb(r.body)) {
      hash.update(chunk);
      done += chunk.length;
      if (total && onProgress) onProgress(done / total);
      if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  return hash.digest("hex");
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(`${path.basename(cmd)}: ${(stderr || err.message).trim()}`)) : resolve()));

// Unzip with what the computer already has: Windows 10+ has tar.exe (it reads zips),
// with PowerShell as a fallback; Mac/Linux have unzip or bsdtar.
async function unzip(zipFile, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const attempts = process.platform === "win32"
    ? [
        [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zipFile, "-C", dest]],
        ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]],
      ]
    : [["unzip", ["-q", "-o", zipFile, "-d", dest]], ["tar", ["-xf", zipFile, "-C", dest]]];
  let lastErr;
  for (const [cmd, args] of attempts) {
    try {
      return await run(cmd, args);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function install() {
  try {
    const blocker = selfUpdateBlocker();
    if (blocker) throw new Error(blocker);
    setJob("checking", "Asking GitHub for the latest version…", 0);
    const release = await latestRelease(true);
    const latest = release?.tag_name?.replace(/^v/, "");
    if (!latest || !isNewer(latest, pkg.version)) throw new Error("You already have the latest version.");
    const { zip, sums } = findAssets(release);
    if (!zip || !sums) throw new Error("This release has no Windows download yet. Try again later, or download it from GitHub.");

    // Start clean
    const staging = path.join(UPDATE_DIR, "staging");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const zipFile = path.join(UPDATE_DIR, zip.name);
    const sumsFile = path.join(UPDATE_DIR, "SHA256SUMS.txt");

    setJob("downloading", `Downloading version ${latest}…`, 0);
    await download(sums.browser_download_url, sumsFile);
    const actual = await download(zip.browser_download_url, zipFile, (f) => { job.percent = Math.round(f * 100); });

    setJob("verifying", "Checking the download…", 100);
    const expected = fs.readFileSync(sumsFile, "utf8").split(/\r?\n/)
      .map((l) => l.trim().split(/\s+\*?/))
      .find(([, name]) => name === zip.name)?.[0]?.toLowerCase();
    if (!expected) throw new Error("SHA256SUMS.txt doesn't list the download.");
    if (expected !== actual) throw new Error("The download is damaged (its fingerprint doesn't match). Please try again.");

    setJob("extracting", "Unpacking…");
    await unzip(zipFile, staging);
    // The zip holds one folder (KenkuEnhanced/); use what's inside it.
    let newRoot = staging;
    const top = fs.readdirSync(staging);
    if (top.length === 1 && fs.statSync(path.join(staging, top[0])).isDirectory()) newRoot = path.join(staging, top[0]);
    const newPkg = JSON.parse(fs.readFileSync(path.join(newRoot, "package.json"), "utf8"));
    if (newPkg.version !== latest) throw new Error(`The download says it's version ${newPkg.version}, expected ${latest}.`);
    if (!fs.existsSync(path.join(newRoot, "helper", "updater.js"))) throw new Error("The download looks incomplete.");

    // Start the NEW updater with the NEW node.exe if there is one, so the old
    // node.exe isn't in use and can be replaced.
    const bundledNode = path.join(newRoot, "node", "node.exe");
    const nodeExe = process.platform === "win32" && fs.existsSync(bundledNode) ? bundledNode : process.execPath;
    const log = fs.openSync(path.join(UPDATE_DIR, "update.log"), "a");
    // --restart: start the new helper the way this one runs (hidden for the
    // KenkuEnhanced window, or in a black window)
    const mode = process.env.KE_MODE === "window" ? "window" : "console";
    const child = spawn(nodeExe, [path.join(newRoot, "helper", "updater.js"), "--from", newRoot, "--to", ROOT, "--pid", String(process.pid), "--old", pkg.version, "--new", latest, "--restart", mode], {
      cwd: UPDATE_DIR,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    fs.rmSync(zipFile, { force: true });

    setJob("restarting", `Installing version ${latest} and restarting the helper…`, 100);
    // Give the dashboard a moment to see "restarting", then make way for the updater.
    setTimeout(() => process.exit(EXIT_FOR_UPDATE), 1500);
  } catch (err) {
    setJob("error", err.message);
    // Don't leave a half-finished or damaged download lying around
    try {
      for (const n of fs.readdirSync(UPDATE_DIR)) if (n.endsWith(".zip")) fs.rmSync(path.join(UPDATE_DIR, n), { force: true });
      fs.rmSync(path.join(UPDATE_DIR, "staging"), { recursive: true, force: true });
    } catch { /* nothing to tidy */ }
  }
}

// Tidy up after an update: keep only the newest backup.
function cleanupOldUpdates() {
  try {
    fs.rmSync(path.join(UPDATE_DIR, "staging"), { recursive: true, force: true });
    const backups = fs.readdirSync(UPDATE_DIR).filter((n) => n.startsWith("backup-")).sort();
    // names are backup-<old version>-<timestamp>; sort by timestamp
    backups.sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()));
    for (const old of backups.slice(0, -1)) fs.rmSync(path.join(UPDATE_DIR, old), { recursive: true, force: true });
  } catch { /* no update folder yet */ }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
module.exports = function updateRouter(jsonOnly) {
  cleanupOldUpdates();
  const router = express.Router();

  router.get("/version", async (req, res) => {
    const out = { current: pkg.version, latest: null, updateAvailable: false, url: null, notes: "", canSelfUpdate: false, why: null };
    try {
      const rel = await latestRelease(req.query.refresh === "1");
      if (rel?.tag_name) {
        out.latest = rel.tag_name.replace(/^v/, "");
        out.url = rel.html_url;
        out.notes = String(rel.body || "").slice(0, 4000);
        out.updateAvailable = isNewer(out.latest, out.current);
        const { zip, sums } = findAssets(rel);
        out.why = selfUpdateBlocker() || (!zip || !sums ? "This release has no Windows download yet." : null);
        out.canSelfUpdate = !out.why;
      }
    } catch {
      // Offline or GitHub unreachable: fail quietly.
    }
    res.json(out);
  });

  router.post("/update/install", jsonOnly, (req, res) => {
    if (["checking", "downloading", "verifying", "extracting", "restarting"].includes(job.state)) {
      return res.json(job); // already running
    }
    install(); // runs in the background; the page polls /api/update/status
    res.json({ state: "checking", percent: 0, message: "Starting…" });
  });

  router.get("/update/status", (req, res) => res.json(job));

  return router;
};

module.exports.isNewer = isNewer;
// true while an update is downloading/installing (the helper mustn't stop itself then)
module.exports.isBusy = () => ["checking", "downloading", "verifying", "extracting", "restarting"].includes(job.state);
module.exports.EXIT_FOR_UPDATE = EXIT_FOR_UPDATE;
