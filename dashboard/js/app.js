// app.js – starts everything and runs the top-bar status checks.

(() => {
  const status = document.getElementById("kenku-status");
  let wasOk = null;
  let pageVersion = null; // the helper's version when this page loaded

  // Ask the helper's /health route every 5 seconds whether Kenku is reachable.
  async function checkHealth() {
    let cls = "status-bad";
    let text = "Helper offline";
    let tip = "The helper server isn't answering. Is the KenkuEnhanced window still open?";
    try {
      const h = await (await fetch("/health")).json();
      pageVersion ??= h.version;
      if (h.version !== pageVersion) {
        const busy = YouTubePanel.decks().some((d) => d.isPlaying()) || EmbedPanel.instances().some((w) => w.tile.config().url);
        Update.helperVersion(h.version, !busy);
      }
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

  // Tile types register themselves first; then Scenes loads the scenes and has
  // the board build the current one.
  KenkuPanel.init();
  YouTubePanel.init();
  YTPlaylist.init();  // the YouTube Playlist tile
  EmbedPanel.init();
  Mixer.init();      // (before Scenes builds the board: it registers the Mixer tile)
  Links.init();
  Scenes.init();
  SoundsPanel.init();
  Settings.init();
  Vibe.init();
  window.addEventListener("settings-saved", checkHealth); // Kenku address may have changed

  checkHealth();
  setInterval(checkHealth, 5000);
  Update.init(); // "Update available" badge (checks GitHub Releases)
  setInterval(Update.check, 6 * 60 * 60 * 1000); // and again every 6 hours
})();
