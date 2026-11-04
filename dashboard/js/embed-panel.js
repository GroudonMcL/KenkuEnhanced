// embed-panel.js – Website tiles: show a website inside the dashboard.
//
// Problem: when a site forbids being framed, the browser just shows a blank or
// "refused to connect" box, and our page is NOT allowed to find out why.
// Solution: before loading, ask our helper (/api/frame-check) to fetch the site
// and read its X-Frame-Options / Content-Security-Policy headers. If framing is
// blocked the tile shows a clear message and an "open in a new tab" button instead.
// (In Kenku's browser a new tab is a new Kenku tab, so its audio still reaches Discord.)
// The same check gives us the page's title, which becomes the tile's name.
//
// We also remember which sites refused, so saved links / scenes can go straight
// to a new tab. Saved links themselves live in links.js.
//
// EXPERIMENTAL: sites ticked in ⚙ Settings → Experimental (Tabletop Audio, myNoise,
// Rainy Mood, Ambient-Mixer) are loaded through the helper's pass-through instead
// (helper/pass-through.js, one port per site).
//
// Volume: pages that come through the pass-through carry a small volume script
// (helper/pass-volume.js). They answer { kenku: "volume-ready" } and then this
// tile can set their volume – for fades, the Mixer and Duck. Other sites are
// shown straight from the internet, and the dashboard can't reach their sound.

