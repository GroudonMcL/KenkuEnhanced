// scenes.js – Phase 2: Scenes.
//
// A scene is a saved "mood": a Kenku playlist + volume, some soundboard sounds,
// some YouTube videos + volumes, a fade time, an optional link and notes.
// One click (or keys 1-9) switches to it:
//
//   1. FADE OUT whatever is going to change (music that switches, YouTube
//      players that stop or get a new video). Sounds not in the scene stop
//      (Kenku applies each sound's own fade-out).
//   2. SWITCH: start the new playlist / videos at volume 0, start sounds.
//   3. FADE IN to the scene's volumes.
//
// Things that are already right keep playing: if the new scene uses the same
// playlist or the same YouTube video, only its volume changes.
//
// Scenes are saved by the helper in data/scenes.json (see helper/scenes.js).

const Scenes = (() => {
  const $ = (id) => document.getElementById(id);
  const K = KenkuPanel;      // shorthand
  const YTP = YouTubePanel;

  let scenes = [];
  let activeId = Store.get("scenes.active", null);
  let busyId = null;         // scene currently fading in
  let editMode = false;
  let runToken = 0;          // goes up on every scene change; older fades see it and stop
  let editing = null;        // { scene, isNew } while the editor is open

  const COLORS = ["#e0a526", "#3fbf6f", "#4a8fe0", "#e5484d", "#a86fe0", "#3fc4c4", "#e07f3f", "#c4c4c4"];

  // ===========================================================================
  // Saving / loading (through the helper)
  // ===========================================================================
  async function load() {
    try {
      const r = await fetch("/api/scenes");
      scenes = (await r.json()).scenes || [];
    } catch {
      scenes = [];
    }
    render();
  }

  async function persist() {
    try {
      const r = await fetch("/api/scenes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (err) {
      alert("Couldn't save scenes: " + err.message);
    }
  }

  function newScene(parts = {}) {
    return {
      id: "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `Scene ${scenes.length + 1}`,
      color: COLORS[scenes.length % COLORS.length],
      fadeSeconds: 2,
      music: { mode: "keep", playlistId: null, volume: 80 },
      sounds: { ids: [], stopOthers: true },
      youtube: { players: [], stopOthers: true },
      link: "",
      linkAuto: false,
      notes: "",
      ...parts,
    };
  }

  // ===========================================================================
  // The scenes bar
  // ===========================================================================
  // Short summary under each scene name, e.g. "🎵 Tavern · 2 🔔 · 1 ▶"
  function summary(scene) {
    const lib = K.library();
    const bits = [];
    if (scene.music?.mode === "play") {
      const p = lib.playlists.find((x) => x.id === scene.music.playlistId);
      bits.push("🎵 " + (p ? p.title : "playlist"));
    } else if (scene.music?.mode === "stop") {
      bits.push("🎵 off");
    }
    if (scene.sounds?.ids.length) bits.push(`${scene.sounds.ids.length} 🔔`);
    if (scene.youtube?.players.length) bits.push(`${scene.youtube.players.length} ▶`);
    return bits.join(" · ") || "—";
  }

  function render() {
    const box = $("scene-buttons");
    box.innerHTML = "";
    if (!scenes.length) {
      box.innerHTML = '<span class="empty">No scenes yet. Start some music/sounds, then click “Save current as scene”.</span>';
    }
    scenes.forEach((scene, i) => {
      const b = document.createElement("button");
      b.className = "scene-btn";
      b.style.setProperty("--scene-color", scene.color || "#888");
      b.classList.toggle("on", scene.id === activeId);
      b.classList.toggle("busy", scene.id === busyId);
      b.title = editMode ? "Click to edit" : `Start this scene${i < 9 ? ` (key ${i + 1})` : ""}`;

      const name = document.createElement("span");
      name.className = "scene-name";
      name.textContent = scene.name;
      const sub = document.createElement("span");
      sub.className = "scene-sub";
      sub.textContent = summary(scene);
      b.append(name, sub);
      if (i < 9) {
        const key = document.createElement("span");
        key.className = "scene-key";
        key.textContent = `key ${i + 1}`;
        b.append(key);
      }
      b.addEventListener("click", () => (editMode ? openEditor(scene, false) : activate(scene)));
      box.appendChild(b);
    });
    $("scenes-bar").classList.toggle("editing", editMode);
    $("scene-edit-mode").classList.toggle("on", editMode);
    $("scene-edit-mode").textContent = editMode ? "✓ Done editing" : "✎ Edit scenes";
    renderInfo();
  }

  // The line under the buttons: active scene's notes + link button.
  function renderInfo() {
    const scene = scenes.find((s) => s.id === activeId);
    $("scene-info").hidden = !scene || (!scene.notes && !scene.link);
    if (!scene) return;
    $("scene-info-text").textContent = scene.notes ? `📝 ${scene.name}: ${scene.notes}` : "";
    $("scene-link").hidden = !scene.link;
    $("scene-link").onclick = () => window.open(scene.link, "_blank");
  }

  function setActive(id, busy) {
    activeId = id;
    busyId = busy ? id : null;
    Store.set("scenes.active", activeId);
    render();
  }

  // ===========================================================================
  // Fading
  // ===========================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Move a value from `from` to `to` over `ms`, calling set(value) every 100ms.
  // Stops early (returns false) if another scene change started meanwhile.
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

  // Do two YouTube links point at the same video/playlist?
  function sameVideo(a, b) {
    const x = YTP.parse(a);
    const y = YTP.parse(b);
    return !!x && !!y && x.videoId === y.videoId && x.listId === y.listId;
  }

  // ===========================================================================
  // Activating a scene
  // ===========================================================================
  async function activate(scene) {
    const token = ++runToken;
    setActive(scene.id, true);
    const fadeMs = Math.max(0, Number(scene.fadeSeconds ?? 2) * 1000);
    if (scene.link && scene.linkAuto) window.open(scene.link, "_blank");

    // --- What's playing right now? (ask Kenku fresh, not the 1-second-old copy)
    const pb = await K.api("/v1/playlist/playback").catch(() => null);
    const playingSounds = await K.api("/v1/soundboard/playback")
      .then((r) => r.sounds.map((s) => s.id))
      .catch(() => []);
    const startVol = pb ? pb.volume : 0;

    // --- Plan the music
    const m = scene.music || { mode: "keep" };
    const musicTarget = (m.volume ?? 80) / 100;
    let music = "none"; // none | adjust (same playlist, change volume) | switch | stop
    if (pb) {
      if (m.mode === "play" && m.playlistId) {
        music = pb.playing && pb.playlist?.id === m.playlistId ? "adjust" : "switch";
      } else if (m.mode === "stop" && pb.playing) {
        music = "stop";
      }
    }

    // --- Plan YouTube: give each of the scene's videos a player.
    // Prefer a player that already has that video (keeps playing), then an idle
    // player, otherwise add a new player.
    const yt = scene.youtube || { players: [], stopOthers: false };
    const decks = YTP.decks(); // live list
    const entries = yt.players.filter((e) => YTP.parse(e.url));
    const plan = [];
    const used = new Set();
    for (const entry of entries) {
      let deck = decks.find((d) => !used.has(d) && sameVideo(d.saved.url, entry.url));
      const reuse = !!deck;
      if (!deck) {
        deck = decks.find(
          (d) => !used.has(d) && !d.isPlaying() && !entries.some((e) => sameVideo(d.saved.url, e.url))
        );
      }
      if (!deck) {
        YTP.ensureDecks(decks.length + 1);
        deck = decks[decks.length - 1];
      }
      used.add(deck);
      plan.push({ deck, entry, reuse });
    }
    const ytToStop = yt.stopOthers ? decks.filter((d) => !used.has(d) && d.isPlaying()) : [];

    // --- 1. FADE OUT
    const outs = [];
    if ((music === "switch" && pb.playing) || music === "stop") {
      outs.push(ramp(startVol, 0, fadeMs, kenkuVolume, token));
    }
    for (const d of ytToStop) outs.push(ramp(d.currentVolume(), 0, fadeMs, (v) => d.setVolume(v, false), token));
    for (const p of plan) {
      if (!p.reuse && p.deck.isPlaying()) {
        outs.push(ramp(p.deck.currentVolume(), 0, fadeMs, (v) => p.deck.setVolume(v, false), token));
      }
    }
    const wanted = new Set(scene.sounds?.ids || []);
    if (scene.sounds?.stopOthers) {
      for (const id of playingSounds) {
        if (!wanted.has(id)) K.api("/v1/soundboard/stop", "PUT", { id }).catch(() => {});
      }
    }
    await Promise.all(outs);
    if (token !== runToken) return; // another scene was clicked meanwhile

    // --- 2. SWITCH
    for (const d of ytToStop) {
      d.pause();
      d.setVolume(d.saved.volume, true); // put the slider back for next time
    }
    if (music === "stop") {
      await K.api("/v1/playlist/playback/pause", "PUT").catch(() => {});
      await kenkuVolume(startVol); // so pressing play later isn't silent
    }
    if (music === "switch") {
      await kenkuVolume(0);
      await K.api("/v1/playlist/play", "PUT", { id: m.playlistId }).catch(() => {});
    }
    for (const p of plan) {
      p.deck.setLoop(!!p.entry.loop);
      if (!p.reuse) {
        p.deck.setVolume(0, false);
        p.deck.loadUrl(p.entry.url, true);
      } else if (!p.deck.isPlaying()) {
        p.deck.play();
      }
    }
    for (const id of wanted) {
      if (!playingSounds.includes(id)) K.api("/v1/soundboard/play", "PUT", { id }).catch(() => {});
    }

    // --- 3. FADE IN
    const ins = [];
    if (music === "switch") ins.push(ramp(0, musicTarget, fadeMs, kenkuVolume, token));
    if (music === "adjust") ins.push(ramp(startVol, musicTarget, fadeMs, kenkuVolume, token));
    for (const p of plan) {
      const from = p.reuse ? p.deck.currentVolume() : 0;
      ins.push(
        ramp(from, p.entry.volume ?? 60, fadeMs, (v) => p.deck.setVolume(v, false), token).then((done) => {
          if (done) p.deck.setVolume(p.entry.volume ?? 60, true); // save final volume
        })
      );
    }
    await Promise.all(ins);
    if (token === runToken) setActive(scene.id, false);
    K.refresh();
  }

  // Fade out everything (button / key 0).
  async function silence(fadeSeconds = 2) {
    const token = ++runToken;
    setActive(null, false);
    const fadeMs = fadeSeconds * 1000;
    const pb = await K.api("/v1/playlist/playback").catch(() => null);
    const decks = YTP.decks().filter((d) => d.isPlaying());

    // Stop sounds (Kenku fades them using their own settings)
    const sounds = await K.api("/v1/soundboard/playback").then((r) => r.sounds).catch(() => []);
    sounds.forEach((s) => K.api("/v1/soundboard/stop", "PUT", { id: s.id }).catch(() => {}));

    const outs = decks.map((d) => ramp(d.currentVolume(), 0, fadeMs, (v) => d.setVolume(v, false), token));
    if (pb?.playing) outs.push(ramp(pb.volume, 0, fadeMs, kenkuVolume, token));
    await Promise.all(outs);
    if (token !== runToken) return;

    for (const d of decks) {
      d.pause();
      d.setVolume(d.saved.volume, true);
    }
    if (pb?.playing) {
      await K.api("/v1/playlist/playback/pause", "PUT").catch(() => {});
      await kenkuVolume(pb.volume);
    }
    K.refresh();
  }

  // ===========================================================================
  // "Save current as scene": capture what's playing now
  // ===========================================================================
  function currentYouTube() {
    return YTP.decks()
      .filter((d) => d.isPlaying() && d.saved.url)
      .map((d) => ({ url: d.saved.url, volume: d.saved.volume, loop: d.saved.loop }));
  }

  function captureCurrent() {
    const pb = K.playback();
    return newScene({
      music:
        pb?.playing && pb.playlist
          ? { mode: "play", playlistId: pb.playlist.id, volume: Math.round(pb.volume * 100) }
          : { mode: "keep", playlistId: null, volume: 80 },
      sounds: { ids: [...K.playingSounds()], stopOthers: true },
      youtube: { players: currentYouTube(), stopOthers: true },
    });
  }

  // ===========================================================================
  // Scene editor (pop-up)
  // ===========================================================================
  function editorMessage(text, kind = "warn") {
    const box = $("scene-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  function openEditor(scene, isNew) {
    editing = { scene, isNew };
    const lib = K.library();
    $("scene-dialog-title").textContent = isNew ? "New scene" : `Edit scene: ${scene.name}`;
    editorMessage(
      lib.playlists.length || lib.soundboards.length
        ? null
        : "Kenku isn't connected (or has no playlists/soundboards), so music and sound choices are limited."
    );

    $("sc-name").value = scene.name;
    $("sc-color").value = scene.color || "#e0a526";
    $("sc-fade").value = scene.fadeSeconds ?? 2;

    // Music dropdown: keep / stop / each playlist
    const sel = $("sc-music");
    sel.innerHTML = "";
    const addOpt = (value, text) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    };
    addOpt("keep", "— Leave the music as it is —");
    addOpt("stop", "— Stop the music —");
    lib.playlists.forEach((p) => addOpt("play:" + p.id, "▶ " + p.title));
    const m = scene.music || {};
    if (m.mode === "play" && m.playlistId && !lib.playlists.some((p) => p.id === m.playlistId)) {
      addOpt("play:" + m.playlistId, "▶ (playlist not found in Kenku)");
    }
    sel.value = m.mode === "play" ? "play:" + m.playlistId : m.mode || "keep";
    $("sc-music-volume").value = m.volume ?? 80;
    $("sc-music-volume-value").textContent = (m.volume ?? 80) + "%";

    // Sounds: a checkbox per sound, grouped by soundboard
    const grid = $("sc-sounds");
    grid.innerHTML = "";
    const chosen = new Set(scene.sounds?.ids || []);
    const shown = new Set();
    for (const board of lib.soundboards) {
      const h = document.createElement("h4");
      h.textContent = board.title;
      grid.appendChild(h);
      for (const id of board.sounds) {
        const sound = lib.sounds.find((s) => s.id === id);
        if (!sound || shown.has(id)) continue;
        shown.add(id);
        grid.appendChild(soundCheckbox(id, sound.title + (sound.loop ? " ↻" : ""), chosen.has(id)));
      }
    }
    // Keep sounds Kenku didn't report (e.g. Kenku closed) so they aren't lost
    for (const id of chosen) {
      if (!shown.has(id)) grid.appendChild(soundCheckbox(id, "(sound not found in Kenku)", true));
    }
    if (!grid.children.length) grid.innerHTML = '<span class="hint">No soundboard sounds found.</span>';
    $("sc-sounds-stop").checked = scene.sounds?.stopOthers ?? true;

    // YouTube rows
    $("sc-youtube").innerHTML = "";
    (scene.youtube?.players || []).forEach(addYouTubeRow);
    $("sc-yt-stop").checked = scene.youtube?.stopOthers ?? true;

    $("sc-link").value = scene.link || "";
    $("sc-link-auto").checked = !!scene.linkAuto;
    $("sc-notes").value = scene.notes || "";

    $("sc-delete").hidden = isNew;
    $("sc-left").hidden = isNew;
    $("sc-right").hidden = isNew;
    $("scene-dialog").showModal();
  }

  function soundCheckbox(id, text, checked) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = id;
    box.checked = checked;
    label.append(box, " " + text);
    return label;
  }

  function addYouTubeRow(entry = { url: "", volume: 60, loop: true }) {
    const row = document.createElement("div");
    row.className = "sc-yt-row";
    row.innerHTML = `
      <input type="text" class="sc-yt-url" placeholder="YouTube link or ID">
      <input type="range" class="sc-yt-vol" min="0" max="100" step="1" aria-label="Volume">
      <span class="volume-value sc-yt-vol-value"></span>
      <label class="check"><input type="checkbox" class="sc-yt-loop"> Loop</label>
      <button type="button" class="small danger" title="Remove">✕</button>`;
    row.querySelector(".sc-yt-url").value = entry.url || "";
    row.querySelector(".sc-yt-vol").value = entry.volume ?? 60;
    row.querySelector(".sc-yt-vol-value").textContent = (entry.volume ?? 60) + "%";
    row.querySelector(".sc-yt-loop").checked = !!entry.loop;
    row.querySelector(".sc-yt-vol").addEventListener("input", (e) => {
      row.querySelector(".sc-yt-vol-value").textContent = e.target.value + "%";
    });
    row.querySelector("button").addEventListener("click", () => row.remove());
    $("sc-youtube").appendChild(row);
  }

  // Read the form back into a scene object
  function readEditor() {
    const scene = editing.scene;
    const musicVal = $("sc-music").value;
    const ytRows = [...document.querySelectorAll("#sc-youtube .sc-yt-row")];
    const badUrl = ytRows.find((r) => r.querySelector(".sc-yt-url").value.trim() && !YTP.parse(r.querySelector(".sc-yt-url").value));
    if (badUrl) return { error: "One of the YouTube links doesn't look like a YouTube link or ID." };
    return {
      scene: {
        ...scene,
        name: $("sc-name").value.trim() || scene.name,
        color: $("sc-color").value,
        fadeSeconds: Math.min(20, Math.max(0, Number($("sc-fade").value) || 0)),
        music: {
          mode: musicVal.startsWith("play:") ? "play" : musicVal,
          playlistId: musicVal.startsWith("play:") ? musicVal.slice(5) : null,
          volume: Number($("sc-music-volume").value),
        },
        sounds: {
          ids: [...document.querySelectorAll("#sc-sounds input:checked")].map((b) => b.value),
          stopOthers: $("sc-sounds-stop").checked,
        },
        youtube: {
          players: ytRows
            .map((r) => ({
              url: r.querySelector(".sc-yt-url").value.trim(),
              volume: Number(r.querySelector(".sc-yt-vol").value),
              loop: r.querySelector(".sc-yt-loop").checked,
            }))
            .filter((e) => e.url),
          stopOthers: $("sc-yt-stop").checked,
        },
        link: $("sc-link").value.trim(),
        linkAuto: $("sc-link-auto").checked,
        notes: $("sc-notes").value.trim(),
      },
    };
  }

  async function saveEditor(e) {
    e.preventDefault();
    const { scene, error } = readEditor();
    if (error) return editorMessage(error, "error");
    if (editing.isNew) scenes.push(scene);
    else scenes[scenes.findIndex((s) => s.id === scene.id)] = scene;
    $("scene-dialog").close();
    render();
    await persist();
  }

  async function move(delta) {
    const i = scenes.findIndex((s) => s.id === editing.scene.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= scenes.length) return;
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    render();
    await persist();
  }

  // ===========================================================================
  // Hotkeys: 1-9 start scenes, 0 fades everything out.
  // Only work while the dashboard itself has keyboard focus (not while typing,
  // and not after clicking inside a YouTube video or website – click on an empty
  // part of the dashboard to give it focus back).
  // ===========================================================================
  function onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector("dialog[open]")) return;
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
  function init() {
    $("scene-capture").addEventListener("click", () => openEditor(captureCurrent(), true));
    $("scene-edit-mode").addEventListener("click", () => {
      editMode = !editMode;
      render();
    });
    $("scene-silence").addEventListener("click", () => silence());

    $("scene-form").addEventListener("submit", saveEditor);
    $("sc-cancel").addEventListener("click", () => $("scene-dialog").close());
    $("sc-delete").addEventListener("click", async () => {
      if (!confirm(`Delete the scene "${editing.scene.name}"?`)) return;
      scenes = scenes.filter((s) => s.id !== editing.scene.id);
      if (activeId === editing.scene.id) setActive(null, false);
      $("scene-dialog").close();
      render();
      await persist();
    });
    $("sc-left").addEventListener("click", () => move(-1));
    $("sc-right").addEventListener("click", () => move(1));
    $("sc-yt-add").addEventListener("click", () => addYouTubeRow());
    $("sc-yt-current").addEventListener("click", () => {
      const now = currentYouTube();
      if (!now.length) return editorMessage("No YouTube player is playing right now.", "warn");
      $("sc-youtube").innerHTML = "";
      now.forEach(addYouTubeRow);
    });
    $("sc-music-volume").addEventListener("input", (e) => {
      $("sc-music-volume-value").textContent = e.target.value + "%";
    });

    document.addEventListener("keydown", onKey);
    load();
    // Summaries show playlist names, which arrive from Kenku a moment later.
    setTimeout(render, 1500);
  }

  return { init, activate, silence };
})();
