// helper/youtube-playlist.js
// The videos in a YouTube playlist, for the dashboard's Playlist tile.
//
//   GET /api/youtube/playlist?list=PL…  → { title, channel, items: [{ videoId, title, channel, thumbnail }], source }
//   GET /api/youtube/titles?ids=a,b,c   → { titles: { a: { title, channel } } }
//
// With a YouTube API key (⚙ Settings) the whole playlist comes from the YouTube
// Data API: 1 quota unit per 50 videos (a search costs 100), up to 1000 videos.
// Without a key, /playlist answers { items: null } and the tile asks the YouTube
// player for the video IDs instead (up to 200); /titles then fills in the names
// from YouTube's public oEmbed address, which needs no key.

const express = require("express");
const config = require("./config");

const CACHE_MS = 30 * 60 * 1000;
const MAX_PAGES = 20; // × 50 videos
const playlistCache = new Map(); // listId → { at, data }
const titleCache = new Map();    // videoId → { title, channel } (names don't change often)

const validList = (s) => /^[\w-]{10,64}$/.test(s);
const validVideo = (s) => /^[\w-]{11}$/.test(s);
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

async function fromApi(listId, key) {
  const get = async (what, params) => {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${what}?` + new URLSearchParams({ ...params, key }), { signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    if (!r.ok) {
      const reason = data.error?.errors?.[0]?.reason || "";
      const err = new Error(reason === "quotaExceeded"
        ? "Today's free YouTube quota is used up. It resets at midnight Pacific time."
        : reason === "playlistNotFound"
          ? "YouTube can't find that playlist. It may be private or deleted."
          : `YouTube said: ${data.error?.message || r.status}`);
      err.status = reason === "playlistNotFound" ? 404 : 502;
      throw err;
    }
    return data;
  };
  const info = await get("playlists", { part: "snippet", id: listId });
  const items = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get("playlistItems", { part: "snippet", playlistId: listId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    for (const it of data.items || []) {
      const s = it.snippet || {};
      const videoId = s.resourceId?.videoId;
      // Deleted and private videos stay in a playlist with these names and no thumbnail
      if (!videoId || /^(Private|Deleted) video$/.test(s.title || "")) continue;
      items.push({
        videoId,
        title: s.title || "",
        channel: s.videoOwnerChannelTitle || "",
        thumbnail: s.thumbnails?.medium?.url || thumb(videoId),
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  const s = info.items?.[0]?.snippet;
  return { title: s?.title || "", channel: s?.channelTitle || "", items, source: "api" };
}

async function oembed(url) {
  const r = await fetch("https://www.youtube.com/oembed?" + new URLSearchParams({ url, format: "json" }), {
    headers: { "User-Agent": "KenkuEnhanced" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return { title: d.title || "", channel: d.author_name || "" };
}

// Run fn over items, a few at a time
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

module.exports = function youtubePlaylistRouter() {
  const router = express.Router();

  router.get("/playlist", async (req, res) => {
    const listId = String(req.query.list || "").trim();
    if (!validList(listId)) return res.status(400).json({ error: "That doesn't look like a YouTube playlist ID." });
    const key = config.apiKeys.youtube;
    const cached = playlistCache.get(listId);
    if (cached && Date.now() - cached.at < CACHE_MS && req.query.refresh !== "1") return res.json({ ...cached.data, cached: true });
    if (!key) {
      // No key: just the playlist's name; the tile gets the videos from the player.
      const info = await oembed(`https://www.youtube.com/playlist?list=${listId}`).catch(() => null);
      return res.json({ title: info?.title || "", channel: info?.channel || "", items: null, source: "player" });
    }
    try {
      const data = await fromApi(listId, key);
      playlistCache.set(listId, { at: Date.now(), data });
      res.json(data);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.status ? err.message : `Couldn't reach YouTube (${err.cause?.code || err.name}).` });
    }
  });

  router.get("/titles", async (req, res) => {
    const ids = [...new Set(String(req.query.ids || "").split(",").map((s) => s.trim()).filter(validVideo))].slice(0, 60);
    const titles = {};
    await pool(ids.filter((id) => !titleCache.has(id)), 6, async (id) => {
      const t = await oembed(`https://www.youtube.com/watch?v=${id}`).catch(() => null);
      // Remember failures too (private/removed videos), so we don't ask again and again
      titleCache.set(id, t || { title: "", channel: "", unavailable: true });
    });
    for (const id of ids) titles[id] = titleCache.get(id);
    if (titleCache.size > 20000) titleCache.clear();
    res.json({ titles });
  });

  router.clearCache = () => playlistCache.clear();
  return router;
};
