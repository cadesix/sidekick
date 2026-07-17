# Attachment composer polish

Follow-ups after wiring the `+` menu. Four asks:

1. **Adding an image feels slow.**
2. **Make the staged-attachment UI look more iOS.**
3. **Downstream: the `+` menu opens higher once an image is staged — it should
   always open in the same spot.**
4. **Resize/optimize on device + guard the upload so a mega-file can't DOS us.**

## 1 — Slowness: stop gating image send on the caption ingest

The composer disables send until every attachment is `ready`. For a **file** or
**voice note** that's correct — the model reads the extracted text / transcript,
which only exists after ingest. For an **image** it's not: `turn.ts` inlines the
image *bytes* into the model call (`inlineAttachmentBytes`) and
`buildContextView` emits a recent image as a real image part **regardless of
status or caption** (`captionText` falls back to `"attachment"`). The vision
caption only matters as the text fallback once an image scrolls past the
recent-3 window.

So: an image is **sendable the moment its bytes land**, not when the caption
returns. In `usePendingAttachments.upload()`, mark an image `ready` right after
`uploadAttachment` resolves and skip the poll. The server still runs the caption
ingest in the background (for later windowing); the composer just never waits on
it. Audio/files keep the upload → poll-to-ready path unchanged.

This removes the multi-second vision round-trip from the perceived "add a photo"
time — send lights up as soon as the (small, resized) upload PUT completes.

## 2 — iOS look for staged attachments (`PendingAttachmentRow`)

- Bigger, softer thumbnails: 62px, `borderRadius:16` continuous, hairline
  border.
- Files render as an iMessage-style **file card** (icon tile + filename +
  "PDF · 2.3 MB"), same height as the thumbnails so the tray is even. Reuses
  `fileTypeLabel` + `formatBytes`.
- Remove badge restyled as an iOS close chip: dark translucent disc + white ring
  + white ×, so it reads on any thumbnail.
- Spinner/dim only shows while genuinely settling (files/audio); images flip to
  ready immediately now, so no lingering spinner.

## 3 — `+` menu always opens in the same spot

`PlusDrawer` is anchored `bottom:"100%"` of the **footer**, whose height grows
when the pending row / reply chain / ad appear — so the drawer floats higher.
Re-anchor it to the **input bar** instead: wrap `ChatInputBar` in a relative
`View` and render the drawer inside it. `bottom:"100%"` then means "top of the
input bar", which is a stable screen position (the footer is bottom-anchored, so
the input bar never moves when rows stack above it). The drawer floats over the
staged tray, exactly like Messages.

## 4 — On-device resize + upload DOS guard

**Resize (already in place, keep):** `pickers.resizeImage` downscales to a
1568px longest edge at JPEG q0.8 — Claude's optimal vision input (~1.15MP,
typically 150–400KB). Confirm every picked image (incl. HEIC/PNG) re-encodes
through it. No change needed; documented here so it's not re-litigated.

**DOS guard (the real gap):** `createUpload` only checks the *client-declared*
`bytes`. The `/blob/*` PUT route buffers the entire body with `arrayBuffer()` —
no size cap, no ownership check. Fix the route to:

- Look up the attachment row by `storageKey`; require it exists **and** belongs
  to the caller (`userId` match) — no writing to an unreserved / another user's
  key.
- Cap the write at the row's already-limit-checked `bytes`. Reject early on an
  oversized `content-length`, and stream-read the body with a hard byte cap so a
  lying/absent `content-length` still can't balloon memory (bounded by the
  per-kind cap, ≤25MB).

Add a server test: reserve a small attachment, PUT an oversized body → 413, PUT
the right size → 204, PUT to another user's key → 404.

## Files

- `packages/expo/src/imessage/usePendingAttachments.ts` — image ready-on-upload.
- `packages/expo/src/imessage/components/PendingAttachmentRow.tsx` — iOS tray.
- `packages/expo/src/imessage/screens/ChatScreen.tsx` — re-anchor the drawer.
- `packages/server/src/app.ts` — `/blob` PUT ownership + size cap.
- `tests/blob-serving.test.ts` — DOS-guard coverage.
