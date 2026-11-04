// update.js – the "Update available" badge and the one-click update window.
//
// The helper checks GitHub Releases (/api/version). If there's a newer version,
// the badge appears; clicking it shows what's new and an "Update now" button.
// Updating: the helper downloads and checks the new version, swaps the files,
// and restarts (helper/update.js + helper/updater.js). Meanwhile this page waits
// for the helper to come back with the new version, then reloads itself.

const Update = (() => {
  const $ = (id) => document.getElementById(id);
  let info = null; // last answer from /api/version
  let reloadFor = null; // the helper was updated (e.g. from the KenkuEnhanced window): this page is old

  function message(text, kind = "warn") {
    const box = $("upd-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  function progress(percent) {
    $("upd-progress").hidden = percent === null;
    $("upd-progress-fill").style.width = `${percent || 0}%`;
  }

  async function check() {
    try {
      info = await (await fetch("/api/version")).json();
    } catch {
      return; // offline – ignore
    }
    const badge = $("update-badge");
    badge.hidden = !info.updateAvailable;
    if (info.updateAvailable) {
      badge.textContent = `Update available: v${info.latest}`;
      badge.title = `You have v${info.current}. Click to see what's new.`;
    }
  }

  function open() {
    if (reloadFor) return location.reload();
    if (!info) return;
    $("upd-title").textContent = `Version ${info.latest} is available`;
    $("upd-intro").textContent = `You have version ${info.current}.`;
    // Release notes are Markdown; drop the symbols that would look odd as plain text.
    const notes = (info.notes || "").replace(/^#+\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/\r/g, "").trim();
    $("upd-notes").textContent = notes || "No release notes.";
    $("upd-github").href = info.url || "#";
    $("upd-install").hidden = !info.canSelfUpdate;
    $("upd-install").disabled = false;
    $("upd-later").disabled = false;
    progress(null);
    if (info.canSelfUpdate) {
      message("Updating takes about a minute. Your settings, scenes, links and downloaded sounds are kept. Music already playing in Kenku carries on.", "ok");
    } else {
      message(`${info.why || "This copy can't update itself."} See "Updating" in the README.`, "warn");
    }
    $("update-dialog").showModal();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function install() {
    $("upd-install").disabled = true;
    $("upd-later").disabled = true;
    progress(0);
    try {
      let s = await (await fetch("/api/update/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
      // Follow the download until the helper says it's restarting (or failed)
      while (!["restarting", "error"].includes(s.state)) {
        message(s.message || "Working…", "warn");
        progress(s.percent);
        await sleep(700);
        s = await (await fetch("/api/update/status")).json();
      }
      if (s.state === "error") throw new Error(s.message);
      message(s.message, "warn");
      progress(100);
      await waitForNewVersion();
    } catch (err) {
      progress(null);
      message(`The update didn't work: ${err.message || "the helper stopped answering"}. Nothing was changed. You can try again, or download the new version from GitHub.`, "error");
      $("upd-install").disabled = false;
      $("upd-later").disabled = false;
    }
  }

  // The helper closes, the files are swapped, a new helper starts. Wait for it.
  async function waitForNewVersion() {
    const until = Date.now() + 3 * 60 * 1000;
    while (Date.now() < until) {
      await sleep(1500);
      try {
        const h = await (await fetch("/health", { cache: "no-store" })).json();
        if (h.version === info.latest) {
          message(`✓ Updated to version ${info.latest}. Reloading…`, "ok");
          await sleep(1000);
          location.reload();
          return;
        }
      } catch { /* helper is restarting */ }
    }
    throw new Error("the helper didn't come back within 3 minutes. Check the KenkuEnhanced window, or start it again; details are in update/update.log");
  }

  function init() {
    $("update-badge").addEventListener("click", open);
    $("upd-later").addEventListener("click", () => $("update-dialog").close());
    $("upd-install").addEventListener("click", install);
    // While updating, don't let Esc close the window (the page reloads at the end anyway)
    $("update-dialog").addEventListener("cancel", (e) => {
      if ($("upd-later").disabled) e.preventDefault();
    });
    check();
  }

  // The helper now runs a newer version than this page was loaded from. Reload now
  // if that interrupts nothing (no YouTube or website tile playing), otherwise
  // ask with the badge. (Your scenes are saved on the helper, so nothing is lost.)
  function helperVersion(v, quietNow) {
    if (reloadFor === v) return;
    reloadFor = v;
    if (quietNow) return location.reload();
    const badge = $("update-badge");
    badge.hidden = false;
    badge.textContent = `Updated to v${v}: click to reload`;
    badge.title = "KenkuEnhanced was updated. Reload this tab to use the new version (what's playing in this tab stops for a moment).";
  }

  return { init, check, helperVersion };
})();
