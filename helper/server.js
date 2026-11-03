// helper/server.js
// The local helper server. Start it with:  npm start
//
// What it does:
//   /            → serves the dashboard (files in ../dashboard)
//   /kenku/*     → forwards the request to Kenku Remote (http://127.0.0.1:3333/*)
//                  and adds CORS headers to the answer
//   /health      → reports whether the helper and Kenku Remote are reachable
//   /api/version → this app's version + latest version on GitHub (update check)
//   /api/update/* → one-click update from GitHub Releases (helper/update.js)
//   /api/frame-check?url=... → does a website allow itself to be shown in an iframe?
//   /api/youtube/search?q=...&type=video → YouTube search (needs apiKeys.youtube)
//   /api/settings → read / save settings (the dashboard's Settings pane)
//   /api/boards   → your scenes = saved tile layouts (data/boards.json, helper/boards.js)
//   /api/scenes   → the old scenes from before the tile redesign (data/scenes.json, backup only)
//   /api/sounds/* → Freesound search + download to your downloads folder (helper/sounds.js)
//   /api/links    → your saved links + the Tabletop Audio SoundPad list (helper/links.js)
//   /models/*, /api/vibe/* → picture model files + picture fetcher for ✨ Vibe (helper/vibe.js)
//   port+1…+4    → EXPERIMENTAL pass-through for Tabletop Audio, myNoise, Rainy Mood,
//                  Ambient-Mixer – each off by default (helper/pass-through.js)
//   /api/pass-check?url=... → does a pass-through site answer the helper?

const path = require("path");
const express = require("express");
const config = require("./config");
const pkg = require("../package.json");

const app = express();

// ---------------------------------------------------------------------------
// 1. Static dashboard files
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "dashboard")));

// ---------------------------------------------------------------------------
// 2. Kenku proxy
// ---------------------------------------------------------------------------
// CORS headers: these tell a browser "pages from any origin may read this".
// Kenku itself doesn't send them, which is why we need this proxy at all.
function addCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

