// helper/datafile.js
// Read and write the small JSON files in the data/ folder (scenes, links, ...).
// Writes are safe: the previous version is kept as <name>.backup.json, and the
// new file is written to a temporary file first and then swapped in, so a crash
// can never leave you with half a file.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// name: "scenes" → data/scenes.json, which looks like { version: 1, scenes: [...] }
function readList(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null; // never saved yet
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data[name]) ? data[name] : [];
  } catch (err) {
    console.error(`!! Could not read data/${name}.json (${err.message}). Is data/${name}.backup.json OK?`);
    return [];
  }
}

function writeList(name, list) {
  writeJson(name, { version: 1, [name]: list }, { backup: true });
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

function writeJson(name, data, { backup = false } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${name}.json`);
  if (backup && fs.existsSync(file)) fs.copyFileSync(file, path.join(DATA_DIR, `${name}.backup.json`));
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

module.exports = { readList, writeList, readJson, writeJson, DATA_DIR };
