# 12 — Life Integrations: Apple Health, Location, Apple Music

Three iOS integrations that turn the sidekick from "app you talk to" into "friend who's actually in your life": it *saw* your run, knows what city you woke up in, and makes you playlists. All three are read-mostly, permissioned contextually (never a wall of prompts at onboarding), and surfaced in one **Connected** section in Settings.

A shared architectural fact drives all of this: **chat tools execute server-side, but these effects live on-device.** So this plan introduces the **device-tool pattern** used here and in [13-focus-mode.md](13-focus-mode.md): a tool marked `execution:'client'` streams to the app mid-turn, the client runs the native call (the user is chatting, so the app is alive), posts the result to `chat.deviceToolResult`, and the model continues the same turn. Timeout 10s → the tool returns `{ error: 'device_unavailable' }` and the model says so in-voice. Build this once in the tool registry (01); health/music/focus tools all declare it.

## Apple Health

**Module:** `@kingstinct/react-native-healthkit` v9 (Nitro modules; add `react-native-nitro-modules`; config plugin `["@kingstinct/react-native-healthkit", { background: true }]`; dev-client only, no Expo Go — same constraint 03 already imposes). Reads only, never writes: `stepCount`, `sleepAnalysis`, `workouts`, `heartRate` + `restingHeartRate`, `activeEnergyBurned`.

**Sync, not tools-first:** a `health_days` daily-aggregate table, synced client → server on app foreground via anchored queries (`queryQuantitySamplesWithAnchor`, which also yields deletions), last 7 days:

```ts
healthDays: {
  userId, date /* user-local */,
  steps, activeCalories, restingHr nullable,
  sleepMinutes nullable, sleepStart nullable, sleepEnd nullable,  // merged across sources by sourceRevision, Watch preferred
  workouts jsonb,  // [{ type:'running', minutes: 34, calories: 310, startedAt }]
  syncedAt
}
```

The chat context then just renders yesterday+today into the memory block's RECENT section ("yesterday: 11,204 steps, 6h41m sleep (12:48–7:29), 34-min run") — no tool round-trip on the hot path. One device-tool exists for depth: `read_health(range_days ≤ 30, metric)` for "how's my sleep been this month?".