// express.raw gives us the request body as raw bytes, so we can pass it on untouched.
app.use("/kenku", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  addCors(res);

  // Browsers send an OPTIONS "preflight" before some requests. Just say yes.
  if (req.method === "OPTIONS") return res.sendStatus(204);

  // req.url here is the part after /kenku, e.g. "/v1/playlist?x=1"
  const target = config.kenkuUrl + req.url;
  const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;

  try {
    const kenkuRes = await fetch(target, {
      method: req.method,
      // Only send a Content-Type when there IS a body: Kenku (Fastify) rejects an
      // empty body that claims to be JSON.
      headers: hasBody ? { "Content-Type": req.get("content-type") || "application/json" } : {},
      body: hasBody ? req.body : undefined,
      signal: AbortSignal.timeout(7000), // Kenku's own timeout is 5s
    });
    const body = Buffer.from(await kenkuRes.arrayBuffer());
    res.status(kenkuRes.status);
    const type = kenkuRes.headers.get("content-type");
    if (type) res.set("Content-Type", type);
    res.send(body);
  } catch (err) {
    // Connection refused / timeout → Kenku is closed or Remote is off
    res.status(502).json({
      statusCode: 502,
      error: "Bad Gateway",
      message: `Kenku Remote not reachable at ${config.kenkuUrl} (${err.cause?.code || err.name})`,
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Health check
// ---------------------------------------------------------------------------
app.get("/health", async (req, res) => {
  const result = {
    helper: "ok",
    version: pkg.version,
    kenku: { url: config.kenkuUrl, reachable: false },
  };
  try {
    const r = await fetch(config.kenkuUrl + "/v1/playlist", { signal: AbortSignal.timeout(3000) });
    result.kenku.status = r.status;
    result.kenku.reachable = true; // Kenku answered *something*
    result.kenku.ok = r.status === 200; // ...and could give us playlists
    // Does Kenku now send CORS itself? (Useful to know if issue #62 ever gets fixed.)
    result.kenku.sendsCorsHeaders = r.headers.has("access-control-allow-origin");
    if (r.status === 200) {
      const data = await r.json();
      result.kenku.playlists = data.playlists?.length ?? 0;
    } else {
      result.kenku.message = (await r.json().catch(() => ({}))).message;
    }
  } catch (err) {
    result.kenku.error = err.cause?.code || err.name;
    result.kenku.message =
      "Kenku Remote didn't answer. Is Kenku FM open with Settings → Remote enabled?";
  }
  res.json(result);
});

// ---------------------------------------------------------------------------
// 4. Frame check: can this site be shown inside an iframe?
// ---------------------------------------------------------------------------
// A browser silently shows a blank/error box when a site forbids framing, and the
// page can't find out why. So we fetch the site here and read its headers:
//   X-Frame-Options: DENY / SAMEORIGIN          → blocked
//   Content-Security-Policy: frame-ancestors ... → blocked unless it allows us
// It also returns the page's <title>, so a Website tile can name itself.

// Read just the start of a web page (enough for <title>) and stop downloading.
async function readTitle(r) {
  if (!/html/i.test(r.headers.get("content-type") || "") || !r.body) {
    r.body?.cancel();
    return null;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < 200000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
  } catch {
    /* a half-read page is fine */
  }
  reader.cancel().catch(() => {});
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  const text = m[1]
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
  return text.slice(0, 120) || null;
}

// Before a Website tile loads a page through the pass-through: will the site answer?
app.get("/api/pass-check", async (req, res) => {
  const site = passThrough.siteFor(String(req.query.url || ""));
  if (!site || !passOn(site.id)) return res.json({ ok: false, reason: "The pass-through is off for this site." });
  res.json(await passThrough.check(String(req.query.url), passMobile(site.id)));
});

app.get("/api/frame-check", async (req, res) => {
  let url;
  try {
    url = new URL(String(req.query.url || ""));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: "Please give a full http:// or https:// URL" });
  }

  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 KenkuEnhanced" },
      signal: AbortSignal.timeout(8000),
    });
    const title = await readTitle(r); // only the first part of the page is read

    const xfo = (r.headers.get("x-frame-options") || "").toLowerCase();
    const csp = r.headers.get("content-security-policy") || "";
    const fa = csp.split(";").map((s) => s.trim()).find((s) => s.toLowerCase().startsWith("frame-ancestors"));

    let allowed = true;
    let reason = "No framing restrictions found.";
    if (xfo.includes("deny") || xfo.includes("sameorigin")) {
      allowed = false;
      reason = `The site sends "X-Frame-Options: ${xfo.toUpperCase()}", which forbids showing it in an iframe.`;
    }
    if (fa) {
      const sources = fa.split(/\s+/).slice(1);
      const ok = sources.includes("*") || sources.some((s) => /localhost|127\.0\.0\.1/.test(s));
      if (!ok) {
        allowed = false;
        reason = `The site's security policy only allows framing by: ${sources.join(" ") || "nobody"}.`;
      }
    }
    res.json({ url: r.url, status: r.status, allowed, reason, title, xFrameOptions: xfo || null, frameAncestors: fa || null });
  } catch (err) {
    res.json({ url: url.href, allowed: null, reason: `Couldn't reach the site (${err.cause?.code || err.name}).` });
  }
});

// ---------------------------------------------------------------------------
// 5. YouTube search (YouTube Data API v3)
// ---------------------------------------------------------------------------
// The API key stays here in the helper – the browser never sees it.
// Each search costs 100 of your 10,000 free daily "quota units" (≈100 searches/day),
// so identical searches are cached for 30 minutes.
const searchCache = new Map(); // "type|query" -> { at, results }

