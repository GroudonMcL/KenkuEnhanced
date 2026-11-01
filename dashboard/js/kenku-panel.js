// kenku-panel.js – Panel A: control Kenku FM through the helper's /kenku proxy.
// API reference: docs/kenku-remote-api.md

const KenkuPanel = (() => {
  const $ = (id) => document.getElementById(id);

  // ---- Talking to Kenku ---------------------------------------------------
  // All calls go to /kenku/... on our helper, which forwards them to Kenku.
  async function api(path, method = "GET", body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch("/kenku" + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Kenku replied ${res.status}`);
    return data;
  }

  // Run a command; show an error if it fails, then refresh the display quickly.
  async function command(path, method, body) {
    try {
      await api(path, method, body);
      showError(null);
    } catch (err) {
      showError(err.message);
    }
    setTimeout(pollPlayback, 150);
    setTimeout(pollSounds, 150);
  }

  function showError(msg) {
    const box = $("kenku-error");
    box.hidden = !msg;
    if (msg) box.textContent = "⚠ " + msg;
  }

  // ---- State we keep in the page ----------------------------------------
  let library = { playlists: [], tracks: [], soundboards: [], sounds: [] };
  let playback = null;                 // last /v1/playlist/playback reply
  let playingSoundIds = new Set();     // from /v1/soundboard/playback
  let selectedBoard = Store.get("kenku.board", null);
  let draggingVolume = false;          // don't fight the user while they drag

  // ---- Load playlists & soundboards ---------------------------------------
  async function loadLibrary() {
    try {
      const [p, s] = await Promise.all([api("/v1/playlist"), api("/v1/soundboard")]);
      library = { playlists: p.playlists, tracks: p.tracks, soundboards: s.soundboards, sounds: s.sounds };
      if (!library.soundboards.some((b) => b.id === selectedBoard)) {
        selectedBoard = library.soundboards[0]?.id || null;
      }
      showError(null);
    } catch (err) {
      showError("Couldn't load playlists: " + err.message);
    }
    renderPlaylists();
    renderSoundboards();
  }

  function renderPlaylists() {
    const grid = $("playlist-grid");
    grid.innerHTML = "";
    if (!library.playlists.length) {
      grid.innerHTML = '<div class="empty">No playlists found.</div>';
      return;
    }
    for (const p of library.playlists) {
      const b = document.createElement("button");
      b.textContent = p.title;
      b.dataset.id = p.id;
      b.title = `${p.tracks.length} tracks`;
      b.addEventListener("click", () => command("/v1/playlist/play", "PUT", { id: p.id }));
      grid.appendChild(b);
    }
    highlightPlaylist();
  }

  function highlightPlaylist() {
    const current = playback?.playlist?.id;
    $("playlist-grid").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.id === current);
    });
  }

  function renderSoundboards() {
    const tabs = $("soundboard-tabs");
    tabs.innerHTML = "";
    for (const board of library.soundboards) {
      const b = document.createElement("button");
      b.textContent = board.title;
      b.classList.toggle("on", board.id === selectedBoard);
      b.addEventListener("click", () => {
        selectedBoard = board.id;
        Store.set("kenku.board", selectedBoard);
        renderSoundboards();
      });
      tabs.appendChild(b);
    }

    const grid = $("sound-grid");
    grid.innerHTML = "";
    const board = library.soundboards.find((b) => b.id === selectedBoard);
    if (!board) {
      grid.innerHTML = '<div class="empty">No soundboards found.</div>';
      return;
    }
    for (const soundId of board.sounds) {
      const sound = library.sounds.find((s) => s.id === soundId);
      if (!sound) continue;
      const b = document.createElement("button");
      b.dataset.id = sound.id;
      b.innerHTML = "";
      b.append(sound.title);
      if (sound.loop) {
        const mark = document.createElement("span");
        mark.className = "loop-mark";
        mark.textContent = " ↻";
        mark.title = "Loops";
        b.append(mark);
      }
      // Click toggles: stop it if it's playing, otherwise play it.
      b.addEventListener("click", () => {
        const playing = playingSoundIds.has(sound.id);
        command(playing ? "/v1/soundboard/stop" : "/v1/soundboard/play", "PUT", { id: sound.id });
      });
      grid.appendChild(b);
    }
    highlightSounds();
  }

  function highlightSounds() {
    $("sound-grid").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", playingSoundIds.has(b.dataset.id));
    });
  }

  // ---- Polling: ask Kenku what's playing, regularly -----------------------
  async function pollPlayback() {
    try {
      playback = await api("/v1/playlist/playback");
    } catch {
      playback = null; // the header status light shows the connection problem
    }
    renderPlayback();
  }

  async function pollSounds() {
    try {
      const r = await api("/v1/soundboard/playback");
      playingSoundIds = new Set(r.sounds.map((s) => s.id));
    } catch {
      playingSoundIds = new Set();
    }
    highlightSounds();
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  function renderPlayback() {
    const p = playback;
    $("np-track").textContent = p?.track?.title || "—";
    $("np-playlist").textContent = p?.playlist?.title || "";
    const dur = p?.track?.duration || 0;
    const pos = p?.track?.progress || 0;
    $("np-progress-fill").style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0";
    $("np-time").textContent = `${fmt(pos)} / ${fmt(dur)}`;

    $("btn-playpause").textContent = p?.playing ? "⏸" : "▶";
    $("btn-mute").textContent = p?.muted ? "🔇" : "🔊";
    $("btn-mute").classList.toggle("on", !!p?.muted);
    $("btn-shuffle").classList.toggle("on", !!p?.shuffle);
    const repeat = p?.repeat || "off";
    $("btn-repeat").textContent = `🔁 Repeat: ${repeat}`;
    $("btn-repeat").classList.toggle("on", repeat !== "off");

    if (p && !draggingVolume) {
      const v = Math.round(p.volume * 100);
      $("volume").value = v;
      $("volume-value").textContent = v + "%";
    }
    highlightPlaylist();
  }

  // ---- Buttons --------------------------------------------------------------
  function wireControls() {
    $("btn-playpause").addEventListener("click", () => {
      command(playback?.playing ? "/v1/playlist/playback/pause" : "/v1/playlist/playback/play", "PUT");
    });
    // Kenku has no "stop" for playlists, so Stop = pause + jump back to the start.
    $("btn-stop").addEventListener("click", async () => {
      await command("/v1/playlist/playback/pause", "PUT");
      await command("/v1/playlist/playback/seek", "PUT", { to: 0 });
    });
    $("btn-next").addEventListener("click", () => command("/v1/playlist/playback/next", "POST"));
    $("btn-prev").addEventListener("click", () => command("/v1/playlist/playback/previous", "POST"));
    $("btn-mute").addEventListener("click", () =>
      command("/v1/playlist/playback/mute", "PUT", { mute: !playback?.muted })
    );
    $("btn-shuffle").addEventListener("click", () =>
      command("/v1/playlist/playback/shuffle", "PUT", { shuffle: !playback?.shuffle })
    );
    $("btn-repeat").addEventListener("click", () => {
      const order = ["off", "playlist", "track"];
      const next = order[(order.indexOf(playback?.repeat || "off") + 1) % order.length];
      command("/v1/playlist/playback/repeat", "PUT", { repeat: next });
    });
    $("btn-refresh").addEventListener("click", loadLibrary);

    $("btn-stop-sounds").addEventListener("click", async () => {
      await Promise.all([...playingSoundIds].map((id) => api("/v1/soundboard/stop", "PUT", { id }).catch(() => {})));
      pollSounds();
    });

    // Click on the progress bar to jump to that point in the track.
    $("np-progress").addEventListener("click", (e) => {
      const dur = playback?.track?.duration;
      if (!dur) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const to = ((e.clientX - rect.left) / rect.width) * dur;
      command("/v1/playlist/playback/seek", "PUT", { to: Math.round(to) });
    });

    // Volume slider: send at most ~8 updates per second while dragging.
    const slider = $("volume");
    let lastSent = 0;
    let pending = null;
    function sendVolume() {
      lastSent = Date.now();
      pending = null;
      api("/v1/playlist/playback/volume", "PUT", { volume: slider.value / 100 }).catch((e) => showError(e.message));
    }
    slider.addEventListener("input", () => {
      draggingVolume = true;
      $("volume-value").textContent = slider.value + "%";
      if (Date.now() - lastSent > 120) sendVolume();
      else if (!pending) pending = setTimeout(sendVolume, 120);
    });
    slider.addEventListener("change", () => {
      sendVolume();
      setTimeout(() => (draggingVolume = false), 500);
    });
  }

  function init() {
    wireControls();
    loadLibrary();
    pollPlayback();
    pollSounds();
    setInterval(pollPlayback, 1000);
    setInterval(pollSounds, 1500);
  }

  return {
    init,
    reload: loadLibrary,
    // Used by Scenes:
    api,                                        // raw call to Kenku through the helper
    library: () => library,                     // playlists, tracks, soundboards, sounds
    playback: () => playback,                   // last known playlist playback
    playingSounds: () => playingSoundIds,       // Set of sound ids playing now
    refresh: () => { pollPlayback(); pollSounds(); },
  };
})();
