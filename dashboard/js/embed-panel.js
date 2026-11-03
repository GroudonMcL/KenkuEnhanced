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
// EXPERIMENTAL: when "Show Tabletop Audio inside the Website panel" is ticked in
// Settings, tabletopaudio.com addresses are loaded through the helper's
// pass-through (helper/tta-proxy.js, on the dashboard's port + 1) instead.

const EmbedPanel = (() => {
  const $ = (id) => document.getElementById(id);
  const instances = [];     // live Website tiles
  let lastUsed = null;      // the Website tile used most recently

  // host → true for sites that don't allow embedding. Tabletop Audio is known.
  const blocked = Store.get("embed.blockedHosts", { "tabletopaudio.com": true });
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  // Pass-through for Tabletop Audio: null when off, else its port.
  let ttaPort = null;
  const isTta = (url) => /(^|\.)tabletopaudio\.com$/.test(hostOf(url)) && !hostOf(url).startsWith("sounds.");
  function viaPassThrough(url) {
    if (!ttaPort || !isTta(url)) return null;
    const u = new URL(url);
    return `${location.protocol}//${location.hostname}:${ttaPort}${u.pathname}${u.search}${u.hash}`;
  }
  function setTtaPassThrough(settings) {
    const port = settings?.experimental?.ttaProxy ? settings.experimental.ttaProxyPort : null;
    if (port === ttaPort) return;
    ttaPort = port;
    window.dispatchEvent(new Event("embed-mode-changed")); // links.js re-draws its ↗ marks
    for (const inst of instances) if (isTta(inst.url())) inst.load(inst.url()); // switch open pages over
  }

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

    async function load(url) {
      url = normalise(url);
      if (!url) return;
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
        wrap.hidden = false;
        message(null);
        tile.setStatus("🧪 pass-through", "muted");
        frame.src = passUrl;
        return;
      }
      tile.setStatus("");

      if (check.allowed !== null && check.allowed !== undefined) rememberBlocked(url, check.allowed === false);

      if (check.allowed === false) {
        frame.src = "about:blank";
        wrap.hidden = true;
        // A "launcher": the tile stays in place and opens the site in a Kenku tab.
        const box = q(".web-message");
        box.hidden = false;
        box.className = "web-launch";
        box.innerHTML = "";
        const h = document.createElement("b");
        h.textContent = `${hostOf(url)} doesn't allow being shown inside other pages.`;
        const p = document.createElement("small");
        p.textContent = "It opens in its own Kenku tab instead; its sound still reaches Discord.";
        const b = document.createElement("button");
        b.className = "primary";
        b.textContent = "↗ Open in a Kenku tab";
        b.onclick = () => openNewTab(url);
        box.append(h, p, b);
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
    tile.addAction("🔗", "Change the address", () => showAddress(q(".web-bar").hidden));
    tile.addAction("☆", "Save this address as a link", () => Links.saveUrl(shownUrl));
    tile.addAction("↗", "Open in a new Kenku tab", () => openNewTab(shownUrl));

    const inst = {
      load,
      url: () => shownUrl,
      rename: () => shownUrl && tile.setTitle(nameFor(shownUrl, pageTitle)),
      tile,
      save: () => ({ url: shownUrl }),
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
    Board.register("website", { badge: "Website", badgeClass: "w", size: { w: 5, h: 18, minW: 2, minH: 6 } /* 20px rows */, create: createWebsite });
    window.addEventListener("settings-saved", (e) => setTtaPassThrough(e.detail));
    // SoundPad / track lists or saved links arrived or changed → better tile names
    window.addEventListener("link-names-changed", () => instances.forEach((i) => i.rename()));
    // Find out whether the pass-through is on before tiles load their pages.
    ready = fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => (ttaPort = s.experimental?.ttaProxy ? s.experimental.ttaProxyPort : null))
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
    passThroughOn: () => !!ttaPort,
  };
})();