app.get("/api/youtube/search", async (req, res) => {
  const key = config.apiKeys.youtube;
  if (!key) {
    return res.status(400).json({
      error: "No YouTube API key yet. Open ⚙ Settings (top right) and paste one in – the README explains how to get a free key.",
    });
  }
  const q = String(req.query.q || "").trim();
  const type = req.query.type === "playlist" ? "playlist" : "video";
  if (!q) return res.status(400).json({ error: "Type something to search for." });

  const cacheKey = `${type}|${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return res.json({ results: cached.results, cached: true });

  const params = new URLSearchParams({ part: "snippet", maxResults: "15", q, type, key, safeSearch: "none" });
  // Only show videos that are allowed to play inside other pages
  if (type === "video") params.set("videoEmbeddable", "true");

  try {
    const r = await fetch("https://www.googleapis.com/youtube/v3/search?" + params, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!r.ok) {
      const reason = data.error?.errors?.[0]?.reason || "";
      const msg = reason === "quotaExceeded"
        ? "Today's free YouTube search quota is used up. It resets at midnight Pacific time."
        : `YouTube said: ${data.error?.message || r.status}`;
      return res.status(502).json({ error: msg });
    }
    // Keep only what the dashboard needs
    const results = (data.items || []).map((it) => ({
      videoId: it.id.videoId || null,
      listId: it.id.playlistId || null,
      title: it.snippet.title,
      channel: it.snippet.channelTitle,
      thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
    }));
    searchCache.set(cacheKey, { at: Date.now(), results });
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach YouTube (${err.cause?.code || err.name}).` });
  }
});

// ---------------------------------------------------------------------------
// 6. Settings (used by the dashboard's ⚙ Settings pane)
// ---------------------------------------------------------------------------
// Only accept real JSON requests. A browser only lets *our own page* send JSON
// here (other websites would need CORS permission, which we don't give for /api),
// so random websites open in Kenku's browser can't change your settings.
const jsonOnly = [
  (req, res, next) => (req.is("application/json") ? next() : res.status(415).json({ error: "Expected JSON" })),
  express.json({ limit: "1mb" }),
];

// What the helper is actually running with (port/LAN changes need a restart).
const HOST = config.host || "127.0.0.1";
const RUNNING = { port: config.port, host: HOST };

// Experimental pass-through: one port per site (see helper/pass-through.js)
const passThrough = require("./pass-through");
const PASS_BASE = config.port;
const passOn = (id) => !!config.experimental.passThrough[id];
const passMobile = (id) => !!config.experimental.mobile[id];
function startPassThrough() {
  passThrough.startEnabled({ basePort: PASS_BASE, host: HOST, isEnabled: passOn, isMobile: passMobile });
}

// "AIzaSy...2fbQ" → "…2fbQ". The full key is never sent to the browser.
function keyHint(key) {
  return key ? { set: true, hint: "…" + key.slice(-4) } : { set: false, hint: "" };
}

function settingsForBrowser() {
  const fs = require("fs");
  return {
    port: config.port,
    lanAccess: config.host === "0.0.0.0",
    kenku: { ...config.kenku },
    downloadsFolder: config.downloadsFolder,
    downloadsFolderExists: fs.existsSync(config.downloadsFolder),
    apiKeys: Object.fromEntries(Object.entries(config.apiKeys).map(([k, v]) => [k, keyHint(v)])),
    experimental: {
      passThrough: { ...config.experimental.passThrough },
      mobile: { ...config.experimental.mobile },
      sites: passThrough.list(PASS_BASE), // [{ id, name, port, hosts }]
    },
    configError: config.loadError,
    // true when saved settings differ from what's running → restart the helper
    restartNeeded: config.port !== RUNNING.port || (config.host || "127.0.0.1") !== RUNNING.host,
  };
}

app.get("/api/settings", (req, res) => res.json(settingsForBrowser()));

