// helper/scenes.js
// Stores your scenes in data/scenes.json (next to package.json).
// Kept on disk rather than in the browser, so they survive clearing the
// browser and you can back them up by copying the data folder.
//
//   GET /api/scenes  → { scenes: [...] }
//   PUT /api/scenes  ← { scenes: [...] }   (replaces the whole list)
//
// A scene looks like this (the dashboard creates them; see dashboard/js/scenes.js):
// {
//   id: "s-abc123", name: "Tavern", color: "#e0a526", fadeSeconds: 2,
//   music:   { mode: "keep" | "stop" | "play", playlistId: "...", volume: 70 },
//   sounds:  { ids: ["soundId", ...], stopOthers: true },
//   youtube: { players: [{ url, volume, loop }], stopOthers: true },
//   link: "https://tabletopaudio.com/...", notes: "..."
// }

const fs = require("fs");
const path = require("path");
const express = require("express");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "scenes.json");
const BACKUP = path.join(DATA_DIR, "scenes.backup.json");

function readScenes() {
  if (!fs.existsSync(FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data.scenes) ? data.scenes : [];
  } catch (err) {
    console.error(`!! Could not read data/scenes.json (${err.message}). Is data/scenes.backup.json OK?`);
    return [];
  }
}

function writeScenes(scenes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Keep the previous version as a backup, in case of a mistake.
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BACKUP);
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, scenes }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, FILE); // swap in the new file in one step
}

// Basic sanity check so a bug can't save rubbish over your scenes.
function validate(scenes) {
  if (!Array.isArray(scenes)) return "scenes must be a list";
  if (scenes.length > 200) return "too many scenes (max 200)";
  for (const s of scenes) {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string") return "every scene needs an id and a name";
  }
  return null;
}

// jsonOnly: middleware from server.js that only accepts real JSON requests.
module.exports = function scenesRouter(jsonOnly) {
  const router = express.Router();

  router.get("/", (req, res) => res.json({ scenes: readScenes() }));

  router.put("/", jsonOnly, (req, res) => {
    const scenes = req.body?.scenes;
    const problem = validate(scenes);
    if (problem) return res.status(400).json({ error: problem });
    try {
      writeScenes(scenes);
      res.json({ scenes });
    } catch (err) {
      res.status(500).json({ error: `Couldn't save scenes: ${err.message}` });
    }
  });

  return router;
};
