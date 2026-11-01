# KenkuEnhanced

A dashboard for [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) that you open
**inside Kenku's own browser**, so everything it plays goes to Discord. One screen with:

- **Scenes**: one click (or a number key) switches music, soundboard sounds and YouTube
  together, with smooth fades.
- **Kenku control**: your playlists and soundboards as big buttons, play/pause/stop/next,
  volume, and what's playing now.
- **YouTube players**: as many as you like, each with its own volume and loop, so you can layer
  ambience under music. Paste a link, or **search YouTube** right in the dashboard.
- **Website panel**: embed any site that allows it (with a clear message when it doesn't),
  plus **saved link buttons** and a browser for **Tabletop Audio's SoundPads**.
- **✨ Vibe**: show it a picture (a map, scene art) or type a few words, and it suggests
  matching scenes, Tabletop Audio SoundPads and sound / YouTube searches.
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

### 1. Install KenkuEnhanced
1. Open the [Releases page](https://github.com/GroudonMcL/KenkuEnhanced/releases) and, under the
   newest version, download **`KenkuEnhanced-Setup-vX.Y.Z.exe`**.
2. Run it. Windows may say **"Windows protected your PC"**, because the installer isn't signed (that
   costs money every year). Click **More info → Run anyway**.
3. Click through the installer. It doesn't need administrator rights and includes everything
   (Node.js too). You can tick **Start the helper automatically when I sign in to Windows**.

It installs into `%LOCALAPPDATA%\Programs\KenkuEnhanced` and adds **KenkuEnhanced** to the Start
menu (and the desktop, if you leave that ticked).

<details>
<summary>Other ways: portable ZIP, or the source code</summary>

- **Portable, no installer:** download **`KenkuEnhanced-vX.Y.Z-windows.zip`** from the same page,
  unzip it somewhere easy (e.g. `Documents\KenkuEnhanced`), and use **`Start KenkuEnhanced.bat`**
  inside it. It also includes Node.js and can update itself.
- **Source code** (GitHub's green **Code → Download ZIP**, or `git clone`): you need
  [Node.js](https://nodejs.org) (the **LTS** version) installed first. `Start KenkuEnhanced.bat`
  installs the libraries on the first run. These copies can't update themselves (see **Updating**).
</details>

### 2. Turn on Kenku Remote
In Kenku FM open **Settings** (the cog) → **Remote** → switch it **on**.
Keep the default address `127.0.0.1` and port `3333`.

### 3. Start the helper
Start **KenkuEnhanced** from the Start menu or desktop (or double-click **`Start KenkuEnhanced.bat`**
in its folder). A black window opens and shows:

```
  KenkuEnhanced helper is running.
  Dashboard:  http://localhost:4000
```

**Leave that window open** while you play. Close it to stop the helper.

> The window **is** the helper. If you close it, the dashboard stops working until you start it again.

### 4. Open the dashboard in Kenku
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
- **Link:** pick one of your saved links or a Tabletop Audio SoundPad from the menu, or paste
  any address (e.g. your Custom SoundPad share link). While the scene is active, a button opens
  it. Tick "open the link when the scene starts" to open it automatically. See
  **Links and Tabletop Audio** below for where it opens.
- Scenes are saved in the `data` folder (`data/scenes.json`). Copy that folder to back them up.
  The previous version is always kept as `scenes.backup.json`.

## ✨ Vibe: from a picture to sounds
Click **✨ Vibe** in the scenes bar. Then either:
- **give it a picture**: drop it on the box, paste it with **Ctrl+V** (e.g. after copying a
  picture in your browser or a screenshot), click **🖼 Choose a picture…**, or paste a picture's
  web address (right-click a picture on a website → *Copy image address*);
- or just **type a few words**, like `tavern, night, cheerful`.

From a picture, it fills in **Words** with what it sees: a place (tavern, forest, cave,
spaceship…), weather (rain, storm, fog…), night, and a mood (calm, tense, scary, epic…). Change the
words however you like; the suggestions update as you type:
- **Your scenes** that match. Click one to start it.
- **＋ New scene with these tags**: saves what's playing now as a scene with these words as its tags.
- **Tabletop Audio SoundPads** that fit.
- **Search for sounds** (Freesound) and **Search YouTube** buttons with ready-made searches.

**Tags make matching work.** In the scene editor (**✎ Edit scenes** → click a scene) there's a
**Tags** box. Type words that describe the scene, separated by commas, e.g.
`tavern, cheerful, night`. Similar words count too: a scene tagged `inn` matches a picture of a
tavern. Words in a scene's name and notes count half.

How it works, and what to expect:
- Pictures are recognised **on your PC** by a small AI model called CLIP. Nothing is uploaded,
  there's no account, and it's free.
- **The first time**, it downloads the model (about 150 MB) and keeps it in `data/models`. That
  takes a minute or two on a normal connection. After that it works offline and takes a second
  or two per picture.
- It knows about 55 words (see `dashboard/js/vibe-words.js`, where you can add your own). It's
  good at clear pictures of places and weather, and only guesses at mood. Treat the words as a
  starting point and fix them by hand.
- The first picture after starting the dashboard is slower, while the model loads.

## Links and Tabletop Audio
The **Website** panel keeps your favourite sites as buttons.

- **Save a link:** type or paste an address in the box at the top and click **☆ Save**. Give it a
  name and choose where it opens:
  - **Automatic** (normal): inside the Website panel if the site allows it, otherwise in a new
    Kenku tab. The dashboard remembers which sites refuse.
  - **The Website panel** or **A new Kenku tab** to force one or the other.
  Buttons that open a new tab have a **↗** after their name.
- **Change, reorder or delete links:** click **✎ Edit links**, then click a link.
- **🎲 SoundPads** shows all of Tabletop Audio's SoundPads with pictures. You can filter them by
  category or by a word like `tavern`. **↗ Open** opens a SoundPad, and **☆ Save** adds it to
  your links, so scenes can use it.

**Why SoundPads open in a new tab:** Tabletop Audio doesn't allow its site to be shown inside
other pages, so it can't sit in the Website panel. A new Kenku tab is just as good, because Kenku
sends the sound of every tab to Discord. Switch back to the dashboard tab to keep using it.

**Your own Custom SoundPad:** open **Custom SoundPad**, build your mix, click **Get Link** on
Tabletop Audio, then paste that link into the address box here and click **☆ Save** (or paste it
straight into a scene's Link box).

Good to know:
- Kenku opens a **new** tab every time a page asks for one (it can't reuse a tab). So when a
  scene opens its link automatically, the dashboard skips links it has already opened since you
  loaded the dashboard. That way, switching between scenes doesn't pile up tabs. If you closed
  that tab, click **↗ Open scene link** under the scene buttons.
- Close SoundPad tabs you no longer need, or their sounds keep playing.
- The dashboard only reads Tabletop Audio's list of SoundPads (once a day). The sounds always
  play from Tabletop Audio's own site. They are free to use but not licensed for downloading, so
  the dashboard never downloads them. If you enjoy them, consider
  [supporting Tabletop Audio on Patreon](https://www.patreon.com/tabletopaudio).
- Links are saved in `data/links.json` (the previous version is kept as `links.backup.json`).

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
When a new version is out, an **"Update available"** badge appears at the top of the dashboard.
Click it to see what's new, then click **Update now**. The helper downloads the new version,
checks it isn't damaged, swaps the files and restarts itself, and the dashboard reloads. It takes
about a minute. Kenku keeps playing in the meantime.

**What's kept:** `config.json` (your settings and keys), the `data` folder (scenes, links, the
✨ Vibe model) and `downloads` (your sounds). The previous version is kept in `update\backup-…`
until the next update, and every step is written to `update\update.log`.

If something goes wrong, the old version is put back automatically. You can always update by
hand instead: run the newest **Setup.exe** over the top (it keeps your files too), or unzip the
new portable ZIP over your old folder.

Copies made with **Git** or GitHub's **Download ZIP** can't update themselves. The badge still
tells you about new versions. Update with `git pull` and then `npm install`, or switch to the
installer.

## Troubleshooting
| Problem | Fix |
|---|---|
| Pill says **Kenku not reachable** | Kenku isn't open, or Remote is off, or the port differs from `config.json`. Run `npm run check-kenku` |
| **Update now** says the download is damaged | Your connection dropped. Click **Update now** again. Nothing was changed |
| The update didn't come back ("didn't come back within 3 minutes") | Start KenkuEnhanced again from the Start menu. If the new version doesn't start, `update\update.log` says why; the old version is in `update\backup-…` |
| Windows says "Windows protected your PC" | The installer isn't signed. Click **More info → Run anyway** |
| Pill says **Helper offline** | The black helper window was closed. Start it again |
| `Port 4000 is already in use` | The helper is already running in another window, or change `port` in `config.json` |
| A website shows "can't be shown inside the dashboard" | That site forbids embedding. Use **↗ New tab**, which opens it as a Kenku tab so its audio still reaches Discord. Saved links set to Automatic will open it in a tab from now on |
| The SoundPad list says it couldn't load | You're offline, or Tabletop Audio changed its page. Use the **Tabletop Audio SoundPads** link instead. Your saved links still work |
| Scene switching opened lots of Kenku tabs | Shouldn't happen any more: each link opens at most once per dashboard visit. Reloading the dashboard resets this |
| YouTube says "doesn't allow it to be embedded" | The uploader disabled embedding. Use the **Open on YouTube in a new tab** button |
| `Could not read config.json` when starting | A quote, comma or bracket got lost while editing. Compare with `config.example.json`, or delete `config.json` (a fresh one is made on the next start) and add your key again |
| Search says "No YouTube API key yet" | Follow **YouTube search** above, then restart the helper |
| Search says the quota is used up | Wait until the next day, or paste links directly (that never uses quota) |
| Sounds says "Freesound rejected the API key" | You probably copied the Client id. Use the longer **Client secret/Api key** from <https://freesound.org/apiv2/apply/> |
| Sound downloads fail with "Couldn't create …" | The downloads folder in ⚙ Settings doesn't exist or isn't writable. Pick another folder, tick "Create the folder" and Save |
| "Saved, but couldn't add it to ATTRIBUTION.csv" | The file is open in Excel, which locks it. Close Excel; the sound itself was saved |
| ✨ Vibe says "Couldn't load the picture recogniser" | You need to be online the first time (it downloads the model). After that it works offline |
| ✨ Vibe says "The site answered 403" for a picture address | That site doesn't let other programs fetch its pictures. Save the picture and drop the file in instead |
| ✨ Vibe gives odd words | It's guessing from what it was trained on. Fix the words by hand. Clear pictures of a place work best, and maps work less well |
| **📂 Open folder** does nothing | The window may have opened behind Kenku. Check the taskbar |

## Project layout
```
helper/       Node.js helper server (Express)
  server.js     dashboard files, /kenku proxy, /health, /api/*
  config.js     reads config.json
  check-kenku.js, mock-kenku.js
  scenes.js     saves scenes to data/scenes.json
  sounds.js     Freesound search + download, ATTRIBUTION.csv
  links.js      saved links (data/links.json) + Tabletop Audio SoundPad list
  datafile.js   safe reading/writing of the files in data/
  update.js     update check + one-click update; updater.js swaps the files
  vibe.js       model files for ✨ Vibe (kept in data/models) + picture fetcher
dashboard/    the web page (plain HTML/CSS/JS, no build step)
data/         your scenes, links and the ✨ Vibe model (created automatically, not uploaded to GitHub)
installer/    Inno Setup script for the Windows installer
.github/      release.yml builds the installer + portable ZIP when a version is tagged
docs/         PLAN.md (roadmap), kenku-remote-api.md (verified API reference), RELEASING.md
```

## Licence
GPL-3.0, the same as Kenku FM. Not affiliated with Kenku FM, Owlbear Rodeo, YouTube or Tabletop Audio.
