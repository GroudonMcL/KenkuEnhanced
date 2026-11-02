// helper/config.js
// Loads settings. Defaults live here; anything in config.json (in the project
// root, next to package.json) overrides them. config.json is git-ignored so your
// API keys never end up on GitHub.
//
// The Settings pane in the dashboard edits this file through saveConfig() below,
// so normally you never need to open config.json by hand.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

const defaults = {
  port: 4000,
  kenku: { host: "127.0.0.1", port: 3333 },
  downloadsFolder: path.join(ROOT, "downloads"),
  apiKeys: { youtube: "", freesound: "", pixabay: "" },
  // Off-by-default experiments (⚙ Settings → Experimental)
  experimental: { ttaProxy: false },
};

let loadError = null; // set if config.json exists but couldn't be read

function loadConfig() {
  let user = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch (err) {
      loadError = err.message;
      // Usually a missing/extra comma, quote or bracket after hand-editing.
      console.error("");
      console.error("!! Could not read config.json – there's a typing mistake in it:");
      console.error(`!!   ${err.message}`);
      console.error("!! Compare it with config.example.json (every line except the last in a");
      console.error("!! { } block ends with a comma, and every text value is in \"quotes\").");
      console.error("!! Or delete config.json and restart: a fresh one will be created.");
      console.error("!! Using default settings for now (YouTube search won't work).");
      console.error("");
    }
  }
  // Merge one level deep so e.g. { kenku: { port: 3334 } } keeps the default host.
  return {
    ...defaults,
    ...user,
    kenku: { ...defaults.kenku, ...(user.kenku || {}) },
    apiKeys: { ...defaults.apiKeys, ...(user.apiKeys || {}) },
    experimental: { ...defaults.experimental, ...(user.experimental || {}) },
  };
}

const config = loadConfig();

// Handy full URL for Kenku Remote, e.g. "http://127.0.0.1:3333"
function updateKenkuUrl() {
  config.kenkuUrl = `http://${config.kenku.host}:${config.kenku.port}`;
}
updateKenkuUrl();

// Save new settings to config.json and apply them straight away.
// `changes` has the same shape as config.json; only the given parts change.
function saveConfig(changes) {
  const next = {
    port: changes.port ?? config.port,
    host: changes.host ?? config.host,
    kenku: { ...config.kenku, ...(changes.kenku || {}) },
    downloadsFolder: changes.downloadsFolder ?? config.downloadsFolder,
    apiKeys: { ...config.apiKeys, ...(changes.apiKeys || {}) },
    experimental: { ...config.experimental, ...(changes.experimental || {}) },
  };
  if (!next.host) delete next.host; // keep the file tidy when not used

  // If the old file was broken, keep a copy rather than silently losing it.
  if (loadError && fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH.replace(/\.json$/, ".broken.json"));
    loadError = null;
  }
  // Write to a temporary file first, then swap it in, so a crash mid-write
  // can't leave you with half a config file.
  const tmp = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, CONFIG_PATH);

  // Update the live settings object in place (other files hold a reference to it).
  Object.assign(config, next);
  if (!next.host) delete config.host;
  updateKenkuUrl();
}

module.exports = config;
// Not enumerable, so they don't show up if the config is ever printed or saved.
Object.defineProperty(config, "save", { value: saveConfig });
Object.defineProperty(config, "loadError", { get: () => loadError });