**Where it pays off — device-verified goals (03):** a synced workout matching an active fitness action item auto-logs `progressEvents` with `source:'device'` (the sidekick reacts, never announces the logging, per 03's silence rule); `sleepStart` before the sleep goal's target time logs the sleep goal. Self-report remains the fallback and the user's word always outranks the sensor ("the watch missed my class" → `user_stated` supersedes).

**Permission UX (the gotchas are the design):** `requestAuthorization` is asked contextually — when the user adopts a fitness/sleep goal, via a pre-permission sheet (sidekick face + "want me to just *see* your steps and sleep so you never have to report anything? i can only read, never share" + PrimaryButton "connect Apple Health" / Caption "maybe later"). Apple never reveals read-permission status and **denied reads return empty, not errors** — so: never query a type before requesting it (crash), guard with `isHealthDataAvailable()`, and if a "connected" user shows empty data for 48h the sidekick says once, in-voice: "btw if you did mean to share health stuff, it might be off in Settings → Health → Data Access — no pressure either way."

**Hard privacy line (extends user-memory §5 and 05):** `health_days` never enters the ad projection, and any assistant message generated from health context is flagged `sensitive` on the row and **stripped from the message window forwarded to Gravity**. Health data makes the product; it must never touch the ads. This is also Gravity's own EEA/UK policy and GDPR Art. 9 — treat it as global.

## Location

**Module:** `expo-location`, `whenInUse` only — **never background tracking** (creepy, battery-hostile, and we have no feature that needs it). On app foreground (throttled to 1/hour): coarse position → `reverseGeocodeAsync` → store `users.lastCity/lastRegion/lastCountry/lastLocatedAt`. City-level, by design — we discard coordinates immediately.

Permission asked contextually the first time location would help (user asks something local, or at weather-enabled check-in setup), with the same pre-permission sheet pattern ("so i know your weather and what's nearby — only while you're using the app, only your city").

What it powers: weather in check-in openers (03, already planned — this supplies the city), `userLocation` for web search (11 — local recommendations), automatic `users.timezone` updates (travel keeps check-ins and reminders correct — recompute reminder `nextFireAt` on change, 10), and openers that notice travel ("wait, you're in ohio — wedding weekend??" via memory cross-reference). Ad requests already carry client IP geo per 05; we send Gravity nothing new.

## Apple Music

**Modules (two, by necessity):** `@lomray/react-native-apple-music` (v1.4+) for authorization and `checkSubscription()`, plus `@superfan-app/apple-music-auth` for the **Music User Token** (lomray doesn't expose it; the token can only be minted on-device). **Server-side everything else:** developer token = ES256 JWT (6-month max expiry) signed on Vercel from a MusicKit-enabled `.p8` key — key never ships to the client; the app fetches short-lived dev tokens from our endpoint. Enable the MusicKit App Service on the App ID; `NSAppleMusicUsageDescription` is mandatory (crash without it).

Connect flow (Settings → Connected → Apple Music): authorize → `checkSubscription()` (no active subscription → "you'd need Apple Music for this one 🥲" and stop — library writes require it) → mint user token → POST to server (encrypted at rest) → **taste ingestion**: server pulls `GET /v1/me/history/heavy-rotation` + top library artists, one extraction pass turns them into `interest` memories (`source:'import'`) — music taste is non-sensitive and ad-projectable, and instantly upgrades both personalization and the 14 context score.

Chat tools (server-executed — the API calls run on our backend with the stored user token; 403 = token revoked → device-tool re-mint next session):

- `music_search(query, types)` — catalog search in the user's storefront (`GET /v1/me/storefront` first; catalog IDs are storefront-scoped).
- `music_make_playlist(name, description, song_queries[])` — resolves each query via catalog search, `POST /v1/me/library/playlists` with the track relationships. The signature moment: "made you a pump-up playlist for tomorrow's 5k — it's in your library 🎧". The playlist description is always signed "made by {sidekickName} 💛".
- `music_add_to_playlist(playlist_id, song_queries[])` — `POST /v1/me/library/playlists/{id}/tracks` (204 on success); playlist ids for sidekick-made playlists render in the memory block's DOCUMENTS-style list so "add that song to my running playlist" needs no lookup.
- `music_recommendations()` — `/v1/me/recommendations` + recent plays, for "what should i listen to" turns.

Prompt rule: playlists are *gifts* — offered at meaningful moments (race day, rough week, new goal), max ~1/week uninvited, always ask-first except milestone celebrations.

## Settings — Connected section (UI spec)

Under Settings (07 §9), a `CONNECTED` group (Caption header): three rows, each 56px — 28px service icon PNG + name (Option 17) + status right-aligned (Caption: `Connected` in ink/60, or a `Connect` ReplyChip). Tap disconnected → the pre-permission sheet for that service; tap connected → detail sheet with what's shared (plain sentences), last-synced Caption, and an ink-bordered "Disconnect" button (flame text). Disconnect immediately: deletes `health_days` / stored music token / clears location fields server-side, and says so on the sheet ("deleted from our side too").

## Effort

- Device-tool pattern in the registry (shared with 13): **1d**
- Health: plugin + sync + `health_days` + device-verified logging + permission sheets + sensitive-flag ad stripping: **3d**
- Location: capture/geocode/tz-update + pre-permission sheet + 11 wiring: **1d**
- Music: token plumbing (dev JWT endpoint, user-token store) + connect flow + 3 tools + taste ingestion: **3d**
- Connected settings section + disconnect cascades: **1d**

Ships: Health + location in **Phase 3** (they feed the core goal loop), Music in **Phase 4** (pure delight). All three need dev-client builds — already true from 03.
