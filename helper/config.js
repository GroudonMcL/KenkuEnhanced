// helper/config.js
// Loads settings. Defaults live here; anything in config.json (in the project
// root, next to package.json) overrides them. config.json is git-ignored so your
// API keys never end up on GitHub.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

const defaults = {
  port: 4000,
  kenku: { host: "127.0.0.1", port: 3333 },
  downloadsFolder: path.join(ROOT, "downloads"),
  apiKeys: { youtube: "", freesound: "", pixabay: "" },
};

function loadConfig() {
  let user = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch (err) {
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
  };
}

const config = loadConfig();

// Handy full URL for Kenku Remote, e.g. "http://127.0.0.1:3333"
config.kenkuUrl = `http://${config.kenku.host}:${config.kenku.port}`;

module.exports = config;
