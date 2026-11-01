// youtube-panel.js – Panel B: an embedded YouTube player.
// Uses the official YouTube IFrame Player API:
// https://developers.google.com/youtube/iframe_api_reference

const YouTubePanel = (() => {
  const $ = (id) => document.getElementById(id);
  let player = null;      // the YT.Player once it's ready
  let pending = null;     // something to load as soon as the player is ready

  // Turn whatever the user typed into { videoId?, listId? }.
  // Accepts: full watch URLs, youtu.be links, /shorts/, /embed/, playlist URLs,
  // a bare 11-character video ID, or a bare playlist ID (PL..., OL..., etc.).
  function parse(input) {
    const text = input.trim();
    if (!text) return null;
    if (/^[\w-]{11}$/.test(text)) return { videoId: text };
    if (/^(PL|OL|UU|LL|RD|FL)[\w-]{10,}$/.test(text)) return { listId: text };

    let url;
    try {
      url = new URL(text.startsWith("http") ? text : "https://" + text);
    } catch {
      return null;
    }
    const listId = url.searchParams.get("list") || undefined;
    let videoId = url.searchParams.get("v") || undefined;
    if (url.hostname.endsWith("youtu.be")) videoId = url.pathname.slice(1, 12);
    const m = url.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    if (m) videoId = m[2];
    if (!videoId && !listId) return null;
    return { videoId, listId };
  }

  function message(text, kind = "warn", link) {
    const box = $("yt-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
    if (link) {
      const b = document.createElement("button");
      b.className = "small";
      b.textContent = "↗ Open on YouTube in a new tab";
      b.onclick = () => window.open(link, "_blank");
      box.append(document.createElement("br"), b);
    }
  }

  // autoplay=false is used when restoring after a page reload (just "cue" it).
  function load(target, autoplay = true) {
    if (!player) { pending = { target, autoplay }; return; }
    message(null);
    if (target.listId) {
      const opts = { listType: "playlist", list: target.listId };
      autoplay ? player.loadPlaylist(opts) : player.cuePlaylist(opts);
    } else {
      autoplay ? player.loadVideoById(target.videoId) : player.cueVideoById(target.videoId);
    }
  }

  // YouTube error codes → plain English
  function onError(e) {
    const url = $("yt-url").value.trim();
    const link = url.startsWith("http") ? url : `https://www.youtube.com/watch?v=${url}`;
    const reasons = {
      2: "That doesn't look like a valid video ID.",
      5: "This video can't play in an embedded player (HTML5 error).",
      100: "Video not found – it may be private or deleted.",
      101: "The owner of this video doesn't allow it to be embedded.",
      150: "The owner of this video doesn't allow it to be embedded.",
      153: "YouTube refused the embed (missing page referrer).",
    };
    message(`${reasons[e.data] || "YouTube error " + e.data} Try opening it in a new tab instead.`, "error", link);
  }

  function createPlayer() {
    player = new YT.Player("yt-player", {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => {
          player.setVolume(Number($("yt-volume").value));
          if (pending) { load(pending.target, pending.autoplay); pending = null; }
        },
        onError,
      },
    });
  }

  function init() {
    // Restore saved URL and volume
    const savedUrl = Store.get("youtube.url", "");
    const savedVol = Store.get("youtube.volume", 60);
    $("yt-url").value = savedUrl;
    $("yt-volume").value = savedVol;
    $("yt-volume-value").textContent = savedVol + "%";

    $("yt-form").addEventListener("submit", (e) => {
      e.preventDefault(); // stop the form reloading the page
      const target = parse($("yt-url").value);
      if (!target) {
        message("Couldn't find a video or playlist ID in that. Paste a YouTube link or an ID.", "error");
        return;
      }
      Store.set("youtube.url", $("yt-url").value.trim());
      load(target, true);
    });

    $("yt-volume").addEventListener("input", (e) => {
      const v = Number(e.target.value);
      $("yt-volume-value").textContent = v + "%";
      Store.set("youtube.volume", v);
      if (player?.setVolume) player.setVolume(v);
    });

    // The API script calls this global function once it has loaded.
    window.onYouTubeIframeAPIReady = createPlayer;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => message("Couldn't load the YouTube player. Are you online?", "error");
    document.head.appendChild(s);

    const restored = parse(savedUrl);
    if (restored) load(restored, false);
  }

  return { init, parse };
})();
