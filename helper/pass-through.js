// helper/pass-through.js – EXPERIMENTAL, off by default (⚙ Settings → Experimental).
//
// Lets a few ambience sites that refuse to be embedded show inside Website tiles:
// Tabletop Audio, myNoise, Rainy Mood and Ambient-Mixer.
//
// Why this is needed: these sites send "X-Frame-Options: SAMEORIGIN", so a
// browser refuses to show them inside another page. Some of them also only
// serve their sound files to their own pages (sounds.tabletopaudio.com answers
// 403, mynoise.world 503 to anyone else). So the helper passes the site – and
// those sound servers – through this computer, one port per site:
//
//   http://localhost:<port+1>/vikings_sp.html   →  https://tabletopaudio.com/vikings_sp.html
//   http://localhost:<port+1>/_m0/...           →  https://sounds.tabletopaudio.com/...
//   http://localhost:<port+2>/NoiseMachines/…   →  https://mynoise.net/NoiseMachines/…
//
// On the way we drop the "don't frame me" headers and rewrite the sites' own
// addresses in pages/scripts so everything comes through us.
//
// Why one port per site: a different port is a different "origin" to the browser,
// so the sites' scripts can't read or call the dashboard's /api endpoints (or
// each other), their own links like "/about" keep working, and their saved
// settings (localStorage) still work.
//
// Safety: only the fixed hosts listed below are ever fetched, and only with
// GET/HEAD (anything else is answered with "204 No Content" and never sent on),
// so this can't be used as a general-purpose proxy. Nothing is saved to disk.
//
// Please be fair to these sites: this is for your own table only. Consider
// supporting them (Tabletop Audio and myNoise are fan-funded).
//
// Pages also get a small volume script (pass-volume.js), so the dashboard can
// fade them, duck them and set their volume in the mixer.

const express = require("express");
const passVolume = require("./pass-volume");

// offset: port = dashboard port + offset (Tabletop Audio keeps +1 from before).
// media:  other hosts of the site, reached through /_m<n>/ on the same port.
// sendOrigin: those hosts only answer requests "from" the site, so say so.
const SITES = [
  {
    id: "tta", name: "Tabletop Audio", offset: 1,
    origin: "https://tabletopaudio.com", aliases: ["www.tabletopaudio.com"],
    media: ["https://sounds.tabletopaudio.com"],
  },
  {
    id: "mynoise", name: "myNoise", offset: 2,
    origin: "https://mynoise.net", aliases: ["www.mynoise.net"],
    media: ["https://mynoise.world"],
  },
  {
    id: "rainymood", name: "Rainy Mood", offset: 3,
    origin: "https://www.rainymood.com", aliases: ["rainymood.com"],
    media: [], // its sound files (media.rainymood.com) play from any page
  },
  {
    id: "ambientmixer", name: "Ambient-Mixer", offset: 4,
    origin: "https://rpg.ambient-mixer.com", aliases: [],
    // static = scripts/images, xml = the mixes and their MP3s, api = (POSTs answered locally)
    media: ["https://static.ambient-mixer.com", "https://user.ambient-mixer.com", "https://www.ambient-mixer.com",
            "https://xml.ambient-mixer.com", "https://api.ambient-mixer.com"],
  },
];

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

// Response headers we never pass on.
const DROP = new Set([
  "x-frame-options",          // the "don't show me in an iframe" header
  "content-security-policy",  // may contain frame-ancestors
  "strict-transport-security", // we're plain http on localhost
  "set-cookie",
  "content-encoding",         // fetch() already decompressed the body
  "content-length",           // recalculated (text gets rewritten)
  "transfer-encoding",
  "connection",
  "alt-svc",
  "report-to",
  "nel",
  "access-control-allow-origin", // upstream's value names the real site; we set our own
  "access-control-allow-credentials",
  "access-control-allow-methods",
]);

