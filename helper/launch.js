// helper/launch.js
// What the KenkuEnhanced shortcut runs (through KenkuEnhanced.exe, which runs this
// with the bundled node.exe and no black window):
//
//   1. Is the helper already running? (asks http://127.0.0.1:<port>/health)
//   2. If not, start it in the background: no window, its messages go to
//      logs/helper.log.
//   3. Open the small KenkuEnhanced window (dashboard/launcher.html) as an app
//      window of Microsoft Edge (or Chrome), which every Windows 10/11 PC has. It
//      shows the version, updates, and opens Kenku.
//
//   node helper/launch.js               start (if needed) + open the window
//   node helper/launch.js --background  start (if needed), no window (sign-in start-up, after updates)
//   node helper/launch.js --stop        stop the helper (the uninstaller uses this)
//
// Errors go to stderr; KenkuEnhanced.exe shows them in a message box.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");
const LOG = path.join(LOG_DIR, "helper.log");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The port, from config.json (without loading the whole config module, which
// prints warnings meant for the helper's own window).
function port() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).port;
    if (Number.isInteger(p)) return p;
  } catch { /* no config.json yet, or a broken one: the helper will say */ }
  return 4000;
}
const PORT = port();
const BASE = `http://127.0.0.1:${PORT}`;

async function health() {
  try {
    const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(1500) });
    const h = await r.json();
    return h.helper === "ok" ? h : null;
  } catch {
    return null;
  }
}

function tail(file, lines = 8) {
  try {
    return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// Start the helper with no window. Its output goes to logs/helper.log (the
// previous run's log is kept as helper.old.log).
async function startHelper() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    if (fs.existsSync(LOG)) fs.renameSync(LOG, path.join(LOG_DIR, "helper.old.log"));
  } catch { /* in use: just append */ }
  // First run: make config.json from the template (as Start KenkuEnhanced.bat does)
  const cfg = path.join(ROOT, "config.json");
  if (!fs.existsSync(cfg) && fs.existsSync(path.join(ROOT, "config.example.json"))) {
    fs.copyFileSync(path.join(ROOT, "config.example.json"), cfg);
  }
  const out = fs.openSync(LOG, "a");
  const child = spawn(process.execPath, [path.join(ROOT, "helper", "server.js")], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, KE_MODE: "window" },
  });
  let exited = null;
  child.on("exit", (code) => (exited = code));
  child.unref();

  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await health()) return;
    if (exited !== null) break;
  }
  const why = tail(LOG);
  throw new Error(
    (exited !== null ? "The KenkuEnhanced helper stopped straight away." : "The KenkuEnhanced helper didn't start within 20 seconds.") +
    (why ? `\n\nIts last messages (from logs\\helper.log):\n${why}` : ""),
  );
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------
function findBrowser() {
  if (process.platform === "win32") {
    const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const apps = [["Microsoft", "Edge", "Application", "msedge.exe"], ["Google", "Chrome", "Application", "chrome.exe"]];
    for (const app of apps) {
      for (const root of roots) {
        const p = path.join(root, ...app);
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }
  if (process.platform === "darwin") {
    for (const p of ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  for (const dir of (process.env.PATH || "").split(":")) {
    for (const name of ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function openWindow() {
  const url = `http://localhost:${PORT}/launcher.html?auto=1`;
  const browser = findBrowser();
  if (browser) {
    // Its own small profile, so it opens as a separate little window at this size
    // and doesn't mix with your normal browsing.
    const profile = path.join(ROOT, "data", "launcher-window");
    fs.mkdirSync(profile, { recursive: true });
    spawn(browser, [
      `--app=${url}`,
      "--window-size=400,500",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
    ], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return;
  }
  // No Edge or Chrome: the normal browser (a tab instead of a small window)
  if (process.platform === "win32") spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  if (has("--stop")) {
    await fetch(BASE + "/api/launcher/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    return;
  }
  // After an update the old helper may still be closing: give it a moment.
  const waitPid = Number(args[args.indexOf("--wait-pid") + 1]);
  if (has("--wait-pid") && waitPid) {
    for (let i = 0; i < 40; i++) {
      try { process.kill(waitPid, 0); } catch { break; }
      await sleep(250);
    }
  }
  if (!(await health())) await startHelper();
  if (!has("--background")) openWindow();
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}

module.exports = { findBrowser };
