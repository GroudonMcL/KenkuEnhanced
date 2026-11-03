// board.js – the grid of tiles (replaces the old fixed panels).
//
// Every element on screen is a "tile": drag it by its title bar, resize it with
// the handles on its edges, ▾ collapse it to just the title bar, ✕ close it.
// 🔒 in the top bar freezes the layout so nothing moves by accident.
//
// The grid itself is gridstack.js (vendor/gridstack, MIT licence). We give it
// 12 columns that stretch with the window; on narrow screens everything stacks
// in one column.
//
// Tile types (Kenku playlist, YouTube, Website, …) register themselves with
// Board.register(type, definition); see kenku-panel.js, youtube-panel.js and
// embed-panel.js. A definition looks like:
//
//   { badge: "YouTube", badgeClass: "y",
//     size: { w: 4, h: 6, minW: 2, minH: 3 },
//     create(tile, config) → { save() → config, destroy() } }
//
// The layout is remembered in this browser (localStorage "board"). In step 3 of
// the redesign each scene will get its own layout.

const Board = (() => {
  const $ = (id) => document.getElementById(id);
  const TYPES = {};
  const tiles = new Map(); // id → tile
  let grid = null;
  let restoring = false;   // true while building the saved layout (don't save half of it)
  let saveTimer = null;

  const CELL = 20;      // row height in px – small, so tile heights can be fine-tuned
  const GAP = 4;       // gridstack margin around each tile (so 8px between tiles)
  const COLLAPSED = 2; // rows of a collapsed tile: 2 × 20px − margins = the 32px title bar

  function register(type, def) {
    TYPES[type] = def;
  }

  const newId = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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

  // Create a tile. `saved` = what save() stored (position, title, collapsed, config).
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
      body: q(".tile-body"),
      actions: q(".tile-actions"),
      autoTitle: "",
      customTitle: saved.customTitle || "",
      collapsed: false,
      expandedH: saved.expandedH || saved.h || size.h,
      inst: null,
    };

    // ---- Title: comes from the source; double-click to give your own ----
    const titleEl = q(".tile-title");
    function showTitle() {
      titleEl.textContent = tile.customTitle || tile.autoTitle || def.badge;
      titleEl.classList.toggle("custom", !!tile.customTitle);
    }
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
        tile.inst?.titleChanged?.();
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
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", onClick);
      tile.actions.appendChild(b);
      return b;
    };

    // ---- Collapse in place: shrink to just the title bar ----
    // The body is clipped, not removed, so videos and websites keep playing.
    tile.setCollapsed = (on) => {
      if (on === tile.collapsed) return;
      tile.collapsed = on;
      el.classList.toggle("collapsed", on);
      const btn = q(".tile-collapse");
      btn.textContent = on ? "▸" : "▾";
      btn.title = on ? "Expand" : "Collapse";
      if (!grid || !el.gridstackNode) return;
      if (on) {
        tile.expandedH = el.gridstackNode.h;
        grid.update(el, { h: COLLAPSED, minH: COLLAPSED, noResize: true, sizeToContent: false });
      } else {
        grid.update(el, { h: Math.max(tile.expandedH || size.h, size.minH || 4), minH: size.minH || 4, noResize: false, sizeToContent: !!def.fitContent });
      }
      save();
    };
    q(".tile-collapse").addEventListener("click", () => tile.setCollapsed(!tile.collapsed));

    tile.close = () => {
      tile.inst?.destroy?.();
      tiles.delete(tile.id);
      grid.removeWidget(el);
      save();
      changed();
    };
    q(".tile-close").addEventListener("click", () => {
      if (tile.inst?.confirmClose && !tile.inst.confirmClose()) return;
      tile.close();
    });

    // Tell the board this tile's settings changed (it saves soon after).
    tile.changed = () => save();

    tile.config = () => (tile.inst?.save ? tile.inst.save() : config);

    // ---- Put it on the grid ----
    tiles.set(tile.id, tile);
    $("board").appendChild(el);
    const pos = saved.w
      ? { x: saved.x, y: saved.y, w: saved.w, h: saved.collapsed ? COLLAPSED : saved.h }
      : { w: size.w, h: size.h, autoPosition: true, ...(saved.place || {}) };
    grid.makeWidget(el, {
      ...pos, id: tile.id,
      minW: size.minW || 2,
      minH: saved.collapsed ? COLLAPSED : size.minH || 4,
      noResize: !!saved.collapsed,
      // fitContent tiles (Now playing) grow/shrink to fit what's in them
      sizeToContent: !!def.fitContent && !saved.collapsed,
      // measure the body's content, not the title bar
      ...(def.fitContent ? { resizeToContentParent: ".tile-body" } : {}),
    });
    if (saved.collapsed) {
      tile.collapsed = true;
      el.classList.add("collapsed");
      q(".tile-collapse").textContent = "▸";
      q(".tile-collapse").title = "Expand";
    }

    showTitle();
    tile.inst = def.create(tile, config) || {};
    if (def.fitContent) {
      tile.body.classList.add("flush"); // the content carries its own padding (exact measuring)
      tile.fit = () => !tile.collapsed && grid.resizeToContent(el);
      requestAnimationFrame(tile.fit);
    } else {
      tile.fit = () => {};
    }
    if (!restoring) {
      save();
      changed();
      // Show the new tile
      setTimeout(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
      el.classList.add("tile-new");
      setTimeout(() => el.classList.remove("tile-new"), 1200);
    }
    return tile;
  }

  // ===========================================================================
  // Saving / restoring the layout
  // ===========================================================================
  function snapshot() {
    // Positions for the full 12-column layout, even while the window is narrow.
    const nodes = grid.save(false, false, undefined, 12);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const items = [];
    for (const t of tiles.values()) {
      const n = byId.get(t.id) || {};
      items.push({
        id: t.id,
        type: t.type,
        x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 4, h: n.h ?? 4,
        collapsed: t.collapsed,
        expandedH: t.collapsed ? t.expandedH : n.h,
        customTitle: t.customTitle || undefined,
        config: t.config(),
      });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return { version: 1, items };
  }

  function save() {
    if (restoring || !grid) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Store.set("board", snapshot()), 300);
  }

  // Other modules can listen for "tiles were added/removed" (e.g. the add dialogs'
  // "on screen" marks).
  function changed() {
    window.dispatchEvent(new Event("board-changed"));
  }

  function restore(layout) {
    restoring = true;
    grid.batchUpdate();
    for (const item of layout.items || []) {
      if (TYPES[item.type]) add(item.type, item.config || {}, item);
    }
    grid.batchUpdate(false);
    restoring = false;
    changed();
  }

  // What you get the very first time (or after "Reset layout").
  function defaultLayout() {
    const items = [
      { type: "nowplaying", x: 0, y: 0, w: 7, h: 4, config: {} },
      { type: "playlist", x: 0, y: 4, w: 3, h: 16, config: { id: null, autoFirst: true } },
      { type: "soundboard", x: 3, y: 4, w: 4, h: 12, config: { id: null, autoFirst: true } },
    ];
    // Carry over YouTube players and the website from the old panel layout.
    const decks = Store.get("youtube.decks", null) || [{ url: "", volume: 60 }];
    let y = 0;
    decks.forEach((d, i) => {
      items.push({ type: "youtube", x: 7, y, w: 5, h: 13, customTitle: d.name || undefined, config: { url: d.url, volume: d.volume ?? 60, loop: !!d.loop } });
      y += 13;
    });
    const url = Store.get("embed.url", "");
    if (url) items.push({ type: "website", x: 0, y: 20, w: 7, h: 20, config: { url } });
    return { version: 1, items };
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
    b.textContent = on ? "🔒" : "🔓";
    b.classList.toggle("on", on);
    b.title = on ? "Layout locked – click to allow moving and resizing tiles" : "Lock the layout (so tiles can't be moved by accident)";
  }

  // ===========================================================================
  function init() {
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
        draggable: { cancel: "button, input, select, textarea, .tile-title.editing" },
      },
      $("board")
    );

    // iframes swallow mouse moves while dragging over them – switch them off briefly.
    const start = () => document.body.classList.add("dragging");
    const stop = () => document.body.classList.remove("dragging");
    grid.on("dragstart resizestart", start);
    grid.on("dragstop resizestop", () => { stop(); save(); });
    grid.on("change", save);

    const saved = Store.get("board", null);
    restore(saved && saved.items ? saved : defaultLayout());
    if (!saved) save();

    setLocked(locked);
    $("board-lock").addEventListener("click", () => setLocked(!locked));
    $("board-reset").addEventListener("click", () => {
      if (!confirm("Put the default tiles back? Your current tiles will be closed.")) return;
      for (const t of [...tiles.values()]) t.close();
      Store.set("board", null);
      restore(defaultLayout());
      save();
    });
  }

  return {
    init,
    register,
    add,
    save,
    tiles: (type) => [...tiles.values()].filter((t) => !type || t.type === type),
    find: (type, pred) => [...tiles.values()].find((t) => t.type === type && (!pred || pred(t))),
  };
})();
