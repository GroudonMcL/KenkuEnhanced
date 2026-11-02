// links.js – Phase 4: saved links + the Tabletop Audio SoundPad browser.
//
// Saved links are buttons in the Website panel (stored by the helper in
// data/links.json). A link opens either in the Website panel or in a new Kenku
// tab. "Automatic" uses the panel unless the site refuses to be embedded –
// Tabletop Audio always refuses, so SoundPads open in a new Kenku tab, where
// their audio still reaches Discord.
//
// Kenku turns every window.open into a NEW tab (it can't reuse one), so when a
// scene opens its link automatically we skip links already opened since the
// dashboard was loaded. The "↗ Open scene link" button always opens it.

const Links = (() => {
  const $ = (id) => document.getElementById(id);
  let links = [];
  let editMode = false;
  let editing = null;          // { link, isNew } while the dialog is open
  let soundpads = null;        // the SoundPad list, once loaded
  let category = Store.get("links.soundpadCategory", "all");
  const openedTabs = new Set(); // URLs opened in a new tab since the page loaded

  // ===========================================================================
  // Loading / saving (through the helper)
  // ===========================================================================
  async function load() {
    try {
      links = (await (await fetch("/api/links")).json()).links || [];
    } catch {
      links = [];
    }
    render();
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

  const newId = () => "l-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sameUrl = (a, b) => EmbedPanel.normalise(a || "").replace(/\/$/, "") === EmbedPanel.normalise(b || "").replace(/\/$/, "");
  const findByUrl = (url) => links.find((l) => sameUrl(l.url, url));

  // ===========================================================================
  // Opening
  // ===========================================================================
  // Where should this URL open? "panel" or "tab".
  function whereFor(url, openIn) {
    const mode = openIn || findByUrl(url)?.openIn || "auto";
    if (mode === "auto") return EmbedPanel.isBlocked(url) ? "tab" : "panel";
    return mode;
  }

  function open(url, openIn) {
    url = EmbedPanel.normalise(url || "");
    if (!url) return;
    if (whereFor(url, openIn) === "tab") {
      EmbedPanel.openNewTab(url);
      openedTabs.add(url);
    } else {
      Layout.show("embed");
      EmbedPanel.load(url).then(render); // re-highlight once we know if it loaded
    }
    setTimeout(render, 0); // highlight the link now showing in the panel
  }

  // Used by scenes: don't pile up Kenku tabs or reload a page that's already open.
  function openForScene(url) {
    url = EmbedPanel.normalise(url || "");
    if (!url) return;
    if (whereFor(url) === "tab") {
      if (openedTabs.has(url)) return;
    } else if (sameUrl(EmbedPanel.current(), url)) {
      return;
    }
    open(url);
  }

  // ===========================================================================
  // The link buttons
  // ===========================================================================
  function render() {
    const box = $("link-list");
    box.innerHTML = "";
    if (!links.length) {
      box.innerHTML = '<span class="hint">No saved links. Type an address above and click ☆ Save.</span>';
    }
    links.forEach((link) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small link-btn";
      const where = whereFor(link.url, link.openIn);
      b.textContent = link.name + (where === "tab" ? " ↗" : "");
      b.title = editMode ? "Click to edit" : `${link.url}\n${where === "tab" ? "Opens in a new Kenku tab" : "Opens in the Website panel"}`;
      b.classList.toggle("on", where === "panel" && sameUrl(EmbedPanel.current(), link.url));
      b.onclick = () => (editMode ? openDialog(link, false) : open(link.url, link.openIn));
      box.appendChild(b);
    });
    $("link-edit-mode").classList.toggle("on", editMode);
    $("link-edit-mode").textContent = editMode ? "✓ Done" : "✎ Edit links";
    $("link-list").classList.toggle("editing", editMode);
    if (soundpads) renderSoundpads(); // update the ☆ / ★ marks
  }

  // Add a link without the dialog (from the SoundPad browser). Returns the link.
  async function add(name, url, openIn = "auto") {
    const existing = findByUrl(url);
    if (existing) return existing;
    const link = { id: newId(), name: name.slice(0, 80), url, openIn };
    links.push(link);
    render();
    await persist();
    return link;
  }

  // ===========================================================================
  // Link editor dialog
  // ===========================================================================
  function dialogMessage(text, kind = "warn") {
    const box = $("link-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  function openDialog(link, isNew) {
    editing = { link, isNew };
    dialogMessage(null);
    $("link-dialog-title").textContent = isNew ? "Save link" : "Edit link";
    $("ln-name").value = link.name || "";
    $("ln-url").value = link.url || "";
    $("ln-open").value = link.openIn || "auto";
    $("ln-delete").hidden = isNew;
    $("ln-left").hidden = isNew;
    $("ln-right").hidden = isNew;
    $("link-dialog").showModal();
  }

  // A sensible name for an address: the SoundPad's name, or the site name.
  function guessName(url) {
    const pad = soundpads?.find((p) => sameUrl(p.url, url));
    if (pad) return pad.name;
    if (/tabletopaudio\.com\/custom_sp/i.test(url)) return "My Custom SoundPad";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function saveCurrent() {
    const url = EmbedPanel.normalise($("embed-url").value);
    if (!url) {
      $("embed-url").focus();
      return;
    }
    const existing = findByUrl(url);
    if (existing) return openDialog(existing, false);
    openDialog({ id: newId(), name: guessName(url), url, openIn: "auto" }, true);
  }

  async function saveDialog(e) {
    e.preventDefault();
    const name = $("ln-name").value.trim();
    const url = EmbedPanel.normalise($("ln-url").value);
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      return dialogMessage("Please enter a full web address, like https://tabletopaudio.com/…", "error");
    }
    if (!name) return dialogMessage("Give the link a name.", "error");
    const other = findByUrl(url);
    if (other && other.id !== editing.link.id) return dialogMessage(`You already saved this address as "${other.name}".`, "error");

    const link = { ...editing.link, name, url, openIn: $("ln-open").value };
    if (editing.isNew) links.push(link);
    else links[links.findIndex((l) => l.id === link.id)] = link;
    $("link-dialog").close();
    render();
    await persist();
  }

  async function deleteLink() {
    if (!confirm(`Delete the link "${editing.link.name}"?`)) return;
    links = links.filter((l) => l.id !== editing.link.id);
    $("link-dialog").close();
    render();
    await persist();
  }

  async function move(delta) {
    const i = links.findIndex((l) => l.id === editing.link.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= links.length) return;
    [links[i], links[j]] = [links[j], links[i]];
    render();
    await persist();
  }

  // ===========================================================================
  // SoundPad browser
  // ===========================================================================
  function soundpadMessage(text, kind = "warn", withLink = false) {
    const box = $("soundpad-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
    if (withLink) {
      const b = document.createElement("button");
      b.className = "small";
      b.textContent = "↗ Open the SoundPad page on Tabletop Audio";
      b.onclick = () => open("https://tabletopaudio.com/soundpad.html", "tab");
      box.append(document.createElement("br"), b);
    }
  }

  async function loadSoundpads(refresh) {
    soundpadMessage("Loading the SoundPad list…");
    try {
      const data = await (await fetch("/api/links/soundpads" + (refresh ? "?refresh=1" : ""))).json();
      soundpads = data.soundpads || [];
      if (!soundpads.length) soundpadMessage(`${data.error || "No SoundPads found"}.`, "error", true);
      else if (data.stale) soundpadMessage(`Showing the list from ${new Date(data.fetchedAt).toLocaleDateString()} (${data.error}).`, "warn");
      else soundpadMessage(null);
    } catch {
      soundpads = [];
      soundpadMessage("Couldn't reach the helper.", "error", true);
    }
    renderSoundpads();
  }

  function renderSoundpads() {
    const cats = ["all", ...new Set(soundpads.flatMap((p) => p.categories))];
    if (!cats.includes(category)) category = "all";
    const catBox = $("soundpad-cats");
    catBox.innerHTML = "";
    if (soundpads.length) {
      for (const c of cats) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "small" + (c === category ? " on" : "");
        b.textContent = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);
        b.onclick = () => {
          category = c;
          Store.set("links.soundpadCategory", c);
          renderSoundpads();
        };
        catBox.appendChild(b);
      }
    }

    const words = $("soundpad-filter").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = soundpads.filter((p) =>
      (category === "all" || p.categories.includes(category)) &&
      words.every((w) => `${p.name} ${p.description} ${p.categories.join(" ")}`.toLowerCase().includes(w)));

    const grid = $("soundpad-grid");
    grid.innerHTML = "";
    if (soundpads.length && !shown.length) grid.innerHTML = '<span class="hint">No SoundPads match.</span>';
    for (const p of shown) {
      const card = document.createElement("div");
      card.className = "soundpad-card";
      card.title = p.description;

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      if (p.image) img.src = p.image;

      const name = document.createElement("div");
      name.className = "soundpad-name";
      name.textContent = p.name;
      if (p.isNew) {
        const badge = document.createElement("span");
        badge.className = "soundpad-new";
        badge.textContent = "new";
        name.append(" ", badge);
      }

      const info = document.createElement("div");
      info.className = "soundpad-info";
      info.textContent = p.sounds ? `${p.sounds} sounds` : "";

      const actions = document.createElement("div");
      actions.className = "soundpad-actions";
      const go = document.createElement("button");
      go.type = "button";
      go.className = "small primary";
      const inPanel = whereFor(p.url) === "panel"; // only with the experimental pass-through
      go.textContent = inPanel ? "▶ Open" : "↗ Open";
      go.title = inPanel ? "Open in the Website panel" : "Open in a new Kenku tab";
      go.onclick = () => open(p.url);
      const saved = !!findByUrl(p.url);
      const star = document.createElement("button");
      star.type = "button";
      star.className = "small" + (saved ? " on" : "");
      star.textContent = saved ? "★ Saved" : "☆ Save";
      star.title = saved ? "It's in your links (edit or delete it with ✎ Edit links)" : "Add to your links, so scenes can use it";
      star.disabled = saved;
      star.onclick = () => add(p.name, p.url);
      actions.append(go, star);

      card.append(img, name, info, actions);
      grid.appendChild(card);
    }
  }

  function toggleBrowser(force) {
    const box = $("soundpad-browser");
    box.hidden = force !== undefined ? !force : !box.hidden;
    $("soundpad-toggle").classList.toggle("on", !box.hidden);
    Store.set("links.browserOpen", !box.hidden);
    if (!box.hidden && !soundpads) loadSoundpads();
  }

  // ===========================================================================
  function init() {
    $("link-save-current").addEventListener("click", saveCurrent);
    $("link-edit-mode").addEventListener("click", () => {
      editMode = !editMode;
      render();
    });
    $("link-form").addEventListener("submit", saveDialog);
    $("ln-cancel").addEventListener("click", () => $("link-dialog").close());
    $("ln-delete").addEventListener("click", deleteLink);
    $("ln-left").addEventListener("click", () => move(-1));
    $("ln-right").addEventListener("click", () => move(1));

    $("soundpad-toggle").addEventListener("click", () => toggleBrowser());
    $("soundpad-close").addEventListener("click", () => toggleBrowser(false));
    $("soundpad-filter").addEventListener("input", () => soundpads && renderSoundpads());
    // Loading something by hand changes which link is highlighted
    $("embed-form").addEventListener("submit", () => setTimeout(render, 0));

    window.addEventListener("embed-mode-changed", () => {
      render();
      if (soundpads) renderSoundpads();
    });

    if (Store.get("links.browserOpen", false)) toggleBrowser(true);
    else loadSoundpads(); // quietly, so the scene editor can offer SoundPads (the helper caches it for a day)
    load();
  }

  return {
    init,
    open,
    openForScene,
    list: () => links,
    soundpads: () => soundpads || [],
  };
})();