app.put("/api/settings", jsonOnly, (req, res) => {
  const b = req.body || {};
  const changes = {};
  const errors = [];
  const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

  if (b.port !== undefined) {
    const p = Number(b.port);
    validPort(p) ? (changes.port = p) : errors.push("Dashboard port must be a whole number from 1 to 65535.");
  }
  if (b.lanAccess !== undefined) changes.host = b.lanAccess ? "0.0.0.0" : "";
  if (b.kenku) {
    const host = String(b.kenku.host ?? config.kenku.host).trim();
    const port = Number(b.kenku.port ?? config.kenku.port);
    if (!host || /\s|\//.test(host)) errors.push("Kenku address should look like 127.0.0.1 (no spaces or slashes).");
    if (!validPort(port)) errors.push("Kenku port must be a whole number from 1 to 65535.");
    changes.kenku = { host, port };
  }
  if (b.downloadsFolder !== undefined) {
    const folder = String(b.downloadsFolder).trim();
    if (!folder) errors.push("Downloads folder can't be empty.");
    changes.downloadsFolder = folder;
    if (folder && b.createFolder) {
      try {
        require("fs").mkdirSync(folder, { recursive: true });
      } catch (err) {
        errors.push(`Couldn't create the downloads folder: ${err.message}`);
      }
    }
  }
  // API keys: a non-empty string sets it, null removes it, missing = unchanged.
  if (b.apiKeys) {
    changes.apiKeys = {};
    for (const name of Object.keys(config.apiKeys)) {
      const v = b.apiKeys[name];
      if (v === null) changes.apiKeys[name] = "";
      else if (typeof v === "string" && v.trim()) changes.apiKeys[name] = v.trim();
    }
  }

  if (b.experimental) {
    const ids = passThrough.SITES.map((x) => x.id);
    const pick = (o) => Object.fromEntries(ids.filter((id) => typeof o?.[id] === "boolean").map((id) => [id, o[id]]));
    changes.experimental = {
      passThrough: { ...config.experimental.passThrough, ...pick(b.experimental.passThrough) },
      mobile: { ...config.experimental.mobile, ...pick(b.experimental.mobile) },
    };
  }

  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  try {
    config.save(changes);
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save config.json: ${err.message}` });
  }
  startPassThrough();
  if (changes.apiKeys?.youtube !== undefined) searchCache.clear();
  if (changes.apiKeys?.freesound !== undefined) soundsRouter.clearCache();
  res.json(settingsForBrowser());
});

// Check the saved YouTube key with a tiny request (costs 1 quota unit, not 100).
app.post("/api/settings/test-youtube", async (req, res) => {
  const key = config.apiKeys.youtube;
  if (!key) return res.json({ ok: false, message: "No YouTube key saved yet." });
  try {
    const params = new URLSearchParams({ part: "id", id: "jNQXAC9IVRw", key });
    const r = await fetch("https://www.googleapis.com/youtube/v3/videos?" + params, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (r.ok) return res.json({ ok: true, message: "✓ The YouTube key works." });
    res.json({ ok: false, message: `✗ YouTube rejected the key: ${data.error?.message || r.status}` });
  } catch (err) {
    res.json({ ok: false, message: `Couldn't reach YouTube (${err.cause?.code || err.name}).` });
  }
});

// ---------------------------------------------------------------------------
// 7. Scenes (stored in data/scenes.json – see helper/scenes.js)
// ---------------------------------------------------------------------------
app.use("/api/scenes", require("./scenes")(jsonOnly)); // old scenes (kept as a backup only)
app.use("/api/boards", require("./boards")(jsonOnly));  // scenes = saved boards (helper/boards.js)

// ---------------------------------------------------------------------------
// 8. Sound search + download (Freesound – see helper/sounds.js)
// ---------------------------------------------------------------------------
const soundsRouter = require("./sounds")(jsonOnly);
app.use("/api/sounds", soundsRouter);

// ---------------------------------------------------------------------------
// 9. Saved links + Tabletop Audio SoundPad list (see helper/links.js)
// ---------------------------------------------------------------------------
app.use("/api/links", require("./links")(jsonOnly));

// ---------------------------------------------------------------------------
// 10. Image → vibe: model files (cached in data/models) + picture fetcher
// ---------------------------------------------------------------------------
const vibe = require("./vibe")();
app.use("/models", vibe.models);
app.use("/api/vibe", vibe.api);

// ---------------------------------------------------------------------------
// 11. Update check + one-click update: /api/version, /api/update/* (helper/update.js)
// ---------------------------------------------------------------------------
app.use("/api", require("./update")(jsonOnly));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// We listen on 127.0.0.1 (this computer only) by default, so nobody else on your
// network can control Kenku. "Allow other devices" in Settings switches this to
// 0.0.0.0 so a tablet on your Wi-Fi can open the dashboard too.
app.listen(config.port, HOST, () => {
  console.log("");
  console.log("  KenkuEnhanced helper is running.");
  console.log(`  Dashboard:  http://localhost:${config.port}`);
  console.log(`  Kenku API:  ${config.kenkuUrl}  (proxied at /kenku)`);
  startPassThrough();
  console.log("  Leave this window open while you play. Close it (or Ctrl+C) to stop.");
  console.log("");
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`!! Port ${config.port} is already in use. Is the helper already running in another window?`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
