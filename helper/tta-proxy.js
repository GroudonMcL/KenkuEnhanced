// helper/tta-proxy.js – EXPERIMENTAL, off by default.
//
// Lets Tabletop Audio pages (SoundPads included) show inside the Website panel.
//
// Why this is needed: tabletopaudio.com sends "X-Frame-Options: SAMEORIGIN", so a
// browser refuses to show it inside another page. And its sound server
// (sounds.tabletopaudio.com) answers 403 to audio requests that don't come from
// tabletopaudio.com itself. So we pass both through this computer:
//
//   http://localhost:<port+1>/vikings_sp.html  →  https://tabletopaudio.com/vikings_sp.html
//   http://localhost:<port+1>/_sounds/...      →  https://sounds.tabletopaudio.com/...
//
// On the way we drop the "don't frame me" headers and rewrite the sound server's
// address in pages/scripts so the audio comes through us too.
//
// It runs on its OWN port on purpose: a different port is a different "origin"
// to the browser, so Tabletop Audio's scripts (and the CDNs they load) can't read
// or call the dashboard's /api endpoints, while localStorage (SoundPad macros)
// still works.
//
// Only these two fixed hosts are ever fetched, and only with GET/HEAD, so this
// can't be used as a general-purpose proxy. Nothing is saved to disk.
//
// Please be fair to Tabletop Audio: this is for your own table only. Their sounds
// are free to use but not licensed for redistribution. Consider supporting them:
// https://www.patreon.com/tabletopaudio

const express = require("express");

const SITE = "https://tabletopaudio.com";
const SOUNDS = "https://sounds.tabletopaudio.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 KenkuEnhanced";

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
  "access-control-allow-origin", // same-origin through us; upstream's value would be wrong
  "access-control-allow-credentials",
  "access-control-allow-methods",
]);

const isText = (type) => /^(text\/|application\/(javascript|x-javascript|json))/i.test(type || "");

// Point Tabletop Audio's own addresses at this proxy.
function rewrite(text) {
  return text
    .replace(/https?:\/\/sounds\.tabletopaudio\.com\//gi, "/_sounds/")
    .replace(/https?:\/\/(www\.)?tabletopaudio\.com(?=[/"'?#]|$)/gi, "")
    // Protocol-relative CDN links ("//ajax.googleapis.com/...") would become
    // http:// on localhost; keep them https.
    .replace(/(src|href)=(["'])\/\//gi, "$1=$2https://");
}

// Fetch `target` and send it to the browser.
async function pass(req, res, target, extraHeaders) {
  const headers = { "User-Agent": UA, Accept: req.get("accept") || "*/*", ...extraHeaders };
  if (req.get("range")) headers.Range = req.get("range");
  if (req.get("accept-language")) headers["Accept-Language"] = req.get("accept-language");

  let up;
  try {
    up = await fetch(target, {
      method: req.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return res.status(502).type("text/plain").send(`KenkuEnhanced couldn't reach Tabletop Audio (${err.cause?.code || err.name}).`);
  }

  res.status(up.status);
  up.headers.forEach((value, name) => {
    if (!DROP.has(name.toLowerCase())) res.set(name, value);
  });

  // Redirects: keep them inside the proxy when they point back at Tabletop Audio.
  const loc = up.headers.get("location");
  if (loc) res.set("Location", rewrite(new URL(loc, target).href) || "/");

  if (req.method === "HEAD" || !up.body) return res.end();

  const type = up.headers.get("content-type");
  if (isText(type)) {
    return res.send(rewrite(await up.text()));
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
  if (url.origin !== base) return null;
  return url.href;
}

function createApp(isEnabled) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    if (!isEnabled()) {
      return res.status(403).type("text/plain")
        .send("The Tabletop Audio pass-through is switched off (⚙ Settings → Experimental).");
    }
    if (req.method !== "GET" && req.method !== "HEAD" && !req.path.startsWith("/cdn-cgi/rum")) return res.sendStatus(405);
    // This page must never end up embedded by random sites either.
    res.set("Referrer-Policy", "same-origin");
    next();
  });

  // Cloudflare's page-analytics beacon: answer it quietly instead of with 405.
  app.use("/cdn-cgi/rum", (req, res) => res.sendStatus(204));

  // Sound files: the sound server only answers requests "from" tabletopaudio.com.
  app.use("/_sounds", (req, res) => {
    const target = targetFor(SOUNDS, req.url);
    if (!target) return res.sendStatus(400);
    pass(req, res, target, { Origin: SITE, Referer: SITE + "/" });
  });

  // Everything else: the website itself.
  app.use((req, res) => {
    const target = targetFor(SITE, req.url);
    if (!target) return res.sendStatus(400);
    pass(req, res, target, { Referer: SITE + "/" });
  });

  return app;
}

// Start the second little server the first time it's needed.
let server = null;
function start({ port, host, isEnabled }) {
  if (server) return;
  server = createApp(isEnabled)
    .listen(port, host, () => {
      console.log(`  Tabletop Audio pass-through (experimental): http://localhost:${port}`);
    })
    .on("error", (err) => {
      console.error(`!! Tabletop Audio pass-through couldn't start on port ${port}: ${err.code || err.message}`);
      server = null;
    });
}

module.exports = { start, rewrite };