const isText = (type) => /^(text\/|application\/(javascript|x-javascript|json|xml|ld\+json)|[^;]*\+xml)/i.test(type || "");
const hostOf = (url) => new URL(url).host;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Point a site's own addresses at its pass-through port. Handles plain and
// JSON-escaped forms: "https://mynoise.world/…" and "https:\/\/mynoise.world\/…".
function makeRewriter(site) {
  const rules = [];
  const add = (host, to) => rules.push([new RegExp(`(?:https?:)?(?:\\\\?/){2}${esc(host)}(?=[\\\\/"'?#:\\s<)]|$)`, "gi"), to]);
  site.media.forEach((m, i) => add(hostOf(m), `/_m${i}`));
  [hostOf(site.origin), ...site.aliases].forEach((h) => add(h, ""));
  return (text, { html } = {}) => {
    for (const [re, to] of rules) text = text.replace(re, to);
    // Protocol-relative CDN links ("//ajax.googleapis.com/…") would become
    // http:// on localhost; keep them https.
    if (html) text = text.replace(/(src|href)=(["'])\/\/(?!\/)/gi, "$1=$2https://");
    return text;
  };
}

// Fetch `target` and send it to the browser.
async function pass(req, res, target, { headers: extra, rewrite, mobile, siteName, addVolume }) {
  const headers = { "User-Agent": mobile ? MOBILE_UA : DESKTOP_UA, Accept: req.get("accept") || "*/*", ...extra };
  if (req.get("range")) headers.Range = req.get("range");
  if (req.get("accept-language")) headers["Accept-Language"] = req.get("accept-language");

  let up;
  try {
    up = await fetch(target, { method: req.method, headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
  } catch (err) {
    return res.status(502).type("text/plain").send(`KenkuEnhanced couldn't reach ${siteName} (${err.cause?.code || err.name}).`);
  }

  res.status(up.status);
  up.headers.forEach((value, name) => {
    if (!DROP.has(name.toLowerCase())) res.set(name, value);
  });
  res.set("Access-Control-Allow-Origin", "*"); // e.g. fonts and audio the page asks for itself

  // Redirects: keep them inside the pass-through when they point back at the site.
  const loc = up.headers.get("location");
  if (loc) res.set("Location", rewrite(new URL(loc, target).href) || "/");

  if (req.method === "HEAD" || !up.body) return res.end();

  const type = up.headers.get("content-type");
  if (isText(type)) {
    const html = /html/i.test(type);
    const text = rewrite(await up.text(), { html });
    // Pages get a small volume control, so the dashboard can fade them (pass-volume.js).
    return res.send(html && addVolume ? passVolume.inject(text) : text);
  }

  // Audio and images: stream straight through (supports seeking via Range).
  const len = up.headers.get("content-length");
  if (len) res.set("Content-Length", len);
  const reader = up.body.getReader();
  req.on("close", () => reader.cancel().catch(() => {}));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once("drain", r));
    }
  } catch {
    /* browser went away or upstream broke – nothing useful to do */
  }
  res.end();
}

// Turn "/some/path?x=1" into a URL on `base`, refusing anything that escapes it.
function targetFor(base, path) {
  const url = new URL(path, base);
  return url.origin === new URL(base).origin ? url.href : null;
}

function createApp(site, opts) {
  const app = express();
  app.disable("x-powered-by");
  const rewrite = makeRewriter(site);

  app.use((req, res, next) => {
    if (!opts.isEnabled(site.id)) {
      return res.status(403).type("text/plain")
        .send(`The ${site.name} pass-through is switched off (⚙ Settings → Experimental).`);
    }
    // Never send anything on to the site: analytics, logins, forms… just say "fine".
    if (req.method !== "GET" && req.method !== "HEAD") return res.sendStatus(204);
    res.set("Referrer-Policy", "same-origin");
    next();
  });

  // The site's other hosts (sound servers, CDNs) – only answer requests "from" the site.
  site.media.forEach((base, i) => {
    app.use(`/_m${i}`, (req, res) => {
      const target = targetFor(base, req.url);
      if (!target) return res.sendStatus(400);
      pass(req, res, target, { headers: { Origin: site.origin, Referer: site.origin + "/" }, rewrite, siteName: site.name });
    });
  });

  // Everything else: the website itself.
  app.use((req, res) => {
    const target = targetFor(site.origin, req.url);
    if (!target) return res.sendStatus(400);
    pass(req, res, target, { headers: { Referer: site.origin + "/" }, rewrite, mobile: opts.isMobile(site.id), siteName: site.name, addVolume: true });
  });

  return app;
}

// Start a site's little server the first time it's switched on.
const servers = new Map(); // id → server
function startEnabled({ basePort, host, isEnabled, isMobile }) {
  for (const site of SITES) {
    if (!isEnabled(site.id) || servers.has(site.id)) continue;
    const port = basePort + site.offset;
    const server = createApp(site, { isEnabled, isMobile })
      .listen(port, host, () => console.log(`  ${site.name} pass-through (experimental): http://localhost:${port}`))
      .on("error", (err) => {
        console.error(`!! ${site.name} pass-through couldn't start on port ${port}: ${err.code || err.message}`);
        servers.delete(site.id);
      });
    servers.set(site.id, server);
  }
}

// Which site (if any) does this address belong to?
function siteFor(url) {
  let host;
  try { host = new URL(url).host.toLowerCase(); } catch { return null; }
  return SITES.find((s) => hostOf(s.origin) === host || s.aliases.includes(host)) || null;
}

// Before a tile loads a page through us: does the site actually answer the helper?
// (Some sites' bot protection refuses requests that don't come from a real browser.)
async function check(url, mobile) {
  const site = siteFor(url);
  if (!site) return { ok: false, status: 0, reason: "Not a pass-through site." };
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": mobile ? MOBILE_UA : DESKTOP_UA, Accept: "text/html,*/*", Referer: site.origin + "/" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    r.body?.cancel();
    if (r.ok) return { ok: true, status: r.status };
    return { ok: false, status: r.status, reason: `${site.name} refused the helper (it answered ${r.status}).` };
  } catch (err) {
    return { ok: false, status: 0, reason: `Couldn't reach ${site.name} (${err.cause?.code || err.name}).` };
  }
}

// For the dashboard: which sites, and on which port.
const list = (basePort) => SITES.map((s) => ({
  id: s.id, name: s.name, port: basePort + s.offset, hosts: [hostOf(s.origin), ...s.aliases],
}));

module.exports = { SITES, startEnabled, siteFor, check, list, makeRewriter };
