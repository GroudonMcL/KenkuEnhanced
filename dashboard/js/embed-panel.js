// embed-panel.js – Panel C: show any website in an iframe.
//
// Problem: when a site forbids being framed, the browser just shows a blank or
// "refused to connect" box, and our page is NOT allowed to find out why.
// Solution: before loading, ask our helper (/api/frame-check) to fetch the site
// and read its X-Frame-Options / Content-Security-Policy headers. If framing is
// blocked we show a clear message and an "open in new tab" button instead.
// (In Kenku's browser a new tab is a new Kenku tab, so its audio still reaches Discord.)
//
// We also remember which sites refused, so next time (e.g. from a scene or a saved
// link) they can go straight to a new tab. Saved links themselves live in links.js.

const EmbedPanel = (() => {
  const $ = (id) => document.getElementById(id);
  let currentUrl = "";

  // host → true for sites that don't allow embedding. Tabletop Audio is known.
  const blocked = Store.get("embed.blockedHosts", { "tabletopaudio.com": true });
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  function isBlocked(url) {
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
    text = text.trim();
    if (!text) return "";
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    return text;
  }

  function message(text, kind) {
    const box = $("embed-message");
    box.hidden = !text;
    box.className = `notice notice-${kind || "warn"}`;
    box.textContent = text || "";
    return box;
  }

  // In Kenku every window.open becomes a new Kenku tab (it ignores tab names,
  // so we can't reuse a tab).
  function openNewTab(url) {
    if (url) window.open(url, "_blank");
  }

  async function load(url) {
    url = normalise(url);
    if (!url) return;
    $("embed-url").value = url;
    Store.set("embed.url", url);
    currentUrl = url;

    const frame = $("embed-iframe");
    const wrap = frame.parentElement;
    message("Checking whether this site allows embedding…", "warn");

    let check = { allowed: null };
    try {
      const r = await fetch("/api/frame-check?url=" + encodeURIComponent(url));
      check = await r.json();
    } catch {
      /* helper unreachable – just try loading it */
    }

    if (check.allowed !== null && check.allowed !== undefined) rememberBlocked(url, check.allowed === false);
    if (url !== currentUrl) return; // something else was loaded while we were checking

    if (check.allowed === false) {
      frame.src = "about:blank";
      currentUrl = "";
      wrap.hidden = true;
      const box = message(`🚫 This site can't be shown inside the dashboard. ${check.reason}`, "error");
      const b = document.createElement("button");
      b.className = "mid primary";
      b.textContent = "↗ Open it in a new Kenku tab instead";
      b.onclick = () => openNewTab(url);
      box.append(document.createElement("br"), b);
      return;
    }

    wrap.hidden = false;
    message(
      check.allowed === null
        ? `Couldn't check this site (${check.reason || "unknown"}). Trying to load it anyway – if the box stays blank, use "New tab".`
        : null,
      "warn"
    );
    frame.src = url;
  }

  function init() {
    $("embed-form").addEventListener("submit", (e) => {
      e.preventDefault();
      load($("embed-url").value);
    });
    $("embed-newtab").addEventListener("click", () => openNewTab(normalise($("embed-url").value)));

    const saved = Store.get("embed.url", "");
    if (saved) load(saved);
  }

  return { init, load, openNewTab, isBlocked, normalise, current: () => currentUrl };
})();
