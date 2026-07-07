# 15 — Documents & Artifacts

The sidekick makes things for you: a workout plan, a packing list, a budget draft, the maid-of-honor toast outline. These are **documents** — created in chat, persisted forever, organized into folders, editable by both the user and the sidekick. This is Daimon's "artifacts" surface and a major retention anchor: a user whose training plan lives in the app doesn't churn.

## Data model

```ts
folders: {
  id, userId, name, emoji /* single emoji, picked by sidekick or user */, position, createdAt
}
documents: {
  id, userId, folderId nullable,
  title, content /* markdown */,
  lastEditedBy /* 'sidekick' | 'user' */,
  status /* active|deleted */, createdAt, updatedAt
}
documentVersions: {
  id, documentId, content, title, editedBy, createdAt
}
```

Content is **markdown, full stop** — one format for the LLM to write, the viewer to render, and the editor to edit. Every write (create or update, either author) appends a `documentVersions` row first; versions are never pruned (they're text — storage is a rounding error) and power both an "undo" affordance and trust ("the sidekick edited my plan… what changed?").

## Chat tools

```json
{ "name": "create_document",
  "description": "Create a document when you've made something worth keeping — a plan, list, draft, or guide. Use it instead of dumping long structured content into the chat bubble: reply with a short in-voice intro and let the document card carry the content. Title: 2-5 words, sentence case.",
  "parameters": { "type": "object", "properties": {
    "title": { "type": "string" },
    "content_markdown": { "type": "string" },
    "folder": { "type": "string", "description": "Folder name; created (with a fitting emoji) if it doesn't exist. Omit for unfiled." }
  }, "required": ["title", "content_markdown"] } }

{ "name": "update_document", "parameters": { "document_id", "title?", "content_markdown /* full replacement */" } }
{ "name": "get_document",    "parameters": { "document_id" } }
{ "name": "list_documents",  "parameters": { "folder?" } }
{ "name": "move_document",   "parameters": { "document_id", "folder" } }
```

- `update_document` is **full-content replacement** (the model re-emits the whole doc). Rejected: patch/diff formats — small models mangle them, and docs here are 1–3k tokens, not code files.
- Concurrency: if the user has unsaved editor changes when a sidekick update lands, last-write-wins **plus** the version history makes it recoverable; the editor shows "sidekick updated this just now — reload?" (Caption banner) rather than merging.
- Context: document **titles + ids** render in the memory block (`DOCUMENTS` section, capped at 15 most recently touched); full content only enters context via `get_document` on demand. Compaction (08) never carries document bodies — the card in the thread and the id in the memory block are the durable pointers.
- Prompt rule: after `update_document`, say what changed in one casual line ("swapped day 3 to legs like you asked") — silent edits to a user's stuff feel spooky, the opposite of check-in logging.

## UI spec

**Document card in the thread** (rendered for the message that created/updated it): a SolidShadow card (radius 16, `bg-white`, `p-4`, max-width = bubble max-width) —

```
┌──────────────────────────────┐
│ 📄  Half-marathon plan       │   16px doc emoji + Option (17/700)
│ 12 weeks · updated just now  │   Caption text-ink/60
│ ──────────────────────────   │   1px ink/10 rule
│ Week 1 — easy base…          │   first ~2 lines of content, Body, text-ink/70
└──────────────────────────────┘
```

Tap anywhere → document viewer. The press uses the standard SolidShadow press (translate 2/2, haptic `impactLight`).

**Documents home** — route `app/documents.tsx`, entered from a "Made for you" row on Home (07 §1, below the goals list; hidden via ternary until ≥1 document exists) and from Settings.

- Header: `Documents` Heading + a `+` new-folder text button (Caption, ink).
- Folder chips row (horizontal scroll): ReplyChip style, `{emoji} {name}`, selected = `bg-sun`; first chip "All".
- Below: document rows — 44px emoji tile (`bg-field rounded-xl`, folder emoji or 📄) + title (Option) + "edited yesterday · by your sidekick" (Caption/60). Swipe-left: ink "Move" + flame "Delete" actions. Sort: `updatedAt` desc.
- Empty state: small sidekick + "when i make you something — plans, lists, drafts — it'll live here" (Body, centered).

**Viewer/editor** — route `app/document/[id].tsx`:

- View mode: title as Heading, markdown body via `react-native-markdown-display` with a style map pinned to 06 tokens (h2 → Option 17/700 `mt-6`; body/li → Body 15/1.6; checkbox list items render as 20px ink-bordered squares — tappable, toggling persists a version). Sticky footer: PrimaryButton "Edit".
- Edit mode (v1 = plain, honest): title `TextInput` + full-height markdown `TextInput` (`multiline`, Body, `bg-field rounded-2xl p-4`), Save/Cancel pill pair. Rejected for v1: rich-text/block editors — every RN option is a jank machine; the audience for raw markdown editing is small, and most edits happen *through chat* ("make week 4 easier"), which is the differentiator anyway.
- Version history: a Caption "History" link in the header → bottom sheet listing versions ("today 4:12pm · sidekick"); tapping one shows it read-only with a "Restore" PrimaryButton (restore = new version, nothing destroyed).

## Effort

- Schema + versions + five tools + memory-block section: **1.5d**
- Thread card + documents home + folders: **1.5d**
- Viewer (markdown style map, checkboxes) + plain editor + history/restore: **2d**

Ships in **Phase 3** (tools + card + viewer) with folders/history polish in Phase 4. Requires nothing from other new plans; pairs beautifully with 11 (web search → researched docs) and 14 (deep-talk outputs can become documents).
