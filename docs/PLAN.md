# KenkuEnhanced – Project Plan

## Big picture

```
 Kenku FM (desktop app)
 ├── Remote API  http://127.0.0.1:3333   (no CORS headers)
 └── Built-in browser ──opens──► http://localhost:4000  (our dashboard)
                                        │
                     helper (Node/Express, port 4000)
                     ├── serves dashboard/ (static files)
                     ├── /kenku/*  → proxies to Kenku Remote, adds CORS
                     ├── /health   → is Kenku reachable?
                     └── /api/*    → our own features (version check, frame check,
                                     scenes, sound search + downloads; later: tagging)
```

Everything the dashboard does goes through the helper, so the helper is where
API keys live (they never reach the browser) and where files get written to disk.

## Phases

### Phase 1 – foundation (built)
- Helper server with Kenku proxy, `/health`, `/api/version` (update check), `/api/frame-check`.
- `npm run check-kenku` probe script, plus `npm run mock-kenku` fake Kenku for testing.
- Dashboard: three resizable panels (Kenku control, YouTube, embed-a-site), dark theme,
  layout + URLs saved in localStorage.
- Windows double-click launcher.

### Phase 1.5 – polish (built)
- Multiple YouTube players (rename, minimise, own volume/loop) and in-app YouTube search
  (`/api/youtube/search`, key in Settings).
- Settings pane (`/api/settings`): Kenku address, API keys, downloads folder, LAN access.

### Phase 2 – Scenes (built)
- A scene = `{ name, color, fadeSeconds, music: {mode, playlistId, volume},
  sounds: {ids, stopOthers}, youtube: {players: [{url, volume, loop}], stopOthers}, link, linkAuto, notes }`.
- Stored by the helper in `data/scenes.json` (+ `scenes.backup.json`).
- Switching: fade out what changes → switch → fade in. Same playlist/video keeps playing.
  Kenku only exposes the *playlist* volume, so soundboard sounds just start/stop
  (their own fadeIn/fadeOut settings in Kenku apply). YouTube volumes fade fully.
- "Save current as scene" captures what's playing. Keys 1–9 = scenes, 0 = fade out all.
- Ideas for later: per-scene hotkeys beyond 1–9, crossfade (overlap) instead of out-then-in,
  scene groups/tabs per campaign, export/import scenes.

### Phase 3 – Sound search & download (built)
- Helper routes in `helper/sounds.js`: `/api/sounds/search` (q, length, sort, page),
  `/api/sounds/download` ({id, subfolder}), `/api/sounds/folders`, `/api/sounds/open-folder`,
  `/api/sounds/test-key`.
- Source: **Freesound** (API key, CC licences). With a plain key only the HQ MP3 previews
  (~128 kbps) can be downloaded; originals need OAuth2 (possible later).
  The helper re-fetches the sound's details by id before downloading, so attribution is
  right and it only ever downloads from Freesound.
- Files go to `downloadsFolder[/subfolder]` as `rain-heavy_freesound-12345.mp3`, and a row is
  appended to `downloadsFolder/ATTRIBUTION.csv` (file, title, author, source, licence,
  licence_url, source_url, downloaded). Already-downloaded sounds are detected by the
  `_freesound-<id>` suffix.
- **Pixabay**: its API only covers images and videos, so no integration – just a link to
  its sound-effects search. **BBC Sound Effects**: no public API and the RemArc licence is
  personal/educational/research only – also just a link.
- Kenku can't import tracks via API, so you drag the downloaded files into a Kenku
  playlist/soundboard (📂 Open folder helps) – until a possible Kenku fork.
- Ideas for later: Freesound OAuth for original files, "similar sounds", licence filter,
  a downloads browser that adds sounds to scenes once Kenku can import.

### Phase 4 – Tabletop Audio links (built)
- **Finding:** tabletopaudio.com sends `X-Frame-Options: SAMEORIGIN`, so SoundPads can't be
  shown in the embed panel. They open in a new Kenku tab instead (its audio still reaches
  Discord).
- **Finding:** Kenku's `setWindowOpenHandler` turns every `window.open` into a new tab and
  ignores target names, so a tab can't be reused. Scenes therefore auto-open a link at most
  once per dashboard visit (the "↗ Open scene link" button always opens it).
- Saved links library: `data/links.json` via `/api/links` (`{id, name, url, openIn:
  auto|panel|tab}`), shown as buttons in the Website panel with ☆ Save / ✎ Edit links.
  "Auto" uses the panel unless the host is known to block framing (the frame check
  remembers blocked hosts in localStorage, with tabletopaudio.com built in).
- SoundPad browser: `/api/links/soundpads` reads the list of SoundPads (name, picture, sound
  count, categories) from `soundpad.html` once a day, cached in `data/soundpads.json` for
  offline use. If the page layout changes, it falls back to a plain link.
- Scene editor: a menu with your saved links and all SoundPads fills the scene's link.
- `helper/datafile.js` now does the safe write + backup for scenes and links.
- **No scraping/downloading of SoundPad audio** (not CC-licensed). Only the public list
  page is read.
