// board.js – the grid of tiles.
//
// Every element on screen is a "tile": drag it by its title bar, resize it with
// the handles on its edges, ▾ collapse it to just the title bar, ✕ close it.
// 🔒 in the top bar freezes the layout so nothing moves by accident.
// Some tiles (YouTube, playlists) have a "▶ auto" switch: ticked = it starts
// when you switch to this scene (see scenes.js).
//
// The grid itself is gridstack.js (vendor/gridstack, MIT licence). We give it
// 12 columns that stretch with the window; on narrow screens everything stacks
// in one column.
//
// Each scene is a saved board. scenes.js gives the board a layout with
// Board.init(layout) / Board.applyLayout(layout), and hears about every change
// through Board.onChange(fn), so it can auto-save.
//
// Tile types (Kenku playlist, YouTube, Website, …) register themselves with
// Board.register(type, definition); see kenku-panel.js, youtube-panel.js and
// embed-panel.js. A definition looks like:
//
//   { badge: "YouTube", badgeClass: "y",
//     size: { w: 4, h: 6, minW: 2, minH: 3 },
//     autoable: true,              // show the "▶ auto" switch
//     fitContent: false,           // height follows the content
//     key(config) → "yt:abc",      // tiles with the same key are "the same thing"
//     create(tile, config) → { save() → config, apply(config), destroy() } }

