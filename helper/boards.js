// helper/boards.js
// Stores your scenes in data/boards.json. Since the tile redesign, a scene IS a
// saved board: its tiles, where they are, how big, what's in them, and which
// ones start (▶ auto) when you switch to it.
//
//   GET /api/boards  → { scenes: [...], activeId }
//   PUT /api/boards  ← { scenes: [...], activeId }   (replaces the whole file)
//
// A scene: { id, name, color, fadeSeconds, tags: [], notes,
//            layout: { version: 1, items: [{ id, type, x, y, w, h, collapsed, auto, customTitle, config }] } }
//
// The scenes from before the redesign stay untouched in data/scenes.json (a
// backup – the dashboard no longer reads them).

const express = require("express");
const { readJson, writeJson } = require("./datafile");

function validate(body) {
  const scenes = body?.scenes;
  if (!Array.isArray(scenes)) return "scenes must be a list";
  if (scenes.length > 200) return "too many scenes (max 200)";
  for (const s of scenes) {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string") return "every scene needs an id and a name";
    if (!s.layout || !Array.isArray(s.layout.items)) return `scene "${s.name}" has no layout`;
    if (s.layout.items.length > 100) return `scene "${s.name}" has too many tiles (max 100)`;
  }
  if (body.activeId != null && typeof body.activeId !== "string") return "activeId must be text";
  return null;
}

module.exports = function boardsRouter(jsonOnly) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const data = readJson("boards");
    res.json({ scenes: data?.scenes || [], activeId: data?.activeId || null, exists: !!data });
  });

  router.put("/", jsonOnly, (req, res) => {
    const problem = validate(req.body);
    if (problem) return res.status(400).json({ error: problem });
    try {
      writeJson("boards", { version: 1, activeId: req.body.activeId || null, scenes: req.body.scenes }, { backup: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: `Couldn't save scenes: ${err.message}` });
    }
  });

  return router;
};
