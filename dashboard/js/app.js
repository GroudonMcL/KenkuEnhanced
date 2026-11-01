// app.js – starts everything and runs the top-bar status checks.

(() => {
  const status = document.getElementById("kenku-status");
  let wasOk = null;

  // Ask the helper's /health route every 5 seconds whether Kenku is reachable.
  async function checkHealth() {
    let cls = "status-bad";
    let text = "Helper offline";
    let tip = "The helper server isn't answering. Is the KenkuEnhanced window still open?";
    try {
      const h = await (await fetch("/health")).json();
      if (h.kenku.ok) {
        cls = "status-ok"; text = "Kenku connected";
        tip = `Kenku Remote at ${h.kenku.url} – ${h.kenku.playlists} playlists`;
      } else if (h.kenku.reachable) {
        cls = "status-warn"; text = `Kenku busy (${h.kenku.status})`;
        tip = h.kenku.message || "";
      } else {
        text = "Kenku not reachable";
        tip = h.kenku.message;
      }
      // Kenku just came back (e.g. you opened it after the dashboard) → reload lists
      if (h.kenku.ok && wasOk === false) KenkuPanel.reload();
      wasOk = !!h.kenku.ok;
    } catch {
      wasOk = false;
    }
    status.className = "status " + cls;
    status.textContent = text;
    status.title = tip;
  }

  // Show a badge if a newer release exists on GitHub.
  async function checkVersion() {
    try {
      const v = await (await fetch("/api/version")).json();
      if (v.updateAvailable) {
        const badge = document.getElementById("update-badge");
        badge.hidden = false;
        badge.textContent = `Update available: v${v.latest}`;
        badge.href = v.url;
        badge.title = `You have v${v.current}. Click to see what's new.`;
      }
    } catch { /* offline – ignore */ }
  }

  Layout.init();
  KenkuPanel.init();
  YouTubePanel.init();
  EmbedPanel.init();
  Settings.init();
  window.addEventListener("settings-saved", checkHealth); // Kenku address may have changed

  checkHealth();
  setInterval(checkHealth, 5000);
  checkVersion();
})();
