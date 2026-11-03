// scenes.js – scenes are saved boards.
//
// A scene stores its tiles: where they are, how big, what's in them (videos,
// playlists, soundboards, websites, volumes, loop…) and which ones are marked
// ▶ auto. The scenes bar shows one tab per scene (keys 1-9; 0 fades everything out).
//
// Everything you change on the board is saved into the current scene straight
// away (↶ Undo takes it back). Scenes live in data/boards.json (helper/boards.js).
//
// Switching scenes – the "smart crossfade":
//   • anything that's in BOTH scenes keeps playing without a gap (the same YouTube
//     video, the same SoundPad page, a Kenku sound whose soundboard is in both,
//     the playlist that's playing if the new scene has a tile for it);
//   • everything else fades out;
//   • the new scene's ▶ auto items fade in (YouTube tiles, one playlist, soundboard sounds).
// A small note at the bottom shows what's happening.

const Scenes = (() => {
  const $ = (id) => document.getElementById(id);
  const K = KenkuPanel;

  let scenes = [];
  let activeId = null;
  let busy = false;          // a switch is fading
  let runToken = 0;          // goes up on every switch; older fades see it and stop
  let persistTimer = null;
  let editing = null;        // { scene, isNew } while the settings dialog is open

  // Undo: earlier versions of the current scene's layout
  let history = [];
  let lastSaved = "";
  let settleUntil = 0;       // right after a switch/undo, the grid settles – don't record that

  const COLORS = ["#e0a526", "#3fbf6f", "#4a8fe0", "#e5484d", "#a86fe0", "#3fc4c4", "#e07f3f", "#c4c4c4"];
  const newId = () => "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const active = () => scenes.find((s) => s.id === activeId) || scenes[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function newScene(parts = {}) {
    return {
      id: newId(),
      name: `Scene ${scenes.length + 1}`,
      color: COLORS[scenes.length % COLORS.length],
      fadeSeconds: 2,
      tags: [],
      notes: "",
      layout: { version: 1, items: [] },
      ...parts,
    };
  }

  // ===========================================================================
  // Loading / saving (through the helper)
  // ===========================================================================
  async function load() {
    let data = null;
    try {
      data = await (await fetch("/api/boards")).json();
    } catch {
      /* helper not answering – start with one scene in memory */
    }
    scenes = data?.scenes || [];
    activeId = data?.activeId || null;
    if (!scenes.length) {
      // First time with scenes-as-boards: keep the tiles you already had.
      scenes = [newScene({ name: "Scene 1", layout: Board.legacyLayout() || Board.defaultLayout() })];
      activeId = scenes[0].id;
      if (data) persistSoon(); // (only if the helper is there to save it)
    }
    if (!scenes.some((s) => s.id === activeId)) activeId = scenes[0].id;
  }

  async function persist() {
    clearTimeout(persistTimer);
    persistTimer = null;
    try {
      const r = await fetch("/api/boards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes, activeId }),
        keepalive: true, // still sent if the page is closing
      });
      if (!r.ok) throw new Error((await r.json()).error);
      $("scene-saved").textContent = "✓ saved";
      $("scene-saved").title = `Saved to “${active()?.name}” at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      $("scene-saved").textContent = "⚠ not saved";
      $("scene-saved").title = "Couldn't save scenes: " + err.message;
    }
  }
  function persistSoon() {
    $("scene-saved").textContent = "saving…";
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 800);
  }

  // The board changed (tile moved, added, volume changed…) → into the current scene.
  function onBoardChange(layout) {
    const scene = active();
    if (!scene) return;
    const json = JSON.stringify(layout);
    if (json === lastSaved) return;
    if (Date.now() > settleUntil && lastSaved) {
      history.push(lastSaved);
      if (history.length > 40) history.shift();
    }
    lastSaved = json;
    scene.layout = layout;
    updateUndo();
    persistSoon();
  }

  function settle() {
    settleUntil = Date.now() + 900;
    lastSaved = JSON.stringify(Board.snapshot());
    active().layout = JSON.parse(lastSaved);
  }

  function updateUndo() {
    $("scene-undo").disabled = !history.length;
    $("scene-undo").title = history.length
      ? `Undo the last change to this scene's tiles (Ctrl+Z) – ${history.length} step${history.length === 1 ? "" : "s"} back possible`
      : "Nothing to undo yet";
  }

  function undo() {
    if (!history.length) return;
    const prev = history.pop();
    const layout = JSON.parse(prev);
    const { leaving } = Board.applyLayout(layout);
    leaving.forEach((t) => t.dispose());
    lastSaved = prev;
    active().layout = layout;
    settleUntil = Date.now() + 900;
    updateUndo();
    persistSoon();
  }

  // ===========================================================================
  // The scenes bar
  // ===========================================================================
  function render() {
    const box = $("scene-buttons");
    box.innerHTML = "";
    scenes.forEach((scene, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scene-btn";
      b.style.setProperty("--scene-color", scene.color || "#888");
      const on = scene.id === activeId;
      b.classList.toggle("on", on);
      b.classList.toggle("busy", on && busy);
      b.title = `${on ? "This scene is showing" : "Switch to this scene"}${i < 9 ? ` (key ${i + 1})` : ""}` +
        " · double-click for its settings" + (scene.tags?.length ? `\nTags: ${scene.tags.join(", ")}` : "");
      if (i < 9) {
        const key = document.createElement("span");
        key.className = "scene-key";
        key.textContent = String(i + 1);
        b.append(key);
      }
      const name = document.createElement("span");
      name.className = "scene-name";
      name.textContent = scene.name;
      b.append(name);
      if (on) {
        const menu = document.createElement("span");
        menu.className = "scene-menu";
        menu.textContent = "▾";
        menu.title = "Scene settings: name, colour, fade time, tags, notes, duplicate, delete";
        menu.onclick = (e) => { e.stopPropagation(); openSettings(scene, false); };
        b.append(menu);
      }
      b.addEventListener("click", () => activate(scene));
      b.addEventListener("dblclick", () => openSettings(scene, false));
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); openSettings(scene, false); });
      box.appendChild(b);
    });
    renderInfo();
  }

  function renderInfo() {
    const scene = active();
    $("scene-info").hidden = !scene?.notes;
    $("scene-info-text").textContent = scene?.notes ? `📝 ${scene.notes}` : "";
  }

  // The note at the bottom during a switch
  let toastTimer = null;
  function toast(scene, lines, ms) {
    const box = $("scene-toast");
    box.innerHTML = "";
    const h = document.createElement("b");
    h.textContent = `Switching to “${scene.name}”`;
    box.append(h);
    for (const [cls, label, names] of lines) {
      if (!names.length) continue;
      const row = document.createElement("div");
      row.className = "toast-row";
      const what = document.createElement("span");
      what.textContent = names.join(", ");
      const how = document.createElement("span");
      how.className = cls;
      how.textContent = label;
      row.append(what, how);
      box.append(row);
    }
    if (box.children.length === 1) {
      const row = document.createElement("div");
      row.className = "toast-row hint";
      row.textContent = "Nothing to fade – nothing was playing and nothing is set to ▶ auto.";
      box.append(row);
    }
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), ms);
  }

  // ===========================================================================
  // Switching scenes
  // ===========================================================================
  // Move a value from `from` to `to` over `ms`, calling set(value) every 100ms.
  // Stops early (returns false) if another switch started meanwhile.
  async function ramp(from, to, ms, set, token) {
    const steps = Math.max(1, Math.round(ms / 100));
    for (let i = 1; i <= steps; i++) {
      if (token !== runToken) return false;
      await set(from + ((to - from) * i) / steps);
      if (i < steps) await sleep(ms / steps);
    }
    return true;
  }

  // Kenku playlist volume, 0-1
  const kenkuVolume = (v) => K.api("/v1/playlist/playback/volume", "PUT", { volume: Math.round(v * 100) / 100 }).catch(() => {});

  async function activate(scene) {
    if (!scene) return;
    const token = ++runToken;
    const switching = scene.id !== activeId;
    if (switching) Board.flush(); // the old scene gets its latest layout first
    activeId = scene.id;
    busy = true;
    render();

    const fadeMs = Math.max(0, (scene.fadeSeconds ?? 2) * 1000);
    const items = scene.layout?.items || [];
    const lib = K.library();
    const soundName = (id) => lib.sounds.find((s) => s.id === id)?.title || "a sound";

    // What's playing right now? (ask Kenku fresh, not the 1-second-old copy)
    const [pb, playingSounds] = await Promise.all([
      K.api("/v1/playlist/playback").catch(() => null),
      K.api("/v1/soundboard/playback").then((r) => r.sounds.map((s) => s.id)).catch(() => []),
    ]);
    if (token !== runToken) return;

    // --- The board: keep what's in both, detach the rest, build the new tiles.
    // (Clicking the scene you're already on just starts its ▶ auto items again.)
    const keepNames = [];
    const outNames = [];
    const inNames = [];
    const work = [];
    const { kept, added, leaving } = switching
      ? Board.applyLayout(scene.layout)
      : { kept: Board.tiles().map((tile) => ({ tile, item: { config: tile.config(), auto: tile.auto } })), added: [], leaving: [] };
    if (switching) history = [];
    settle();
    updateUndo();
    persistSoon();

    // --- YouTube
    const startDeck = async (deck, vol, name) => {
      inNames.push(name);
      await deck.whenReady();
      if (token !== runToken) return;
      deck.setVolume(0, false);
      deck.play();
      if (await ramp(0, vol, fadeMs, (v) => deck.setVolume(v, false), token)) deck.setVolume(vol, true);
    };
    for (const { tile, item } of kept) {
      if (tile.type !== "youtube") continue;
      const deck = tile.inst.deck;
      const vol = item.config?.volume ?? deck.saved.volume;
      if (deck.isPlaying()) {
        keepNames.push(tile.title());
        const from = deck.currentVolume();
        if (from !== vol) work.push(ramp(from, vol, fadeMs, (v) => deck.setVolume(v, false), token).then((done) => done && deck.setVolume(vol, true)));
      } else if (item.auto && deck.saved.url) {
        work.push(startDeck(deck, vol, tile.title()));
      }
    }
    // A website that's in both scenes was never reloaded, so whatever it plays carries on.
    for (const { tile } of kept) if (switching && tile.type === "website" && tile.config().url) keepNames.push(tile.title());
    for (const { tile, item } of added) {
      if (tile.type === "youtube" && item.auto && item.config?.url) work.push(startDeck(tile.inst.deck, item.config.volume ?? 60, tile.title()));
    }
    for (const t of leaving) {
      if (t.type === "youtube" && t.inst.deck?.isPlaying()) {
        outNames.push(t.title());
        const deck = t.inst.deck;
        work.push(ramp(deck.currentVolume(), 0, fadeMs, (v) => deck.setVolume(v, false), token).finally(() => t.dispose()));
      } else if (t.type === "website" && t.config().url) {
        // We can't turn a website's volume down, so it plays on until the fade is over.
        outNames.push(t.title());
        setTimeout(() => t.dispose(), fadeMs);
      } else {
        t.dispose();
      }
    }

    // --- Kenku music: one playlist at a time
    const np = items.find((i) => i.type === "nowplaying");
    const musicVol = np?.config?.volume != null ? np.config.volume / 100 : null;
    const playlistIds = items.filter((i) => i.type === "playlist" && i.config?.id).map((i) => i.config.id);
    const autoPl = items.find((i) => i.type === "playlist" && i.auto && i.config?.id);
    const nowPl = pb?.playing ? pb.playlist : null;
    if (nowPl && playlistIds.includes(nowPl.id) && (!autoPl || autoPl.config.id === nowPl.id)) {
      keepNames.push(`🎵 ${nowPl.title}`);
      if (musicVol != null && Math.abs(musicVol - pb.volume) > 0.005) work.push(ramp(pb.volume, musicVol, fadeMs, kenkuVolume, token));
    } else if (autoPl) {
      const title = lib.playlists.find((p) => p.id === autoPl.config.id)?.title || "playlist";
      const target = musicVol ?? pb?.volume ?? 0.8;
      if (nowPl) outNames.push(`🎵 ${nowPl.title}`);
      inNames.push(`🎵 ${title}`);
      work.push((async () => {
        if (nowPl && !(await ramp(pb.volume, 0, fadeMs, kenkuVolume, token))) return;
        await kenkuVolume(0);
        await K.api("/v1/playlist/play", "PUT", { id: autoPl.config.id }).catch(() => {});
        if (await ramp(0, target, fadeMs, kenkuVolume, token)) K.refresh();
      })());
    } else if (nowPl) {
      outNames.push(`🎵 ${nowPl.title}`);
      work.push(ramp(pb.volume, 0, fadeMs, kenkuVolume, token).then(async (done) => {
        if (!done) return;
        await K.api("/v1/playlist/playback/pause", "PUT").catch(() => {});
        await kenkuVolume(musicVol ?? pb.volume); // ready for next time
      }));
    }

    // --- Kenku sounds: keep those whose soundboard is in the scene; start ▶ auto ones
    const boardIds = new Set(items.filter((i) => i.type === "soundboard" && i.config?.id).map((i) => i.config.id));
    const present = new Set(lib.soundboards.filter((b) => boardIds.has(b.id)).flatMap((b) => b.sounds));
    const autoSounds = new Set(items.filter((i) => i.type === "soundboard").flatMap((i) => i.config?.autoSounds || []));
    for (const id of playingSounds) {
      if (present.has(id)) keepNames.push(soundName(id));
      else {
        outNames.push(soundName(id));
        K.api("/v1/soundboard/stop", "PUT", { id }).catch(() => {}); // Kenku fades it (the sound's own setting)
      }
    }
    for (const id of autoSounds) {
      if (playingSounds.includes(id)) continue;
      inNames.push(soundName(id));
      K.api("/v1/soundboard/play", "PUT", { id }).catch(() => {});
    }

    toast(scene, [
      ["keep", "keeps playing", keepNames],
      ["out", "fading out", outNames],
      ["in", "▶ auto – fading in", inNames],
    ], fadeMs + 3000);

    await Promise.all(work);
    if (token !== runToken) return;
    busy = false;
    render();
    K.refresh();
  }

  // Fade out everything (button / key 0). The board stays as it is.
  async function silence(fadeSeconds = active()?.fadeSeconds ?? 2) {
    const token = ++runToken;
    busy = false;
    render();
    const fadeMs = fadeSeconds * 1000;
    const pb = await K.api("/v1/playlist/playback").catch(() => null);
    const decks = YouTubePanel.decks().filter((d) => d.isPlaying());

    // Stop sounds (Kenku fades them using their own settings)
    const sounds = await K.api("/v1/soundboard/playback").then((r) => r.sounds).catch(() => []);
    sounds.forEach((s) => K.api("/v1/soundboard/stop", "PUT", { id: s.id }).catch(() => {}));

    const outs = decks.map((d) => ramp(d.currentVolume(), 0, fadeMs, (v) => d.setVolume(v, false), token));
    if (pb?.playing) outs.push(ramp(pb.volume, 0, fadeMs, kenkuVolume, token));
    await Promise.all(outs);
    if (token !== runToken) return;

    for (const d of decks) {
      d.pause();
      d.setVolume(d.saved.volume, false); // back to its saved volume, ready for next time
    }
    if (pb?.playing) {
      await K.api("/v1/playlist/playback/pause", "PUT").catch(() => {});
      await kenkuVolume(pb.volume);
    }
    K.refresh();
  }

  // ===========================================================================
  // New scene + scene settings (name, colour, fade, tags, notes, duplicate, delete)
  // ===========================================================================
  function settingsMessage(text, kind = "warn") {
    const box = $("scene-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  function openSettings(scene, isNew) {
    editing = { scene, isNew };
    settingsMessage(null);
    $("scene-dialog-title").textContent = isNew ? "New scene" : `Scene: ${scene.name}`;
    $("sc-name").value = scene.name;
    $("sc-color").value = scene.color || "#e0a526";
    $("sc-fade").value = scene.fadeSeconds ?? 2;
    $("sc-tags").value = (scene.tags || []).join(", ");
    $("sc-notes").value = scene.notes || "";
    $("sc-start").hidden = !isNew;
    $("sc-start-copy-label").textContent = `A copy of “${active()?.name || "this scene"}” (the same tiles)`;
    for (const id of ["sc-delete", "sc-left", "sc-right", "sc-duplicate"]) $(id).hidden = isNew;
    $("sc-save").textContent = isNew ? "Create and switch to it" : "Save";
    $("scene-dialog").showModal();
    $("sc-name").select();
  }

  async function saveSettings(e) {
    e.preventDefault();
    const s = editing.scene;
    s.name = $("sc-name").value.trim() || s.name;
    s.color = $("sc-color").value;
    s.fadeSeconds = Math.min(20, Math.max(0, Number($("sc-fade").value) || 0));
    s.tags = $("sc-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 30);
    s.notes = $("sc-notes").value.trim();
    $("scene-dialog").close();
    if (editing.isNew) {
      Board.flush();
      const copy = document.querySelector("input[name=sc-start]:checked")?.value !== "empty";
      s.layout = copy
        ? JSON.parse(JSON.stringify(active().layout))
        : { version: 1, items: [{ type: "nowplaying", x: 0, y: 0, w: 7, h: 4, config: {} }] };
      scenes.push(s);
      await activate(s);
    } else {
      render();
      persistSoon();
    }
  }

  function duplicate() {
    const s = editing.scene;
    if (s.id === activeId) Board.flush();
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = newId();
    copy.name = `${s.name} (copy)`;
    scenes.splice(scenes.indexOf(s) + 1, 0, copy);
    $("scene-dialog").close();
    render();
    persistSoon();
  }

  async function remove() {
    const s = editing.scene;
    if (scenes.length <= 1) return settingsMessage("This is your only scene – make another one first.", "error");
    if (!confirm(`Delete the scene "${s.name}" and its tiles?`)) return;
    const i = scenes.indexOf(s);
    scenes.splice(i, 1);
    $("scene-dialog").close();
    if (s.id === activeId) {
      activeId = null; // so the next scene is a real switch
      await activate(scenes[Math.max(0, i - 1)]);
    } else {
      render();
      persistSoon();
    }
  }

  function move(delta) {
    const i = scenes.indexOf(editing.scene);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= scenes.length) return;
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    render();
    persistSoon();
  }

  // ⟲ in the top bar: the default tiles for this scene (can be undone)
  function resetTiles() {
    if (!confirm(`Put the default tiles back in “${active().name}”? (↶ Undo brings your tiles back.)`)) return;
    Board.flush();
    history.push(lastSaved);
    const { leaving } = Board.applyLayout(Board.defaultLayout());
    leaving.forEach((t) => t.dispose());
    settle();
    updateUndo();
    persistSoon();
  }

  // ===========================================================================
  // Keys: 1-9 switch scenes, 0 fades out, Ctrl+Z undoes a layout change.
  // (They only work while the dashboard itself has focus – not while typing in a
  // box, and not after clicking inside a YouTube video or website: click on an
  // empty part of the dashboard to give it focus back.)
  // ===========================================================================
  function onKey(e) {
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector("dialog[open]")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      undo();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "0") {
      silence();
    } else if (/^[1-9]$/.test(e.key)) {
      const scene = scenes[Number(e.key) - 1];
      if (scene) activate(scene);
    } else {
      return;
    }
    e.preventDefault();
  }

  // ===========================================================================
  // Start-up: load the scenes, then build the board for the active one.
  async function init() {
    await load();
    Board.onChange(onBoardChange);
    Board.init(active().layout);
    settle();
    history = [];
    updateUndo();
    render();

    $("scene-new").addEventListener("click", () => openSettings(newScene(), true));
    $("scene-undo").addEventListener("click", undo);
    $("scene-silence").addEventListener("click", () => silence());
    $("board-reset").addEventListener("click", resetTiles);
    $("scene-form").addEventListener("submit", saveSettings);
    $("sc-cancel").addEventListener("click", () => $("scene-dialog").close());
    $("sc-delete").addEventListener("click", remove);
    $("sc-duplicate").addEventListener("click", duplicate);
    $("sc-left").addEventListener("click", () => move(-1));
    $("sc-right").addEventListener("click", () => move(1));
    document.addEventListener("keydown", onKey);
    // Save straight away if the page is closed while a save is waiting.
    window.addEventListener("pagehide", () => {
      Board.flush();
      if (persistTimer) persist();
    });
  }

  // From ✨ Vibe: a new scene (a copy of this one) with these tags filled in.
  function createWithTags(tags) {
    const scene = newScene({ tags: [...tags] });
    if (tags[0]) scene.name = tags[0][0].toUpperCase() + tags[0].slice(1);
    openSettings(scene, true);
  }

  return { init, activate, silence, createWithTags, list: () => scenes, active };
})();
