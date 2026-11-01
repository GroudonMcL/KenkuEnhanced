// helper/sounds.js
// Sound search + download (Freesound), so you can find a sound in the dashboard,
// listen to it, and save it straight into your downloads folder.
//
//   GET  /api/sounds/search?q=rain&length=any&sort=score&page=1
//                         → { results: [...], count, page, hasMore }
//   POST /api/sounds/download     ← { id: 12345, subfolder: "Ambience" }
//                         → { file, folder, alreadyHad }
//   GET  /api/sounds/folders      → { folder, exists, subfolders: [...] }
//   POST /api/sounds/open-folder  ← { subfolder } opens it in Explorer / Finder
//   POST /api/sounds/test-key     → { ok, message } (Settings → Test button)
//
// Every download is also written to ATTRIBUTION.csv in the downloads folder
// (file, title, author, licence, link, date), so you always know who to credit.
//
// Why "preview" files: with a plain API key, Freesound only lets apps download
// its preview MP3s (about 128 kbps, which is plenty for Discord). The original
// WAV/FLAC files need a full Freesound login flow (OAuth) – maybe later.
//
// Pixabay's API only covers images and videos (no sounds), and BBC Sound Effects
// has no public API and a personal/educational-only licence, so the dashboard just
// opens those sites in a new tab instead.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const config = require("./config");

// Overridable so the tests can point it at a fake Freesound.
const API = process.env.FREESOUND_API || "https://freesound.org/apiv2";
const API_HOST = new URL(API).hostname;
const FIELDS = "id,name,username,license,duration,previews,images,tags,url,num_downloads,avg_rating";
const PAGE_SIZE = 15;
const MAX_BYTES = 50 * 1024 * 1024; // refuse anything bigger than 50 MB
const CSV_NAME = "ATTRIBUTION.csv";

