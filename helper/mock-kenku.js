// helper/mock-kenku.js
// Run with:  npm run mock-kenku
//
// A FAKE Kenku Remote for testing the dashboard without Kenku FM running.
// It copies the real API (see docs/kenku-remote-api.md) closely, including the
// lack of CORS headers. No audio plays – it just keeps pretend state.
//
// Only run this when the real Kenku is CLOSED (both want port 3333).

const express = require("express");
const config = require("./config");

const app = express();
app.use(express.json());

// --- Pretend library ----------------------------------------------------
const tracks = [
  { id: "t1", url: "file:///music/tavern1.mp3", title: "Rowdy Tavern" },
  { id: "t2", url: "file:///music/tavern2.mp3", title: "Quiet Inn" },
  { id: "t3", url: "file:///music/battle1.mp3", title: "Clash of Steel" },
  { id: "t4", url: "file:///music/battle2.mp3", title: "Dragon Fight" },
  { id: "t5", url: "file:///music/forest.mp3", title: "Whispering Woods" },
];
const playlists = [
  { id: "p1", title: "Tavern", background: "", tracks: ["t1", "t2"] },
  { id: "p2", title: "Battle", background: "", tracks: ["t3", "t4"] },
  { id: "p3", title: "Exploration", background: "", tracks: ["t5"] },
];
const sounds = [
  { id: "s1", url: "file:///sfx/rain.mp3", title: "Rain", loop: true, volume: 1, fadeIn: 1000, fadeOut: 1000 },
  { id: "s2", url: "file:///sfx/fire.mp3", title: "Campfire", loop: true, volume: 0.8, fadeIn: 500, fadeOut: 500 },
  { id: "s3", url: "file:///sfx/door.mp3", title: "Door Creak", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 },
  { id: "s4", url: "file:///sfx/thunder.mp3", title: "Thunder", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 },
];
const soundboards = [
  { id: "b1", title: "Weather", background: "", sounds: ["s1", "s4"] },
  { id: "b2", title: "Camp & Town", background: "", sounds: ["s2", "s3"] },
];

// --- Pretend playback state --------------------------------------------
const state = {
  playing: false, volume: 0.8, muted: false, shuffle: false, repeat: "playlist",
  playlistId: null, trackIndex: 0, progress: 0,
};
const playingSounds = new Map(); // soundId -> started-at time

const TRACK_LENGTH = 180; // every fake track is 3 minutes

// Move progress forward once a second while "playing"
setInterval(() => {
  if (state.playing) {
    state.progress += 1;
    if (state.progress >= TRACK_LENGTH) next();
  }
  // non-looping sounds "finish" after 5 seconds
  for (const [id, started] of playingSounds) {
    const s = sounds.find((x) => x.id === id);
    if (!s.loop && Date.now() - started > 5000) playingSounds.delete(id);
  }
}, 1000);

function currentList() {
  const p = playlists.find((x) => x.id === state.playlistId);
  return p ? p.tracks : [];
}
function next() {
  const list = currentList();
  if (!list.length) return;
  state.trackIndex = (state.trackIndex + 1) % list.length;
  state.progress = 0;
}

const ok = (req, res) => res.status(200).send(req.body || {});
function needId(req, res) {
  if (!req.body || typeof req.body.id !== "string") {
    res.status(400).send({ statusCode: 400, error: "Bad Request", message: "body must have required property 'id'" });
    return false;
  }
  return true;
}

// --- Playlist routes ----------------------------------------------------
app.get("/v1/playlist", (req, res) => res.send({ playlists, tracks }));

app.put("/v1/playlist/play", (req, res) => {
  if (!needId(req, res)) return;
  const id = req.body.id;
  const p = playlists.find((x) => x.id === id);
  if (p) {
    state.playlistId = p.id;
    state.trackIndex = 0;
  } else {
    // Real Kenku also accepts a track id: play the playlist containing it
    const owner = playlists.find((x) => x.tracks.includes(id));
    if (owner) { state.playlistId = owner.id; state.trackIndex = owner.tracks.indexOf(id); }
  }
  state.progress = 0;
  state.playing = true;
  ok(req, res);
});

app.get("/v1/playlist/playback", (req, res) => {
  const p = playlists.find((x) => x.id === state.playlistId);
  const t = p && tracks.find((x) => x.id === p.tracks[state.trackIndex]);
  res.send({
    playing: state.playing, volume: state.volume, muted: state.muted,
    shuffle: state.shuffle, repeat: state.repeat,
    track: t ? { ...t, duration: TRACK_LENGTH, progress: state.progress } : undefined,
    playlist: p ? { id: p.id, title: p.title } : undefined,
  });
});

app.put("/v1/playlist/playback/play", (req, res) => { if (state.playlistId) state.playing = true; ok(req, res); });
app.put("/v1/playlist/playback/pause", (req, res) => { state.playing = false; ok(req, res); });
app.post("/v1/playlist/playback/next", (req, res) => { next(); ok(req, res); });
app.post("/v1/playlist/playback/previous", (req, res) => {
  const n = currentList().length;
  if (n) { state.trackIndex = (state.trackIndex - 1 + n) % n; state.progress = 0; }
  ok(req, res);
});
app.put("/v1/playlist/playback/mute", (req, res) => { state.muted = !!req.body.mute; ok(req, res); });
app.put("/v1/playlist/playback/volume", (req, res) => {
  state.volume = Math.max(0, Math.min(1, Number(req.body.volume) || 0));
  ok(req, res);
});
app.put("/v1/playlist/playback/seek", (req, res) => { state.progress = Math.max(0, Number(req.body.to) || 0); ok(req, res); });
app.put("/v1/playlist/playback/shuffle", (req, res) => { state.shuffle = !!req.body.shuffle; ok(req, res); });
app.put("/v1/playlist/playback/repeat", (req, res) => { state.repeat = req.body.repeat; ok(req, res); });

// --- Soundboard routes --------------------------------------------------
app.get("/v1/soundboard", (req, res) => res.send({ soundboards, sounds }));
app.put("/v1/soundboard/play", (req, res) => {
  if (!needId(req, res)) return;
  if (sounds.some((s) => s.id === req.body.id)) playingSounds.set(req.body.id, Date.now());
  ok(req, res);
});
app.put("/v1/soundboard/stop", (req, res) => {
  if (!needId(req, res)) return;
  playingSounds.delete(req.body.id);
  ok(req, res);
});
app.get("/v1/soundboard/playback", (req, res) => {
  res.send({
    sounds: [...playingSounds].map(([id, started]) => {
      const s = sounds.find((x) => x.id === id);
      return { ...s, duration: s.loop ? 60 : 5, progress: ((Date.now() - started) / 1000) % 60 };
    }),
  });
});

app.listen(config.kenku.port, config.kenku.host, () => {
  console.log(`Mock Kenku Remote running on ${config.kenkuUrl}  (Ctrl+C to stop)`);
});
