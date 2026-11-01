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

const express = require("express");
const { readList, writeList } = require("./datafile");

const readScenes = () => readList("scenes") || [];
const writeScenes = (scenes) => writeList("scenes", scenes);

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