// "Length" choices in the dashboard → Freesound duration filter (seconds)
const LENGTHS = {
  any: null,
  short: "duration:[0 TO 10]",       // one-shot effects: door, sword, spell
  medium: "duration:[10 TO 120]",
  long: "duration:[120 TO *]",       // ambience / loops
};
const SORTS = ["score", "downloads_desc", "rating_desc", "duration_asc", "created_desc"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function noKeyError() {
  return "No Freesound API key yet. Open ⚙ Settings and paste one in – the README explains how to get a free key.";
}

// Ask the Freesound API something. Throws an Error with a friendly message.
async function freesound(pathAndQuery, params = {}) {
  const key = config.apiKeys.freesound;
  if (!key) throw Object.assign(new Error(noKeyError()), { status: 400 });
  const url = `${API}${pathAndQuery}?` + new URLSearchParams({ ...params, token: key });
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "KenkuEnhanced" } });
  } catch (err) {
    throw Object.assign(new Error(`Couldn't reach Freesound (${err.cause?.code || err.name}).`), { status: 502 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.detail || data.error || r.statusText;
    let msg = `Freesound said: ${detail}`;
    if (r.status === 401) msg = "Freesound rejected the API key. Check it in ⚙ Settings (use the long \"API key\", not the client ID).";
    if (r.status === 404) msg = "Freesound doesn't have that sound any more.";
    if (r.status === 429) msg = "Too many Freesound requests for now (the free limit is 60 a minute, 2000 a day). Try again shortly.";
    throw Object.assign(new Error(msg), { status: r.status === 404 ? 404 : 502 });
  }
  return data;
}

// "http://creativecommons.org/licenses/by-nc/4.0/" → { short: "CC BY-NC 4.0", ... }
function describeLicence(url = "") {
  const version = (url.match(/\/(\d\.\d)\/?$/) || [])[1];
  const v = version ? " " + version : "";
  let short = "Unknown licence";
  if (/publicdomain\/zero/i.test(url)) short = "CC0";
  else if (/sampling\+/i.test(url)) short = "Sampling+";
  else if (/licenses\/by-nc/i.test(url)) short = "CC BY-NC" + v;
  else if (/licenses\/by\b/i.test(url)) short = "CC BY" + v;
  return {
    short,
    url,
    needsCredit: short !== "CC0",
    nonCommercial: /by-nc|sampling/i.test(url),
  };
}

// "Heavy Rain on roof.wav" → "heavy-rain-on-roof"
function slug(text) {
  const s = String(text || "")
    .replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return s || "sound";
}

// A subfolder name typed in the dashboard, e.g. "Ambience". One level only,
// nothing that could escape the downloads folder or upset Windows.
function cleanSubfolder(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (s.length > 60 || !/^[\w][\w \-()&']*$/.test(s) || /\s$/.test(s)) {
    throw Object.assign(new Error("Folder names can use letters, numbers, spaces, - and _ (no slashes or dots)."), { status: 400 });
  }
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) {
    throw Object.assign(new Error(`"${s}" is a name Windows doesn't allow for folders.`), { status: 400 });
  }
  return s;
}

function subfolders() {
  try {
    return fs.readdirSync(config.downloadsFolder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Which Freesound sounds are already downloaded? Looks for "..._freesound-12345.mp3"
// in the downloads folder and its subfolders. → Map(id → "Ambience/rain_freesound-12345.mp3")
function downloadedIds() {
  const found = new Map();
  const scan = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile()) {
        const m = e.name.match(/_freesound-(\d+)\.\w+$/);
        if (m) found.set(Number(m[1]), prefix + e.name);
      } else if (e.isDirectory() && !prefix && !e.name.startsWith(".")) {
        scan(path.join(dir, e.name), e.name + "/");
      }
    }
  };
  scan(config.downloadsFolder, "");
  return found;
}

// One CSV cell: wrap in quotes if needed, double any quotes inside.
function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function appendAttribution(row) {
  const file = path.join(config.downloadsFolder, CSV_NAME);
  const columns = ["file", "title", "author", "source", "licence", "licence_url", "source_url", "downloaded"];
  let text = "";
  // The "﻿" mark at the start makes Excel read accents and emoji correctly.
  if (!fs.existsSync(file)) text += "﻿" + columns.join(",") + "\r\n";
  text += columns.map((c) => csvCell(row[c])).join(",") + "\r\n";
  fs.appendFileSync(file, text, "utf8");
}

// Keep only what the dashboard needs from a Freesound result.
function simplify(s, downloaded) {
  return {
    id: s.id,
    title: String(s.name || "").replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, ""),
    author: s.username,
    duration: s.duration,
    licence: describeLicence(s.license),
    preview: s.previews?.["preview-hq-mp3"] || s.previews?.["preview-lq-mp3"] || null,
    waveform: s.images?.waveform_m || null,
    tags: (s.tags || []).slice(0, 6),
    url: s.url || `https://freesound.org/s/${s.id}/`,
    downloads: s.num_downloads ?? null,
    rating: s.avg_rating ?? null,
    downloaded: downloaded.get(s.id) || null,
  };
}

