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
                                     later: sound search, downloads, scenes, tagging)
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

### Phase 2 – Scenes
- A scene = `{ name, playlistId, sounds: [soundId...], volume, soundpadLink?, tags? }`.
- Stored by the helper in `data/scenes.json` (not localStorage), so they survive a
  browser reset and can be backed up.
- "Fade": Kenku's API only exposes the *playlist* volume, so fade = step the playlist
  volume down over ~2s, switch playlist, step it up. Soundboard sounds can only be
  started/stopped (their own fadeIn/fadeOut settings in Kenku apply).
- Hotkeys (Phase 2b): number keys 1–9 trigger scenes; space = play/pause.

### Phase 3 – Sound search & download
- Helper routes `/api/search?source=freesound&q=rain`, `/api/download`.
- Sources: Freesound (API key, CC licences), Pixabay (API key), BBC Sound Effects
  (check licence terms – RemArc licence is personal/educational only).
- Preview in the browser, then download to `downloadsFolder` with tidy names
  like `rain-heavy_freesound-12345.mp3`, and append to `downloadsFolder/ATTRIBUTION.csv`
  (file, source, author, licence, URL, date).
- Kenku can't import tracks via API, so you add the downloaded files into a Kenku
  playlist manually (or point a playlist at the folder) – until a possible Kenku fork.

### Phase 4 – Tabletop Audio links
- Save custom SoundPad share links per scene; open them in the embed panel.
- **No scraping/downloading of SoundPad audio** (not CC-licensed).

### Phase 5 – Image → vibe
- Step 1: manual tags typed per scene → search sounds / suggest a scene.
- Step 2: automatic tags, either Transformers.js CLIP zero-shot in the browser
  (free, offline, slower first load) or a cloud vision API via the helper (key in config).

### Phase 6 – Packaging & updates
- Today: `Start KenkuEnhanced.bat` + a "new version available" badge (GitHub releases).
- Later: a Setup.exe (Node bundled, e.g. Node SEA + Inno Setup, or Electron wrapper)
  with one-click update from GitHub Releases.

### Maybe – Kenku fork
- Split browser views; an "import file to playlist" endpoint.

## Kenku API limits that shape the design
See `kenku-remote-api.md`. Key ones: no playlist stop (we pause + seek 0),
no per-sound volume, no adding tracks.
