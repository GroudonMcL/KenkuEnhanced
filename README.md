# KenkuEnhanced

A dashboard for [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) that you open
**inside Kenku's own browser**, so everything it plays goes to Discord. One screen with:

- **Kenku control**: your playlists and soundboards as big buttons, play/pause/stop/next,
  volume, and what's playing now.
- **YouTube player**: paste a video or playlist link.
- **Website panel**: embed any site that allows it (with a clear message when it doesn't).

You can drag the panels to resize them and show or hide each one. The dashboard remembers
your layout and links.

```
Kenku FM ── built-in browser ──► http://localhost:4000 (this dashboard)
   ▲                                      │
   └── Remote API :3333 ◄── helper ◄──────┘   (the helper fixes the CORS problem)
```

---

## Setup on Windows (first time, about 5 minutes)

### 1. Install Node.js (once)
Node.js runs the small "helper" program that sits between the dashboard and Kenku.
1. Go to <https://nodejs.org> and download the **LTS** version.
2. Run the installer and keep all the default options.

### 2. Get this project
- On the GitHub page click **Code → Download ZIP**, then unzip it somewhere easy,
  e.g. `Documents\KenkuEnhanced`.
  *(If you use Git: `git clone https://github.com/GroudonMcL/KenkuEnhanced.git`)*

### 3. Turn on Kenku Remote
In Kenku FM open **Settings** (the cog) → **Remote** → switch it **on**.
Keep the default address `127.0.0.1` and port `3333`.

### 4. Start the helper
Double-click **`Start KenkuEnhanced.bat`**. A black window opens. The first time, it
installs what it needs (about 30 seconds), then shows:

```
  KenkuEnhanced helper is running.
  Dashboard:  http://localhost:4000
```

**Leave that window open** while you play. Close it to stop the helper.

> Windows may show "Windows protected your PC" the first time. Click **More info → Run anyway**.
> That happens because the file isn't signed; you can open it in Notepad to see exactly what it does.

### 5. Open the dashboard in Kenku
In Kenku FM, click **+** to open a new browser tab, type `http://localhost:4000` and press Enter.
The pill at the top should turn green: **Kenku connected**.

---

## Using a terminal instead (optional)
In the project folder, click the address bar in File Explorer, type `cmd` and press Enter. Then:

```bash
npm install
```
installs the libraries (only needed once, or after updating).

```bash
npm start
```
starts the helper (same as the .bat file).

```bash
npm run check-kenku
```
tests Kenku Remote directly and prints what it finds (it only reads, nothing plays).

```bash
npm run mock-kenku
```
starts a **fake** Kenku so you can try the dashboard with Kenku closed.
Run it in a second window, with the real Kenku closed, because both use port 3333.

## Settings: `config.json`
Created automatically on first start from `config.example.json`. Edit it with Notepad,
then restart the helper.

| Setting | Meaning |
|---|---|
| `port` | Dashboard port (default 4000) |
| `kenku.host` / `kenku.port` | Must match Kenku → Settings → Remote |
| `downloadsFolder` | (later) where downloaded sounds are saved; point a Kenku playlist here |
| `apiKeys` | (later) Freesound / Pixabay keys |
| `host` | Optional. `"0.0.0.0"` lets other devices on your network (e.g. a tablet) use the dashboard. Off by default for safety |

`config.json` is never uploaded to GitHub (it's in `.gitignore`), so your keys stay private.

## Updating
When a new version is released, an **"Update available"** badge appears at the top of the
dashboard. To update for now:
1. Close the helper window.
2. Download the new ZIP and unzip it over the old folder (your `config.json` is kept,
   because the ZIP doesn't contain one).
3. Double-click `Start KenkuEnhanced.bat` again. It installs any new libraries by itself.

A proper installer with one-click updates is planned (see `docs/PLAN.md`).

## Troubleshooting
| Problem | Fix |
|---|---|
| Pill says **Kenku not reachable** | Kenku isn't open, or Remote is off, or the port differs from `config.json`. Run `npm run check-kenku` |
| Pill says **Helper offline** | The black helper window was closed. Start it again |
| `Port 4000 is already in use` | The helper is already running in another window, or change `port` in `config.json` |
| A website shows "can't be shown inside the dashboard" | That site forbids embedding. Use **↗ New tab**, which opens it as a Kenku tab so its audio still reaches Discord |
| YouTube says "doesn't allow it to be embedded" | The uploader disabled embedding. Use the **Open on YouTube in a new tab** button |

## Project layout
```
helper/       Node.js helper server (Express)
  server.js     dashboard files, /kenku proxy, /health, /api/*
  config.js     reads config.json
  check-kenku.js, mock-kenku.js
dashboard/    the web page (plain HTML/CSS/JS, no build step)
docs/         PLAN.md (roadmap), kenku-remote-api.md (verified API reference)
```

## Licence
GPL-3.0, the same as Kenku FM. Not affiliated with Kenku FM, Owlbear Rodeo, YouTube or Tabletop Audio.
