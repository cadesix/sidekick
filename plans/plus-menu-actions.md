# Wire up the chat + menu (Camera, Photos, Files, Location; drop Stickers)

## Context

The iMessage-style chat's `+` drawer (`PlusDrawer.tsx`) lists Camera, Photos,
Stickers, Audio, Location, More — but only Audio does anything; every other row
just closes the drawer. This was inherited from the imessage-llm reference,
which had the same dead rows.

Meanwhile the **backend for all of this already exists and is tested** (plan
09 — multimodal chat): presigned uploads (`chat.createUploadUrl`), an ingest
pipeline (image → vision caption, file → parsed text + summary, audio →
transcript), send-time `attachmentIds` on the turn, LLM view windowing, and
history rows that return full attachment render data (url, dims, mime, bytes).
A previous Expo UI for it (ChatComposer/AttachmentSheet/PendingAttachments/
ImageBubble/FileBubble + `features/chat/pickers.ts`) existed at commit
`f4aa035` and was deleted when the iMessage-style chat replaced that composer.
The needed packages (expo-image-picker, expo-document-picker,
expo-image-manipulator, react-native-awesome-gallery, expo-image) are still
installed.

So this is a **reconnection job**: recover the proven pick/resize/upload/poll
logic and re-skin the surfaces in the iMessage design language.

## What each button should do

| Row | Behavior |
| --- | --- |
| **Camera** | `expo-image-picker` camera → resize (1568px longest edge, JPEG q0.8, per 09) → upload → pending thumbnail above the input → sends with the turn's `attachmentIds`. |
| **Photos** | Library picker, up to 4 (the server's per-message cap), same pipeline. |
| **Audio** | Already wired (in-place voice recorder). Unchanged. |
| **Files** (replaces "More") | `expo-document-picker`, one file (pdf/docx/xlsx/csv/txt/code…), client-side size check with the in-voice error line, same upload pipeline. The sidekick reads it via the existing ingest/extractedText path. |
| **Location** | One-time, city-level share — matching the app's privacy model (coords never leave the device). Resolve a coarse fix → reverse-geocode on device → send a normal turn: `📍 Austin, Texas`. Permission requested contextually; graceful alert if denied/unresolvable. Does NOT flip the ongoing location-context setting. |
| **Stickers** | **Removed.** No sticker infra exists anywhere (no assets, no backend, no spec), and a dead row is worse than no row. Tapbacks already cover expressive reactions. |

## Implementation

### 1. Pickers + pending-attachment model (recovered from `f4aa035`)
- `imessage/lib/attachments.ts` — `PendingAttachment` type, `formatBytes`,
  `truncateFilename`, `filenameFromUrl` (decode last URL segment — the server
  encodes the original filename into the storage key).
- `imessage/lib/pickers.ts` — `takePhoto()`, `pickImages()`, `pickFile()`
  verbatim from the old module (resize spec, permission flows, limit checks
  via `@sidekick/shared`).

### 2. Upload orchestration — `imessage/usePendingAttachments.ts`
Recovered from the old ChatComposer: eager upload on pick
(`uploadAttachment`), then poll `attachmentStatus` until ready/failed;
`remove`, `retry` (re-`retryAttachment` when server id exists, re-upload
otherwise); exposes `pending`, `readyIds`, `allSettled`, `clear`.

### 3. Message model + history mapping
- `imessage/types.ts`: `Message` gains `images: ImageAttachment[]`
  (`{uri,width,height}`) and `file?: FileAttachment`
  (`{url,filename,mime,bytes}`). `kind` stays `text|audio`.
- `imessage/server.ts` `toMessage`: map image/file attachment rows from
  history. `runTurn` already takes `attachmentIds`.
- `useSidekickChat` `SendInput` gains `attachments?: PendingAttachment[]`
  (ready by send time); mutation passes their server ids; optimistic bubble
  renders local thumbnails / file card immediately.

### 4. Rendering
- `ImageBubble` — iMessage style: rounded-rect image(s), no gray backing,
  max-width 240, 2-col grid for 2–4; tap → full-screen pinch-zoom gallery
  (react-native-awesome-gallery in a Modal).
- `FileBubble` — inside the normal MessageBubble: doc icon + filename +
  `PDF · 2.3 MB` caption, tinted for sent/received.
- `MessageRow` — renders images, then file bubble, then the text bubble
  (each only when present; no empty text bubble).
- `ReplyQuote`/quote text: "Photo" / filename / "Audio Message" fallbacks.

### 5. Composer integration
- `PlusDrawer` — items become Camera / Photos / Audio / Files / Location;
  generic `onSelect(key)`; Stickers removed.
- `PendingAttachmentRow` — chips above the input bar (56px thumbnails with ×
  badge, file pill, dimmed while uploading, red retry line on failure).
- `ChatInputBar` — send arrow also shows when attachments are ready with no
  text; send blocked while any attachment is uploading/processing/failed.
- `ChatScreen` — owns the hook, handles drawer selections, includes ready
  attachment ids in `send`, clears them after.

### 6. Location share
`lib/location.ts` gains `resolveCityLine()`: request foreground permission if
needed, coarse fix, reverse geocode, return `"City, Region"` or null. Chat
sends `📍 ${line}` as the user turn. Alert on denial (points at Settings) or
unresolvable fix.

### 7. Icons
Add `folder` (Files row) and `doc` (file bubble/pill) to `Icon.tsx`.

## Verification
Typecheck + lint; drive in the iOS simulator against the local backend
(memory: `verify-in-ios-sim-with-real-backend`): send a photo from library,
a file, share location; confirm the sidekick's reply references the image
caption/file content; confirm bubbles render after transcript revalidation
and in history after reload.
