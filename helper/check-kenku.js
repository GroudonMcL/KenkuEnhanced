// helper/check-kenku.js
// Run with:  npm run check-kenku
//
// Talks to Kenku Remote directly (not through the dashboard) and prints what it
// finds: whether it's reachable, whether it sends CORS headers, and the shape of
// the playlist / soundboard / playback replies. It only READS – it never plays
// or changes anything.

const config = require("./config");

const ENDPOINTS = [
  "/v1/playlist",
  "/v1/playlist/playback",
  "/v1/soundboard",
  "/v1/soundboard/playback",
];

// Describe a JSON value's structure, e.g. { playlists: [ { id: string, ... } ] }
function shapeOf(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.length ? [shapeOf(value[0], depth + 1)] : "[] (empty)";
  }
  if (value && typeof value === "object") {
    if (depth > 3) return "{...}";
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shapeOf(v, depth + 1);
    return out;
  }
  return typeof value;
}

async function probe(path) {
  const url = config.kenkuUrl + path;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      // Pretend to be a web page from our dashboard so Kenku *could* answer with CORS headers.
      headers: { Origin: "http://localhost:4000" },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return {
      url,
      status: res.status,
      cors: res.headers.get("access-control-allow-origin"),
      body,
    };
  } catch (err) {
    return { url, error: err.cause?.code || err.name || err.message };
  }
}

(async () => {
  console.log(`\nChecking Kenku Remote at ${config.kenkuUrl}\n`);
  let anyOk = false;

  for (const path of ENDPOINTS) {
    const r = await probe(path);
    console.log("=".repeat(60));
    console.log(`GET ${r.url}`);
    if (r.error) {
      console.log(`  ✗ Not reachable: ${r.error}`);
      continue;
    }
    anyOk = anyOk || r.status === 200;
    console.log(`  Status: ${r.status}`);
    console.log(`  CORS header (Access-Control-Allow-Origin): ${r.cors || "NONE"}`);
    console.log("  Response shape:");
    console.log(JSON.stringify(shapeOf(r.body), null, 2).replace(/^/gm, "    "));

    // A friendly summary for the most useful ones
    if (path === "/v1/playlist" && r.body?.playlists) {
      console.log(`  → ${r.body.playlists.length} playlists, ${r.body.tracks.length} tracks`);
      r.body.playlists.forEach((p) => console.log(`     - ${p.title} (${p.tracks.length} tracks)`));
    }
    if (path === "/v1/soundboard" && r.body?.soundboards) {
      console.log(`  → ${r.body.soundboards.length} soundboards, ${r.body.sounds.length} sounds`);
    }
  }

  console.log("=".repeat(60));
  if (anyOk) {
    console.log("\n✓ Kenku Remote is responding.\n");
  } else {
    console.log(
      "\n✗ Kenku Remote did not respond. Check that Kenku FM is open and that\n" +
        "  Settings → Remote is enabled with the same address/port as config.json.\n"
    );
    process.exitCode = 1;
  }
})();