// Open a folder in the computer's file manager.
function openInFileManager(dir) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("spawn", () => { child.unref(); resolve(); });
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// jsonOnly: middleware from server.js that only accepts real JSON requests.
module.exports = function soundsRouter(jsonOnly) {
  const router = express.Router();
  const cache = new Map(); // search params → { at, data }

  const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

  router.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Type something to search for." });
    if (!config.apiKeys.freesound) return res.status(400).json({ error: noKeyError() });
    const length = LENGTHS[req.query.length] !== undefined ? req.query.length : "any";
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : "score";
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 50);

    const params = { query: q, fields: FIELDS, page_size: String(PAGE_SIZE), page: String(page), sort };
    if (LENGTHS[length]) params.filter = LENGTHS[length];

    const cacheKey = JSON.stringify(params).toLowerCase();
    try {
      let data = cache.get(cacheKey);
      if (!data || Date.now() - data.at > 30 * 60 * 1000) {
        data = { at: Date.now(), data: await freesound("/search/text/", params) };
        cache.set(cacheKey, data);
        if (cache.size > 200) cache.delete(cache.keys().next().value); // forget the oldest
      }
      const downloaded = downloadedIds(); // checked fresh every time
      res.json({
        results: (data.data.results || []).map((s) => simplify(s, downloaded)),
        count: data.data.count ?? 0,
        page,
        hasMore: !!data.data.next,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/download", jsonOnly, async (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Which sound? (missing id)" });
    try {
      const sub = cleanSubfolder(req.body?.subfolder);

      const already = downloadedIds().get(id);
      if (already) return res.json({ file: already, folder: config.downloadsFolder, alreadyHad: true });

      // Ask Freesound for the details ourselves rather than trusting the page,
      // so the attribution is right and we only ever download from Freesound.
      const info = await freesound(`/sounds/${id}/`, { fields: FIELDS });
      const previewUrl = info.previews?.["preview-hq-mp3"] || info.previews?.["preview-lq-mp3"];
      if (!previewUrl) throw Object.assign(new Error("Freesound has no MP3 for this sound."), { status: 502 });
      const host = new URL(previewUrl).hostname;
      if (!(host === "freesound.org" || host.endsWith(".freesound.org") || host === API_HOST)) {
        throw Object.assign(new Error(`Unexpected download address (${host}).`), { status: 502 });
      }

      let r;
      try {
        r = await fetch(previewUrl, { signal: AbortSignal.timeout(60000), headers: { "User-Agent": "KenkuEnhanced" } });
      } catch (err) {
        throw Object.assign(new Error(`Couldn't download from Freesound (${err.cause?.code || err.name}).`), { status: 502 });
      }
      if (!r.ok) throw Object.assign(new Error(`Freesound download failed (${r.status}).`), { status: 502 });
      if (Number(r.headers.get("content-length")) > MAX_BYTES) {
        throw Object.assign(new Error("That file is over 50 MB – too big."), { status: 413 });
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw Object.assign(new Error("That file is over 50 MB – too big."), { status: 413 });

      const dir = path.join(config.downloadsFolder, sub);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        throw Object.assign(new Error(`Couldn't create ${dir}: ${err.message}. Check the downloads folder in ⚙ Settings.`), { status: 500 });
      }
      const name = `${slug(info.name)}_freesound-${id}.mp3`;
      const file = path.join(dir, name);
      const tmp = file + ".part";
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, file); // never leave a half-written MP3 behind

      const relative = sub ? `${sub}/${name}` : name;
      const licence = describeLicence(info.license);
      try {
        appendAttribution({
          file: relative,
          title: String(info.name || "").replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, ""),
          author: info.username,
          source: "Freesound",
          licence: licence.short,
          licence_url: licence.url,
          source_url: info.url || `https://freesound.org/s/${id}/`,
          downloaded: new Date().toISOString().slice(0, 10),
        });
      } catch (err) {
        // Usually ATTRIBUTION.csv is open in Excel, which locks it on Windows.
        return res.json({
          file: relative, folder: config.downloadsFolder, alreadyHad: false,
          warning: `Saved, but couldn't add it to ${CSV_NAME} (${err.code || err.message}). Is it open in Excel?`,
        });
      }
      res.json({ file: relative, folder: config.downloadsFolder, alreadyHad: false });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/folders", (req, res) => {
    res.json({
      folder: config.downloadsFolder,
      exists: fs.existsSync(config.downloadsFolder),
      subfolders: subfolders(),
    });
  });

  router.post("/open-folder", jsonOnly, async (req, res) => {
    try {
      const dir = path.join(config.downloadsFolder, cleanSubfolder(req.body?.subfolder));
      fs.mkdirSync(dir, { recursive: true });
      await openInFileManager(dir);
      res.json({ ok: true, folder: dir });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.status ? err.message : `Couldn't open the folder (${err.code || err.message}).` });
    }
  });

  // Check the saved key with the smallest possible search.
  router.post("/test-key", async (req, res) => {
    if (!config.apiKeys.freesound) return res.json({ ok: false, message: "No Freesound key saved yet." });
    try {
      await freesound("/search/text/", { query: "rain", fields: "id", page_size: "1" });
      res.json({ ok: true, message: "✓ The Freesound key works." });
    } catch (err) {
      res.json({ ok: false, message: "✗ " + err.message });
    }
  });

  router.clearCache = () => cache.clear();
  return router;
};

// Exported for quick testing
module.exports.describeLicence = describeLicence;
module.exports.slug = slug;
