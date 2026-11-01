// helper/server.js
// The local helper server. Start it with:  npm start
//
// What it does:
//   /            → serves the dashboard (files in ../dashboard)
//   /kenku/*     → forwards the request to Kenku Remote (http://127.0.0.1:3333/*)
//                  and adds CORS headers to the answer
//   /health      → reports whether the helper and Kenku Remote are reachable
//   /api/version → this app's version + latest version on GitHub (update check)
//   /api/frame-check?url=... → does a website allow itself to be shown in an iframe?
//   /api/youtube/search?q=...//   /api/frame-check?url=... → does a website allow itself to be shown in an iframe?type=video → YouTube search (needs apiKeys.youtube)

const path = require("path");
const express = require("express");
const config = require("./config");
const pkg = require("../package.json");

const app = express();

// GitHub repo used for the "new version available" check
const GITHUB_REPO = "GroudonMcL/KenkuEnhanced";

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
// 4. Update check (asks GitHub for the latest release, cached for an hour)
// ---------------------------------------------------------------------------
let versionCache = { at: 0, latest: null };

app.get("/api/version", async (req, res) => {
  const out = { current: pkg.version, latest: null, updateAvailable: false, url: null };
  try {
    if (Date.now() - versionCache.at > 60 * 60 * 1000) {
      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "KenkuEnhanced" },
        signal: AbortSignal.timeout(5000),
      });
      // 404 just means "no releases published yet"
      versionCache = { at: Date.now(), latest: r.ok ? await r.json() : null };
    }
    const rel = versionCache.latest;
    if (rel?.tag_name) {
      out.latest = rel.tag_name.replace(/^v/, "");
      out.url = rel.html_url;
      out.updateAvailable = isNewer(out.latest, out.current);
    }
  } catch {
    // Offline or GitHub unreachable: fail quietly.
  }
  res.json(out);
});

// "0.2.0" newer than "0.1.5"?
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Frame check: can this site be shown inside an iframe?
// ---------------------------------------------------------------------------
// A browser silently shows a blank/error box when a site forbids framing, and the
// page can't find out why. So we fetch the site here and read its headers:
//   X-Frame-Options: DENY / SAMEORIGIN          → blocked
//   Content-Security-Policy: frame-ancestors ... → blocked unless it allows us
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
      headers: { "User-Agent": "Mozilla/5.0 KenkuEnhanced frame check" },
      signal: AbortSignal.timeout(8000),
    });
    r.body?.cancel(); // we only need the headers

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
    res.json({ url: r.url, status: r.status, allowed, reason, xFrameOptions: xfo || null, frameAncestors: fa || null });
  } catch (err) {
    res.json({ url: url.href, allowed: null, reason: `Couldn't reach the site (${err.cause?.code || err.name}).` });
  }
});

// ---------------------------------------------------------------------------
// 6. YouTube search (YouTube Data API v3)
// ---------------------------------------------------------------------------
// The API key stays here in the helper – the browser never sees it.
// Each search costs 100 of your 10,000 free daily "quota units" (≈100 searches/day),
// so identical searches are cached for 30 minutes.
const searchCache = new Map(); // "type|query" -> { at, results }

app.get("/api/youtube/search", async (req, res) => {
  const key = config.apiKeys.youtube;
  if (!key) {
    return res.status(400).json({
      error: "No YouTube API key yet. Add one to config.json under apiKeys.youtube and restart the helper (see README → YouTube search).",
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
// Start
// ---------------------------------------------------------------------------
// We listen on 127.0.0.1 (this computer only) by default, so nobody else on your
// network can control Kenku. Set "host": "0.0.0.0" in config.json to allow a tablet.
const HOST = config.host || "127.0.0.1";
app.listen(config.port, HOST, () => {
  console.log("");
  console.log("  KenkuEnhanced helper is running.");
  console.log(`  Dashboard:  http://localhost:${config.port}`);
  console.log(`  Kenku API:  ${config.kenkuUrl}  (proxied at /kenku)`);
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
