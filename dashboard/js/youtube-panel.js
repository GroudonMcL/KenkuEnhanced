// youtube-panel.js – YouTube tiles ("decks") plus the "+ YouTube" search dialog.
//
// Each YouTube tile is an independent player with its own link, volume and loop
// button, so you can layer e.g. a rain ambience under some music. All of them play
// through this page, so in Kenku's browser they all reach Discord.
//
// Uses the official YouTube IFrame Player API:
//   https://developers.google.com/youtube/iframe_api_reference
// Search goes through our helper (/api/youtube/search), which holds the API key.

const YouTubePanel = (() => {
  const $ = (id) => document.getElementById(id);
  const decks = [];             // the live deck objects, in display order
  let apiReady = false;         // true once YouTube's script has loaded
  let lastResults = [];         // most recent search results (re-drawn when decks change)

  // ---------------------------------------------------------------------------
  // Turning user input into { videoId?, listId? }
  // Accepts watch URLs, youtu.be links, /shorts/, /embed/, playlist URLs,
  // a bare 11-character video ID, or a bare playlist ID (PL..., OL..., etc.).
  // ---------------------------------------------------------------------------
  function parse(input) {
    const text = (input || "").trim();
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

  // Make sure at least n players exist (Scenes use this); returns the deck list.
  function ensureDecks(n) {
    while (decks.length < n) Board.add("youtube", {});
    return decks;
  }

  // A link we can open in a new tab if embedding fails
  function linkFor(target) {
    if (target?.listId && !target.videoId) return `https://www.youtube.com/playlist?list=${target.listId}`;
    if (target?.videoId) return `https://www.youtube.com/watch?v=${target.videoId}`;
    return null;
  }

  // ---------------------------------------------------------------------------
  // One player = one tile. Its settings { url, volume, loop } are saved with
  // the board layout.
  // ---------------------------------------------------------------------------
  function createDeck(tile, saved, { autoplay = false } = {}) {
    const el = $("yt-deck-template").content.firstElementChild.cloneNode(true);
    tile.body.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    tile.setTitle("YouTube");

    const deck = {
      el,
      tile,
      saved: {
        url: saved.url || "",
        volume: saved.volume ?? 60,
        loop: !!saved.loop,
      },
      player: null,
      ready: false,
      pending: null,  // something to load once the player is ready
      target: null,   // what's currently loaded
    };
    decks.push(deck);
    const save = () => tile.changed();

    q(".yt-url").value = deck.saved.url;
    q(".yt-volume").value = deck.saved.volume;
    q(".yt-volume-value").textContent = deck.saved.volume + "%";
    q(".yt-loop").classList.toggle("on", deck.saved.loop);

    // The link box only shows while the player is empty, or after 🔗 in the title bar.
    function showLinkBox(on) {
      q(".yt-form").hidden = !on;
      if (on) q(".yt-url").focus();
    }
    showLinkBox(!deck.saved.url);
    tile.addAction("🔗", "Change the video (paste a link)", () => showLinkBox(q(".yt-form").hidden));
    tile.addAction("🔎", "Search YouTube for this player", () => openDialog(deck));

    function message(text, kind = "warn", link) {
      const box = q(".yt-message");
      box.hidden = !text;
      box.className = `notice notice-${kind} yt-message`;
      box.textContent = text || "";
      if (link) {
        const b = document.createElement("button");
        b.className = "small";
        b.textContent = "↗ Open on YouTube in a new tab";
        b.onclick = () => window.open(link, "_blank");
        box.append(document.createElement("br"), b);
      }
    }

    // play=false just "cues" it (used when restoring after a reload).
    deck.load = (target, play = true) => {
      deck.target = target;
      if (!deck.ready) { deck.pending = { target, play }; return; }
      message(null);
      const p = deck.player;
      if (target.listId) {
        const opts = { listType: "playlist", list: target.listId };
        play ? p.loadPlaylist(opts) : p.cuePlaylist(opts);
      } else {
        play ? p.loadVideoById(target.videoId) : p.cueVideoById(target.videoId);
      }
    };

    // Load from a link/ID typed by the user or chosen from search results.
    deck.loadUrl = (text, play = true, title) => {
      const target = parse(text);
      if (!target) {
        message("Couldn't find a video or playlist ID in that. Paste a YouTube link or an ID.", "error");
        showLinkBox(true);
        return;
      }
      q(".yt-url").value = text.trim();
      deck.saved.url = text.trim();
      if (title) tile.setTitle(title);
      showLinkBox(false);
      save();
      deck.load(target, play);
    };

    // YouTube error codes → plain English
    function onError(e) {
      const reasons = {
        2: "That doesn't look like a valid video ID.",
        5: "This video can't play in an embedded player.",
        100: "Video not found – it may be private or deleted.",
        // YouTube uses 101/150 both for "embedding disabled" and "blocked here"
        101: "This video can't be played inside the dashboard (embedding is turned off, or it's blocked in your region).",
        150: "This video can't be played inside the dashboard (embedding is turned off, or it's blocked in your region).",
        153: "YouTube refused the embed (missing page referrer).",
      };
      message(`${reasons[e.data] || "YouTube error " + e.data} Try opening it in a new tab instead.`, "error", linkFor(deck.target));
    }

    function onStateChange(e) {
      const playing = e.data === YT.PlayerState.PLAYING;
      q(".yt-playpause").textContent = playing ? "⏸" : "▶";
      tile.setStatus(playing ? "● playing" : "", "playing");
      // The tile takes the video's name once it's loaded
      if (playing || e.data === YT.PlayerState.CUED) {
        const title = deck.player.getVideoData?.().title;
        if (title) tile.setTitle(title);
      }
      // Loop a single video by starting it again when it ends.
      // (Playlists loop through setLoop instead – see the loop button.)
      if (e.data === YT.PlayerState.ENDED && deck.saved.loop && !deck.target?.listId) {
        deck.player.seekTo(0);
        deck.player.playVideo();
      }
    }

    deck.createPlayer = () => {
      deck.player = new YT.Player(q(".yt-player"), {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            deck.ready = true;
            deck.player.setVolume(deck.saved.volume);
            deck.player.setLoop(deck.saved.loop);
            if (deck.pending) {
              deck.load(deck.pending.target, deck.pending.play);
              deck.pending = null;
            }
          },
          onStateChange,
          onError,
        },
      });
    };

    // --- Controls ---
    q(".yt-form").addEventListener("submit", (e) => {
      e.preventDefault(); // stop the form reloading the page
      deck.loadUrl(q(".yt-url").value, false); // ready to play, but wait for ▶
    });

    q(".yt-playpause").addEventListener("click", () => {
      if (!deck.ready) return;
      const playing = deck.player.getPlayerState() === YT.PlayerState.PLAYING;
      playing ? deck.player.pauseVideo() : deck.player.playVideo();
    });

    // Loop: single videos restart in onStateChange; playlists use setLoop.
    q(".yt-loop").addEventListener("click", () => deck.setLoop(!deck.saved.loop));
    q(".yt-volume").addEventListener("input", (e) => deck.setVolume(Number(e.target.value)));

    // --- Small helpers other parts of the dashboard (Scenes) use ---
    // Set the volume (0-100). persist=false is used during fades so we don't
    // save 20 times a second; the final value is saved.
    deck.setVolume = (v, persist = true) => {
      v = Math.max(0, Math.min(100, Math.round(v)));
      if (deck.ready) deck.player.setVolume(v);
      q(".yt-volume").value = v;
      q(".yt-volume-value").textContent = v + "%";
      if (persist) {
        deck.saved.volume = v;
        save();
      }
    };
    deck.currentVolume = () => (deck.ready ? deck.player.getVolume() : deck.saved.volume);
    deck.isPlaying = () => deck.ready && deck.player.getPlayerState() === YT.PlayerState.PLAYING;
    deck.pause = () => deck.ready && deck.player.pauseVideo();
    deck.play = () => deck.ready && deck.player.playVideo();
    deck.setLoop = (on) => {
      deck.saved.loop = !!on;
      q(".yt-loop").classList.toggle("on", deck.saved.loop);
      if (deck.ready) deck.player.setLoop(deck.saved.loop);
      save();
    };
    deck.displayName = () => tile.title();

    // Start it
    if (apiReady) deck.createPlayer();
    if (deck.saved.url) {
      const t = parse(deck.saved.url);
      if (t) deck.load(t, autoplay);
    }

    return {
      deck,
      save: () => ({ ...deck.saved }),
      destroy: () => {
        deck.player?.destroy?.();
        decks.splice(decks.indexOf(deck), 1);
        renderResults();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  // YouTube sends titles with HTML codes like &amp; and &#39; – turn them back into text.
  function decode(text) {
    return new DOMParser().parseFromString(text || "", "text/html").documentElement.textContent;
  }

  function searchMessage(text, kind = "warn") {
    const box = $("yt-search-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  async function search(query, type) {
    if (!query.trim()) return;
    searchMessage("Searching…");
    try {
      const r = await fetch(`/api/youtube/search?type=${type}&q=${encodeURIComponent(query)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Search failed");
      lastResults = data.results;
      searchMessage(lastResults.length ? null : "No results.");
    } catch (err) {
      lastResults = [];
      searchMessage(err.message, "error");
    }
    renderResults();
  }

  // Search results: each one can go into a new player tile, or into an existing one.
  function renderResults() {
    const box = $("yt-results");
    box.innerHTML = "";
    box.hidden = !lastResults.length;
    for (const r of lastResults) {
      const url = r.listId ? `https://www.youtube.com/playlist?list=${r.listId}` : `https://www.youtube.com/watch?v=${r.videoId}`;
      const title = decode(r.title);
      const row = document.createElement("div");
      row.className = "yt-result";

      const img = document.createElement("img");
      img.src = r.thumbnail || "";
      img.alt = "";
      img.loading = "lazy";

      const info = document.createElement("div");
      info.className = "yt-result-info";
      const t = document.createElement("div");
      t.className = "yt-result-title";
      t.textContent = (r.listId ? "📃 " : "") + title;
      const channel = document.createElement("div");
      channel.className = "yt-result-channel";
      channel.textContent = decode(r.channel);

      const actions = document.createElement("div");
      actions.className = "yt-result-actions";
      const into = (deck) => {
        deck.loadUrl(url, false, title);
        $("yt-dialog").close();
      };
      if (targetDeck && decks.includes(targetDeck)) {
        const b = document.createElement("button");
        b.className = "small primary";
        b.textContent = `→ Put in “${shorten(targetDeck.displayName())}”`;
        b.onclick = () => into(targetDeck);
        actions.appendChild(b);
      }
      const add = document.createElement("button");
      add.className = "small" + (targetDeck ? "" : " primary");
      add.textContent = "＋ New tile";
      add.title = "Add a YouTube tile with this (press ▶ there to play)";
      add.onclick = () => {
        Board.add("youtube", { url, volume: 60, loop: false, title });
        $("yt-dialog").close();
      };
      actions.appendChild(add);

      info.append(t, channel, actions);
      row.append(img, info);
      box.appendChild(row);
    }
  }

  const shorten = (s) => (s.length > 28 ? s.slice(0, 27) + "…" : s);

  // The "+ YouTube" dialog: search, or paste a link. If `deck` is given, results
  // can go into that player instead of a new tile.
  let targetDeck = null;
  function openDialog(deck = null, query = "") {
    targetDeck = deck;
    $("yt-dialog-title").textContent = deck ? `Change “${shorten(deck.displayName())}”` : "Add a YouTube tile";
    $("yt-link").value = "";
    renderResults();
    $("yt-dialog").showModal();
    if (query) {
      $("yt-search").value = query;
      $("yt-search-type").value = "video";
      search(query, "video");
    } else {
      $("yt-search").focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------
  function init() {
    Board.register("youtube", {
      badge: "YouTube",
      badgeClass: "y",
      size: { w: 4, h: 13, minW: 2, minH: 6 }, // 20px rows
      create(tile, config) {
        const inst = createDeck(tile, config);
        if (config.title) tile.setTitle(config.title); // name from search, until YouTube tells us
        return inst;
      },
    });

    $("add-youtube").addEventListener("click", () => openDialog());
    $("yt-dialog-close").addEventListener("click", () => $("yt-dialog").close());

    const savedType = Store.get("youtube.searchType", "video");
    $("yt-search-type").value = savedType;
    $("yt-search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      Store.set("youtube.searchType", $("yt-search-type").value);
      search($("yt-search").value, $("yt-search-type").value);
    });
    // One-click example searches (each search uses some of the daily YouTube quota)
    document.querySelectorAll("[data-yt-q]").forEach((b) => {
      b.addEventListener("click", () => {
        $("yt-search").value = b.dataset.ytQ;
        $("yt-search-type").value = "video";
        search(b.dataset.ytQ, "video");
      });
    });
    $("yt-link-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("yt-link").value.trim();
      if (!parse(text)) {
        searchMessage("Couldn't find a video or playlist ID in that. Paste a YouTube link or an ID.", "error");
        return;
      }
      if (targetDeck && decks.includes(targetDeck)) targetDeck.loadUrl(text, false);
      else Board.add("youtube", { url: text, volume: 60, loop: false });
      $("yt-dialog").close();
    });

    // YouTube's script calls this global function once it has loaded.
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      decks.forEach((d) => d.player || d.createPlayer());
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => searchMessage("Couldn't load the YouTube player. Are you online?", "error");
    document.head.appendChild(s);
  }

  // Used by ✨ Vibe: open the YouTube dialog and search for `q`.
  function searchFor(q) {
    openDialog(null, q);
  }

  return { init, parse, decks: () => decks, ensureDecks, searchFor };
})();
