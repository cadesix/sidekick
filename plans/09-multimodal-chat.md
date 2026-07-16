# 09 — Multimodal Chat: Images, Voice Notes, Files

Texting a friend means sending photos, rambling voice notes, and the occasional "can you look at this" attachment. The sidekick handles all three. Everything lands in the same endless thread (08) as normal messages with attachments — no separate "upload" surface.

Supported: **images** (camera/library), **voice messages** (recorded in-app), **files** (pdf, docx, xlsx, pptx, csv, json, txt, and code files by extension).

## Data model & storage

```ts
attachments: {
  id, messageId nullable /* set when the message sends */, userId,
  kind /* image|audio|file */, mime, bytes, storageKey /* Vercel Blob */,
  width nullable, height nullable, durationMs nullable,
  transcript nullable,       // audio: full transcription
  extractedText nullable,    // files: parsed text, capped 50k chars
  caption nullable,          // image: one-line vision caption; file: ~200-token ingest summary
  status /* uploading|processing|ready|failed */, createdAt
}
```

Storage is **Vercel Blob** (we're on Vercel; zero new infra). Upload flow: client asks `chat.createUploadUrl({ kind, mime, bytes })` → presigned PUT direct to Blob (never through our function, 4.5MB body limit) → client sends the message with `attachmentIds`. Limits enforced server-side: images 10MB & max 4 per message, audio 25MB / 5 min, files 20MB & 1 per message. Over-limit → the send button disables with a caption-sized error line under the composer ("that file's too big (max 20mb)" — lowercase, in-voice).

## Ingest pipeline (async, per attachment, on upload complete)

| Kind | Processing | Result |
| --- | --- | --- |
| image | expo-image-manipulator client-side first: resize longest edge to 1568px, JPEG q0.8 (matches Claude's optimal input, slashes upload time). Server: one cheap vision call → one-line caption ("a golden retriever puppy on a beach"). | `caption` |
| audio | Transcribe via AI SDK `experimental_transcribe` (OpenAI `gpt-4o-mini-transcribe`; Whisper fallback). | `transcript` |
| file | pdf → text via `pdf-parse` (and kept whole for native document blocks, below); docx → `mammoth`; xlsx → `sheetjs`, each sheet rendered as CSV; pptx → `officeparser`; csv/json/txt/code → raw. Cap `extractedText` at 50k chars with a `[truncated — N pages/rows omitted]` marker. Then one cheap-model call → ~200-token `caption` summary. | `extractedText` + `caption` |

Ingest usually beats the user's send tap; if not, the chat turn **waits on `status='ready'`** (the model must see the content on the turn it was sent — replying "nice pic!" blind is a trust-killer). Client shows the normal typing indicator; p95 ingest is ~2–4s. `failed` → the attachment bubble shows a retry state and no LLM call happens for that message until resolved or removed.

## What the LLM sees (and the 08 compaction interplay)

- **Images:** real image content parts (Blob URL) while the message is in the verbatim tail — but only the **3 most recent images** thread-wide; older ones render as `[photo: {caption}]` text. Keeps vision tokens bounded.
- **Voice:** the transcript *is* the message content, prefixed `[voice note] `. The model treats it as text; the audio itself never goes to the LLM.
- **Files:** full `extractedText` (as a fenced block) on the turn it's sent **and while that message is within the last ~10 messages**; after that the derived view swaps in `[file: {name} — {caption}]`. PDFs additionally go up as native Anthropic document blocks when ≤100 pages / ≤32MB (better tables/layout comprehension than extracted text).
- **New tool — `read_attachment(attachment_id)`:** returns the full `extractedText`/`transcript` of any past attachment. This is what makes the swap-out safe: "what did that lease say about parking again?" re-pulls the document on demand. Attachment ids for recent files render in the memory block's RECENT section so no lookup chain is needed.
- **Compaction (08):** summaries reference attachments by caption only. The compaction prompt gets captions, never raw text — a 50k-char lease must not blow the summary budget.
- **Memory (user-memory.md):** nothing new needed — the extractor reads the transcript stream, and captions/transcripts are in it ("sent a photo of her new puppy" → `relationship` memory candidate).

## UI spec (composer + bubbles — exact, per 06 tokens)

**Composer.** The input row from 07 §2 gains a **`+` button** (36px circle, `border-2 border-ink bg-white`, ink `+` icon) left of the text field. Tap → bottom action sheet (06 §3 sheet recipe) with three OptionCard rows: "Photo library", "Camera", "File". When the text field is empty, the send button renders as a **mic** (same 44px sun circle, mic glyph); with text, the up-arrow as today.

**Pending attachments** render as a horizontal row of chips directly above the input: images as 56px rounded-12 thumbnails with a 20px ink `×` badge (top-right, white ×), files as a pill (`border-2 border-ink bg-field rounded-full px-3 py-1.5`) with a 16px type icon + filename truncated middle + `×`. Uploading state: thumbnail/pill at 50% opacity with a 2px ink progress bar along its bottom edge.

**Voice recording.** Tap mic → the input row is replaced in-place by the recording bar: red 8px pulsing dot (Reanimated opacity loop) + elapsed `0:07` in Body + live waveform (24 bars, 3px wide, 2px gap, `bg-ink`, heights driven by metering) + a 44px ink **stop** square-in-circle button where send was. Stop → preview state: play button + static waveform + duration, `×` to discard, sun send button to send. Rejected: hold-to-record — accidental releases lose long messages; tap-tap is what WhatsApp moved to.

**Bubbles** (all get the user-bubble geometry from 06 §3 — `bg-usergray`, 24px radius, 6px flattened corner bottom-right):
- **Image bubble:** the image itself, `rounded-2xl border-2 border-ink`, max-width 240, no gray backing. Multiple images: 2-col grid, 4px gaps. Tap → full-screen viewer (black backdrop, pinch-zoom via `react-native-awesome-gallery`, ink `×` top-left in safe area).
- **Voice bubble:** 32px ink play/pause circle (white glyph) + static waveform (played portion `bg-ink`, rest `bg-ink/25`) + duration in Caption. Below, a "view transcript" Caption link toggling the transcript as Body text inside the same bubble.
- **File bubble:** a card row — 40px file-type icon (one PNG per type, 06 §5.1 asset rules) + filename (Option weight, 15px) + `PDF · 2.3 MB` in Caption/60. While `processing`: the row's icon swapped for the ellipsis-dots typing animation + "reading it…" Caption. `failed`: flame-colored Caption "couldn't read this — try again?" tappable to retry.

**Sidekick voice replies (TTS)** are deliberately later (Phase 5): per-character ElevenLabs voices are a big cost/latency/casting decision, and `expo-speech` robot voices would damage the persona more than silence does. The schema (`kind:'audio'` on assistant messages) already supports it.

## Effort

- Blob upload flow + attachments schema + composer/pending-chips UI: **2d**
- Image path (picker, resize, vision caption, bubbles, viewer): **1.5d**
- Voice path (recording UI, transcription, bubble/player): **2d**
- File path (parsers, PDF document blocks, ingest summaries, bubbles): **2d**
- `read_attachment` tool + LLM-view windowing + compaction caption rules: **1d**

Ships in **Phase 2** (images + voice) and **Phase 3** (files) — images and voice notes are core to "texting a friend"; document reading is a power feature.
