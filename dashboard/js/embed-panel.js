// embed-panel.js – Panel C: show any website in an iframe.
//
// Problem: when a site forbids being framed, the browser just shows a blank or
// "refused to connect" box, and our page is NOT allowed to find out why.
// Solution: before loading, ask our helper (/api/frame-check) to fetch the site
// and read its X-Frame-Options / Content-Security-Policy headers. If framing is
// blocked we show a clear message and an "open in new tab" button instead.
// (In Kenku's browser a new tab is a new Kenku tab, so its audio still reaches Discord.)

const EmbedPanel = (() => {
  const $ = (id) => document.getElementById(id);

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

  function openNewTab(url) {
    if (url) window.open(url, "_blank");
  }

  async function load(url) {
    url = normalise(url);
    if (!url) return;
    $("embed-url").value = url;
    Store.set("embed.url", url);

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

    if (check.allowed === false) {
      frame.src = "about:blank";
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
    document.querySelectorAll(".presets [data-url]").forEach((b) => {
      b.addEventListener("click", () => load(b.dataset.url));
    });

    const saved = Store.get("embed.url", "");
    if (saved) load(saved);
  }

  return { init };
})();
