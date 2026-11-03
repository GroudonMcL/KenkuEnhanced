// vibe.js – Phase 5: Image → vibe.
//
// Give it a picture (a map, a scene illustration, a photo) or type some words,
// and it suggests what to play: your matching scenes, Tabletop Audio SoundPads,
// and ready-made Freesound / YouTube searches.
//
// Pictures are recognised in the browser by CLIP, an AI model that scores how
// well a picture fits a sentence ("a cozy medieval tavern interior..."). We ask
// it about every entry in vibe-words.js and keep the best matches. It runs on
// this PC (no account, no upload, free), using Transformers.js. The model files
// (~150 MB) are downloaded once through the helper and kept in data/models.

const Vibe = (() => {
  const $ = (id) => document.getElementById(id);
  const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
  const MODEL = "Xenova/clip-vit-base-patch32";
  const GROUPS = ["place", "weather", "time", "mood"];

  // ===========================================================================
  // Words: look up any word or synonym → its vibe-words entry
  // ===========================================================================
  const entries = GROUPS.flatMap((g) => VIBE_WORDS[g].map((e) => ({ ...e, group: g })));
  const byWord = new Map();
  for (const e of entries) {
    for (const w of [e.tag, ...e.words]) if (!byWord.has(w)) byWord.set(w, e);
  }
  const clean = (w) => String(w || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const entryFor = (w) => byWord.get(clean(w)) || null;
  // "Inn" → "tavern", "Thunder" → "storm", unknown words stay as they are
  const canonical = (w) => entryFor(w)?.tag || clean(w);

  // "tavern, rain; night" → ["tavern", "rain", "night"]
  function parseWords(text) {
    return [...new Set(String(text || "").split(/[,;\n]+/).map(clean).filter(Boolean))];
  }

  // ===========================================================================
  // The picture model
  // ===========================================================================
  let T = null;                       // the Transformers.js library
  let vision = null;                  // { processor, model }
  let text = null;                    // { tokenizer, model }
  let loadingVision = null;
  // Sentence → numbers, remembered so the text half of the model only loads once.
  const EMBED_KEY = "vibe.textEmbeds." + MODEL;
  const textEmbeds = Store.get(EMBED_KEY, {});

  // Download progress across all model files → one percentage
  const progressFiles = {};
  function onProgress(p) {
    if (p.status !== "progress" || !p.total) return;
    progressFiles[p.file] = { loaded: p.loaded, total: p.total };
    const all = Object.values(progressFiles);
    const loaded = all.reduce((a, f) => a + f.loaded, 0);
    const total = all.reduce((a, f) => a + f.total, 0);
    if (total > 5e6) {
      status(`Downloading the picture model (first time only, ~150 MB): ${Math.floor((loaded / total) * 100)}% of ${Math.round(total / 1e6)} MB…`, "warn");
    }
  }

  async function lib() {
    if (T) return T;
    try {
      T = await import(LIB_URL);
    } catch {
      throw new Error("Couldn't load the picture recogniser. You need to be online the first time.");
    }
    // Model files come from our helper (which keeps a copy in data/models), never straight from the web.
    T.env.allowRemoteModels = false;
    T.env.allowLocalModels = true;
    T.env.localModelPath = "/models/";
    return T;
  }

  function loadVision() {
    loadingVision ||= (async () => {
      const t = await lib();
      const [processor, model] = await Promise.all([
        t.AutoProcessor.from_pretrained(MODEL),
        t.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8", progress_callback: onProgress }),
      ]);
      vision = { processor, model };
    })().catch((err) => {
      loadingVision = null;
      throw err;
    });
    return loadingVision;
  }

  const normalise = (v) => {
    const len = Math.hypot(...v) || 1;
    return v.map((x) => x / len);
  };

  // Numbers for each sentence (cached in this browser).
  async function embedSentences(sentences) {
    const missing = sentences.filter((s) => !textEmbeds[s]);
    if (missing.length) {
      if (!text) {
        const t = await lib();
        const [tokenizer, model] = await Promise.all([
          t.AutoTokenizer.from_pretrained(MODEL),
          t.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8", progress_callback: onProgress }),
        ]);
        text = { tokenizer, model };
      }
      const inputs = text.tokenizer(missing, { padding: true, truncation: true });
      const { text_embeds } = await text.model(inputs);
      const rows = text_embeds.tolist();
      missing.forEach((s, i) => {
        textEmbeds[s] = normalise(rows[i]).map((x) => Math.round(x * 1e5) / 1e5);
      });
      Store.set(EMBED_KEY, textEmbeds);
    }
    return sentences.map((s) => textEmbeds[s]);
  }

  // Picture (Blob) → { place: [{tag, p}, ...best first], weather: [...], ... }
  async function recognise(blob) {
    await loadVision();
    const image = await T.RawImage.fromBlob(blob);
    const inputs = await vision.processor(image);
    const { image_embeds } = await vision.model(inputs);
    const img = normalise(Array.from(image_embeds.data));

    const scores = {};
    for (const g of GROUPS) {
      const list = VIBE_WORDS[g];
      const vecs = await embedSentences(list.map((e) => e.prompt));
      // CLIP's usual scoring: similarity × 100, then softmax → chances that add up to 1
      const logits = vecs.map((v) => 100 * v.reduce((a, x, i) => a + x * img[i], 0));
      const max = Math.max(...logits);
      const exps = logits.map((l) => Math.exp(l - max));
      const sum = exps.reduce((a, b) => a + b, 0);
      scores[g] = list.map((e, i) => ({ tag: e.tag, p: exps[i] / sum })).sort((a, b) => b.p - a.p);
    }
    return scores;
  }

  // Keep the confident ones.
  function pickTags(scores) {
    const out = [];
    const [p1, p2] = scores.place;
    if (p1.p >= 0.12) out.push(p1.tag);
    if (p2 && p2.p >= 0.25) out.push(p2.tag);
    const w = scores.weather[0];
    if (w.tag !== "clear" && w.p >= 0.45) out.push(w.tag);
    const t = scores.time[0];
    if (t.tag === "night" && t.p >= 0.65) out.push("night");
    const [m1, m2] = scores.mood;
    out.push(m1.tag);
    if (m2 && m2.p >= 0.3) out.push(m2.tag);
    return [...new Set(out)];
  }

  // ===========================================================================
  // Matching
  // ===========================================================================
  // How well does a scene fit? Its tags count fully, words in its name/notes half.
  function scoreScene(scene, vibe) {
    const tagSet = new Set((scene.tags || []).map(canonical));
    const nameText = clean(`${scene.name} ${scene.notes || ""}`);
    let score = 0;
    const hits = [];
    for (const v of vibe) {
      const e = entryFor(v);
      const weight = e?.group === "place" ? 3 : 1;
      if (tagSet.has(v)) {
        score += weight;
        hits.push(v);
      } else if ([v, ...(e?.words || [])].some((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(nameText))) {
        score += weight / 2;
        hits.push(v);
      }
    }
    return { score, hits };
  }

  function scoreSoundpad(pad, vibe) {
    const hay = clean(`${pad.name} ${pad.description} ${pad.categories.join(" ")}`);
    let score = 0;
    for (const v of vibe) {
      const e = entryFor(v);
      if ([v, ...(e?.words || [])].some((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(hay))) {
        score += e?.group === "place" ? 2 : 1;
      }
    }
    return score;
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ===========================================================================
  // The dialog
  // ===========================================================================
  let lastScores = null;
  let previewUrl = null;
  let runId = 0;

  function status(msg, kind = "warn") {
    const box = $("vibe-status");
    box.hidden = !msg;
    box.className = `notice notice-${kind}`;
    box.textContent = msg || "";
  }

  function open() {
    status(null);
    $("vibe-dialog").showModal();
    $("vibe-words").focus();
    showResults();
  }

  async function usePicture(blob) {
    if (!blob || !/^image\//.test(blob.type)) return status("That isn't a picture.", "error");
    const id = ++runId;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    $("vibe-preview").src = previewUrl;
    $("vibe-drop").classList.add("has-image");
    status(vision ? "Looking at the picture…" : "Starting the picture recogniser…");
    try {
      const scores = await recognise(blob);
      if (id !== runId) return; // a newer picture arrived meanwhile
      lastScores = scores;
      $("vibe-words").value = pickTags(scores).join(", ");
      status(null);
      showResults();
    } catch (err) {
      if (id === runId) status(err.message || String(err), "error");
    }
  }

  async function usePictureUrl(url) {
    url = url.trim();
    if (!url) return;
    status("Fetching the picture…");
    try {
      const r = await fetch("/api/vibe/image?url=" + encodeURIComponent(url));
      if (!r.ok) throw new Error((await r.json()).error);
      usePicture(await r.blob());
    } catch (err) {
      status(err.message, "error");
    }
  }

  // "Recognised: tavern 62% · camp 14% | night 80% | ..."
  function renderScores() {
    const box = $("vibe-scores");
    box.hidden = !lastScores;
    if (!lastScores) return;
    const pct = (x) => `${Math.round(x.p * 100)}%`;
    box.textContent = "What the picture looks like: " + GROUPS
      .map((g) => lastScores[g].slice(0, g === "place" || g === "mood" ? 3 : 1).map((x) => `${x.tag} ${pct(x)}`).join(", "))
      .join("  ·  ");
  }

  function button(textContent, onClick, cls = "small") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = textContent;
    b.onclick = onClick;
    return b;
  }

  function showResults() {
    renderScores();
    const vibe = parseWords($("vibe-words").value).map(canonical);
    const out = $("vibe-results");
    out.innerHTML = "";
    if (!vibe.length) {
      out.innerHTML = '<p class="hint">Add a picture or type some words (e.g. <i>tavern, night, cheerful</i>) to get suggestions.</p>';
      return;
    }
    const section = (title) => {
      const h = document.createElement("h3");
      h.textContent = title;
      const row = document.createElement("div");
      row.className = "vibe-row";
      out.append(h, row);
      return row;
    };

    // Your scenes
    const scenes = Scenes.list()
      .map((s) => ({ s, ...scoreScene(s, vibe) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const sceneRow = section("Your scenes");
    if (!scenes.length) {
      sceneRow.innerHTML = '<span class="hint">No scene matches yet. Give your scenes tags (✎ Edit scenes), or make one below.</span>';
    }
    for (const { s, hits } of scenes) {
      const b = button(`▶ ${s.name}`, () => {
        $("vibe-dialog").close();
        Scenes.activate(s);
      }, "mid vibe-scene");
      b.style.setProperty("--scene-color", s.color || "#888");
      b.title = `Matches: ${hits.join(", ")}`;
      sceneRow.appendChild(b);
    }
    sceneRow.appendChild(button("＋ New scene with these tags", () => {
      $("vibe-dialog").close();
      Scenes.createWithTags(vibe);
    }, "mid"));

    // Tabletop Audio SoundPads
    const pads = Links.soundpads()
      .map((p) => ({ p, score: scoreSoundpad(p, vibe) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (pads.length) {
      const padRow = section("Tabletop Audio SoundPads");
      for (const { p } of pads) {
        // A tile when the pass-through can show it, otherwise a Kenku tab
        const inTile = !EmbedPanel.isBlocked(p.url);
        const b = button(inTile ? `＋ ${p.name}` : `${p.name} ↗`, () => {
          $("vibe-dialog").close?.();
          Links.open(p.url, undefined, { newTile: true });
        });
        b.title = p.description;
        padRow.appendChild(b);
      }
    }

    // Searches
    const searchRow = section("Search for sounds");
    for (const v of vibe) {
      const e = entryFor(v);
      const q = e ? e.sound : v;
      if (!q) continue;
      searchRow.appendChild(button(`🔎 ${q}`, () => {
        $("vibe-dialog").close();
        SoundsPanel.search(q);
      }));
    }
    if (!searchRow.children.length) searchRow.innerHTML = '<span class="hint">Add a place or weather word to search for sounds.</span>';

    const ytRow = section("Search YouTube");
    const placeish = vibe.filter((v) => ["place", "weather", "time"].includes(entryFor(v)?.group) || !entryFor(v));
    const moods = vibe.filter((v) => entryFor(v)?.group === "mood");
    const ambience = [...placeish.slice(0, 3), "ambience"].join(" ");
    const music = [...moods.slice(0, 1), ...placeish.slice(0, 1), "fantasy music"].join(" ");
    for (const q of [ambience, music]) {
      ytRow.appendChild(button(`▶ ${q}`, () => {
        $("vibe-dialog").close();
        YouTubePanel.searchFor(q);
      }));
    }
  }

  // ===========================================================================
  function init() {
    $("vibe-open").addEventListener("click", open);
    $("vibe-close").addEventListener("click", () => $("vibe-dialog").close());
    $("vibe-words").addEventListener("input", showResults);
    $("vibe-file").addEventListener("change", (e) => {
      usePicture(e.target.files[0]);
      e.target.value = ""; // so choosing the same file again still works
    });
    $("vibe-choose").addEventListener("click", () => $("vibe-file").click());
    $("vibe-url-go").addEventListener("click", () => usePictureUrl($("vibe-url").value));
    $("vibe-url").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        usePictureUrl($("vibe-url").value);
      }
    });
    // Enter in the words box shouldn't close the window
    $("vibe-words").addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });

    // Drag a picture onto the box (from your files or from another browser window)
    const drop = $("vibe-drop");
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
      if (file) return usePicture(file);
      const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (url) usePictureUrl(url.split("\n")[0]);
    });

    // Paste a picture (Ctrl+V) while the Vibe window is open
    document.addEventListener("paste", (e) => {
      if (!$("vibe-dialog").open) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        usePicture(item.getAsFile());
      }
    });
  }

  return { init, open, parseWords, canonical };
})();
