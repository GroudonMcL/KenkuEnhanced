// youtube-panel.js – Panel B: several YouTube players ("decks") plus search.
//
// Each deck is an independent player with its own link, volume and loop button,
// so you can layer e.g. a rain ambience under some music. All of them play
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
    while (decks.length < n) addDeck();
    return decks;
  }

  // A link we can open in a new tab if embedding fails
  function linkFor(target) {
    if (target?.listId && !target.videoId) return `https://www.youtube.com/playlist?list=${target.listId}`;
    if (target?.videoId) return `https://www.youtube.com/watch?v=${target.videoId}`;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Saving: an array of { name, url, volume, loop, collapsed }, one per deck
  // ---------------------------------------------------------------------------
  function save() {
    Store.set("youtube.decks", decks.map((d) => d.saved));
  }

  function loadSaved() {
    let saved = Store.get("youtube.decks", null);
    if (!saved) {
      // Older version stored a single URL + volume – carry it over.
      saved = [{ url: Store.get("youtube.url", ""), volume: Store.get("youtube.volume", 60), loop: false }];
    }
    return saved.length ? saved : [{ url: "", volume: 60, loop: false }];
  }

  // ---------------------------------------------------------------------------
  // One deck
  // ---------------------------------------------------------------------------
  function createDeck(saved, { autoplay = false } = {}) {
    const el = $("yt-deck-template").content.firstElementChild.cloneNode(true);
    $("yt-decks").appendChild(el);
    const q = (sel) => el.querySelector(sel);

    const deck = {
      el,
      saved: {
        name: saved.name || "",          // empty = use "Player 1", "Player 2"...
        url: saved.url || "",
        volume: saved.volume ?? 60,
        loop: !!saved.loop,
        collapsed: !!saved.collapsed,    // minimised?
      },
      player: null,
      ready: false,
      pending: null,  // something to load once the player is ready
      target: null,   // what's currently loaded
    };
    decks.push(deck);

    q(".yt-url").value = deck.saved.url;
    q(".yt-volume").value = deck.saved.volume;
    q(".yt-volume-value").textContent = deck.saved.volume + "%";
    q(".yt-loop").classList.toggle("on", deck.saved.loop);
    q(".yt-deck-name").value = deck.saved.name;
    setCollapsed(deck.saved.collapsed);

    function setCollapsed(on) {
      deck.saved.collapsed = on;
      el.classList.toggle("collapsed", on);
      q(".yt-collapse").textContent = on ? "▸" : "▾";
      q(".yt-collapse").title = on ? "Expand" : "Minimise";
    }

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

    // autoplay=false just "cues" it (used when restoring after a reload).
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
    deck.loadUrl = (text, play = true) => {
      const target = parse(text);
      if (!target) {
        message("Couldn't find a video or playlist ID in that. Paste a YouTube link or an ID.", "error");
        return;
      }
      q(".yt-url").value = text.trim();
      deck.saved.url = text.trim();
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
      // 1 = playing, 2 = paused, 0 = ended
      q(".yt-playpause").textContent = e.data === YT.PlayerState.PLAYING ? "⏸" : "▶";
      if (e.data === YT.PlayerState.PLAYING) {
        const title = deck.player.getVideoData?.().title;
        if (title) q(".yt-deck-title").textContent = title;
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
      deck.loadUrl(q(".yt-url").value, true);
    });

    q(".yt-playpause").addEventListener("click", () => {
      if (!deck.ready) return;
      const playing = deck.player.getPlayerState() === YT.PlayerState.PLAYING;
      playing ? deck.player.pauseVideo() : deck.player.playVideo();
    });

    // Loop: single videos restart in onStateChange; playlists use setLoop.
    q(".yt-loop").addEventListener("click", () => deck.setLoop(!deck.saved.loop));

    q(".yt-volume").addEventListener("input", (e) => deck.setVolume(Number(e.target.value)));

    q(".yt-collapse").addEventListener("click", () => {
      setCollapsed(!deck.saved.collapsed);
      save();
    });

    // Rename: just type in the name box. Empty = back to "Player N".
    q(".yt-deck-name").addEventListener("input", (e) => {
      deck.saved.name = e.target.value.trim();
      save();
      renderResults(); // result buttons show player names
    });
    q(".yt-deck-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
    });

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
    deck.displayName = () => deck.saved.name || q(".yt-deck-name").placeholder;

    q(".yt-remove").addEventListener("click", () => removeDeck(deck));

    // Start it
    if (apiReady) deck.createPlayer();
    if (deck.saved.url) {
      const t = parse(deck.saved.url);
      if (t) deck.load(t, autoplay);
    }
    return deck;
  }

  function removeDeck(deck) {
    if (decks.length <= 1) return; // always keep one
    deck.player?.destroy?.();
    deck.el.remove();
    decks.splice(decks.indexOf(deck), 1);
    save();
    refreshDeckLabels();
  }

  function addDeck(saved = { name: "", url: "", volume: 60, loop: false }, opts) {
    const d = createDeck(saved, opts);
    save();
    refreshDeckLabels();
    return d;
  }

  // Default names ("Player 1", "Player 2"...), remove buttons and result buttons depend on the deck count.
  function refreshDeckLabels() {
    decks.forEach((d, i) => {
      d.el.querySelector(".yt-deck-name").placeholder = `Player ${i + 1}`;
      d.el.querySelector(".yt-remove").hidden = decks.length <= 1;
    });
    renderResults();
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

  function renderResults() {
    const box = $("yt-results");
    box.innerHTML = "";
    box.hidden = !lastResults.length;
    if (!lastResults.length) return;

    const close = document.createElement("button");
    close.className = "small yt-results-close";
    close.textContent = "✕ Close results";
    close.onclick = () => { lastResults = []; renderResults(); };
    box.appendChild(close);

    for (const r of lastResults) {
      const url = r.listId ? `https://www.youtube.com/playlist?list=${r.listId}` : `https://www.youtube.com/watch?v=${r.videoId}`;
      const row = document.createElement("div");
      row.className = "yt-result";

      const img = document.createElement("img");
      img.src = r.thumbnail || "";
      img.alt = "";
      img.loading = "lazy";

      const info = document.createElement("div");
      info.className = "yt-result-info";
      const title = document.createElement("div");
      title.className = "yt-result-title";
      title.textContent = (r.listId ? "📃 " : "") + decode(r.title);
      const channel = document.createElement("div");
      channel.className = "yt-result-channel";
      channel.textContent = decode(r.channel);

      // One button per player, plus "new player"
      const actions = document.createElement("div");
      actions.className = "yt-result-actions";
      decks.forEach((d) => {
        const b = document.createElement("button");
        b.className = "small";
        b.textContent = `▶ ${d.displayName()}`;
        b.onclick = () => d.loadUrl(url, true);
        actions.appendChild(b);
      });
      const add = document.createElement("button");
      add.className = "small primary";
      add.textContent = "＋ New player";
      add.onclick = () => addDeck({ url, volume: 60, loop: false }, { autoplay: true });
      actions.appendChild(add);

      info.append(title, channel, actions);
      row.append(img, info);
      box.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------
  function init() {
    loadSaved().forEach((s) => createDeck(s));
    refreshDeckLabels();

    $("yt-add").addEventListener("click", () => addDeck());

    const savedType = Store.get("youtube.searchType", "video");
    $("yt-search-type").value = savedType;
    $("yt-search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      Store.set("youtube.searchType", $("yt-search-type").value);
      search($("yt-search").value, $("yt-search-type").value);
    });

    // YouTube's script calls this global function once it has loaded.
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      decks.forEach((d) => d.createPlayer());
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => searchMessage("Couldn't load the YouTube player. Are you online?", "error");
    document.head.appendChild(s);
  }

  // Used by ✨ Vibe: show the panel and search YouTube for `q`.
  function searchFor(q) {
    Layout.show("youtube");
    $("yt-search").value = q;
    $("yt-search-type").value = "video";
    search(q, "video");
    $("panel-youtube").scrollTop = 0;
  }

  return { init, parse, decks: () => decks, ensureDecks, searchFor };
})();
