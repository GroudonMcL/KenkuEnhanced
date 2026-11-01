# KenkuEnhanced

A dashboard for [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) that you open
**inside Kenku's own browser**, so everything it plays goes to Discord. One screen with:

- **Scenes**: one click (or a number key) switches music, soundboard sounds and YouTube
  together, with smooth fades.
- **Kenku control**: your playlists and soundboards as big buttons, play/pause/stop/next,
  volume, and what's playing now.
- **YouTube players**: as many as you like, each with its own volume and loop, so you can layer
  ambience under music. Paste a link, or **search YouTube** right in the dashboard.
- **Website panel**: embed any site that allows it (with a clear message when it doesn't).
- **Sound search**: search Freesound, listen to a preview, and download sounds straight into a
  folder on your PC, with the credits written down for you.

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

## Scenes
A scene remembers a mood: a Kenku playlist and its volume, soundboard sounds, YouTube videos
with their volumes, plus an optional link and notes.

**Make one:** get things playing the way you like (a playlist, some sounds, a YouTube video),
then click **＋ Save current as scene**. Give it a name, adjust anything you want, and click
**Save scene**.

**Use it:** click the scene button, or press its number key. While a scene fades in, its button
pulses; once it's active, it turns gold. Anything that changes fades out first, then the new
scene fades in. If the playlist or video is the same, it keeps playing and only the volume changes.

| Key | Does |
|---|---|
| `1` – `9` | Start scene 1 – 9 |
| `0` | Fade everything out (same as **🔇 Fade out all**) |

Keys only work while the dashboard has focus. After clicking inside a YouTube video or a
website, click an empty part of the dashboard first.

**Change one:** click **✎ Edit scenes**, then click a scene. You can rename it, change the
colour, delete it, or move it left or right (that changes its number key). Click
**✓ Done editing** when finished.

Good to know:
- **Fade (seconds)** is per scene. Soundboard sounds use their own fade settings from Kenku,
  because Kenku's remote control can only start and stop them.
- **"Leave the music as it is"** makes a scene that only changes sounds or YouTube, e.g. a
  "Thunderstorm" scene layered over whatever music is playing.
- **Link:** paste your Tabletop Audio SoundPad share link here. While the scene is active, a
  button opens it, or tick "open when the scene starts".
- Scenes are saved in the `data` folder (`data/scenes.json`). Copy that folder to back them up.
  The previous version is always kept as `scenes.backup.json`.

## Settings
Click **⚙ Settings** at the top right of the dashboard to change the Kenku address and port,
your API keys, the downloads folder and network access. Click **Save** and the changes apply
straight away; changing the dashboard port or network access needs a helper restart.

Behind the scenes, Settings writes to `config.json` in the project folder. You can edit that file
in Notepad too, but Settings avoids typing mistakes. If the file ever gets broken, Settings tells
you, and saving fixes it. The broken copy is kept as `config.broken.json`.

| Setting | Meaning |
|---|---|
| `port` | Dashboard port (default 4000) |
| `kenku.host` / `kenku.port` | Must match Kenku → Settings → Remote |
| `downloadsFolder` | where the Sound search panel saves sounds (and `ATTRIBUTION.csv`) |
| `apiKeys.youtube` | YouTube search key (see below) |
| `apiKeys.freesound` | Sound search key (see below) |
| `apiKeys.pixabay` | not used yet (Pixabay has no sound API) |
| `host` | `"0.0.0.0"` = "Allow other devices on my network" in Settings (e.g. a tablet). Off by default for safety |

`config.json` is never uploaded to GitHub (it's in `.gitignore`), so your keys stay private.

## YouTube search (optional, free)
Pasting links works without any setup. To **search** inside the dashboard you need a free
YouTube Data API key. Google has no other official way to search YouTube.

1. Go to <https://console.cloud.google.com/> and sign in with a Google account.
2. At the top, click the project picker → **New project** → name it `KenkuEnhanced` → **Create**.
3. Open <https://console.cloud.google.com/apis/library/youtube.googleapis.com>, make sure your
   new project is selected, and click **Enable**.
4. Go to **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. Recommended: click the key → under **API restrictions** choose **Restrict key** →
   tick **YouTube Data API v3** → **Save**.
6. In the dashboard, click **⚙ Settings**, paste the key into the **YouTube** box and click **Save**.
7. Click **Test** next to the key. It should say "✓ The YouTube key works".

The key stays in `config.json` on your PC. The browser never sees it, and it's never uploaded.
The free allowance is about **100 searches a day** (it resets at midnight US Pacific time). The
same search repeated within 30 minutes is free, because the helper remembers the results.
Search only shows videos that allow embedding.

## Sound search (optional, free)
The **Sounds** panel searches [Freesound](https://freesound.org), a huge library of free sound
effects and ambiences shared under Creative Commons licences. You need a free API key once:

1. Make a free account at <https://freesound.org> and confirm your email.
2. Open <https://freesound.org/apiv2/apply/>, fill in a name (e.g. `KenkuEnhanced`) and a short
   description (e.g. `Personal tabletop sound dashboard`), accept the terms and submit.
3. The page now lists your app. Copy the long value under **Client secret/Api key**
   (not the shorter Client id).
4. In the dashboard: **⚙ Settings** → paste it into the **Freesound** box → **Save** → **Test**.
   It should say "✓ The Freesound key works."

**Using it**
- Type what you want (`tavern crowd`, `sword clash`, `rain on tent`) and press **Search**.
  **Length** helps a lot: *Short effect* for one-off sounds, *Long ambience* for backgrounds.
- **▶ Preview** plays it, or click anywhere on the waveform to jump there. Previews play through
  the dashboard, so **in Kenku your players hear them too**. Turn down **Preview volume**, or
  preview before the session.
- **⬇ Download** saves an MP3 into your downloads folder (set it in ⚙ Settings). Type a
  **subfolder** like `Ambience` or `Combat` first to keep things sorted. Files get tidy names like
  `heavy-rain-on-roof_freesound-12345.mp3`, and a sound you already have shows **✓ Saved**.
- **📂 Open folder** opens that folder on your PC. Kenku can't add files through its remote
  control, so **drag the files from that window into a Kenku playlist or soundboard**.

**Credits and licences.** Each result shows its licence:
- **CC0** (green): public domain, use it however you like.
- **CC BY**: free to use, but credit the author if you share or publish something with it
  (a stream VOD, a YouTube video, an actual-play podcast).
- **CC BY-NC**: as CC BY, and non-commercial use only.

Every download is added to `ATTRIBUTION.csv` in the downloads folder (file, title, author,
licence, link, date). It opens in Excel; copy from it when you need to give credit.

Good to know:
- Downloads are Freesound's high-quality MP3 previews (about 128 kbps), which sound fine on
  Discord. Original WAV files need a full Freesound login, which isn't supported yet.
- The free key allows 60 searches a minute and 2000 a day, far more than a session needs.
  Repeating a search within 30 minutes doesn't count.
- **BBC Sound Effects ↗** and **Pixabay ↗** open those sites' own search in a new tab (neither has
  an API we can use). BBC sounds are free for **personal, educational and research use only**.
  If downloading doesn't work inside Kenku's browser, open the site in your normal browser and
  save the file into your downloads folder yourself.

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
| `Could not read config.json` when starting | A quote, comma or bracket got lost while editing. Compare with `config.example.json`, or delete `config.json` (a fresh one is made on the next start) and add your key again |
| Search says "No YouTube API key yet" | Follow **YouTube search** above, then restart the helper |
| Search says the quota is used up | Wait until the next day, or paste links directly (that never uses quota) |
| Sounds says "Freesound rejected the API key" | You probably copied the Client id. Use the longer **Client secret/Api key** from <https://freesound.org/apiv2/apply/> |
| Sound downloads fail with "Couldn't create …" | The downloads folder in ⚙ Settings doesn't exist or isn't writable. Pick another folder, tick "Create the folder" and Save |
| "Saved, but couldn't add it to ATTRIBUTION.csv" | The file is open in Excel, which locks it. Close Excel; the sound itself was saved |
| **📂 Open folder** does nothing | The window may have opened behind Kenku. Check the taskbar |

## Project layout
```
helper/       Node.js helper server (Express)
  server.js     dashboard files, /kenku proxy, /health, /api/*
  config.js     reads config.json
  check-kenku.js, mock-kenku.js
  scenes.js     saves scenes to data/scenes.json
  sounds.js     Freesound search + download, ATTRIBUTION.csv
dashboard/    the web page (plain HTML/CSS/JS, no build step)
data/         your scenes (created automatically, not uploaded to GitHub)
docs/         PLAN.md (roadmap), kenku-remote-api.md (verified API reference)
```

## Licence
GPL-3.0, the same as Kenku FM. Not affiliated with Kenku FM, Owlbear Rodeo, YouTube or Tabletop Audio.
