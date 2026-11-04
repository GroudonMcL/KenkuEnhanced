// kenku-panel.js – everything Kenku: talking to Kenku FM through the helper's
// /kenku proxy, plus three tile types and the "+ Kenku" picker.
// API reference: docs/kenku-remote-api.md
//
//   Now playing  – the one shared Kenku player (Kenku plays one playlist at a time)
//   Playlist     – one playlist's tracks; clicking a track plays it in that player
//   Soundboard   – one soundboard's sounds as pads (many can play at once)
//
// The module polls Kenku (playback every second, sounds every 1.5 s) and tells
// every tile when something changes.

const KenkuPanel = (() => {
  const $ = (id) => document.getElementById(id);

  // ---- Talking to Kenku ---------------------------------------------------
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

  // Run a command; show an error if it fails, then refresh quickly.
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
    if (msg) box.textContent = "⚠ Kenku: " + msg;
  }

  // ---- Music volume -------------------------------------------------------
  // Your music volume (0-1) vs. Kenku's: while Duck is on (mixer.js), Kenku's
  // volume is yours × the duck, and the sliders keep showing yours.
  const toKenku = (v) => Math.round(Math.max(0, Math.min(1, v)) * Mixer.factor() * 100) / 100;
  const fromKenku = (v) => Math.min(1, v / Mixer.factor());
  const setMusicVolume = (v) => api("/v1/playlist/playback/volume", "PUT", { volume: toKenku(v) }).catch((e) => showError(e.message));

  // ---- State + listeners --------------------------------------------------
  let library = { playlists: [], tracks: [], soundboards: [], sounds: [] };
  let loaded = false;                  // library loaded at least once
  let playback = null;                 // last /v1/playlist/playback reply
  let playingSoundIds = new Set();     // from /v1/soundboard/playback
  const listeners = { library: new Set(), playback: new Set(), sounds: new Set() };

  function on(event, fn) {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  }
  const emit = (event) => listeners[event].forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  async function loadLibrary() {
    try {
      const [p, s] = await Promise.all([api("/v1/playlist"), api("/v1/soundboard")]);
      library = { playlists: p.playlists, tracks: p.tracks, soundboards: s.soundboards, sounds: s.sounds };
      loaded = true;
      showError(null);
    } catch (err) {
      showError("couldn't load playlists – " + err.message);
    }
    emit("library");
  }

  async function pollPlayback() {
    try {
      playback = await api("/v1/playlist/playback");
    } catch {
      playback = null; // the status light in the top bar shows the problem
    }
    emit("playback");
  }

  async function pollSounds() {
    let next;
    try {
      next = new Set((await api("/v1/soundboard/playback")).sounds.map((s) => s.id));
    } catch {
      next = new Set();
    }
    const same = next.size === playingSoundIds.size && [...next].every((id) => playingSoundIds.has(id));
    playingSoundIds = next;
    if (!same) emit("sounds");
  }

  const playlistById = (id) => library.playlists.find((p) => p.id === id);
  const boardById = (id) => library.soundboards.find((b) => b.id === id);
  const trackById = (id) => library.tracks.find((t) => t.id === id);
  const soundById = (id) => library.sounds.find((s) => s.id === id);

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ===========================================================================
  // Tile: Now playing
  // ===========================================================================
  // config.volume (0-100) = the music volume you last set here. Each scene keeps
  // its own, and switching to the scene fades Kenku's music to it.
  function createNowPlaying(tile, config) {
    let sceneVolume = config.volume ?? null;
    tile.setTitle("Now playing");
    tile.body.innerHTML = `
      <div class="np">
        <div class="np-info">
          <div class="np-track">—</div>
          <div class="np-playlist"></div>
        </div>
        <div class="np-ctl">
          <button type="button" class="np-prev" title="Previous track">${Icons.svg("prev")}</button>
          <button type="button" class="np-play primary" title="Play / pause">${Icons.svg("play")}</button>
          <button type="button" class="np-stop" title="Stop (pause and rewind)">${Icons.svg("stop")}</button>
          <button type="button" class="np-next" title="Next track">${Icons.svg("next")}</button>
          <button type="button" class="np-shuffle" title="Shuffle">${Icons.svg("shuffle")}</button>
          <button type="button" class="np-repeat" title="Repeat: off">${Icons.svg("repeat")}</button>
        </div>
        <div class="np-seek">
          <span class="np-pos">0:00</span>
          <div class="progress" title="Click to jump"><div class="progress-fill"></div></div>
          <span class="np-dur">0:00</span>
        </div>
        <div class="np-vol">
          <button type="button" class="np-mute" title="Mute">${Icons.svg("volume")}</button>
          <input type="range" min="0" max="100" step="1" value="80" aria-label="Playlist volume">
          <span class="volume-value">80%</span>
        </div>
      </div>`;
    const q = (s) => tile.body.querySelector(s);
    const slider = q(".np-vol input");
    let draggingVolume = false;

    function render() {
      const p = playback;
      q(".np-track").textContent = p?.track?.title || "Nothing playing";
      q(".np-playlist").textContent = p?.playlist?.title || "";
      const dur = p?.track?.duration || 0;
      const pos = p?.track?.progress || 0;
      q(".progress-fill").style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0";
      q(".np-pos").textContent = fmt(pos);
      q(".np-dur").textContent = fmt(dur);
      Icons.set(q(".np-play"), p?.playing ? "pause" : "play");
      Icons.set(q(".np-mute"), p?.muted ? "mute" : "volume");
      q(".np-mute").classList.toggle("on", !!p?.muted);
      q(".np-shuffle").classList.toggle("on", !!p?.shuffle);
      const repeat = p?.repeat || "off";
      Icons.set(q(".np-repeat"), repeat === "track" ? "repeat1" : "repeat");
      q(".np-repeat").title = `Repeat: ${repeat} (click to change)`;
      q(".np-repeat").classList.toggle("on", repeat !== "off");
      if (p && !draggingVolume && !Mixer.duckBusy()) {
        const v = Math.round(fromKenku(p.volume) * 100);
        slider.value = v;
        Icons.paintRange(slider);
        q(".np-vol .volume-value").textContent = v + "%";
      }
      tile.setStatus(p?.playing ? "● playing" : "", "playing");
    }

    q(".np-play").onclick = () => command(playback?.playing ? "/v1/playlist/playback/pause" : "/v1/playlist/playback/play", "PUT");
    // Kenku has no "stop" for playlists, so Stop = pause + jump back to the start.
    q(".np-stop").onclick = async () => {
      await command("/v1/playlist/playback/pause", "PUT");
      await command("/v1/playlist/playback/seek", "PUT", { to: 0 });
    };
    q(".np-next").onclick = () => command("/v1/playlist/playback/next", "POST");
    q(".np-prev").onclick = () => command("/v1/playlist/playback/previous", "POST");
    q(".np-mute").onclick = () => command("/v1/playlist/playback/mute", "PUT", { mute: !playback?.muted });
    q(".np-shuffle").onclick = () => command("/v1/playlist/playback/shuffle", "PUT", { shuffle: !playback?.shuffle });
    q(".np-repeat").onclick = () => {
      const order = ["off", "playlist", "track"];
      const next = order[(order.indexOf(playback?.repeat || "off") + 1) % order.length];
      command("/v1/playlist/playback/repeat", "PUT", { repeat: next });
    };
    q(".progress").onclick = (e) => {
      const dur = playback?.track?.duration;
      if (!dur) return;
      const rect = e.currentTarget.getBoundingClientRect();
      command("/v1/playlist/playback/seek", "PUT", { to: Math.round(((e.clientX - rect.left) / rect.width) * dur) });
    };

    // Volume: send at most ~8 updates per second while dragging.
    let lastSent = 0;
    let pending = null;
    function sendVolume() {
      lastSent = Date.now();
      pending = null;
      setMusicVolume(slider.value / 100);
    }
    slider.addEventListener("input", () => {
      draggingVolume = true;
      q(".np-vol .volume-value").textContent = slider.value + "%";
      if (Date.now() - lastSent > 120) sendVolume();
      else if (!pending) pending = setTimeout(sendVolume, 120);
    });
    slider.addEventListener("change", () => {
      sendVolume();
      sceneVolume = Number(slider.value);
      tile.changed();
      setTimeout(() => (draggingVolume = false), 500);
    });

    const off = on("playback", render);
    render();
    return {
      save: () => (sceneVolume == null ? {} : { volume: sceneVolume }),
      apply: (c) => (sceneVolume = c.volume ?? null),
      destroy: off,
    };
  }

  // ===========================================================================
  // Shared bits for Playlist and Soundboard tiles
  // ===========================================================================
  // When a tile doesn't know which playlist/soundboard to show (new, or it was
  // deleted in Kenku), show a menu to pick one.
  function chooser(tile, kind, onPick) {
    const list = kind === "playlist" ? library.playlists : library.soundboards;
    const box = el("div", "tile-empty");
    if (!loaded) {
      box.textContent = "Waiting for Kenku…";
      return box;
    }
    if (!list.length) {
      box.textContent = kind === "playlist" ? "Kenku has no playlists yet." : "Kenku has no soundboards yet.";
      return box;
    }
    const sel = el("select");
    sel.append(new Option(kind === "playlist" ? "Choose a playlist…" : "Choose a soundboard…", ""));
    for (const x of list) sel.append(new Option(x.title, x.id));
    sel.onchange = () => sel.value && onPick(sel.value);
    box.append(sel);
    return box;
  }

  // ===========================================================================
  // Tile: Playlist
  // ===========================================================================
  function createPlaylist(tile, config) {
    let id = config.id || null;
    let autoFirst = !!config.autoFirst;
    let choosing = false;

    tile.addAction("⇄", "Show a different playlist in this tile", () => {
      choosing = !choosing;
      render();
    });

    function pick(newId) {
      id = newId;
      autoFirst = false;
      choosing = false;
      tile.changed();
      render();
      window.dispatchEvent(new Event("board-changed"));
    }

    function render() {
      if (!id && autoFirst && library.playlists.length) return pick(library.playlists[0].id);
      const pl = playlistById(id);
      tile.body.innerHTML = "";
      if (!pl || choosing) {
        tile.setTitle(pl ? pl.title : "Playlist");
        tile.body.append(chooser(tile, "playlist", pick));
        if (!pl) return;
      }
      tile.setTitle(pl.title);

      const bar = el("div", "tile-toolbar");
      const play = el("button", "primary small", "▶ Play all");
      play.onclick = () => command("/v1/playlist/play", "PUT", { id: pl.id });
      bar.append(play, el("span", "hint", `${pl.tracks.length} track${pl.tracks.length === 1 ? "" : "s"}`));
      const list = el("ol", "track-list");
      pl.tracks.forEach((tid) => {
        const t = trackById(tid);
        if (!t) return;
        const li = el("li");
        li.dataset.id = tid;
        const b = el("button", "track", t.title);
        b.title = "Play this track";
        b.onclick = () => command("/v1/playlist/play", "PUT", { id: tid });
        li.append(b);
        list.append(li);
      });
      if (!pl.tracks.length) list.append(el("li", "hint", "This playlist is empty."));
      tile.body.append(bar, list);
      highlight();
    }

    function highlight() {
      const pl = playlistById(id);
      const mine = !!pl && playback?.playlist?.id === pl.id;
      tile.body.querySelectorAll(".track-list li").forEach((li) => {
        li.classList.toggle("on", mine && playback?.track?.id === li.dataset.id);
      });
      tile.setStatus(mine && playback?.playing ? "● playing" : mine ? "paused" : "", "playing");
    }

    const offs = [on("library", render), on("playback", highlight)];
    render();
    return {
      save: () => ({ id, ...(autoFirst ? { autoFirst } : {}) }),
      destroy: () => offs.forEach((f) => f()),
      playlistId: () => id,
    };
  }

  // ===========================================================================
  // Tile: Soundboard
  // ===========================================================================
  // config.autoSounds = sounds marked ▶ auto: they start when you switch to the scene.
  function createSoundboard(tile, config) {
    let id = config.id || null;
    let autoFirst = !!config.autoFirst;
    let choosing = false;
    let autoSounds = new Set(config.autoSounds || []);

    tile.addAction("■", "Stop this soundboard's sounds", async () => {
      const board = boardById(id);
      if (!board) return;
      const playing = board.sounds.filter((s) => playingSoundIds.has(s));
      await Promise.all(playing.map((s) => api("/v1/soundboard/stop", "PUT", { id: s }).catch(() => {})));
      pollSounds();
    });
    tile.addAction("⇄", "Show a different soundboard in this tile", () => {
      choosing = !choosing;
      render();
    });

    function pick(newId) {
      id = newId;
      autoFirst = false;
      choosing = false;
      tile.changed();
      render();
      window.dispatchEvent(new Event("board-changed"));
    }

    function render() {
      if (!id && autoFirst && library.soundboards.length) return pick(library.soundboards[0].id);
      const board = boardById(id);
      tile.body.innerHTML = "";
      if (!board || choosing) {
        tile.setTitle(board ? board.title : "Soundboard");
        tile.body.append(chooser(tile, "soundboard", pick));
        if (!board) return;
      }
      tile.setTitle(board.title);
      const pads = el("div", "pads");
      for (const sid of board.sounds) {
        const s = soundById(sid);
        if (!s) continue;
        const b = el("button", "pad");
        b.dataset.id = sid;
        b.append(el("span", "pad-name", s.title));
        b.append(el("small", "pad-sub", s.loop ? "↻ loop" : "one-shot"));
        b.title = s.title + (s.loop ? " (loops)" : "");
        b.onclick = () => command(playingSoundIds.has(sid) ? "/v1/soundboard/stop" : "/v1/soundboard/play", "PUT", { id: sid });
        // Small ▶ in the corner: start this sound with the scene
        const auto = el("span", "pad-auto", "▶");
        auto.setAttribute("role", "switch");
        auto.onclick = (e) => {
          e.stopPropagation();
          autoSounds.has(sid) ? autoSounds.delete(sid) : autoSounds.add(sid);
          tile.changed();
          highlight();
        };
        b.append(auto);
        pads.append(b);
      }
      if (!board.sounds.length) pads.append(el("div", "hint", "This soundboard is empty."));
      tile.body.append(pads);
      highlight();
    }

    function highlight() {
      let n = 0;
      tile.body.querySelectorAll(".pad").forEach((b) => {
        const onNow = playingSoundIds.has(b.dataset.id);
        const auto = autoSounds.has(b.dataset.id);
        b.classList.toggle("on", onNow);
        b.classList.toggle("auto", auto);
        const a = b.querySelector(".pad-auto");
        a.setAttribute("aria-checked", auto);
        a.title = auto ? "▶ auto: starts with this scene (click to turn off)" : "Click to start this sound with the scene (▶ auto)";
        if (onNow) n++;
      });
      const nAuto = [...autoSounds].filter((s) => boardById(id)?.sounds.includes(s)).length;
      tile.setStatus([n ? `● ${n} playing` : "", nAuto ? `▶ ${nAuto} auto` : ""].filter(Boolean).join(" · "), "playing");
    }

    const offs = [on("library", render), on("sounds", highlight)];
    render();
    return {
      save: () => ({ id, ...(autoFirst ? { autoFirst } : {}), ...(autoSounds.size ? { autoSounds: [...autoSounds] } : {}) }),
      apply: (c) => {
        autoSounds = new Set(c.autoSounds || []);
        highlight();
      },
      destroy: () => offs.forEach((f) => f()),
      boardId: () => id,
    };
  }

  // ===========================================================================
  // "+ Kenku" picker: tick one or more, then "+ Add". Double-click adds one at once.
  // ===========================================================================
  let addTab = Store.get("kenku.addTab", "playlists");
  const picked = new Map(); // "type:id" → { type, config, name }

  function onScreen(type, id) {
    return Board.tiles(type).some((t) => t.config().id === id);
  }

  function renderAddDialog() {
    const words = $("kenku-add-search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = (...texts) => {
      const hay = texts.join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    document.querySelectorAll("#kenku-add-dialog [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === addTab));
    $("kenku-add-count-playlists").textContent = library.playlists.length;
    $("kenku-add-count-soundboards").textContent = library.soundboards.length;

    const box = $("kenku-add-list");
    box.innerHTML = "";
    const row = (icon, type, config, name, sub, mark) => {
      const key = `${type}:${config.id || ""}`;
      const r = el("label", "pick-row");
      const box2 = el("input");
      box2.type = "checkbox";
      box2.checked = picked.has(key);
      box2.onchange = () => {
        box2.checked ? picked.set(key, { type, config, name }) : picked.delete(key);
        renderFooter();
      };
      const text = el("span", "pick-text");
      text.append(el("b", "", name), el("small", "", sub));
      r.append(box2, el("span", "pick-icon", icon), text);
      if (mark) r.append(el("span", "pick-mark", mark));
      r.addEventListener("dblclick", (e) => {
        e.preventDefault();
        picked.clear();
        picked.set(key, { type, config, name });
        addPicked();
      });
      box.append(r);
    };

    if (!loaded) box.append(el("p", "hint", "Waiting for Kenku… Is Kenku FM open with Remote switched on?"));

    if (addTab === "nowplaying") {
      row("▶", "nowplaying", {}, "Now playing", "Play/pause, skip, shuffle, repeat and volume for Kenku's playlist player",
        Board.tiles("nowplaying").length ? "on screen" : "");
    } else if (addTab === "playlists") {
      const list = library.playlists.filter((p) => match(p.title, ...p.tracks.map((t) => trackById(t)?.title)));
      for (const p of list) {
        const names = p.tracks.slice(0, 3).map((t) => trackById(t)?.title).filter(Boolean);
        row("🎵", "playlist", { id: p.id }, p.title, `${p.tracks.length} tracks${names.length ? " · " + names.join(", ") : ""}`,
          onScreen("playlist", p.id) ? "on screen" : "");
      }
      if (loaded && !list.length) box.append(el("p", "hint", words.length ? "No playlists match." : "Kenku has no playlists yet."));
    } else {
      const list = library.soundboards.filter((b) => match(b.title, ...b.sounds.map((s) => soundById(s)?.title)));
      for (const b of list) {
        const names = b.sounds.slice(0, 4).map((s) => soundById(s)?.title).filter(Boolean);
        row("🎛", "soundboard", { id: b.id }, b.title, `${b.sounds.length} sounds${names.length ? " · " + names.join(", ") : ""}`,
          onScreen("soundboard", b.id) ? "on screen" : "");
      }
      if (loaded && !list.length) box.append(el("p", "hint", words.length ? "No soundboards match." : "Kenku has no soundboards yet."));
    }
    renderFooter();
  }

  function renderFooter() {
    const items = [...picked.values()];
    const go = $("kenku-add-go");
    go.disabled = !items.length;
    go.textContent = items.length > 1 ? `＋ Add ${items.length} tiles` : items.length ? `＋ Add “${items[0].name}”` : "＋ Add";
    $("kenku-add-selected").textContent = items.length
      ? `Selected: ${items.map((i) => i.name).join(", ")}`
      : "Tick one or more (double-click adds one straight away).";
  }

  function addPicked() {
    const items = [...picked.values()];
    if (!items.length) return;
    $("kenku-add-dialog").close();
    for (const i of items) Board.add(i.type, i.config);
    picked.clear();
  }

  function openAddDialog() {
    picked.clear();
    $("kenku-add-search").value = "";
    renderAddDialog();
    $("kenku-add-dialog").showModal();
    $("kenku-add-search").focus();
    loadLibrary().then(renderAddDialog); // pick up anything new in Kenku
  }

  // ===========================================================================
  function init() {
    // Heights are in 20px rows.
    // key: tiles with the same key in two scenes are kept (not rebuilt) when switching.
    Board.register("nowplaying", { badge: "Kenku", badgeClass: "k", icon: "bars", fitContent: true, size: { w: 7, h: 4, minW: 3, minH: 3 },
      key: () => "", create: createNowPlaying });
    Board.register("playlist", { badge: "Playlist", badgeClass: "k", icon: "music", autoable: true, size: { w: 3, h: 14, minW: 2, minH: 5 },
      key: (c) => c.id || "", create: createPlaylist });
    Board.register("soundboard", { badge: "Soundboard", badgeClass: "k", icon: "pads", size: { w: 4, h: 10, minW: 2, minH: 5 },
      key: (c) => c.id || "", create: createSoundboard });

    $("add-kenku").addEventListener("click", openAddDialog);
    $("kenku-add-close").addEventListener("click", () => $("kenku-add-dialog").close());
    $("kenku-add-go").addEventListener("click", addPicked);
    $("kenku-add-search").addEventListener("input", renderAddDialog);
    document.querySelectorAll("#kenku-add-dialog [data-tab]").forEach((b) => {
      b.addEventListener("click", () => {
        addTab = b.dataset.tab;
        Store.set("kenku.addTab", addTab);
        renderAddDialog();
      });
    });

    loadLibrary();
    pollPlayback();
    pollSounds();
    setInterval(pollPlayback, 1000);
    setInterval(pollSounds, 1500);
  }

  return {
    init,
    reload: loadLibrary,
    on,
    // Used by Scenes:
    api,                                        // raw call to Kenku through the helper
    library: () => library,                     // playlists, tracks, soundboards, sounds
    playback: () => playback,                   // last known playlist playback
    musicVolume: () => (playback ? fromKenku(playback.volume) : null), // yours, 0-1 (see Duck)
    setMusicVolume,                             // yours, 0-1
    playingSounds: () => playingSoundIds,       // Set of sound ids playing now
    refresh: () => { pollPlayback(); pollSounds(); },
  };
})();
