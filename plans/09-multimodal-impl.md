# 09 — Multimodal Chat: implementation notes (this wave)

Implements plan 09 v1 (images, voice, files) minus Phase-5 TTS, plus two cross-cutting items.

## Shared (`packages/shared`)
- `src/attachments.ts` — kinds, `ATTACHMENT_LIMITS`, `checkUploadLimit` / `checkAttachmentBatch`, LLM-view windowing constants, `formatMbLimit`.
- `src/conversation.ts` — `tailMessages` now returns each row's `toolCalls` jsonb + joined `attachments`.
- `src/context.ts` — tail→`ModelMessage[]` mapping reworked:
  - tool-call/tool-result round-trip (paired by `toolCallId`; unmatched dropped);
  - attachment view rules (3 most-recent images as image parts, older → `[photo: caption]`; voice transcript prefixed `[voice note] `; file full text within last ~10 messages else `[file: name — caption]`; PDFs as native document blocks).
- `src/tools/attachments.ts` — `read_attachment(attachment_id)` server tool.
- `src/schemas.ts` — `createUploadUrlInput`, `attachmentUploadedInput`, `attachmentStatusInput`, `retryAttachmentInput`; `chatSendInput` gains optional `attachmentIds`, text no longer required when attachments present.

## Server (`apps/server`)
- `src/storage/{index,local,blob}.ts` — `Storage` interface; local-filesystem impl (dev/tests) + Vercel Blob impl (env-gated).
- `src/attachments/{ingest,parse}.ts` — ingest state machine (uploading→processing→ready|failed); image caption, audio transcription (`experimental_transcribe`), file parsing (pdf/docx/xlsx/csv/txt).
- `src/attachments/upload.ts` — createUploadUrl (limit enforcement + row insert), finalize, retry, status.
- `src/chat/turn.ts` — user message carries `attachmentIds`; turn waits on `ready`.
- `src/routers/chat.ts` — new endpoints.
- `src/{env,services,context,app,index}.ts` — wire `Storage` + caption/transcription models.

## Mobile (`apps/mobile`)
- `features/chat/attachments.ts` — pure helpers (waveform bucketing, size/duration format) — unit-tested.
- `features/chat/useChat.ts` + `ChatSheet.tsx` — composer state + upload orchestration + attachment bubbles.
- `components/{ChatComposer,AttachmentSheet,PendingAttachments,VoiceRecorder,ImageBubble,VoiceBubble,FileBubble}.tsx`.
- DocumentCard rendered for assistant messages whose tool call/result is create_document/update_document.

## Reply chips
No plan (02/03/07) specs a source of scripted replies for the *main* chat turn (02 specs them only for onboarding). Left empty; see report QUESTIONS.
</content>
</invoke>
