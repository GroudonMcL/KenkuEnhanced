// helper/updater.js
// Swaps in a new version. Started by helper/update.js from the NEW copy in
// update/staging/, after which the old helper exits. Not meant to be run by hand.
//
//   node updater.js --from <new files> --to <app folder> --pid <old helper> --old 0.1.0 --new 0.2.0
//
// Steps:
//   1. Wait for the old helper to close (so its files aren't in use).
//   2. Move each old file/folder into update/backup-<old version>-<time>/ ...
//   3. ...and copy the new one in its place.
//      Never touched: config.json, data/, downloads/, update/ (your settings and files).
//   4. If anything fails, put the old files back.
//   5. Start the helper again (a new "KenkuEnhanced helper" window on Windows).
// Everything is written to update/update.log.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const FROM = path.resolve(args.from);
const TO = path.resolve(args.to);
const PID = Number(args.pid);

// Your own stuff – never replaced or removed.
const KEEP = new Set(["config.json", "config.broken.json", "data", "downloads", "update", ".git"]);

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Windows sometimes holds a file for a moment after a program closes (antivirus,
// indexing). Retry a few times before giving up.
async function retry(what, fn) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= 10) throw new Error(`${what}: ${err.message}`);
      await sleep(500 * i);
    }
  }
}

function restart() {
  if (process.platform === "win32" && fs.existsSync(path.join(TO, "Start KenkuEnhanced.bat"))) {
    // `start ""` opens it in a new window, just like double-clicking it.
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", "Start KenkuEnhanced.bat"], {
      cwd: TO, detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
  } else {
    const out = fs.openSync(path.join(TO, "update", "helper.log"), "a");
    spawn(process.execPath, [path.join(TO, "helper", "server.js")], {
      cwd: TO, detached: true, stdio: ["ignore", out, out],
    }).unref();
  }
}

async function main() {
  log(`Updating ${TO} from ${args.old} to ${args.new}`);

  // 1. Wait for the old helper to close (at most 30 seconds)
  for (let i = 0; i < 60 && isRunning(PID); i++) await sleep(500);
  if (isRunning(PID)) throw new Error("The old helper didn't close.");
  await sleep(500);

  const backup = path.join(TO, "update", `backup-${args.old}-${Date.now()}`);
  fs.mkdirSync(backup, { recursive: true });
  const moved = [];  // names moved to the backup
  const added = [];  // names copied in

  try {
    for (const name of fs.readdirSync(FROM)) {
      if (KEEP.has(name)) continue;
      // The bundled node.exe only makes sense on Windows
      if (name === "node" && process.platform !== "win32") continue;
      const target = path.join(TO, name);
      if (fs.existsSync(target)) {
        await retry(`Moving old ${name}`, () => fs.renameSync(target, path.join(backup, name)));
        moved.push(name);
      }
      await retry(`Copying new ${name}`, () => fs.cpSync(path.join(FROM, name), target, { recursive: true }));
      added.push(name);
      log(`  replaced ${name}`);
    }
  } catch (err) {
    log(`!! ${err.message} – putting the old version back`);
    for (const name of added) fs.rmSync(path.join(TO, name), { recursive: true, force: true });
    for (const name of moved) fs.renameSync(path.join(backup, name), path.join(TO, name));
    restart();
    throw err;
  }

  log(`Done. The old version is kept in ${backup} until the next update.`);
  restart();
  log("Helper restarted.");
}

main().then(
  () => process.exit(0),
  (err) => {
    log(`!! Update failed: ${err.message}`);
    process.exit(1);
  },
);
