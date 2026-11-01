// helper/links.js
// Your saved links (Tabletop Audio SoundPads, your Custom SoundPad share links,
// any other website) and the list of Tabletop Audio's SoundPads.
//
//   GET /api/links            → { links: [...] }
//   PUT /api/links            ← { links: [...] }  (replaces the whole list)
//   GET /api/links/soundpads  → { soundpads: [...], fetchedAt, stale?, error? }
//
// A link looks like: { id, name, url, openIn: "auto" | "panel" | "tab" }
//
// About Tabletop Audio: we only read the *list* of SoundPads (names, pictures,
// links) from https://tabletopaudio.com/soundpad.html, once a day. The SoundPads
// themselves always run on Tabletop Audio's own site, in a Kenku tab. We never
// download or copy their audio (it isn't licensed for that).

const express = require("express");
const { readList, writeList, readJson, writeJson } = require("./datafile");

const TTA = "https://tabletopaudio.com/";
const CUSTOM_SOUNDPAD = TTA + "custom_sp.html";

// What you get before you've saved any links of your own.
const DEFAULT_LINKS = [
  { id: "l-tta-soundpads", name: "Tabletop Audio SoundPads", url: TTA + "soundpad.html", openIn: "auto" },
  { id: "l-tta-custom", name: "Custom SoundPad", url: CUSTOM_SOUNDPAD, openIn: "auto" },
  { id: "l-tta-home", name: "Tabletop Audio", url: TTA, openIn: "auto" },
];

const OPEN_IN = ["auto", "panel", "tab"];

function validate(links) {
  if (!Array.isArray(links)) return "links must be a list";
  if (links.length > 500) return "too many links (max 500)";
  for (const l of links) {
    if (!l || typeof l.id !== "string" || typeof l.name !== "string" || !l.name.trim()) return "every link needs an id and a name";
    if (l.name.length > 80) return `The name "${l.name.slice(0, 20)}…" is too long (max 80 characters).`;
    try {
      if (!["http:", "https:"].includes(new URL(l.url).protocol)) throw new Error();
    } catch {
      return `"${l.name}" needs a full web address starting with https://`;
    }
    if (l.openIn !== undefined && !OPEN_IN.includes(l.openIn)) return "openIn must be auto, panel or tab";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The SoundPad list
// ---------------------------------------------------------------------------
// Turn tabletopaudio.com/soundpad.html into
//   [{ name, url, image, sounds, description, categories: ["fantasy"], isNew }]
// Each SoundPad on that page is a block like:
//   <div class="col-md-3 mix historical fantasy" role="listitem">
//     <h3 ...>Vikings</h3> <sup> *new* </sup> <i ...>40 sounds</i>
//     <span class="white flavor">Build your clan ...</span>
//     <a ... href="vikings_sp.html"> ... <img data-src="https://images...jpg">
// If they redesign the page this finds nothing, and the dashboard falls back to a
// plain "open the SoundPad page" link.
function parseSoundpads(html) {
  const text = (s) =>
    String(s || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const out = [];
  const seen = new Set();
  const blocks = html.split(/<div[^>]+class=["']col-[\w-]+ mix\b/i).slice(1);
  for (const block of blocks) {
    const classes = (block.match(/^([^"']*)["']/) || [])[1] || "";
    const href = (block.match(/href=["']([\w-]+_sp\.html)["']/i) || [])[1];
    const name = text((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    if (!href || !name || seen.has(href)) continue;
    seen.add(href);
    out.push({
      name,
      url: TTA + href,
      image: (block.match(/data-src=["'](https:\/\/[^"']+\.(?:jpe?g|png|webp))["']/i) || [])[1] || null,
      sounds: Number((block.match(/(\d+)\s+sounds/i) || [])[1]) || null,
      description: text((block.match(/class=["'][^"']*\bflavor\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]),
      categories: classes.split(/\s+/).filter((c) => c && c !== "mix" && !/^col-/.test(c)),
      isNew: /\*new\*/i.test(block.slice(0, 400)),
    });
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
let soundpadCache = readJson("soundpads"); // { fetchedAt, soundpads } from the last good fetch

async function getSoundpads(force) {
  if (!force && soundpadCache?.soundpads?.length && Date.now() - soundpadCache.fetchedAt < DAY) {
    return soundpadCache;
  }
  try {
    const r = await fetch(TTA + "soundpad.html", {
      headers: { "User-Agent": "Mozilla/5.0 KenkuEnhanced (SoundPad list)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Tabletop Audio answered ${r.status}`);
    const soundpads = parseSoundpads(await r.text());
    if (!soundpads.length) throw new Error("Couldn't read the SoundPad list (the page may have changed)");
    soundpadCache = { fetchedAt: Date.now(), soundpads };
    try { writeJson("soundpads", soundpadCache); } catch { /* the in-memory copy still works */ }
    return soundpadCache;
  } catch (err) {
    const error = err.cause?.code ? `Couldn't reach Tabletop Audio (${err.cause.code})` : err.message;
    // An old list is better than none (e.g. playing offline)
    if (soundpadCache?.soundpads?.length) return { ...soundpadCache, stale: true, error };
    return { fetchedAt: null, soundpads: [], error };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// jsonOnly: middleware from server.js that only accepts real JSON requests.
module.exports = function linksRouter(jsonOnly) {
  const router = express.Router();

  router.get("/", (req, res) => res.json({ links: readList("links") ?? DEFAULT_LINKS }));

  router.put("/", jsonOnly, (req, res) => {
    const links = req.body?.links;
    const problem = validate(links);
    if (problem) return res.status(400).json({ error: problem });
    try {
      writeList("links", links);
      res.json({ links });
    } catch (err) {
      res.status(500).json({ error: `Couldn't save links: ${err.message}` });
    }
  });

  router.get("/soundpads", async (req, res) => {
    res.json(await getSoundpads(req.query.refresh === "1"));
  });

  return router;
};

module.exports.parseSoundpads = parseSoundpads;
