// yt-playlist.js – the YouTube Playlist tile.
//
// The video plays at the top; under it, every video in the playlist with its
// thumbnail. Click one to play it. Shuffle, repeat (all / one / off), and a
// crossfade from one video into the next.
//
// How the crossfade works: the tile has TWO YouTube players on top of each
// other. Near the end of a video (or when you click another one) the hidden
// player starts the next video silently, then one turns down while the other
// turns up, and the pictures blend over. So the tile plays its own queue
// (loadVideoById per video) instead of YouTube's playlist mode.
//
// The list of videos comes from the helper (/api/youtube/playlist). With a
// YouTube API key it's the whole playlist; without one the helper says so and
// we ask the YouTube player for the IDs (up to 200), and the helper looks up
// the names (/api/youtube/titles, no key needed).
//
// For the Mixer, Duck and scenes this tile is a YouTube "deck" like any other
// (it joins YouTubePanel.decks()): setVolume / currentVolume / play / pause /
// isPlaying / position / resume / whenReady / fadeToggle.

const YTPlaylist = (() => {
  const XFADES = [0, 2, 5, 10, 15];
  const REPEATS = ["all", "one", "off"];
  const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };
  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function createTile(tile, saved) {
    const el = document.getElementById("ytpl-template").content.firstElementChild.cloneNode(true);
    tile.body.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    const layers = [...el.querySelectorAll(".ytpl-layer")];
    tile.setTitle(saved.listTitle || saved.title || "YouTube playlist");

    const deck = {
      kind: "playlist",
      el,
      tile,
      saved: {
        url: saved.url || "",
        volume: saved.volume ?? 60,
        shuffle: !!saved.shuffle,
        repeat: REPEATS.includes(saved.repeat) ? saved.repeat : "all",
        crossfade: XFADES.includes(saved.crossfade) ? saved.crossfade : 5,
        index: saved.index || 0,     // the video it was on (in playlist order)
        listTitle: saved.listTitle || "",
      },
      level: saved.volume ?? 60,
      fadeDir: null,
      created: false,
      ready: false,
      readyWaiters: [],
      target: null,       // { listId, videoId }
      items: [],          // [{ videoId, title, channel, thumbnail, bad }]
      order: [],          // play order: indexes into items (shuffled or not)
      pos: 0,             // where we are in `order`
      players: [null, null],
      act: 0,             // which player is the one you see and hear
      mix: [1, 0],        // each player's share of the volume (crossfades move these)
      xf: null,           // the crossfade in progress
      wantPlay: false,    // play() was asked for and hasn't started yet
      errors: 0,          // videos in a row that couldn't play
    };
    deck.player = null;   // (the YouTube panel checks this)
    const save = () => tile.changed();
    const S = () => YT.PlayerState;
    const active = () => deck.players[deck.act];
    const current = () => deck.items[deck.order[deck.pos]];
    let loadToken = 0;
    let xfToken = 0;

    // ---- Controls start-up ----
    Icons.set(q(".ytpl-prev"), "prev");
    Icons.set(q(".yt-playpause"), "play");
    Icons.set(q(".ytpl-next"), "next");
    Icons.set(q(".yt-fade"), "fadein");
    Icons.set(q(".ytpl-shuffle"), "shuffle");
    q(".yt-url").value = deck.saved.url;
    q(".ytpl-xf select").value = String(deck.saved.crossfade);
    function showVolume() {
      q(".yt-volume").value = deck.level;
      Icons.paintRange(q(".yt-volume"));
      q(".yt-volume-value").textContent = Math.round(deck.level) + "%";
    }
    showVolume();
    function showModes() {
      q(".ytpl-shuffle").classList.toggle("on", deck.saved.shuffle);
      q(".ytpl-shuffle").title = deck.saved.shuffle ? "Shuffle is on (click to play in order)" : "Shuffle";
      const r = deck.saved.repeat;
      Icons.set(q(".ytpl-repeat"), r === "one" ? "repeat1" : "repeat");
      q(".ytpl-repeat").classList.toggle("on", r !== "off");
      q(".ytpl-repeat").title = { all: "Repeat: the whole playlist (click: this video)", one: "Repeat: this video (click: off)", off: "Repeat: off – stops at the end (click: whole playlist)" }[r];
    }
    showModes();

    function showLinkBox(on) {
      q(".yt-form").hidden = !on;
      if (on) q(".yt-url").focus();
    }
    showLinkBox(!deck.saved.url);
    tile.addAction("link", "Change the playlist (paste a link)", () => showLinkBox(q(".yt-form").hidden));
    tile.addAction("search", "Search YouTube for a playlist", () => YouTubePanel.openDialog(deck, "", "playlist"));

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

    // =========================================================================
    // The list
    // =========================================================================
    const listBox = q(".ytpl-list");
    let rows = [];
    function renderList() {
      listBox.innerHTML = "";
      rows = deck.items.map((it, i) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ytpl-row";
        row.setAttribute("role", "listitem");
        row.innerHTML = `<span class="ytpl-num"></span><img alt="" loading="lazy"><span class="ytpl-info"><span class="ytpl-title"></span><span class="ytpl-channel"></span></span>`;
        row.querySelector(".ytpl-num").textContent = i + 1;
        row.querySelector("img").src = it.thumbnail || thumb(it.videoId);
        row.addEventListener("click", () => {
          Mixer.claim(deck); // a fade button's fade stops
          deck.wantPlay = true;
          deck.errors = 0;
          playAt(deck.order.indexOf(i), { play: true });
        });
        listBox.appendChild(row);
        return row;
      });
      rows.forEach((_, i) => paintRow(i));
      filter();
      q(".ytpl-count").textContent = deck.items.length ? `${deck.items.length} video${deck.items.length === 1 ? "" : "s"}` : "";
    }
    function paintRow(i) {
      const it = deck.items[i];
      const row = rows[i];
      if (!row) return;
      row.querySelector(".ytpl-title").textContent = it.title || (it.bad ? "(can't be played)" : "…");
      row.querySelector(".ytpl-channel").textContent = it.channel || "";
      row.title = it.title || "";
      row.classList.toggle("bad", !!it.bad);
    }
    function showCurrent() {
      const i = deck.order[deck.pos];
      rows.forEach((r, k) => r.classList.toggle("current", k === i));
      const it = current();
      const n = deck.items.length;
      q(".ytpl-now-title").textContent = it ? `${i + 1}/${n} · ${it.title || "…"}` : n ? "" : "No videos loaded";
      const next = upNext();
      q(".ytpl-now").title = next ? `Up next: ${next.title || next.videoId}` : "";
    }
    function scrollToCurrent() {
      rows[deck.order[deck.pos]]?.scrollIntoView({ block: "nearest" });
    }
    function filter() {
      const text = q(".ytpl-filter").value.trim().toLowerCase();
      rows.forEach((r, i) => (r.hidden = !!text && !`${deck.items[i].title} ${deck.items[i].channel}`.toLowerCase().includes(text)));
    }
    q(".ytpl-filter").addEventListener("input", filter);

    function makeOrder(keepCurrent = true) {
      const cur = keepCurrent && deck.order.length ? deck.order[deck.pos] : deck.saved.index;
      const all = deck.items.map((_, i) => i);
      if (deck.saved.shuffle) {
        const rest = shuffled(all.filter((i) => i !== cur));
        deck.order = all.includes(cur) ? [cur, ...rest] : rest;
        deck.pos = 0;
      } else {
        deck.order = all;
        deck.pos = Math.max(0, Math.min(all.length - 1, cur || 0));
      }
    }

    // Get the playlist's videos (see the top of this file).
    async function loadList(target, { play = false, startIndex = null, startSeconds = 0 } = {}) {
      const token = ++loadToken;
      deck.target = target;
      deck.items = [];
      deck.order = [];
      renderList();
      message(null);
      q(".ytpl-now-title").textContent = "Loading the playlist…";
      let items = null;
      let title = "";
      try {
        if (target.listId) {
          const r = await fetch(`/api/youtube/playlist?list=${encodeURIComponent(target.listId)}`);
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Couldn't load the playlist");
          items = data.items;
          title = data.title || "";
        } else {
          items = [{ videoId: target.videoId }];
        }
        if (token !== loadToken) return;
        if (!items) items = (await idsFromPlayer(target.listId, token)).map((videoId) => ({ videoId }));
        if (token !== loadToken) return;
      } catch (err) {
        if (token !== loadToken) return;
        q(".ytpl-now-title").textContent = "";
        message(`${err.message}.`, "error", target.listId ? `https://www.youtube.com/playlist?list=${target.listId}` : null);
        return;
      }
      if (!items.length) {
        q(".ytpl-now-title").textContent = "";
        message("This playlist has no videos that can be played here.", "warn");
        return;
      }
      deck.items = items.map((it) => ({ title: "", channel: "", ...it }));
      if (title) {
        deck.saved.listTitle = title;
        tile.setTitle(title);
      }
      // Where to start: the video from the link, the saved one, or the first
      let start = startIndex ?? deck.saved.index;
      if (startIndex == null && target.videoId && !deck.saved.index) {
        const k = deck.items.findIndex((it) => it.videoId === target.videoId);
        if (k >= 0) start = k;
      }
      deck.saved.index = Math.max(0, Math.min(deck.items.length - 1, start || 0));
      deck.order = [];
      makeOrder(false);
      renderList();
      showCurrent();
      requestAnimationFrame(scrollToCurrent);
      fillTitles(token);
      await deck.whenReady();
      if (token !== loadToken) return;
      const resume = deck.pendingResume;
      deck.pendingResume = null;
      if (resume) {
        const k = deck.order.indexOf(resume.index);
        if (k >= 0) deck.pos = k;
        startSeconds = resume.time || 0;
      }
      playAt(deck.pos, { play: play || deck.wantPlay, startSeconds, fade: false });
    }

    // No API key: cue the playlist in the hidden player and read its video IDs.
    async function idsFromPlayer(listId, token) {
      await deck.whenReady();
      const p = deck.players[1 - deck.act];
      p.cuePlaylist({ listType: "playlist", list: listId });
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        if (token !== loadToken) return [];
        const ids = p.getPlaylist?.();
        if (ids?.length) return ids;
      }
      throw new Error("YouTube didn't give the list of videos. The playlist may be private, or you're offline");
    }

    // Names for videos that came without one (no API key), 50 at a time
    async function fillTitles(token) {
      const missing = deck.items.map((it, i) => [it, i]).filter(([it]) => !it.title);
      for (let k = 0; k < missing.length; k += 50) {
        const part = missing.slice(k, k + 50);
        try {
          const { titles } = await (await fetch(`/api/youtube/titles?ids=${part.map(([it]) => it.videoId).join(",")}`)).json();
          if (token !== loadToken) return;
          for (const [it, i] of part) {
            const t = titles[it.videoId];
            if (t) Object.assign(it, { title: t.title, channel: t.channel, bad: it.bad || !!t.unavailable });
            paintRow(i);
          }
          showCurrent();
        } catch {
          return; // offline: the rows keep their numbers and thumbnails
        }
      }
    }

    // =========================================================================
    // Playing
    // =========================================================================
    function upNext() {
      if (!deck.order.length) return null;
      if (deck.saved.repeat === "one") return current();
      const p = deck.pos + 1;
      if (p < deck.order.length) return deck.items[deck.order[p]];
      return deck.saved.repeat === "all" && !deck.saved.shuffle ? deck.items[deck.order[0]] : null;
    }

    // What each player really plays at: your volume × its crossfade share × Duck.
    deck.applyOutput = () => {
      deck.players.forEach((p, k) => {
        if (p && deck.ready) p.setVolume(Math.round(deck.level * deck.mix[k] * Mixer.factor()));
      });
    };
    function showLayers() {
      layers.forEach((l, k) => l.classList.toggle("active", k === deck.act));
    }

    // Finish a crossfade now: the new video carries on and the old one stops. If the
    // new video hadn't started yet, it's called off and the old one carries on.
    function endCrossfade() {
      if (!deck.xf) return;
      xfToken++;
      const { from, to, started } = deck.xf;
      deck.xf = null;
      const stop = started ? from : to;
      deck.players[stop]?.pauseVideo();
      deck.mix[stop] = 0;
      deck.mix[deck.act] = 1;
      showLayers();
      el.style.removeProperty("--xf");
      deck.applyOutput();
    }

    // Go to position `pos` in the play order. play=false just cues it.
    // fade=true crossfades into it if something is playing and crossfade is on.
    function playAt(pos, { play = true, fade = true, startSeconds = 0 } = {}) {
      const it = deck.items[deck.order[pos]];
      if (!it || !deck.ready) return;
      deck.pos = pos;
      deck.saved.index = deck.order[pos];
      save();
      showCurrent();
      scrollToCurrent();
      message(null);
      const secs = deck.saved.crossfade;
      if (play && fade && secs > 0 && deck.isPlaying()) {
        crossfadeTo(it, secs);
        return;
      }
      endCrossfade();
      const p = active();
      deck.players[1 - deck.act]?.pauseVideo();
      deck.mix = deck.act === 0 ? [1, 0] : [0, 1];
      deck.applyOutput();
      const opts = { videoId: it.videoId, startSeconds };
      play ? p.loadVideoById(opts) : p.cueVideoById(opts);
      if (play) checkStarted();
    }

    async function crossfadeTo(it, secs) {
      endCrossfade();
      const token = ++xfToken;
      const from = deck.act;
      const to = 1 - from;
      const incoming = deck.players[to];
      deck.xf = { from, to, started: false };
      deck.mix[to] = 0;
      deck.applyOutput();
      incoming.loadVideoById({ videoId: it.videoId });
      // Wait (up to 10 s) for the next video to really start before fading
      for (let i = 0; i < 100 && incoming.getPlayerState() !== S().PLAYING; i++) {
        await sleep(100);
        if (token !== xfToken) return;
      }
      if (incoming.getPlayerState() !== S().PLAYING) {
        // It didn't start in time: switch over without a fade
        deck.act = to;
        deck.xf.started = true;
        endCrossfade();
        return;
      }
      deck.act = to; // from now on this is "the" player (position, pause, the list)
      deck.xf.started = true;
      el.style.setProperty("--xf", `${secs}s`);
      showLayers();
      const steps = Math.max(1, Math.round((secs * 1000) / 100));
      for (let i = 1; i <= steps; i++) {
        await sleep(100);
        if (token !== xfToken) return;
        const f = i / steps;
        deck.mix[to] = f;
        deck.mix[from] = 1 - f;
        deck.applyOutput();
      }
      endCrossfade();
    }

    // Next video. auto=true when the last one ended (or is about to).
    function advance(auto) {
      if (!deck.order.length) return;
      if (auto && deck.saved.repeat === "one") return playAt(deck.pos, { play: true });
      let p = deck.pos + 1;
      if (p >= deck.order.length) {
        if (auto && deck.saved.repeat === "off") return; // the end
        if (deck.saved.shuffle) {
          // A new shuffle each time round (but not the same video twice in a row)
          const last = deck.order[deck.pos];
          const fresh = shuffled(deck.order);
          if (fresh.length > 1 && fresh[0] === last) fresh.push(fresh.shift());
          deck.order = fresh;
        }
        p = 0;
      }
      playAt(p, { play: true });
    }
    function back() {
      if (!deck.order.length) return;
      if (deck.ready && active().getCurrentTime() > 5) return active().seekTo(0, true);
      const p = deck.pos > 0 ? deck.pos - 1 : deck.order.length - 1;
      playAt(p, { play: true });
    }

    // YouTube ignores play requests while it's still loading, so check it really started.
    function checkStarted() {
      clearTimeout(deck.playCheck);
      deck.playCheck = setTimeout(() => {
        const s = deck.ready && active().getPlayerState();
        if (deck.wantPlay && current() && ![S().PLAYING, S().BUFFERING].includes(s)) {
          active().loadVideoById({ videoId: current().videoId, startSeconds: Math.floor(active().getCurrentTime?.() || 0) });
        }
      }, 2500);
    }

    // ---- Player events ----
    function onStateChange(k, e) {
      if (k !== deck.act) return; // the player that's fading out doesn't count
      const s = S();
      const playing = e.data === s.PLAYING;
      if (playing) {
        deck.wantPlay = false;
        deck.errors = 0;
        // The video's name, if the list didn't have it
        const it = current();
        const title = active().getVideoData?.()?.title;
        if (it && !it.title && title) {
          it.title = title;
          paintRow(deck.order[deck.pos]);
          showCurrent();
        }
      }
      if (e.data === s.PAUSED) deck.wantPlay = false;
      // A cue that was still loading can land after our "play" and stop it at the
      // thumbnail: if it should be playing, start it now.
      if (e.data === s.CUED && deck.wantPlay) active().playVideo();
      if (e.data === s.ENDED && !deck.xf) advance(true);
      showPlaying();
    }
    function onError(k, e) {
      // The next video failing while we wait to crossfade into it counts too
      const incoming = deck.xf && !deck.xf.started && k === deck.xf.to;
      if (k !== deck.act && !incoming) return;
      if (incoming) endCrossfade(); // the old video plays on until we skip
      const it = current();
      if (it) {
        it.bad = true;
        paintRow(deck.order[deck.pos]);
      }
      const why = { 2: "isn't a valid video", 5: "can't play in an embedded player", 100: "is private or deleted", 101: "can't be played inside the dashboard", 150: "can't be played inside the dashboard" }[e.data] || `gave YouTube error ${e.data}`;
      message(`“${it?.title || "This video"}” ${why}.${deck.wantPlay || deck.isPlaying() ? " Skipping it." : ""}`, "warn");
      // Skip to the next one – unless nothing in the playlist plays
      if (++deck.errors < Math.min(deck.items.length, 10) && (deck.wantPlay || deck.xf)) {
        deck.wantPlay = true;
        setTimeout(() => advance(false), 1200);
      }
    }

    deck.createPlayer = () => {
      deck.created = true;
      let readyCount = 0;
      layers.forEach((layer, k) => {
        deck.players[k] = new YT.Player(layer.querySelector(".yt-player"), {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => {
              if (++readyCount < 2) return;
              deck.ready = true;
              deck.player = deck.players[0];
              deck.applyOutput();
              deck.readyWaiters.splice(0).forEach((r) => r());
            },
            onStateChange: (e) => onStateChange(k, e),
            onError: (e) => onError(k, e),
          },
        });
      });
    };
    deck.whenReady = () => (deck.ready ? Promise.resolve() : new Promise((r) => deck.readyWaiters.push(r)));

    // Time display, and starting the crossfade a little before a video ends
    const ticker = setInterval(() => {
      if (!deck.ready || !current()) return;
      const p = active();
      const t = p.getCurrentTime?.() || 0;
      const d = p.getDuration?.() || 0;
      q(".ytpl-time").textContent = d ? `${fmt(t)} / ${fmt(d)}` : "";
      q(".ytpl-progress div").style.width = d ? `${Math.min(100, (t / d) * 100)}%` : "0";
      const secs = deck.saved.crossfade;
      if (secs > 0 && !deck.xf && d > secs * 2 && d - t <= secs && p.getPlayerState() === S().PLAYING && !deck.fadeDir) {
        if (upNext() || deck.saved.repeat === "all") advance(true);
      }
    }, 250);
    // Clicking the progress bar jumps there
    q(".ytpl-progress").addEventListener("click", (e) => {
      if (!deck.ready || !current()) return;
      const d = active().getDuration?.() || 0;
      const r = e.currentTarget.getBoundingClientRect();
      if (d) active().seekTo(((e.clientX - r.left) / r.width) * d, true);
    });

    function showPlaying() {
      const playing = deck.isPlaying();
      Icons.set(q(".yt-playpause"), playing ? "pause" : "play");
      tile.setStatus(playing ? "● playing" : "", "playing");
      showFade();
    }

    // =========================================================================
    // What the rest of the dashboard uses (same as a YouTube tile)
    // =========================================================================
    deck.isPlaying = () => deck.ready && (!!deck.xf || active().getPlayerState() === S().PLAYING);
    deck.currentVolume = () => deck.level;
    deck.setVolume = (v, persist = true) => {
      deck.level = Math.max(0, Math.min(100, Math.round(v)));
      deck.applyOutput();
      showVolume();
      if (persist) {
        deck.saved.volume = deck.level;
        save();
      }
    };
    deck.play = () => {
      if (!deck.ready) return;
      deck.wantPlay = true;
      if (!current()) return; // the list is still loading: it plays when it's there
      const p = active();
      const same = p.getVideoData?.()?.video_id === current().videoId;
      if (p.getPlayerState() === S().UNSTARTED || !same) {
        playAt(deck.pos, { play: true, fade: false, startSeconds: same ? Math.floor(p.getCurrentTime?.() || 0) : 0 });
      } else {
        p.playVideo();
        checkStarted();
      }
    };
    deck.pause = () => {
      deck.wantPlay = false;
      clearTimeout(deck.playCheck);
      endCrossfade();
      if (deck.ready) deck.players.forEach((p) => p.pauseVideo());
    };
    // { index, time } – which video (in playlist order) and how far in
    deck.position = () => {
      if (!deck.ready || !current()) return null;
      return { index: deck.order[deck.pos], time: Math.floor(active().getCurrentTime?.() || 0) };
    };
    deck.resume = (pos) => {
      if (!deck.ready) return;
      deck.wantPlay = true;
      if (!deck.items.length) {
        deck.pendingResume = pos; // the list is still loading
        return;
      }
      const k = deck.order.indexOf(pos?.index ?? deck.order[deck.pos]);
      playAt(k >= 0 ? k : deck.pos, { play: true, fade: false, startSeconds: pos?.time || 0 });
    };
    deck.displayName = () => tile.title();
    deck.setLoop = (on) => setRepeat(on ? "all" : "off"); // (scenes / older callers)

    function setRepeat(r) {
      deck.saved.repeat = r;
      showModes();
      showCurrent();
      save();
    }
    function setShuffle(on) {
      deck.saved.shuffle = !!on;
      makeOrder(true);
      showModes();
      showCurrent();
      save();
    }

    // Fade button: fade out then pause, or start and fade in (as on a YouTube tile)
    function showFade() {
      const out = deck.isPlaying() && deck.fadeDir !== "out";
      Icons.set(q(".yt-fade"), out ? "fadeout" : "fadein");
      q(".yt-fade").title = out ? "Fade out (then pause)" : "Fade in";
      q(".yt-fade").classList.toggle("on", !!deck.fadeDir);
    }
    deck.fadeToggle = async () => {
      if (!deck.ready || !current()) return;
      const ms = Mixer.fadeMs();
      if (deck.isPlaying() && deck.fadeDir !== "out") {
        deck.fadeDir = "out";
        showFade();
        if (await Mixer.fade(deck, 0, ms)) {
          deck.pause();
          deck.setVolume(deck.saved.volume, false);
          deck.fadeDir = null;
        }
      } else {
        deck.fadeDir = "in";
        showFade();
        if (!deck.isPlaying()) {
          deck.setVolume(0, false);
          deck.play();
        }
        if (await Mixer.fade(deck, deck.saved.volume, ms)) deck.fadeDir = null;
      }
      showFade();
    };

    // Load a link typed in, or chosen in the YouTube search window
    deck.loadUrl = (text, play = false, title) => {
      const target = YouTubePanel.parse(text);
      if (!target) {
        message("Couldn't find a playlist in that. Paste a YouTube playlist link (it has “list=” in it).", "error");
        showLinkBox(true);
        return;
      }
      q(".yt-url").value = text.trim();
      deck.saved.url = text.trim();
      deck.saved.index = 0;
      deck.saved.listTitle = title || "";
      tile.setTitle(title || "YouTube playlist");
      showLinkBox(false);
      save();
      endCrossfade();
      loadList(target, { play, startIndex: target.videoId ? null : 0 });
    };

    // ---- Buttons ----
    q(".yt-form").addEventListener("submit", (e) => {
      e.preventDefault();
      deck.loadUrl(q(".yt-url").value, false);
    });
    q(".yt-playpause").addEventListener("click", () => (deck.isPlaying() ? deck.pause() : deck.play()));
    q(".ytpl-next").addEventListener("click", () => { deck.errors = 0; advance(false); });
    q(".ytpl-prev").addEventListener("click", () => { deck.errors = 0; back(); });
    q(".yt-fade").addEventListener("click", () => deck.fadeToggle());
    q(".ytpl-shuffle").addEventListener("click", () => setShuffle(!deck.saved.shuffle));
    q(".ytpl-repeat").addEventListener("click", () => setRepeat(REPEATS[(REPEATS.indexOf(deck.saved.repeat) + 1) % REPEATS.length]));
    q(".ytpl-xf select").addEventListener("change", (e) => {
      deck.saved.crossfade = Number(e.target.value);
      save();
    });
    q(".yt-volume").addEventListener("input", (e) => {
      Mixer.claim(deck);
      deck.setVolume(Number(e.target.value));
    });

    // ---- Start ----
    YouTubePanel.addDeck(deck); // creates the players once YouTube's script is there
    if (deck.saved.url) {
      const t = YouTubePanel.parse(deck.saved.url);
      if (t) loadList(t, { play: false });
    }

    return {
      deck,
      save: () => ({ ...deck.saved }),
      // A scene switch kept this tile: take that scene's settings (scenes.js fades the volume)
      apply: (c) => {
        deck.saved.volume = c.volume ?? deck.saved.volume;
        deck.fadeDir = null;
        if (typeof c.shuffle === "boolean" && c.shuffle !== deck.saved.shuffle) setShuffle(c.shuffle);
        if (REPEATS.includes(c.repeat)) setRepeat(c.repeat);
        if (XFADES.includes(c.crossfade)) {
          deck.saved.crossfade = c.crossfade;
          q(".ytpl-xf select").value = String(c.crossfade);
        }
      },
      destroy: () => {
        clearInterval(ticker);
        clearTimeout(deck.playCheck);
        loadToken++;
        xfToken++;
        deck.players.forEach((p) => p?.destroy?.());
        YouTubePanel.removeDeck(deck);
      },
    };
  }

  function init() {
    Board.register("ytplaylist", {
      badge: "YouTube playlist",
      badgeClass: "y",
      icon: "ytlist",
      autoable: true,
      collapsedRows: 4, // collapsed: the title bar plus the controls row
      keepSize: true,
      // the same playlist in two scenes = the same tile (keeps playing)
      key: (c) => {
        const t = YouTubePanel.parse(c.url || "");
        return t ? t.listId || t.videoId || "" : "";
      },
      size: { w: 4, h: 26, minW: 3, minH: 12 },
      create(tile, config) {
        const inst = createTile(tile, config);
        if (config.title && !config.listTitle) tile.setTitle(config.title);
        return inst;
      },
    });
  }

  return { init };
})();
