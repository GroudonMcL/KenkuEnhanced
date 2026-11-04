// helper/launcher.js
// The small KenkuEnhanced window (dashboard/launcher.html) talks to these:
//
//   GET  /api/launcher/status        → version, how the helper runs, Kenku found/running, settings
//   POST /api/launcher/open-kenku    → start Kenku FM (if it's open already, Kenku brings itself to the front)
//   POST /api/launcher/settings      → { kenkuPath, autoOpenKenku, stopWithKenku }
//   POST /api/launcher/restart       → restart the helper (e.g. after changing the port)
//   POST /api/launcher/stop          → stop the helper
//
// They only answer this PC (never another device, even with "Allow other devices"
// on), because they start programs.
//
// "Stop with Kenku": when the helper runs in the background (started by the
// KenkuEnhanced window, not the black console window), it closes itself about a
// minute after Kenku closes, so nothing is left running in the background.

const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const express = require("express");
const config = require("./config");
const pkg = require("../package.json");

const ROOT = path.join(__dirname, "..");
// "window" = started hidden by helper/launch.js; "console" = the black window (Start KenkuEnhanced.bat / npm start)
const MODE = process.env.KE_MODE === "window" ? "window" : "console";
const STARTED_AT = Date.now();

const kenkuPath = () => String(config.launcher.kenkuPath || "").trim();
const exeName = () => path.basename(kenkuPath() || "kenku-fm.exe");

// Is Kenku FM running? On Windows, ask the task list for its program name.
// Elsewhere (for testing), "running" = Kenku Remote answers.
function kenkuRunning() {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("tasklist", ["/FI", `IMAGENAME eq ${exeName()}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000 }, (err, out) => {
        resolve(err ? null : String(out).toLowerCase().includes(`"${exeName().toLowerCase()}"`));
      });
    });
  }
  return fetch(config.kenkuUrl + "/v1/playlist", { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
}

function openKenku() {
  const exe = kenkuPath();
  if (!exe) throw new Error("Tell KenkuEnhanced where Kenku FM is first (⚙ in this window).");
  if (!fs.existsSync(exe)) throw new Error(`Kenku FM isn't at ${exe}. Click ⚙ and choose where kenku-fm.exe is.`);
  spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" }).unref();
}

// Start a fresh helper (in the same way this one runs), then close this one.
function restartHelper() {
  const node = process.execPath;
  if (MODE === "window") {
    spawn(node, [path.join(ROOT, "helper", "launch.js"), "--background", "--wait-pid", String(process.pid)], {
      cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
  } else if (process.platform === "win32" && fs.existsSync(path.join(ROOT, "Start KenkuEnhanced.bat"))) {
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", "Start KenkuEnhanced.bat", "--console"], {
      cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
  } else {
    const out = fs.openSync(path.join(ROOT, "logs", "helper.log"), "a");
    spawn(node, [path.join(ROOT, "helper", "server.js")], { cwd: ROOT, detached: true, stdio: ["ignore", out, out] }).unref();
  }
  // The new one waits until this one has let go of the port. (75 = "closing for a
  // restart": Start KenkuEnhanced.bat then closes its old window instead of pausing.)
  setTimeout(() => process.exit(75), 300);
}

// ---------------------------------------------------------------------------
// Stop with Kenku (background helper only)
// ---------------------------------------------------------------------------
let seenKenku = false;
let missing = 0;
let busy = () => false; // set by server.js: true while an update is installing
function watchKenku() {
  if (MODE !== "window") return;
  setInterval(async () => {
    const running = await kenkuRunning();
    if (running === null) return; // couldn't tell
    if (running) {
      seenKenku = true;
      missing = 0;
      return;
    }
    if (!seenKenku || !config.launcher.stopWithKenku || busy()) return;
    // Closed for about a minute (not just restarting) → stop
    if (++missing >= 4) {
      console.log("  Kenku FM was closed, so the helper stops too. (Switch this off in the KenkuEnhanced window: ⚙)");
      process.exit(0);
    }
  }, 15000).unref();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
module.exports = function launcherRouter(jsonOnly, { restartNeeded, isUpdating } = {}) {
  if (isUpdating) busy = isUpdating;
  watchKenku();
  const router = express.Router();

  // Only this computer
  router.use((req, res, next) => {
    const ip = req.socket.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return next();
    res.status(403).json({ error: "The KenkuEnhanced window only works on the PC the helper runs on." });
  });

  router.get("/status", async (req, res) => {
    const exe = kenkuPath();
    res.json({
      version: pkg.version,
      mode: MODE,
      platform: process.platform,
      startedAt: STARTED_AT,
      restartNeeded: restartNeeded ? restartNeeded() : false,
      kenku: { path: exe, found: !!exe && fs.existsSync(exe), running: await kenkuRunning() },
      settings: { ...config.launcher },
      dashboard: `http://localhost:${config.port}`,
    });
  });

  router.post("/open-kenku", jsonOnly, (req, res) => {
    try {
      openKenku();
      seenKenku = false; // (count it as "seen" once it's really running)
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/settings", jsonOnly, (req, res) => {
    const b = req.body || {};
    const changes = {};
    if (typeof b.kenkuPath === "string") {
      // People paste paths with quotes from "Copy as path"
      const p = b.kenkuPath.trim().replace(/^"(.*)"$/, "$1");
      if (p && !/\.exe$/i.test(p) && process.platform === "win32") return res.status(400).json({ error: "Choose the Kenku FM program itself: kenku-fm.exe." });
      changes.kenkuPath = p;
    }
    for (const k of ["autoOpenKenku", "stopWithKenku"]) if (typeof b[k] === "boolean") changes[k] = b[k];
    try {
      config.save({ launcher: changes });
    } catch (err) {
      return res.status(500).json({ error: `Couldn't save config.json: ${err.message}` });
    }
    res.json({ ok: true, settings: { ...config.launcher }, found: !!kenkuPath() && fs.existsSync(kenkuPath()) });
  });

  router.post("/restart", jsonOnly, (req, res) => {
    res.json({ ok: true });
    restartHelper();
  });

  router.post("/stop", jsonOnly, (req, res) => {
    res.json({ ok: true });
    console.log("  Stopped from the KenkuEnhanced window.");
    setTimeout(() => process.exit(0), 300);
  });

  return router;
};

module.exports.MODE = MODE;
