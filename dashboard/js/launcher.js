// launcher.js – the small KenkuEnhanced window (launcher.html).
//
// Opened by helper/launch.js when you start KenkuEnhanced. It:
//   • shows the version and checks GitHub for a newer one (/api/version);
//   • installs an update with one click (/api/update/*, the same one-click update
//     as the dashboard's badge), then reloads itself when the new version answers;
//   • opens Kenku FM (/api/launcher/open-kenku) – by itself once KenkuEnhanced is
//     known to be up to date (switch that off in ⚙);
//   • shows "Restart KenkuEnhanced" when a setting needs a restart, and "Stop helper".

(() => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  let status = null;   // last /api/launcher/status
  let info = null;     // last /api/version
  let working = false; // updating / restarting / stopping: the helper going away is expected
  let autoDone = !params.has("auto");

  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `The helper answered ${r.status}`);
    return data;
  };

  function message(text, kind = "error") {
    $("message").hidden = !text;
    $("message").className = `message ${kind === "info" ? "info" : ""}`;
    $("message").textContent = text || "";
  }
  function setDot(id, kind) {
    $(id).className = `dot ${kind || ""}`;
  }
  function progress(percent) {
    const p = $("update-progress");
    p.hidden = percent === null;
    p.classList.toggle("indeterminate", percent === "busy");
    p.firstElementChild.style.width = typeof percent === "number" ? `${percent}%` : "";
  }

  // ---------------------------------------------------------------------------
  // Status: version, Kenku, helper
  // ---------------------------------------------------------------------------
  function renderStatus() {
    const s = status;
    $("version").textContent = `Version ${s.version}`;
    $("restart").hidden = !s.restartNeeded || working;
    $("helper-state").textContent = s.mode === "window" ? "Helper running in the background" : "Helper running in its own window";
    $("stop-with-row").hidden = s.mode !== "window";

    const k = s.kenku;
    if (k.running) {
      setDot("kenku-dot", "ok");
      $("kenku-title").textContent = "Kenku FM is open";
      $("kenku-sub").textContent = `Dashboard: open a Kenku tab at ${s.dashboard}`;
      $("open-kenku").textContent = "Show Kenku";
    } else if (!k.found) {
      setDot("kenku-dot", "warn");
      $("kenku-title").textContent = "Kenku FM not found";
      $("kenku-sub").textContent = k.path ? `It isn't at ${k.path}. Click ⚙ to choose where it is.` : "Click ⚙ to choose where kenku-fm.exe is.";
      $("open-kenku").textContent = "Open Kenku";
    } else {
      setDot("kenku-dot", "");
      $("kenku-title").textContent = "Kenku FM is closed";
      $("kenku-sub").textContent = "";
      $("open-kenku").textContent = "Open Kenku";
    }
  }

  async function refreshStatus() {
    try {
      status = await api("/api/launcher/status");
      renderStatus();
      return true;
    } catch {
      if (!working) helperGone();
      return false;
    }
  }

  function helperGone() {
    setDot("kenku-dot", "bad");
    setDot("update-dot", "bad");
    $("helper-state").textContent = "Helper stopped";
    message("KenkuEnhanced's helper has stopped, so the dashboard doesn't work now. Start KenkuEnhanced again from the Start menu.");
    document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  }

  // ---------------------------------------------------------------------------
  // Updates
  // ---------------------------------------------------------------------------
  async function checkUpdates() {
    setDot("update-dot", "busy");
    $("update-title").textContent = "Checking for updates…";
    $("update-sub").textContent = "";
    try {
      info = await api("/api/version?refresh=1");
    } catch {
      info = null;
    }
    const updated = params.get("updated");
    $("update-now").hidden = true;
    $("update-github").hidden = true;
    $("update-notes").hidden = true;
    if (!info?.latest) {
      setDot("update-dot", "warn");
      $("update-title").textContent = "Couldn't check for updates";
      $("update-sub").textContent = "You may be offline, or GitHub didn't answer. You can still use everything.";
    } else if (info.updateAvailable) {
      setDot("update-dot", "warn");
      $("update-title").textContent = `Version ${info.latest} is available`;
      $("update-sub").textContent = info.canSelfUpdate ? `You have ${info.current}. Updating takes about a minute and keeps your scenes and settings.` : info.why || "";
      $("update-now").hidden = !info.canSelfUpdate;
      $("update-github").hidden = info.canSelfUpdate;
      $("update-github").href = info.url || "https://github.com/GroudonMcL/KenkuEnhanced/releases";
      const notes = (info.notes || "").replace(/^#+\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/\r/g, "").trim();
      if (notes) {
        $("update-notes").hidden = false;
        $("update-notes").querySelector("pre").textContent = notes;
      }
    } else {
      setDot("update-dot", "ok");
      $("update-title").textContent = updated ? `Updated to version ${info.current}` : "KenkuEnhanced is up to date";
      $("update-sub").textContent = updated ? `You had ${updated}. Kenku's dashboard tab reloads by itself.` : `Version ${info.current} is the newest.`;
    }
    maybeAutoOpen();
  }

  // Open Kenku by itself once we know there's nothing to install first
  async function maybeAutoOpen() {
    if (autoDone || !status) return;
    const mustUpdate = info?.updateAvailable && info.canSelfUpdate;
    if (mustUpdate) return; // after the update (or "Open Kenku")
    autoDone = true;
    params.delete("auto");
    history.replaceState(null, "", "launcher.html" + (params.toString() ? "?" + params : ""));
    if (!status.settings.autoOpenKenku || status.kenku.running || !status.kenku.found) return;
    message("Opening Kenku…", "info");
    await openKenku(true);
  }

  async function install() {
    working = true;
    message(null);
    $("update-now").disabled = true;
    $("open-kenku").disabled = true;
    $("restart").hidden = true;
    setDot("update-dot", "busy");
    progress(0);
    try {
      let s = await api("/api/update/install", {});
      while (!["restarting", "error"].includes(s.state)) {
        $("update-title").textContent = s.message || "Updating…";
        $("update-sub").textContent = "";
        progress(s.state === "downloading" ? s.percent : "busy");
        await sleep(600);
        s = await api("/api/update/status");
      }
      if (s.state === "error") throw new Error(s.message);
      $("update-title").textContent = `Installing version ${info.latest}…`;
      $("update-sub").textContent = "KenkuEnhanced restarts by itself. Music in Kenku keeps playing.";
      progress("busy");
      await waitFor((h) => h.version === info.latest, 3 * 60 * 1000);
      location.replace(`launcher.html?auto=1&updated=${encodeURIComponent(info.current)}`);
    } catch (err) {
      working = false;
      progress(null);
      setDot("update-dot", "bad");
      $("update-title").textContent = "The update didn't work";
      $("update-sub").textContent = "";
      message(`${err.message || "The helper stopped answering."} Nothing was changed: you can try again, or download the new version from GitHub. Details are in the update\\update.log file.`);
      $("update-now").disabled = false;
      $("open-kenku").disabled = false;
      $("update-github").hidden = false;
    }
  }

  // Wait for the (new) helper to answer /health in a way that pleases `ok`
  async function waitFor(ok, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await sleep(1200);
      try {
        const h = await (await fetch("/health", { cache: "no-store" })).json();
        if (ok(h)) return;
      } catch { /* restarting */ }
    }
    throw new Error("KenkuEnhanced didn't come back within 3 minutes. Start it again from the Start menu.");
  }

  // ---------------------------------------------------------------------------
  // Kenku, restart, stop
  // ---------------------------------------------------------------------------
  async function openKenku(auto = false) {
    if (!auto) message(null);
    $("open-kenku").disabled = true;
    try {
      await api("/api/launcher/open-kenku", {});
      if (!auto) message(status?.kenku.running ? null : "Opening Kenku…", "info");
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        await refreshStatus();
        if (status?.kenku.running) break;
      }
      if (!status?.kenku.running) message("Kenku didn't seem to open. Check the taskbar, or click ⚙ to check where Kenku is.");
      else message(null);
    } catch (err) {
      message(err.message);
      if (!status?.kenku.found) openSettings();
    } finally {
      $("open-kenku").disabled = working;
    }
  }

  async function restart() {
    working = true;
    message("Restarting KenkuEnhanced…", "info");
    $("restart").disabled = true;
    const before = status?.startedAt;
    try {
      await api("/api/launcher/restart", {});
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        await sleep(1000);
        try {
          const s = await (await fetch("/api/launcher/status", { cache: "no-store" })).json();
          if (s.startedAt !== before) return location.reload();
        } catch { /* restarting */ }
      }
      throw new Error("KenkuEnhanced didn't come back within a minute. Start it again from the Start menu.");
    } catch (err) {
      working = false;
      message(err.message);
      $("restart").disabled = false;
    }
  }

  async function stop() {
    working = true;
    try {
      await api("/api/launcher/stop", {});
    } catch { /* it's going anyway */ }
    helperGone();
    message("Stopped. Start KenkuEnhanced from the Start menu when you need the dashboard again.", "info");
    setTimeout(() => window.close(), 1500); // works in the app window
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function openSettings() {
    if (!status) return;
    $("kenku-path").value = status.settings.kenkuPath || "";
    $("auto-open").checked = !!status.settings.autoOpenKenku;
    $("stop-with").checked = !!status.settings.stopWithKenku;
    $("settings-error").hidden = true;
    $("dashboard-link").textContent = status.dashboard;
    $("dashboard-link").href = status.dashboard;
    $("settings").showModal();
  }
  async function saveSettings(e) {
    e.preventDefault();
    try {
      const r = await api("/api/launcher/settings", {
        kenkuPath: $("kenku-path").value,
        autoOpenKenku: $("auto-open").checked,
        stopWithKenku: $("stop-with").checked,
      });
      $("settings").close();
      await refreshStatus();
      if (!r.found && r.settings.kenkuPath) message(`There's no file at ${r.settings.kenkuPath}. Check the path.`);
      else message(null);
    } catch (err) {
      $("settings-error").hidden = false;
      $("settings-error").textContent = err.message;
    }
  }

  // ---------------------------------------------------------------------------
  $("update-now").addEventListener("click", install);
  $("open-kenku").addEventListener("click", () => openKenku(false));
  $("restart").addEventListener("click", restart);
  $("stop").addEventListener("click", stop);
  $("open-settings").addEventListener("click", openSettings);
  $("settings-form").addEventListener("submit", saveSettings);
  $("settings-cancel").addEventListener("click", () => $("settings").close());

  (async () => {
    if (!(await refreshStatus())) return;
    await checkUpdates();
    setInterval(() => working || refreshStatus(), 4000);
    setInterval(() => working || checkUpdates(), 6 * 60 * 60 * 1000);
  })();
})();