const EmbedPanel = (() => {
  const $ = (id) => document.getElementById(id);
  const instances = [];     // live Website tiles
  let lastUsed = null;      // the Website tile used most recently

  // host → true for sites that don't allow embedding. Tabletop Audio is known.
  const blocked = Store.get("embed.blockedHosts", { "tabletopaudio.com": true });
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  // EXPERIMENTAL pass-through (helper/pass-through.js): sites that refuse to be
  // embedded, shown through the helper – one port per site. From /api/settings:
  // [{ id, name, port, hosts: ["mynoise.net", …], enabled, mobile }]
  let passSites = [];
  function passSiteFor(url) {
    let host = "";
    try { host = new URL(url).host.toLowerCase(); } catch { return null; }
    return passSites.find((s) => s.enabled && s.hosts.includes(host)) || null;
  }
  function viaPassThrough(url) {
    const site = passSiteFor(url);
    if (!site) return null;
    const u = new URL(url);
    return `${location.protocol}//${location.hostname}:${site.port}${u.pathname}${u.search}${u.hash}`;
  }
  function readPassSites(settings) {
    const e = settings?.experimental || {};
    return (e.sites || []).map((s) => ({ ...s, enabled: !!e.passThrough?.[s.id], mobile: !!e.mobile?.[s.id] }));
  }
  function setPassThrough(settings) {
    const next = readPassSites(settings);
    const sig = (list) => JSON.stringify(list.map((s) => [s.id, s.enabled, s.mobile]));
    if (sig(next) === sig(passSites)) return;
    const before = new Map(passSites.map((s) => [s.id, sig([s])]));
    passSites = next;
    window.dispatchEvent(new Event("embed-mode-changed")); // links.js re-draws its ↗ marks
    // Reload pages whose site was switched on/off (or to/from the mobile version).
    for (const inst of instances) {
      let host = "";
      try { host = new URL(inst.url()).host.toLowerCase(); } catch { continue; }
      const site = next.find((s) => s.hosts.includes(host));
      if (site && before.get(site.id) !== sig([site])) inst.load(inst.url());
    }
  }
  // Pass-through pages can't break out of their tile ("frame busting") or open
  // pop-ups over the dashboard, but scripts, sound and their own storage work.
  const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation";

  function isBlocked(url) {
    if (viaPassThrough(url)) return false;
    const host = hostOf(url);
    return Object.keys(blocked).some((h) => host === h || host.endsWith("." + h));
  }
  function rememberBlocked(url, isBlockedNow) {
    const host = hostOf(url);
    if (!host) return;
    if (isBlockedNow) blocked[host] = true;
    else delete blocked[host];
    Store.set("embed.blockedHosts", blocked);
  }

  function normalise(text) {
    text = (text || "").trim();
    if (!text) return "";
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    return text;
  }

  // In Kenku every window.open becomes a new Kenku tab (it ignores tab names,
  // so we can't reuse a tab).
  function openNewTab(url) {
    if (url) window.open(url, "_blank");
  }

  // A good name for a page: the SoundPad's or saved link's name, else the page title.
  function nameFor(url, pageTitle) {
    return Links.nameFor(url) || shortTitle(pageTitle, hostOf(url)) || hostOf(url) || "Website";
  }

  // "Custom Soundscapes for Focus | myNoise ®" → "myNoise ®": page titles often
  // have parts; prefer the part that names the site, else the first part.
  function shortTitle(title, host) {
    if (!title) return "";
    const parts = title.split(/\s+[|–—·•-]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return title;
    const site = host.split(".").slice(-2, -1)[0] || "";
    const squash = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    return parts.find((p) => site && squash(p).includes(squash(site))) || parts[0];
  }

  // ===========================================================================
  // One Website tile
  // ===========================================================================
  function createWebsite(tile, config) {
    const el = $("web-tile-template").content.firstElementChild.cloneNode(true);
    tile.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    const frame = q("iframe");
    let currentUrl = "";
    let shownUrl = config.url || "";
    let pageTitle = "";
    let savedVolume = config.volume ?? 100; // kept with the scene (0-100)
    let level = savedVolume;                // right now (fades move this)
    let controllable = false;               // the page answered our volume script
    let passStatus = "";

    function message(text, kind) {
      const box = q(".web-message");
      box.hidden = !text;
      box.className = `notice notice-${kind || "warn"} web-message`; // (also undoes the launcher look)
      box.textContent = text || "";
      return box;
    }
    function showAddress(on) {
      q(".web-bar").hidden = !on;
      if (on) q(".web-url").focus();
    }

    // A "launcher": the tile keeps its place but opens the site in a Kenku tab.
    function showLauncher(url, headline, text) {
      frame.src = "about:blank";
      q(".web-frame").hidden = true;
      const box = q(".web-message");
      box.hidden = false;
      box.className = "web-launch";
      box.innerHTML = "";
      const h = document.createElement("b");
      h.textContent = headline;
      const p = document.createElement("small");
      p.textContent = text;
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = "↗ Open in a Kenku tab";
      b.onclick = () => openNewTab(url);
      box.append(h, p, b);
    }

    // ---- Volume (pass-through pages only) ----
    const output = () => {
      if (!controllable) return;
      try { frame.contentWindow.postMessage({ kenku: "volume", value: (level / 100) * Mixer.factor() }, "*"); } catch { /* gone */ }
    };
    function setStatus(text) {
      if (text !== undefined) passStatus = text;
      tile.setStatus(controllable && level === 0 ? "🔇 silent" : passStatus, "muted");
    }
    function showFade() {
      fadeBtn.hidden = !controllable;
      const out = level > 0 && inst.fadeDir !== "out";
      Icons.set(fadeBtn, out ? "fadeout" : "fadein");
      fadeBtn.title = out ? "Fade this page out" : "Fade this page in";
      fadeBtn.classList.toggle("on", !!inst.fadeDir);
    }
    function setControllable(on) {
      if (controllable === on) return;
      controllable = on;
      output();
      showFade();
      setStatus();
      window.dispatchEvent(new Event("mixer-changed"));
    }
    // A new page in the frame: it has to say hello again.
    frame.addEventListener("load", () => {
      setControllable(false);
      try { frame.contentWindow.postMessage({ kenku: "volume-hello" }, "*"); } catch { /* ignore */ }
    });

    async function load(url) {
      url = normalise(url);
      if (!url) return;
      setControllable(false);
      lastUsed = inst;
      q(".web-url").value = url;
      shownUrl = url;
      currentUrl = url;
      tile.changed();
      tile.setTitle(nameFor(url));
      showAddress(false);
      const wrap = q(".web-frame");

      // Ask the helper about the page (framing rules + title).
      const checking = setTimeout(() => message("Checking whether this site allows embedding…", "warn"), 400);
      let check = { allowed: null };
      try {
        check = await (await fetch("/api/frame-check?url=" + encodeURIComponent(url))).json();
      } catch {
        /* helper unreachable – just try loading it */
      }
      clearTimeout(checking);
      if (url !== currentUrl) return; // something else was loaded meanwhile
      pageTitle = check.title || "";
      tile.setTitle(nameFor(url, pageTitle));

      const passUrl = viaPassThrough(url);
      if (passUrl) {
        // Does the site answer the helper? (Bot protection sometimes says no.)
        let pc = { ok: true };
        try {
          pc = await (await fetch("/api/pass-check?url=" + encodeURIComponent(url))).json();
        } catch {
          /* helper unreachable – try anyway */
        }
        if (url !== currentUrl) return;
        if (!pc.ok) {
          setStatus("");
          showLauncher(url, `${hostOf(url)} can't be shown here right now.`,
            `${pc.reason || "The pass-through didn't work."} It opens in its own Kenku tab instead; its sound still reaches Discord.`);
          return;
        }
        wrap.hidden = false;
        message(null);
        const site = passSiteFor(url);
        setStatus(site?.mobile ? "🧪 pass-through · 📱" : "🧪 pass-through");
        frame.setAttribute("sandbox", SANDBOX);
        frame.src = passUrl;
        return;
      }
      setStatus("");
      frame.removeAttribute("sandbox");

      if (check.allowed !== null && check.allowed !== undefined) rememberBlocked(url, check.allowed === false);

      if (check.allowed === false) {
        showLauncher(url, `${hostOf(url)} doesn't allow being shown inside other pages.`,
          passSites.some((x) => x.hosts.includes(new URL(url).host.toLowerCase()))
            ? "It opens in its own Kenku tab instead (its sound still reaches Discord) – or switch on its pass-through in ⚙ Settings → Experimental."
            : "It opens in its own Kenku tab instead; its sound still reaches Discord.");
        return;
      }

      wrap.hidden = false;
      message(
        check.allowed === null
          ? `Couldn't check this site (${check.reason || "unknown"}). Trying anyway – if it stays blank, use ↗.`
          : null,
        "warn"
      );
      frame.src = url;
    }

    q(".web-form").addEventListener("submit", (e) => {
      e.preventDefault();
      load(q(".web-url").value);
    });
    tile.addAction("link", "Change the address", () => showAddress(q(".web-bar").hidden));
    tile.addAction("☆", "Save this address as a link", () => Links.saveUrl(shownUrl));
    tile.addAction("↗", "Open in a new Kenku tab", () => openNewTab(shownUrl));
    const fadeBtn = tile.addAction("fadeout", "Fade this page out", () => inst.fadeToggle());
    fadeBtn.hidden = true;

    // Zoom: show the page smaller so more of it fits in the tile (works for any site).
    // New tiles start at 55%.
    const ZOOMS = [1, 0.85, 0.7, 0.55];
    const DEFAULT_ZOOM = 0.55;
    let zoom = ZOOMS.includes(config.zoom) ? config.zoom : DEFAULT_ZOOM;
    const zoomBtn = tile.addAction("", "", () => {
      zoom = ZOOMS[(ZOOMS.indexOf(zoom) + 1) % ZOOMS.length];
      applyZoom();
      tile.changed();
    });
    function applyZoom() {
      frame.style.setProperty("--zoom", zoom);
      frame.classList.toggle("zoomed", zoom !== 1);
      Icons.set(zoomBtn, "zoom", zoom === 1 ? "" : `${Math.round(zoom * 100)}%`);
      zoomBtn.title = `Zoom: ${Math.round(zoom * 100)}% – click to show the page smaller (more of it fits)`;
    }
    applyZoom();

    const inst = {
      load,
      url: () => shownUrl,
      rename: () => shownUrl && tile.setTitle(nameFor(shownUrl, pageTitle)),
      tile,
      save: () => ({ url: shownUrl, zoom, ...(savedVolume !== 100 ? { volume: savedVolume } : {}) }),
      // A scene switch kept this page: take the scene's volume (scenes.js fades to it).
      apply: (c) => {
        savedVolume = c.volume ?? 100;
        inst.fadeDir = null;
      },
      frameWindow: () => frame.contentWindow,
      onVolumeReady: () => setControllable(true),
      canFade: () => controllable,
      currentVolume: () => level,
      savedVolume: () => savedVolume,
      setVolume: (v, persist = true) => {
        level = Math.max(0, Math.min(100, Math.round(v)));
        output();
        if (persist) {
          savedVolume = level;
          tile.changed();
        }
        setStatus();
        showFade();
      },
      applyOutput: output,
      fadeDir: null,
      // Fade out (it stays silent), or back in to its volume. Again while fading = turn around.
      fadeToggle: async () => {
        if (!controllable) return;
        const out = level > 0 && inst.fadeDir !== "out";
        inst.fadeDir = out ? "out" : "in";
        showFade();
        if (await Mixer.fade(inst, out ? 0 : savedVolume || 100)) inst.fadeDir = null;
        showFade();
        window.dispatchEvent(new Event("mixer-changed"));
      },
      destroy: () => {
        frame.src = "about:blank";
        instances.splice(instances.indexOf(inst), 1);
        if (lastUsed === inst) lastUsed = null;
      },
    };
    instances.push(inst);

    if (shownUrl) {
      // Wait until we know whether the pass-through is on.
      ready.then(() => load(shownUrl));
    } else {
      tile.setTitle("Website");
      showAddress(true);
    }
    return inst;
  }

  // ===========================================================================
  // Used by saved links, scenes and Vibe
  // ===========================================================================
  // Show `url` in a Website tile. newTile=true always adds one; otherwise we
  // reuse a tile already showing it, or the last used Website tile.
  function load(url, { newTile = false } = {}) {
    url = normalise(url);
    if (!url) return Promise.resolve();
    const same = instances.find((i) => i.url().replace(/\/$/, "") === url.replace(/\/$/, ""));
    if (same && !newTile) {
      same.tile.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return Promise.resolve();
    }
    const target = !newTile && (lastUsed || instances[0]);
    if (target) return target.load(url);
    Board.add("website", { url });
    return Promise.resolve();
  }

  let ready;
  function init() {
    Board.register("website", { badge: "Website", badgeClass: "w", icon: "globe",
      keepSize: true, // a scene switch that keeps this page keeps its size too
      // the same page in two scenes = the same tile (keeps playing)
      key: (c) => normalise(c.url || "").replace(/\/$/, ""),
      size: { w: 5, h: 18, minW: 2, minH: 6 }, // 20px rows
      create: createWebsite });
    window.addEventListener("settings-saved", (e) => setPassThrough(e.detail));
    // A pass-through page saying "you can set my volume" (helper/pass-volume.js)
    window.addEventListener("message", (e) => {
      if (e.data?.kenku !== "volume-ready") return;
      instances.find((i) => i.frameWindow() === e.source)?.onVolumeReady();
    });
    // SoundPad / track lists or saved links arrived or changed → better tile names
    window.addEventListener("link-names-changed", () => instances.forEach((i) => i.rename()));
    // Find out whether the pass-through is on before tiles load their pages.
    ready = fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => (passSites = readPassSites(s)))
      .catch(() => {})
      .finally(() => window.dispatchEvent(new Event("embed-mode-changed")));
  }

  return {
    init,
    load,
    openNewTab,
    isBlocked,
    viaPassThrough,
    normalise,
    current: () => (lastUsed || instances[0])?.url() || "",
    urls: () => instances.map((i) => i.url()),
    instances: () => instances,
    passThroughOn: () => passSites.some((s) => s.enabled),
  };
})();