const Board = (() => {
  const $ = (id) => document.getElementById(id);
  const TYPES = {};
  const tiles = new Map(); // id → tile
  let grid = null;
  let quiet = 0;           // > 0 while building a layout (don't report half of it)
  let saveTimer = null;
  let changeHandler = () => {};

  const CELL = 20;      // row height in px – small, so tile heights can be fine-tuned
  const GAP = 3;        // gridstack margin around each tile (so 6px between tiles)
  const COLLAPSED = 2;  // rows of a collapsed tile: 2 × 20px − margins = 34px, just the title bar

  function register(type, def) {
    TYPES[type] = def;
  }

  const newId = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const keyOf = (type, config) => type + ":" + (TYPES[type]?.key ? TYPES[type].key(config || {}) : "");

  // ===========================================================================
  // One tile
  // ===========================================================================
  function buildTileElement(def) {
    const item = document.createElement("div");
    item.className = "grid-stack-item";
    item.innerHTML = `
      <div class="grid-stack-item-content tile">
        <div class="tile-head">
          <span class="tile-badge"></span>
          <button type="button" class="tile-auto" title="▶ auto: start this when you switch to the scene" hidden>▶ auto</button>
          <span class="tile-title" title="Double-click to rename"></span>
          <span class="tile-status"></span>
          <span class="tile-actions"></span>
          <button type="button" class="tile-btn tile-collapse" title="Collapse">▾</button>
          <button type="button" class="tile-btn tile-close" title="Close this tile">✕</button>
        </div>
        <div class="tile-body"></div>
      </div>`;
    const badge = item.querySelector(".tile-badge");
    badge.textContent = def.badge;
    badge.classList.add("b-" + (def.badgeClass || "k"));
    return item;
  }

  // Create a tile. `saved` = a layout item (position, title, collapsed, auto).
  function add(type, config = {}, saved = {}) {
    const def = TYPES[type];
    if (!def) return null;
    const el = buildTileElement(def);
    const q = (sel) => el.querySelector(sel);
    const size = def.size || { w: 4, h: 5 };

    const tile = {
      id: saved.id || newId(),
      type,
      el,
      def,
      body: q(".tile-body"),
      actions: q(".tile-actions"),
      autoTitle: "",
      customTitle: saved.customTitle || "",
      collapsed: false,
      auto: !!saved.auto,
      expandedH: saved.expandedH || saved.h || size.h,
      inst: null,
    };

    // ---- Title: comes from the source; double-click to give your own ----
    const titleEl = q(".tile-title");
    function showTitle() {
      titleEl.textContent = tile.customTitle || tile.autoTitle || def.badge;
      titleEl.classList.toggle("custom", !!tile.customTitle);
    }
    tile.showTitle = showTitle;
    tile.setTitle = (text) => {
      tile.autoTitle = text || "";
      showTitle();
    };
    tile.title = () => tile.customTitle || tile.autoTitle || def.badge;
    titleEl.addEventListener("dblclick", () => {
      const input = document.createElement("input");
      input.className = "tile-rename";
      input.value = tile.title();
      input.maxLength = 80;
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      const done = (keep) => {
        if (keep) {
          const v = input.value.trim();
          // Typing the automatic name (or nothing) goes back to the automatic name
          tile.customTitle = v && v !== tile.autoTitle ? v : "";
          save();
        }
        input.replaceWith(titleEl);
        showTitle();
      };
      let finished = false;
      const finish = (keep) => {
        if (finished) return; // Enter → replaceWith → blur would run it twice
        finished = true;
        done(keep);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
    });

    // ---- ▶ auto: start with the scene ----
    const autoBtn = q(".tile-auto");
    autoBtn.hidden = !def.autoable;
    tile.setAuto = (on, quietly) => {
      tile.auto = !!on;
      autoBtn.classList.toggle("on", tile.auto);
      autoBtn.title = tile.auto
        ? "▶ auto is on: this starts when you switch to the scene. Click to turn off."
        : "▶ auto is off. Click to start this when you switch to the scene.";
      if (!quietly) save();
    };
    autoBtn.addEventListener("click", () => tile.setAuto(!tile.auto));
    tile.setAuto(tile.auto, true);

    // ---- Small status text next to the title (e.g. "● 2 playing") ----
    const statusEl = q(".tile-status");
    tile.setStatus = (text, kind = "") => {
      statusEl.textContent = text || "";
      statusEl.className = "tile-status" + (kind ? " " + kind : "");
    };

    // ---- Extra buttons in the title bar ----
    tile.addAction = (label, title, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn";
      if (Icons.has(label)) Icons.set(b, label); // a line icon by name (see icons.js)
      else b.textContent = label;
      b.title = title;
      b.addEventListener("click", onClick);
      tile.actions.appendChild(b);
      return b;
    };

    // ---- Collapse in place: shrink to just the title bar ----
    // The body is clipped, not removed, so videos and websites keep playing.
    function showCollapsed(on) {
      tile.collapsed = on;
      el.classList.toggle("collapsed", on);
      const btn = q(".tile-collapse");
      btn.textContent = on ? "▸" : "▾";
      btn.title = on ? "Expand" : "Collapse";
    }
    tile.setCollapsed = (on) => {
      if (on === tile.collapsed) return;
      if (on && el.gridstackNode) tile.expandedH = el.gridstackNode.h;
      showCollapsed(on);
      if (!grid || !el.gridstackNode) return;
      grid.update(el, on
        ? { h: COLLAPSED, minH: COLLAPSED, noResize: true, sizeToContent: false }
        : { h: Math.max(tile.expandedH || size.h, size.minH || 4), minH: size.minH || 4, noResize: false, sizeToContent: !!def.fitContent });
      if (!on) tile.fit();
      save();
    };
    q(".tile-collapse").addEventListener("click", () => tile.setCollapsed(!tile.collapsed));

    // Close = gone now. (Scene switches use detach() + dispose() instead, so a
    // video can fade out before its tile disappears.)
    tile.dispose = () => {
      tile.inst?.destroy?.();
      tiles.delete(tile.id);
      if (el.gridstackNode) grid.removeWidget(el);
      else el.remove();
    };
    tile.close = () => {
      tile.dispose();
      save();
      changed();
    };
    q(".tile-close").addEventListener("click", () => tile.close());

    // Tell the board this tile's settings changed (it saves soon after).
    tile.changed = () => save();

    tile.config = () => (tile.inst?.save ? tile.inst.save() : config);
    tile.key = () => keyOf(type, tile.config());

    // Take a layout item's settings (used when a scene switch keeps this tile).
    tile.applySaved = (item) => {
      tile.customTitle = item.customTitle || "";
      tile.expandedH = item.expandedH || item.h || tile.expandedH;
      showCollapsed(!!item.collapsed);
      tile.setAuto(!!item.auto, true);
      tile.inst?.apply?.(item.config || {});
      showTitle();
    };

    // ---- Put it on the grid ----
    tiles.set(tile.id, tile);
    $("board").appendChild(el);
    // (Fit-to-content is switched on only once the tile has content – see below.)
    grid.makeWidget(el, { ...widgetOpts(def, { ...saved, id: tile.id }), sizeToContent: false });
    if (saved.collapsed) showCollapsed(true);

    showTitle();
    tile.inst = def.create(tile, config) || {};
    if (def.fitContent) {
      tile.body.classList.add("flush"); // the content carries its own padding (exact measuring)
      tile.fit = () => !tile.collapsed && tile.body.firstElementChild && grid.resizeToContent(el);
      if (!tile.collapsed) grid.update(el, { sizeToContent: true });
      requestAnimationFrame(tile.fit);
    } else {
      tile.fit = () => {};
    }
    if (!quiet) {
      save();
      changed();
      // Show the new tile
      setTimeout(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
      el.classList.add("tile-new");
      setTimeout(() => el.classList.remove("tile-new"), 1200);
    }
    return tile;
  }

  // gridstack options for a layout item (or a brand-new tile when it has no w)
  function widgetOpts(def, saved) {
    const size = def.size || { w: 4, h: 5 };
    const pos = saved.w
      ? { x: saved.x, y: saved.y, w: saved.w, h: saved.collapsed ? COLLAPSED : saved.h }
      : { w: size.w, h: size.h, autoPosition: true };
    return {
      ...pos,
      id: saved.id,
      minW: size.minW || 2,
      minH: saved.collapsed ? COLLAPSED : size.minH || 4,
      noResize: !!saved.collapsed,
      // fitContent tiles (Now playing) grow/shrink to fit what's in them
      sizeToContent: !!def.fitContent && !saved.collapsed,
      // measure the body's content, not the title bar
      ...(def.fitContent ? { resizeToContentParent: ".tile-body" } : {}),
    };
  }

  // ===========================================================================
  // Saving: the board reports changes; scenes.js stores them in the scene.
  // ===========================================================================
  function snapshot() {
    // Positions for the full 12-column layout, even while the window is narrow.
    const nodes = grid.save(false, false, undefined, 12);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const items = [];
    for (const t of tiles.values()) {
      const n = byId.get(t.id);
      if (!n) continue; // a tile that's fading out
      items.push({
        id: t.id,
        type: t.type,
        x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 4, h: n.h ?? 4,
        collapsed: t.collapsed || undefined,
        expandedH: t.collapsed ? t.expandedH : undefined,
        auto: t.auto || undefined,
        customTitle: t.customTitle || undefined,
        config: t.config(),
      });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return { version: 1, items };
  }

  function save() {
    if (quiet || !grid) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  // Report the layout now (e.g. right before switching scenes).
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (grid && !quiet) changeHandler(snapshot());
  }

  // Other modules can listen for "tiles were added/removed" (e.g. the add dialogs'
  // "on screen" marks).
  function changed() {
    window.dispatchEvent(new Event("board-changed"));
  }

  // ===========================================================================
  // Switching to another layout (a scene switch, or Undo)
  // ===========================================================================
  // Tiles that are "the same thing" in both layouts (same key: same video, same
  // playlist, same website…) are KEPT – moved and resized, never rebuilt – so
  // whatever they're playing carries on without a gap. The others are detached:
  // hidden but still alive, so the caller can fade them out, then dispose() them.
  // Returns { kept: [{ tile, item }], added: [{ tile, item }], leaving: [tile] }.
  function applyLayout(layout) {
    const items = (layout?.items || []).filter((i) => TYPES[i.type]);
    const pool = [...tiles.values()];
    const kept = [];
    const used = new Set();
    for (const item of items) {
      const key = keyOf(item.type, item.config);
      const t = pool.find((x) => !used.has(x) && x.type === item.type && x.key() === key);
      if (t) {
        used.add(t);
        kept.push({ tile: t, item });
      }
    }
    const leaving = pool.filter((t) => !used.has(t));

    quiet++;
    grid.batchUpdate();
    // Detach leaving tiles: off the grid, out of sight, still playing.
    // (Never move the element in the page – that would reload its video/website.)
    for (const t of leaving) {
      grid.removeWidget(t.el, false);
      t.el.classList.add("tile-leaving");
      tiles.delete(t.id);
      t.dispose = () => {
        t.inst?.destroy?.();
        t.el.remove();
        t.dispose = () => {};
      };
    }
    // Kept tiles take the new layout's place, size and settings.
    for (const { tile, item } of kept) {
      tiles.delete(tile.id);
      tile.id = item.id || newId();
      tiles.set(tile.id, tile);
      tile.applySaved(item);
      grid.update(tile.el, widgetOpts(tile.def, { ...item, id: tile.id }));
      if (tile.el.gridstackNode) tile.el.gridstackNode.id = tile.id; // snapshot() matches tiles by this id
    }
    // New tiles
    const added = [];
    for (const item of items) {
      if (kept.some((k) => k.item === item)) continue;
      added.push({ tile: add(item.type, item.config || {}, item), item });
    }
    grid.batchUpdate(false);
    quiet--;
    kept.forEach(({ tile }) => tile.fit());
    changed();
    return { kept, added, leaving };
  }

  // ===========================================================================
  // Lock
  // ===========================================================================
  let locked = Store.get("board.locked", false);
  function setLocked(on) {
    locked = on;
    Store.set("board.locked", on);
    grid?.setStatic(on);
    document.body.classList.toggle("board-locked", on);
    const b = $("board-lock");
    b.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/>` +
      (on ? `<path d="M8 11V7a4 4 0 0 1 8 0v4"/>` : `<path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>`) + `</svg>`;
    b.setAttribute("aria-label", on ? "Unlock the layout" : "Lock the layout");
    b.classList.toggle("on", on);
    b.title = on ? "Layout locked – click to allow moving and resizing tiles" : "Lock the layout (so tiles can't be moved by accident)";
  }

  // What a brand-new scene starts with
  function defaultLayout() {
    return {
      version: 1,
      items: [
        { type: "nowplaying", x: 0, y: 0, w: 7, h: 4, config: {} },
        { type: "playlist", x: 0, y: 4, w: 3, h: 16, config: { id: null, autoFirst: true } },
        { type: "soundboard", x: 3, y: 4, w: 4, h: 12, config: { id: null, autoFirst: true } },
        { type: "youtube", x: 7, y: 0, w: 5, h: 13, config: { url: "", volume: 60 } },
      ],
    };
  }

  // The layout from before scenes stored boards (step 1/2 kept it in this browser).
  function legacyLayout() {
    const saved = Store.get("board", null);
    return saved?.items?.length ? saved : null;
  }

  // ===========================================================================
  function init(layout) {
    grid = GridStack.init(
      {
        column: 12,
        cellHeight: CELL,
        margin: GAP,
        float: false,               // tiles move up to fill gaps (so collapsing frees space)
        animate: true,
        handle: ".tile-head",
        resizable: { handles: "e, se, s, sw, w" },
        columnOpts: { breakpointForWindow: true, breakpoints: [{ w: 760, c: 1 }] },
        draggable: { cancel: "button, input, select, textarea" },
      },
      $("board")
    );

    // iframes swallow mouse moves while dragging over them – switch them off briefly.
    const start = () => document.body.classList.add("dragging");
    const stop = () => document.body.classList.remove("dragging");
    grid.on("dragstart resizestart", start);
    grid.on("dragstop resizestop", () => { stop(); save(); });
    grid.on("change", save);

    quiet++;
    grid.batchUpdate();
    for (const item of (layout || defaultLayout()).items || []) {
      if (TYPES[item.type]) add(item.type, item.config || {}, item);
    }
    grid.batchUpdate(false);
    quiet--;
    changed();

    setLocked(locked);
    $("board-lock").addEventListener("click", () => setLocked(!locked));
  }

  return {
    init,
    register,
    add,
    save,
    flush,
    snapshot,
    applyLayout,
    defaultLayout,
    legacyLayout,
    onChange: (fn) => (changeHandler = fn),
    tiles: (type) => [...tiles.values()].filter((t) => !type || t.type === type),
    find: (type, pred) => [...tiles.values()].find((t) => t.type === type && (!pred || pred(t))),
  };
})();