- Ideas for later: several links per scene, a "close the old SoundPad tab" helper if a Kenku
  fork ever exposes tab control.
- **Experimental pass-through (off by default):** `helper/tta-proxy.js` serves
  tabletopaudio.com on port+1 without `X-Frame-Options`/CSP, and `/_sounds/*` →
  sounds.tabletopaudio.com with `Origin: https://tabletopaudio.com` (that server answers 403
  to any other origin, and CreateJS loads sounds via XHR/Web Audio, so it needs CORS). Page,
  JS and CSS text is rewritten so sound URLs point at `/_sounds/`. Own port = own origin, so
  third-party scripts in the page can't call the dashboard's `/api`. Only those two hosts,
  GET/HEAD only, streamed with Range support, nothing cached to disk. Tested: Vikings
  SoundPad loads all 40 sounds and plays (Web Audio output measured). Not yet tested in
  Kenku itself; fragile if Tabletop Audio changes their site.

### Phase 5 – Image → vibe (built)
- **Step 1, tags:** scenes have `tags: [...]` (scene editor → Tags). The ✨ Vibe dialog takes
  words and suggests matching scenes (tags count fully, name/notes half, places weigh more),
  SoundPads (name/description/categories), Freesound searches (one per word, using each
  word's `sound` query) and two YouTube searches (ambience + music). It can also make a
  "new scene with these tags" from what's playing.
- **Step 2, automatic tags:** CLIP zero-shot in the browser (Transformers.js 4.3.2 from
  jsDelivr, `Xenova/clip-vit-base-patch32`, q8 text + vision models ≈ 153 MB).
  - Model files go through the helper's `/models/*` route, which downloads them once from
    Hugging Face into `data/models` (streaming to the page so progress shows). It works
    offline afterwards and survives clearing the browser.
  - The vocabulary is `dashboard/js/vibe-words.js`: groups place/weather/time/mood, each
    entry with a CLIP prompt and synonyms. Softmax is taken per group, then confident
    picks are kept.
  - Prompt embeddings are cached in localStorage, so after the first run only the vision
    model is needed.
  - Pictures come from file / drag-drop / paste / URL. A URL is fetched through
    `/api/vibe/image`, because the page can't read other sites' pictures.
- Not done: a cloud vision API (e.g. Claude) for richer descriptions. Possible later as an
  optional provider with a key in Settings.
- Ideas for later: "✨ from picture" inside the scene editor, a per-campaign vocabulary, and
  using the YouTube/Freesound results' own tags to learn better words.

### Phase 6 – Packaging & updates (built)
- **Release build:** `.github/workflows/release.yml` runs on a Windows runner when a `v*` tag
  is pushed (or by hand, build-only). It checks the tag matches `package.json`, runs
  `npm ci --omit=dev`, bundles `node.exe` (Node 22) into `node/`, smoke-tests the helper from
  the release folder, then makes:
  - `KenkuEnhanced-vX.Y.Z-windows.zip` (portable, 7-Zip);
  - `KenkuEnhanced-Setup-vX.Y.Z.exe` (Inno Setup, `installer/KenkuEnhanced.iss`);
  - `SHA256SUMS.txt`.
  It then publishes the GitHub release. See `docs/RELEASING.md`.
- **Installer:** per-user, no admin (`%LOCALAPPDATA%\Programs\KenkuEnhanced`), so the app can
  update itself. Start menu / desktop / "start at sign-in" shortcuts. Uninstall leaves the
  user's `config.json`, `data/` and `downloads/`.
- **Launcher:** `Start KenkuEnhanced.bat` prefers the bundled `node\node.exe` and skips
  `npm install` in release builds. It closes its window when the helper exits with code 75
  (an update is in progress).
- **One-click update** (`helper/update.js` + `helper/updater.js`):
  1. `/api/version` → badge → update window with release notes → `/api/update/install`.
  2. The helper downloads the zip, verifies its SHA-256 and unzips it into `update/staging`
     (Windows `tar.exe`, falling back to PowerShell).
  3. It starts the *new* updater with the *new* `node.exe` (so the old one isn't locked),
     then exits.
  4. The updater moves old files to `update/backup-*`, copies the new ones in (never
     `config.json`, `data/`, `downloads/`), rolls back on failure, and restarts the helper.
  5. The page waits for `/health` to report the new version, then reloads.

  Git checkouts are detected and told to `git pull` instead.
- Not done: code signing (needs a paid certificate, so SmartScreen warns). Also the version
  shown in Windows' "Installed apps" only changes when Setup.exe is run, not after a
  one-click update.
- Considered and skipped: Node SEA and an Electron wrapper. Bundling plain `node.exe` is
  simpler, and the app is a server plus a page opened inside Kenku anyway.

### Maybe – Kenku fork
- Split browser views; an "import file to playlist" endpoint.

## Kenku API limits that shape the design
See `kenku-remote-api.md`. Key ones: no playlist stop (we pause + seek 0),
no per-sound volume, no adding tracks.
