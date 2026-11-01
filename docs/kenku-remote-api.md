# Kenku FM Remote API – verified reference

Verified by reading the Kenku FM source (owlbear-rodeo/kenku-fm, `main` branch):
- routes: `src/main/remote/index.ts` and `src/main/remote/routes/**`
- reply types: `src/types/player.ts`
- server: `src/main/managers/PlayerManager.ts` (Fastify, default `127.0.0.1:3333`,
  **no CORS plugin registered** → browsers block direct calls from other origins).

Base URL: `http://127.0.0.1:3333` (change in Kenku → Settings → Remote).
Through our helper the same paths are available at `http://localhost:4000/kenku/...`.

Bodies are JSON (`Content-Type: application/json`). Endpoints that take an `{ "id" }`
validate it with a schema; a missing id gives **400**.

## Common errors
| Status | When | Body |
|---|---|---|
| 503 | Kenku's player view isn't ready | `{ statusCode, error: "Service Unavailable", message: "Unable to connect to Kenku FM" }` |
| 408 | Player didn't answer within 5 s (GET routes) | `{ statusCode, error: "Request Timeout", message }` |
| connection refused | Remote is disabled or Kenku is closed | – |

## Playlists

| Method | Path | Body | Reply |
|---|---|---|---|
| GET | `/v1/playlist` | – | `PlaylistsReply` |
| PUT | `/v1/playlist/play` | `{ "id": "<playlist or track id>" }` | echoes body |
| GET | `/v1/playlist/playback` | – | `PlaylistPlaybackReply` |
| PUT | `/v1/playlist/playback/play` | – | – |
| PUT | `/v1/playlist/playback/pause` | – | – |
| POST | `/v1/playlist/playback/next` | – | – |
| POST | `/v1/playlist/playback/previous` | – | – |
| PUT | `/v1/playlist/playback/mute` | `{ "mute": true }` | echoes body |
| PUT | `/v1/playlist/playback/volume` | `{ "volume": 0.5 }` (clamped 0–1) | echoes body |
| PUT | `/v1/playlist/playback/seek` | `{ "to": 30 }` (seconds) | echoes body |
| PUT | `/v1/playlist/playback/shuffle` | `{ "shuffle": true }` | echoes body |
| PUT | `/v1/playlist/playback/repeat` | `{ "repeat": "off" \| "track" \| "playlist" }` | echoes body |

⚠️ **There is no playlist "stop".** The dashboard's Stop = pause + seek to 0.

```ts
PlaylistsReply = {
  playlists: { id, title, background, tracks: string[] /* track ids */ }[],
  tracks:    { id, url, title }[]
}

PlaylistPlaybackReply = {
  playing: boolean, volume: number /* 0-1 */, muted: boolean,
  shuffle: boolean, repeat: "off" | "track" | "playlist",
  track?:    { id, url, title, duration /* s */, progress /* s */ },
  playlist?: { id, title }
}
```

## Soundboards

| Method | Path | Body | Reply |
|---|---|---|---|
| GET | `/v1/soundboard` | – | `SoundboardsReply` |
| PUT | `/v1/soundboard/play` | `{ "id": "<sound id>" }` | echoes body |
| PUT | `/v1/soundboard/stop` | `{ "id": "<sound id>" }` | echoes body |
| GET | `/v1/soundboard/playback` | – | `SoundboardPlaybackReply` |

⚠️ No API for per-sound volume, loop or fade – those come from the sound's settings inside Kenku.

```ts
SoundboardsReply = {
  soundboards: { id, title, background, sounds: string[] /* sound ids */ }[],
  sounds: { id, url, title, loop, volume, fadeIn, fadeOut }[]
}

SoundboardPlaybackReply = {
  sounds: { id, url, title, loop, volume, fadeIn, fadeOut, duration, progress }[]  // currently playing
}
```

## Not available
- Adding/importing tracks or sounds, creating playlists.
- Stopping the playlist (only pause).
- Anything about the built-in browser.
