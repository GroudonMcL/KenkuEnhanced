// sounds-panel.js – Panel D: search Freesound, preview, download.
//
// Search and download go through our helper (/api/sounds/*), which holds the
// Freesound API key and writes the files + ATTRIBUTION.csv into your downloads
// folder. Previews play right here in the page with a single <audio> player.
// (In Kenku's browser that means your players hear previews too – there's a
// preview volume slider for that.)

const SoundsPanel = (() => {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  audio.preload = "none";

  let query = "";
  let page = 1;
  let results = [];
  let playingId = null;  // id of the sound being previewed
  let folderInfo = null; // { folder, exists, subfolders }

  function message(text, kind = "warn") {
    const box = $("snd-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  // 75.3 → "1:15"
  function time(sec) {
    const s = Math.round(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  async function search(q, nextPage = 1) {
    q = q.trim();
    if (!q) return;
    query = q;
    Store.set("sounds.query", q);
    message(nextPage === 1 ? "Searching…" : "Loading more…");
    $("snd-more").disabled = true;
    try {
      const params = new URLSearchParams({ q, page: nextPage, length: $("snd-length").value, sort: $("snd-sort").value });
      const r = await fetch("/api/sounds/search?" + params);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Search failed");
      page = nextPage;
      if (page === 1) {
        stopPreview();
        results = [];
        $("snd-results").innerHTML = "";
      }
      results.push(...data.results);
      data.results.forEach((s) => $("snd-results").appendChild(row(s)));
      $("snd-more").hidden = !data.hasMore;
      message(results.length ? `${data.count.toLocaleString()} sounds found.` : "No sounds found. Try fewer or different words.", results.length ? "ok" : "warn");
    } catch (err) {
      message(err.message, "error");
    } finally {
      $("snd-more").disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // One result row
  // ---------------------------------------------------------------------------
  function row(s) {
    const el = document.createElement("div");
    el.className = "snd-result";
    el.dataset.id = s.id;

    // Waveform picture; click it to preview from that point
    const wave = document.createElement("div");
    wave.className = "snd-wave";
    wave.title = "Click to play from here";
    if (s.waveform) wave.style.backgroundImage = `url("${s.waveform}")`;
    const fill = document.createElement("div");
    fill.className = "snd-wave-fill";
    wave.appendChild(fill);
    wave.onclick = (e) => {
      const rect = wave.getBoundingClientRect();
      preview(s, (e.clientX - rect.left) / rect.width);
    };

    const title = document.createElement("div");
    title.className = "snd-title";
    title.textContent = s.title;

    const meta = document.createElement("div");
    meta.className = "snd-meta";
    const lic = document.createElement("span");
    lic.className = "snd-licence" + (s.licence.needsCredit ? "" : " free");
    lic.textContent = s.licence.short;
    lic.title = s.licence.needsCredit
      ? `Credit "${s.author}" if you share or publish this (it's saved in ATTRIBUTION.csv).` +
        (s.licence.nonCommercial ? " Non-commercial use only." : "")
      : "Public domain: use it however you like, no credit needed.";
    meta.append(`${time(s.duration)} · by ${s.author} · `, lic);

    const tags = document.createElement("div");
    tags.className = "snd-tags";
    tags.textContent = s.tags.join(" · ");

    const actions = document.createElement("div");
    actions.className = "snd-actions";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "mid snd-play";
    play.textContent = "▶ Preview";
    play.disabled = !s.preview;
    play.onclick = () => (playingId === s.id && !audio.paused ? stopPreview() : preview(s, 0));

    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "mid primary snd-dl";
    setDownloaded(dl, s.downloaded);
    dl.onclick = () => download(s, dl);

    const link = document.createElement("button");
    link.type = "button";
    link.className = "mid";
    link.textContent = "↗";
    link.title = "Open this sound on Freesound";
    link.onclick = () => window.open(s.url, "_blank");

    actions.append(play, dl, link);
    el.append(wave, title, meta, tags, actions);
    return el;
  }

  function setDownloaded(button, file) {
    button.textContent = file ? "✓ Saved" : "⬇ Download";
    button.classList.toggle("primary", !file);
    button.title = file ? `Already saved as ${file}` : "Save this sound into your downloads folder";
  }

  // ---------------------------------------------------------------------------
  // Preview player
  // ---------------------------------------------------------------------------
  function rowEl(id) {
    return $("snd-results").querySelector(`.snd-result[data-id="${id}"]`);
  }

  function preview(s, fraction) {
    if (!s.preview) return;
    if (playingId !== s.id) {
      stopPreview();
      playingId = s.id;
      audio.src = s.preview;
    }
    const startAt = () => { if (fraction > 0 && audio.duration) audio.currentTime = fraction * audio.duration; };
    if (audio.readyState >= 1) startAt();
    else audio.addEventListener("loadedmetadata", startAt, { once: true });
    audio.play().catch((err) => {
      if (err.name !== "AbortError") message(`Couldn't play the preview (${err.message}).`, "error");
    });
    const el = rowEl(s.id);
    el?.classList.add("playing");
    if (el) el.querySelector(".snd-play").textContent = "⏸ Stop";
  }

  function stopPreview() {
    audio.pause();
    const el = playingId && rowEl(playingId);
    if (el) {
      el.classList.remove("playing");
      el.querySelector(".snd-play").textContent = "▶ Preview";
      el.querySelector(".snd-wave-fill").style.width = "0";
    }
    playingId = null;
  }

  audio.addEventListener("timeupdate", () => {
    const el = playingId && rowEl(playingId);
    if (el && audio.duration) el.querySelector(".snd-wave-fill").style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  });
  audio.addEventListener("ended", stopPreview);
  audio.addEventListener("error", () => {
    if (playingId) message("Couldn't load the preview. Are you online?", "error");
    stopPreview();
  });

  function setPreviewVolume(v) {
    audio.volume = v / 100;
    $("snd-preview-volume").value = v;
    $("snd-preview-volume-value").textContent = v + "%";
  }

  // ---------------------------------------------------------------------------
  // Download + folders
  // ---------------------------------------------------------------------------
  function subfolder() {
    return $("snd-subfolder").value.trim();
  }

  async function download(s, button) {
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const r = await fetch("/api/sounds/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, subfolder: subfolder() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Download failed");
      s.downloaded = data.file;
      setDownloaded(button, data.file);
      if (data.warning) message(data.warning, "warn");
      else if (data.alreadyHad) message(`You already have this one: ${data.file}`, "ok");
      else message(`✓ Saved ${data.file}. Drag it into a Kenku playlist or soundboard to use it.`, "ok");
      loadFolders(); // a new subfolder may exist now
    } catch (err) {
      setDownloaded(button, s.downloaded);
      message(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function loadFolders() {
    try {
      folderInfo = await (await fetch("/api/sounds/folders")).json();
    } catch {
      return;
    }
    const list = $("snd-subfolders");
    list.innerHTML = "";
    for (const name of folderInfo.subfolders) {
      const o = document.createElement("option");
      o.value = name;
      list.appendChild(o);
    }
    updateFolderHint();
  }

  function updateFolderHint() {
    if (!folderInfo) return;
    const sep = folderInfo.folder.includes("\\") ? "\\" : "/";
    const sub = subfolder();
    $("snd-folder-hint").textContent = `Saving to: ${folderInfo.folder}${sub ? sep + sub : ""}` +
      (folderInfo.exists ? "" : " (it will be created)");
  }

  async function openFolder() {
    try {
      const r = await fetch("/api/sounds/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subfolder: subfolder() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      message(`Opened ${data.folder} (look for a new window, it may be behind Kenku).`, "ok");
      loadFolders();
    } catch (err) {
      message(err.message || "Couldn't open the folder.", "error");
    }
  }

  // Other sites without a usable API: open their own search in a new tab.
  function openSite(site) {
    const q = encodeURIComponent($("snd-search").value.trim() || query);
    const urls = {
      bbc: q ? `https://sound-effects.bbcrewind.co.uk/search?q=${q}` : "https://sound-effects.bbcrewind.co.uk/",
      pixabay: q ? `https://pixabay.com/sound-effects/search/${q}/` : "https://pixabay.com/sound-effects/",
    };
    window.open(urls[site], "_blank");
  }

  // ---------------------------------------------------------------------------
  function init() {
    $("snd-length").value = Store.get("sounds.length", "any");
    $("snd-sort").value = Store.get("sounds.sort", "score");
    $("snd-subfolder").value = Store.get("sounds.subfolder", "");
    $("snd-search").value = Store.get("sounds.query", "");
    setPreviewVolume(Store.get("sounds.previewVolume", 60));

    $("snd-search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      search($("snd-search").value, 1);
    });
    // Changing a filter re-runs the current search
    for (const id of ["snd-length", "snd-sort"]) {
      $(id).addEventListener("change", () => {
        Store.set(id === "snd-length" ? "sounds.length" : "sounds.sort", $(id).value);
        if (query) search(query, 1);
      });
    }
    $("snd-more").addEventListener("click", () => search(query, page + 1));
    $("snd-preview-volume").addEventListener("input", (e) => {
      setPreviewVolume(Number(e.target.value));
      Store.set("sounds.previewVolume", Number(e.target.value));
    });
    $("snd-subfolder").addEventListener("input", () => {
      Store.set("sounds.subfolder", subfolder());
      updateFolderHint();
    });
    $("snd-open-folder").addEventListener("click", openFolder);
    document.querySelectorAll("[data-snd-site]").forEach((b) => {
      b.addEventListener("click", () => openSite(b.dataset.sndSite));
    });
    window.addEventListener("settings-saved", loadFolders); // downloads folder may have changed

    loadFolders();
  }

  // Used by ✨ Vibe: show the panel and search for `q`.
  function searchFor(q) {
    Layout.show("sounds");
    $("snd-search").value = q;
    search(q, 1);
    $("panel-sounds").scrollTop = 0;
  }

  return { init, search: searchFor };
})();
