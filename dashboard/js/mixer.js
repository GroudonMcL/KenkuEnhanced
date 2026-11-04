// mixer.js – volume for everything in one place: fades, Duck, and the Mixer tile.
//
// Duck (button in the Mixer tile, or key D) turns everything down to e.g. 25 %
// while you talk, and back up when you press it again. It works as one extra
// multiplier on top of every volume (Mixer.factor()), so the sliders keep
// showing your own levels while ducked:
//   • YouTube tiles: player volume = slider × factor   (youtube-panel.js)
//   • Website tiles: page volume = slider × factor     (embed-panel.js; only
//     pages shown through the helper's pass-through can be controlled)
//   • Kenku music: Kenku's volume = slider × factor    (kenku-panel.js)
// Kenku soundboard sounds can't be ducked: Kenku has no volume control for them.
//
// Fades: Mixer.fade(source, to, ms) moves a source's volume smoothly. A source is
// anything with currentVolume() and setVolume(v, persist) (0-100). Starting a new
// fade on a source (or dragging its slider) stops the one already running.

const Mixer = (() => {
  const DUCK_MS = 600;
  const LEVELS = [10, 25, 40, 60];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  let level = LEVELS.includes(Store.get("mixer.duckLevel", 25)) ? Store.get("mixer.duckLevel", 25) : 25;
  let ducked = !!Store.get("mixer.ducked", false);
  let factor = ducked ? level / 100 : 1; // after a reload Kenku is still turned down, so start ducked
  let duckToken = 0;
  let duckBusy = false;

  // ===========================================================================
  // Fades
  // ===========================================================================
  const owners = new WeakMap();
  // Take charge of a source's volume; returns alive(): still in charge?
  function claim(src) {
    const t = (owners.get(src) || 0) + 1;
    owners.set(src, t);
    return () => owners.get(src) === t;
  }

  // The fade time for buttons: the scene's fade time (⚙ scene settings), at least 0.3 s.
  function fadeMs() {
    const s = typeof Scenes !== "undefined" ? Scenes.active?.()?.fadeSeconds : null;
    return Math.max(300, (s ?? 2) * 1000);
  }

  // Fade `src` to `to` (0-100). Resolves true if it got there (nothing took over).
  async function fade(src, to, ms = fadeMs()) {
    const alive = claim(src);
    const from = src.currentVolume();
    const steps = Math.max(1, Math.round(ms / 100));
    for (let i = 1; i <= steps; i++) {
      if (!alive()) return false;
      src.setVolume(from + ((to - from) * i) / steps, false);
      if (i < steps) await sleep(ms / steps);
    }
    return alive();
  }

  // ===========================================================================
  // Duck
  // ===========================================================================
  function applyAll() {
    YouTubePanel.decks().forEach((d) => d.applyOutput?.());
    EmbedPanel.instances().forEach((w) => w.applyOutput?.());
  }
  const emit = () => window.dispatchEvent(new Event("mixer-changed"));

  async function setDuck(on) {
    ducked = !!on;
    Store.set("mixer.ducked", ducked);
    emit();
    const token = ++duckToken;
    const from = factor;
    const to = ducked ? level / 100 : 1;
    duckBusy = true;
    // Kenku's music: work out your own level (Kenku's volume ÷ the duck now) once.
    let music = null;
    try {
      const pb = await KenkuPanel.api("/v1/playlist/playback");
      music = clamp01(pb.volume / from);
    } catch {
      /* Kenku not answering – duck the rest anyway */
    }
    const steps = Math.max(1, Math.round(DUCK_MS / 80));
    for (let i = 1; i <= steps; i++) {
      if (token !== duckToken) return;
      factor = from + ((to - from) * i) / steps;
      applyAll();
      if (music != null) {
        await KenkuPanel.api("/v1/playlist/playback/volume", "PUT", { volume: Math.round(music * factor * 100) / 100 }).catch(() => {});
      }
      if (i < steps) await sleep(DUCK_MS / steps);
    }
    duckBusy = false;
    KenkuPanel.refresh();
    emit();
  }

  function setLevel(v) {
    if (!LEVELS.includes(v)) return;
    level = v;
    Store.set("mixer.duckLevel", v);
    if (ducked) setDuck(true); // move to the new level
    else emit();
  }

  // ===========================================================================
  // Kenku music as a mixer source
  // ===========================================================================
  const K = () => KenkuPanel;
  const kenkuSrc = { dir: null, back: null };
  kenkuSrc.currentVolume = () => (K().musicVolume() ?? 0) * 100;
  kenkuSrc.setVolume = (v) => K().setMusicVolume(v / 100);
  kenkuSrc.fadeToggle = async () => {
    const pb = K().playback();
    if (!pb) return;
    const ms = fadeMs();
    if (pb.playing && kenkuSrc.dir !== "out") {
      kenkuSrc.dir = "out";
      kenkuSrc.back = kenkuSrc.currentVolume() || 80;
      emit();
      if (await fade(kenkuSrc, 0, ms)) {
        await K().api("/v1/playlist/playback/pause", "PUT").catch(() => {});
        await K().setMusicVolume(kenkuSrc.back / 100); // ready for next time
      }
    } else {
      kenkuSrc.dir = "in";
      emit();
      const target = kenkuSrc.back ?? (kenkuSrc.currentVolume() || 80);
      if (!pb.playing) {
        await K().setMusicVolume(0);
        await K().api("/v1/playlist/playback/play", "PUT").catch(() => {});
      }
      await fade(kenkuSrc, target, ms);
    }
    kenkuSrc.dir = null;
    K().refresh();
    emit();
  };

  // Everything the mixer can show, in board order.
  function sources() {
    const pb = K().playback();
    const list = [{
      id: "kenku", icon: "bars", src: kenkuSrc, controllable: !!pb,
      name: pb?.playlist?.title ? `Kenku · ${pb.playlist.title}` : "Kenku music",
      fadingOut: kenkuSrc.dir === "out", on: !!pb?.playing,
    }];
    for (const d of YouTubePanel.decks()) {
      list.push({ id: "yt:" + d.tile.id, icon: d.kind === "playlist" ? "ytlist" : "video", src: d, controllable: true, name: d.displayName(),
        fadingOut: d.fadeDir === "out", on: d.isPlaying() });
    }
    for (const w of EmbedPanel.instances()) {
      list.push({ id: "web:" + w.tile.id, icon: "globe", src: w, controllable: w.canFade(), name: w.tile.title(),
        fadingOut: w.fadeDir === "out", on: w.canFade() && w.currentVolume() > 0 });
    }
    return list;
  }

  // ===========================================================================
  // The Mixer tile
  // ===========================================================================
  function createTile(tile) {
    tile.setTitle("Mixer");
    tile.body.innerHTML = `
      <div class="mixer">
        <div class="mx-top">
          <button type="button" class="mx-duck" title="Turn everything down while you talk (key D)">${Icons.svg("duck")}<span>Duck</span></button>
          <label class="mx-level" title="How far Duck turns things down">to
            <select>${LEVELS.map((v) => `<option value="${v}">${v}%</option>`).join("")}</select></label>
          <span class="hint">key D</span>
        </div>
        <div class="mx-rows"></div>
      </div>`;
    const q = (s) => tile.body.querySelector(s);
    const duckBtn = q(".mx-duck");
    const levelSel = q(".mx-level select");
    const rowsBox = q(".mx-rows");
    let sig = "";
    let rows = new Map(); // id → { el, update(source) }

    duckBtn.onclick = () => setDuck(!ducked);
    levelSel.onchange = () => setLevel(Number(levelSel.value));

    function makeRow(s) {
      const el = document.createElement("div");
      el.className = "mx-row";
      el.innerHTML = `
        <span class="mx-icon">${Icons.svg(s.icon)}</span>
        <span class="mx-name"></span>
        <button type="button" class="small mx-fade"></button>
        <input type="range" min="0" max="100" step="1" aria-label="Volume">
        <span class="volume-value"></span>
        <span class="mx-off hint">volume can't be set</span>`;
      const r = (x) => el.querySelector(x);
      const slider = r("input");
      let dragging = false;
      let last = 0;
      let pending = null;
      const send = (persist) => {
        last = Date.now();
        clearTimeout(pending);
        pending = null;
        claim(s.src); // stops a fade that's running on it
        s.src.setVolume(Number(slider.value), persist);
      };
      slider.addEventListener("input", () => {
        dragging = true;
        r(".volume-value").textContent = slider.value + "%";
        if (Date.now() - last > 80) send(false);
        else if (!pending) pending = setTimeout(() => send(false), 80);
      });
      slider.addEventListener("change", () => {
        send(true);
        setTimeout(() => (dragging = false), 400);
      });
      r(".mx-fade").onclick = () => s.src.fadeToggle();

      function update(src) {
        s = src;
        el.classList.toggle("off", !s.controllable);
        el.classList.toggle("on", s.on && !s.fadingOut);
        r(".mx-name").textContent = s.name;
        r(".mx-name").title = s.name;
        for (const x of [".mx-fade", "input", ".volume-value"]) r(x).hidden = !s.controllable;
        r(".mx-off").hidden = s.controllable;
        r(".mx-off").title = s.id.startsWith("web:")
          ? "Only websites shown through the pass-through (⚙ Settings → Experimental) can be faded and ducked."
          : "Kenku isn't answering.";
        const out = s.on && !s.fadingOut;
        Icons.set(r(".mx-fade"), out ? "fadeout" : "fadein");
        r(".mx-fade").title = out ? "Fade out" : "Fade in";
        if (!dragging && s.controllable) {
          const v = Math.round(s.src.currentVolume());
          if (Number(slider.value) !== v) {
            slider.value = v;
            Icons.paintRange(slider);
          }
          r(".volume-value").textContent = v + "%";
        }
      }
      update(s);
      return { el, update };
    }

    function sync() {
      duckBtn.classList.toggle("on", ducked);
      duckBtn.querySelector("span").textContent = ducked ? "Ducked – back up" : "Duck";
      duckBtn.title = ducked ? "Bring everything back up (key D)" : "Turn everything down while you talk (key D)";
      if (Number(levelSel.value) !== level) levelSel.value = level;
      tile.setStatus(ducked ? `ducked to ${level}%` : "", ducked ? "playing" : "");

      const list = sources();
      const nextSig = list.map((s) => s.id + (s.controllable ? "+" : "-")).join("|");
      if (nextSig !== sig) {
        sig = nextSig;
        const old = rows;
        rows = new Map();
        rowsBox.innerHTML = "";
        for (const s of list) {
          const row = old.get(s.id) || makeRow(s); // keep a row you might be dragging
          rows.set(s.id, row);
          rowsBox.appendChild(row.el);
        }
        tile.fit?.(); // (not there yet while the tile is being built)
      }
      for (const s of list) rows.get(s.id)?.update(s);
    }

    sync();
    const timer = setInterval(sync, 500);
    window.addEventListener("mixer-changed", sync);
    window.addEventListener("board-changed", sync);
    return {
      save: () => ({}),
      destroy: () => {
        clearInterval(timer);
        window.removeEventListener("mixer-changed", sync);
        window.removeEventListener("board-changed", sync);
      },
    };
  }

  // ===========================================================================
  function init() {
    Board.register("mixer", {
      badge: "Mixer", badgeClass: "m", icon: "sliders",
      fitContent: true, // as tall as its rows
      key: () => "",    // one mixer: in two scenes it's the same tile
      size: { w: 4, h: 8, minW: 3, minH: 4 },
      create: createTile,
    });
    document.getElementById("add-mixer").addEventListener("click", () => {
      const t = Board.find("mixer");
      if (!t) return Board.add("mixer", {});
      t.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      t.el.classList.add("tile-new");
      setTimeout(() => t.el.classList.remove("tile-new"), 1200);
    });
    // D = duck (not while typing, or while a dialog is open)
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.toLowerCase() !== "d") return;
      if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setDuck(!ducked);
    });
  }

  return {
    init,
    factor: () => factor,
    ducked: () => ducked,
    duckBusy: () => duckBusy,
    setDuck,
    claim,
    fade,
    fadeMs,
  };
})();
