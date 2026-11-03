// links.js – saved links + the "+ Website" dialog.
//
// The dialog has a sidebar:
//   Tabletop Audio – 🎲 SoundPads, 🎵 Ambience tracks, ⭐ My Custom SoundPads
//   Presets        – other ambience sites (myNoise, Ambient-Mixer, …)
//   Your links     – addresses you saved with ☆
// plus one box that searches the current list, or takes an address you paste.
// Pick something, then "+ Add tile" (or double-click it).
//
// Saved links are stored by the helper in data/links.json. A link opens either
// in a Website tile or in a new Kenku tab. "Automatic" uses a tile unless the
// site refuses to be embedded. (Adding a tile from the dialog always makes a
// tile: for sites that refuse, the tile shows an "open in a Kenku tab" button,
// so the site still has its place on the board.)
//
// Kenku turns every window.open into a NEW tab (it can't reuse one), so when a
// scene opens its link automatically we skip links already opened since the
// dashboard was loaded. The "↗ Open scene link" button always opens it.

const Links = (() => {
  const $ = (id) => document.getElementById(id);
  let links = [];
  let editing = null;          // { link, isNew } while the link editor is open
  let soundpads = null;        // Tabletop Audio SoundPads, once loaded
  let tracks = null;           // Tabletop Audio ambience tracks, once loaded
  const listMessages = {};     // section → problem loading its list
  const openedTabs = new Set(); // URLs opened in a new tab since the page loaded

  const TTA = "https://tabletopaudio.com/";
  const CUSTOM_SP = TTA + "custom_sp.html";

  // Other ambience sites. `embeds: false` = the site refuses to be shown inside
  // other pages (tested 2026-11-03), so its tile shows an "open" button for now.
  const PRESETS = [
    { id: "mynoise", icon: "🎚", name: "myNoise", url: "https://mynoise.net/noiseMachines.php",
      description: "Noise and ambience generators with sliders – rain, forest, dungeon, spaceship…", embeds: false },
    { id: "ambientmixer", icon: "🧪", name: "Ambient-Mixer (RPG)", url: "https://rpg.ambient-mixer.com/",
      description: "Thousands of user-made ambience mixes for fantasy and RPG settings.", embeds: false },
    { id: "rainymood", icon: "🌧", name: "Rainy Mood", url: "https://www.rainymood.com/",
      description: "A simple, endless rain and thunder loop.", embeds: false },
    { id: "syrinscape", icon: "🐉", name: "Syrinscape", url: "https://app.syrinscape.com/",
      description: "RPG soundscapes and sound effects. Needs a Syrinscape account (free tier available).", embeds: true },
    { id: "taverntunes", icon: "🍺", name: "TavernTunes", url: "https://app.taverntunes.com/",
      description: "Music and ambience for D&D and board games, made to listen to together.", embeds: true },
    { id: "asoftmurmur", icon: "🍃", name: "A Soft Murmur", url: "https://asoftmurmur.com/",
      description: "Mix rain, wind, waves, fire and more with simple sliders.", embeds: true },
  ];

  // ===========================================================================
  // Loading / saving (through the helper)
  // ===========================================================================
  async function load() {
    try {
      links = (await (await fetch("/api/links")).json()).links || [];
    } catch {
      links = [];
    }
    renderDialog();
  }

  async function persist() {
    try {
      const r = await fetch("/api/links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return true;
    } catch (err) {
      alert("Couldn't save links: " + err.message);
      return false;
    }
  }

  // The Tabletop Audio lists (the helper reads them once a day and keeps a copy).
  async function loadList(kind, refresh) {
    try {
      const data = await (await fetch(`/api/links/${kind}` + (refresh ? "?refresh=1" : ""))).json();
      const list = data[kind] || [];
      if (!list.length) listMessages[kind] = [`${data.error || "Nothing found"}.`, "error"];
      else if (data.stale) listMessages[kind] = [`Showing the list from ${new Date(data.fetchedAt).toLocaleDateString()} (${data.error}).`, "warn"];
      else delete listMessages[kind];
      return list;
    } catch {
      listMessages[kind] = ["Couldn't reach the helper.", "error"];
      return [];
    }
  }
  async function loadSoundpads(refresh) {
    soundpads = await loadList("soundpads", refresh);
    renderDialog();
    window.dispatchEvent(new Event("link-names-changed")); // Website tiles can use the names
  }
  async function loadTracks(refresh) {
    tracks = await loadList("tracks", refresh);
    renderDialog();
    window.dispatchEvent(new Event("link-names-changed"));
  }

  const newId = () => "l-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sameUrl = (a, b) => EmbedPanel.normalise(a || "").replace(/\/$/, "") === EmbedPanel.normalise(b || "").replace(/\/$/, "");
  const findByUrl = (url) => links.find((l) => sameUrl(l.url, url));
  const isCustomSoundpad = (url) => /tabletopaudio\.com\/custom_sp/i.test(url || "");

  // ===========================================================================
  // Opening (used by scenes and Vibe too)
  // ===========================================================================
  // Where should this URL open? "panel" (a Website tile) or "tab".
  function whereFor(url, openIn) {
    const mode = openIn || findByUrl(url)?.openIn || "auto";
    if (mode === "auto") return EmbedPanel.isBlocked(url) ? "tab" : "panel";
    return mode;
  }

  // opts.newTile: always add a new Website tile
  function open(url, openIn, opts = {}) {
    url = EmbedPanel.normalise(url || "");
    if (!url) return;
    if (whereFor(url, openIn) === "tab") {
      EmbedPanel.openNewTab(url);
      openedTabs.add(url);
    } else {
      EmbedPanel.load(url, opts);
    }
  }

  // Used by scenes: don't pile up Kenku tabs or reload a page that's already open.
  function openForScene(url) {
    url = EmbedPanel.normalise(url || "");
    if (!url) return;
    if (whereFor(url) === "tab") {
      if (openedTabs.has(url)) return;
    } else if (EmbedPanel.urls().some((u) => sameUrl(u, url))) {
      return;
    }
    open(url);
  }

  // Name to show for an address we know (SoundPad, track, preset, saved link), or "".
  function nameFor(url) {
    const pad = soundpads?.find((p) => sameUrl(p.url, url));
    if (pad) return `${pad.name} – Tabletop Audio SoundPad`;
    const track = tracks?.find((t) => sameUrl(t.url, url));
    if (track) return `${track.name} – Tabletop Audio`;
    const link = findByUrl(url);
    if (link) return link.name;
    const preset = PRESETS.find((p) => sameUrl(p.url, url));
    if (preset) return preset.name;
    if (isCustomSoundpad(url)) return "Custom SoundPad – Tabletop Audio";
    return "";
  }

  // ===========================================================================
  // Link editor dialog (☆ Save link / ✎ edit)
  // ===========================================================================
  function linkMessage(text, kind = "warn") {
    const box = $("link-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  function openLinkEditor(link, isNew) {
    editing = { link, isNew };
    linkMessage(null);
    $("link-dialog-title").textContent = isNew ? "Save link" : "Edit link";
    $("ln-name").value = link.name || "";
    $("ln-url").value = link.url || "";
    $("ln-open").value = link.openIn || "auto";
    $("ln-delete").hidden = isNew;
    $("ln-left").hidden = isNew;
    $("ln-right").hidden = isNew;
    $("link-dialog").showModal();
  }

  // A sensible name for an address: the SoundPad's / track's name, or the site name.
  function guessName(url) {
    const pad = soundpads?.find((p) => sameUrl(p.url, url));
    if (pad) return pad.name;
    const track = tracks?.find((t) => sameUrl(t.url, url));
    if (track) return track.name;
    if (isCustomSoundpad(url)) return "My Custom SoundPad";
    const preset = PRESETS.find((p) => sameUrl(p.url, url));
    if (preset) return preset.name;
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // ☆ in a Website tile or the dialog: save (or edit) an address as a link.
  function saveUrl(url, name) {
    url = EmbedPanel.normalise(url || "");
    if (!url) return;
    const existing = findByUrl(url);
    if (existing) return openLinkEditor(existing, false);
    openLinkEditor({ id: newId(), name: name || guessName(url), url, openIn: "auto" }, true);
  }

  // Add a link without the editor. Returns the link.
  async function add(name, url, openIn = "auto") {
    const existing = findByUrl(url);
    if (existing) return existing;
    const link = { id: newId(), name: name.slice(0, 80), url, openIn };
    links.push(link);
    renderDialog();
    await persist();
    return link;
  }

  async function saveLinkEditor(e) {
    e.preventDefault();
    const name = $("ln-name").value.trim();
    const url = EmbedPanel.normalise($("ln-url").value);
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      return linkMessage("Please enter a full web address, like https://tabletopaudio.com/…", "error");
    }
    if (!name) return linkMessage("Give the link a name.", "error");
    const other = findByUrl(url);
    if (other && other.id !== editing.link.id) return linkMessage(`You already saved this address as "${other.name}".`, "error");

    const link = { ...editing.link, name, url, openIn: $("ln-open").value };
    if (editing.isNew) links.push(link);
    else links[links.findIndex((l) => l.id === link.id)] = link;
    $("link-dialog").close();
    renderDialog();
    window.dispatchEvent(new Event("link-names-changed"));
    await persist();
  }

  async function deleteLink() {
    if (!confirm(`Delete the link "${editing.link.name}"?`)) return;
    links = links.filter((l) => l.id !== editing.link.id);
    $("link-dialog").close();
    renderDialog();
    await persist();
  }

  async function move(delta) {
    const i = links.findIndex((l) => l.id === editing.link.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= links.length) return;
    [links[i], links[j]] = [links[j], links[i]];
    renderDialog();
    await persist();
  }

  // ===========================================================================
  // The "+ Website" dialog
  // ===========================================================================
  let section = Store.get("links.section", "soundpads");
  let category = "all";
  let selected = null;        // { url, name, tileName }
  let showAll = false;        // big lists show the first 120 until "Show more"
  const PAGE = 120;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const cap = (c) => c[0].toUpperCase() + c.slice(1);

  // "tavern night" → every word must appear somewhere in the item's text
  function matcher() {
    const words = $("web-add-search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (...texts) => {
      const hay = texts.join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    };
  }

  // Does the search box hold an address rather than search words?
  function typedAddress() {
    const v = $("web-add-search").value.trim();
    if (!v || /\s/.test(v)) return "";
    if (/^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return EmbedPanel.normalise(v);
    return "";
  }

  const customLinks = () => links.filter((l) => isCustomSoundpad(l.url));
  const otherLinks = () => links.filter((l) => !isCustomSoundpad(l.url));

  // What each section shows, already filtered by the search box (and category).
  function itemsFor(sec, match, cat = "all") {
    const inCat = (x) => cat === "all" || x.categories.includes(cat);
    switch (sec) {
      case "soundpads":
        return (soundpads || []).filter((p) => inCat(p) && match(p.name, p.description, p.categories.join(" ")));
      case "tracks":
        return (tracks || []).filter((t) => inCat(t) && match(t.name, t.description, t.kind, t.categories.join(" ")));
      case "custom":
        return customLinks().filter((l) => match(l.name, l.url));
      case "presets":
        return PRESETS.filter((p) => match(p.name, p.description, p.url));
      case "links":
        return otherLinks().filter((l) => match(l.name, l.url));
    }
    return [];
  }

  function select(item) {
    selected = item;
    renderFooter();
    document.querySelectorAll("#web-add-list .selected").forEach((x) => x.classList.remove("selected"));
    document.querySelector(`#web-add-list [data-url="${CSS.escape(item?.url || "")}"]`)?.classList.add("selected");
  }

  // A clickable item: click = select, double-click = add straight away.
  function selectable(node, item) {
    node.dataset.url = item.url;
    node.tabIndex = 0;
    if (selected && sameUrl(selected.url, item.url)) node.classList.add("selected");
    node.addEventListener("click", () => select(item));
    node.addEventListener("dblclick", () => { select(item); addSelected(); });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { select(item); addSelected(); }
    });
    return node;
  }

  function card(item, { image, name, info, isNew, saved }) {
    const c = el("div", "pick-card");
    const img = el("div", "pick-img");
    if (image) {
      const i = el("img");
      i.loading = "lazy"; // only load pictures that scroll into view
      i.alt = "";
      i.src = image;
      img.append(i);
    }
    if (isNew) img.append(el("span", "pick-new", "new"));
    if (saved) img.append(el("span", "pick-saved", "★"));
    c.append(img, el("b", "", name), el("small", "", info));
    c.title = item.description || name;
    return selectable(c, item);
  }

  function row(item, { icon, name, info, mark, onEdit }) {
    const r = el("div", "pick-row");
    r.append(el("span", "pick-icon w", icon));
    const text = el("span", "pick-text");
    text.append(el("b", "", name), el("small", "", info));
    r.append(text);
    if (mark) r.append(el("span", "pick-mark", mark));
    if (onEdit) {
      const b = el("button", "tile-btn", "✎");
      b.type = "button";
      b.title = "Rename, change or delete this link";
      b.onclick = (e) => { e.stopPropagation(); onEdit(); };
      r.append(b);
    }
    return selectable(r, item);
  }

  const embedMark = (url, knownEmbeds) => {
    const blocked = knownEmbeds === false ? !EmbedPanel.viaPassThrough(url) : EmbedPanel.isBlocked(url);
    return blocked ? "opens in a Kenku tab" : "";
  };

  function renderDialog() {
    if (!$("web-add-dialog").open) return;
    const match = matcher();
    const words = $("web-add-search").value.trim();
    const addr = typedAddress();

    // Sidebar: active section + counts (matches while searching)
    document.querySelectorAll("#web-add-dialog [data-sec]").forEach((b) => {
      b.classList.toggle("on", b.dataset.sec === section);
      const n = b.querySelector("small");
      if (n) n.textContent = itemsFor(b.dataset.sec, words && !addr ? match : () => true).length || "";
    });

    // Category chips (Tabletop Audio lists only)
    const chips = $("web-add-chips");
    chips.innerHTML = "";
    const all = section === "soundpads" ? soundpads || [] : section === "tracks" ? tracks || [] : [];
    const cats = [...new Set(all.flatMap((x) => x.categories))].filter((c) => c !== "music" && c !== "scif").sort();
    if (!cats.includes(category)) category = "all";
    chips.hidden = !cats.length;
    for (const c of ["all", ...cats]) {
      const b = el("button", "small" + (c === category ? " on" : ""), c === "all" ? "All" : c === "scifi" ? "Sci-fi" : cap(c));
      b.type = "button";
      b.onclick = () => { category = c; showAll = false; renderDialog(); };
      chips.append(b);
    }

    const msg = listMessages[section];
    $("web-add-message").hidden = !msg;
    if (msg) {
      $("web-add-message").className = `notice notice-${msg[1]}`;
      $("web-add-message").textContent = msg[0];
    }

    const box = $("web-add-list");
    box.innerHTML = "";
    box.className = ["soundpads", "tracks"].includes(section) ? "pick-cards" : "pick-list";
    const holder = el("div", "pick-list");

    // A pasted address always comes first
    if (addr) {
      const item = { url: addr, name: guessName(addr), tileName: Links.nameFor(addr) || guessName(addr) };
      const r = row(item, { icon: "🔗", name: "Add this address", info: addr, mark: embedMark(addr) });
      r.classList.add("pick-address");
      holder.append(r);
      if (!selected || !sameUrl(selected.url, addr)) select(item);
      box.className = "pick-list";
      box.append(holder);
      renderFooter();
      return;
    }

    const items = itemsFor(section, match, category);
    const shown = showAll ? items : items.slice(0, PAGE);
    if (section === "soundpads") {
      if (!soundpads) box.append(el("p", "hint", "Loading the SoundPad list…"));
      for (const p of shown) {
        box.append(card({ url: p.url, name: p.name, tileName: `${p.name} – Tabletop Audio SoundPad`, description: p.description },
          { image: p.image, name: p.name, info: [p.sounds && `${p.sounds} sounds`, p.categories.filter((c) => c !== "music").join(" · ")].filter(Boolean).join(" · "), isNew: p.isNew, saved: !!findByUrl(p.url) }));
      }
    } else if (section === "tracks") {
      if (!tracks) box.append(el("p", "hint", "Loading the track list…"));
      for (const t of shown) {
        box.append(card({ url: t.url, name: t.name, tileName: `${t.name} – Tabletop Audio`, description: t.description },
          { image: t.image, name: t.name, info: `#${t.id} · ${t.kind}`, isNew: t.isNew, saved: !!findByUrl(t.url) }));
      }
    } else if (section === "custom") {
      box.append(row({ url: CUSTOM_SP, name: "Custom SoundPad", tileName: "Custom SoundPad – Tabletop Audio" },
        { icon: "＋", name: "Make a new Custom SoundPad", info: "Build your own mix on Tabletop Audio, click Get Link there, then ☆ Save it here" }));
      for (const l of items) {
        box.append(row({ url: l.url, name: l.name, tileName: l.name },
          { icon: "⭐", name: l.name, info: l.url, mark: embedMark(l.url), onEdit: () => openLinkEditor(l, false) }));
      }
      if (!items.length) box.append(el("p", "hint", words ? "None of your Custom SoundPads match." : "No saved Custom SoundPads yet. Paste a Custom SoundPad share link in the box above and click ☆ Save link."));
    } else if (section === "presets") {
      for (const p of items) {
        box.append(row({ url: p.url, name: p.name, tileName: p.name },
          { icon: p.icon, name: p.name, info: p.description, mark: embedMark(p.url, p.embeds) }));
      }
    } else if (section === "links") {
      for (const l of items) {
        box.append(row({ url: l.url, name: l.name, tileName: l.name },
          { icon: "🔗", name: l.name, info: l.url, mark: l.openIn === "tab" ? "always a Kenku tab" : embedMark(l.url), onEdit: () => openLinkEditor(l, false) }));
      }
      if (!items.length) box.append(el("p", "hint", words ? "No saved links match." : "No saved links yet. Paste an address in the box above and click ☆ Save link."));
    }
    if (items.length > shown.length) {
      const more = el("button", "small pick-more", `Show all ${items.length}`);
      more.type = "button";
      more.onclick = () => { showAll = true; renderDialog(); };
      box.append(more);
    }
    if (["soundpads", "tracks"].includes(section) && (soundpads || tracks) && !items.length && !msg) {
      box.append(el("p", "hint", "Nothing matches."));
    }

    $("web-add-hint").hidden = !["soundpads", "tracks", "custom"].includes(section);
    renderFooter();
  }

  function renderFooter() {
    const go = $("web-add-go");
    go.disabled = !selected;
    $("web-add-tab").disabled = !selected;
    $("web-add-save").disabled = !selected;
    const box = $("web-add-selected");
    box.innerHTML = "";
    if (!selected) {
      box.textContent = "Pick something (double-click adds it straight away).";
      return;
    }
    const saved = findByUrl(selected.url);
    $("web-add-save").textContent = saved ? "★ Saved" : "☆ Save link";
    box.append("Selected: ", el("b", "", selected.name), ` – the tile will be called “${selected.tileName}”`);
    if (EmbedPanel.isBlocked(selected.url) && !EmbedPanel.viaPassThrough(selected.url)) {
      box.append(el("span", "pick-warn", " · this site can't show inside a tile, so the tile will have an “open in a Kenku tab” button"));
    }
  }

  function addSelected() {
    if (!selected) return;
    $("web-add-dialog").close();
    EmbedPanel.load(selected.url, { newTile: true });
  }

  function openAdd(sec) {
    if (sec) section = sec;
    selected = null;
    showAll = false;
    $("web-add-search").value = "";
    $("web-add-dialog").showModal();
    renderDialog();
    $("web-add-search").focus();
    if (!soundpads?.length) loadSoundpads();
    if (!tracks?.length) loadTracks();
  }

  // ===========================================================================
  function init() {
    $("link-form").addEventListener("submit", saveLinkEditor);
    $("ln-cancel").addEventListener("click", () => $("link-dialog").close());
    $("ln-delete").addEventListener("click", deleteLink);
    $("ln-left").addEventListener("click", () => move(-1));
    $("ln-right").addEventListener("click", () => move(1));

    $("add-website").addEventListener("click", () => openAdd());
    $("web-add-close").addEventListener("click", () => $("web-add-dialog").close());
    document.querySelectorAll("#web-add-dialog [data-sec]").forEach((b) => {
      b.addEventListener("click", () => {
        section = b.dataset.sec;
        Store.set("links.section", section);
        category = "all";
        showAll = false;
        selected = null;
        renderDialog();
      });
    });
    let typing = null;
    $("web-add-search").addEventListener("input", () => {
      showAll = false;
      clearTimeout(typing);
      typing = setTimeout(renderDialog, 120);
    });
    $("web-add-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        renderDialog();
        if (typedAddress()) addSelected();
      }
    });
    $("web-add-go").addEventListener("click", addSelected);
    $("web-add-tab").addEventListener("click", () => {
      if (!selected) return;
      $("web-add-dialog").close();
      EmbedPanel.openNewTab(selected.url);
      openedTabs.add(selected.url);
    });
    $("web-add-save").addEventListener("click", () => selected && saveUrl(selected.url, selected.name));
    $("link-dialog").addEventListener("close", renderDialog);
    window.addEventListener("embed-mode-changed", renderDialog);

    loadSoundpads(); // quietly, so tiles, the scene editor and Vibe know SoundPad names
    loadTracks();
    load();
  }

  return {
    init,
    open,
    openForScene,
    openAdd,
    list: () => links,
    soundpads: () => soundpads || [],
    tracks: () => tracks || [],
    nameFor,
    saveUrl,
  };
})();
