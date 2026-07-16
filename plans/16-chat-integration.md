# Chat integration: cje/chat-stuff → main monorepo

Bring the full chat stack built on `cje/chat-stuff` (server turn engine, DB,
shared domain logic, mobile chat UI, tests) into main's pnpm monorepo, wiring
the rich chat into `packages/expo`'s existing chat drawer.

## Source → destination map

| cje/chat-stuff | main (this branch) | Notes |
| --- | --- | --- |
| `packages/db` | `packages/db` | wholesale; `@sidekick/db` (drizzle + pglite tests + 5 migrations) |
| `packages/shared` | `packages/shared/app` | wholesale; keeps name `@sidekick/shared` (prompts, tools, conversation, context) |
| `apps/server` | `packages/server` | wholesale; `@sidekick/server` (Hono + tRPC at `/trpc`, raw streaming at `/chat/stream|continue`, Vercel entry in `api/`) |
| `tests/` + `vitest.config.ts` | root `tests/` + root vitest | mobile-import paths repointed to `packages/expo/src/...`; `onboarding-funnel.test.ts` dropped (onboarding funnel screens not ported) |
| `plans/` | `plans/` | design docs for the copied code |
| `apps/mobile` chat subtree | `packages/expo` | ported (below); rest of the mobile app (goals, onboarding, locker, …) intentionally NOT ported |

## Workspace/config adjustments

- Workspace deps `"*"` → `"workspace:*"` (npm workspaces → pnpm).
- Branch `tsconfig.base.json` becomes `@sidekick/tsconfig/node.json`
  (ES2022, bundler resolution, verbatimModuleSyntax, noUncheckedIndexedAccess —
  load-bearing for this code style); db/shared/server extend it.
- Root package.json: `test`, `db:generate`, `dev:server` scripts; vitest/msw/
  @types/node/typescript devDeps; typecheck also covers `tests/` via
  `tests/tsconfig.json`.
- `pnpm-workspace.yaml` globs already cover the new packages.

## Expo port (chat portion of this app)

The toy chat (`src/components/Chat.tsx` + `src/store/chat.ts` +
`src/lib/chat-api.ts` — canned/OpenAI-direct replies) is replaced by the real
chat, keeping the same home-screen integration (drawer over the 3D scene,
`loading` still drives the mascot's `talking`).

Ported, mirroring the branch layout under `src/`:

- `src/features/chat/` — ChatSheet, ChatSearch, useChat, stream-frames,
  tool-chrome, attachments, pickers, device-tools, focus-device-tools.
- `src/components/` — ChatBubbles, ThreadMessage, ChatComposer, ReplyChips,
  SearchingCaption, Skeleton, SourcePills, SponsoredCard, SolidShadow,
  DocumentCard, FileBubble, ImageBubble, VoiceBubble, Waveform,
  AttachmentSheet, BottomSheet, PendingAttachments, SendButton, VoiceRecorder,
  MarkdownDocument.
- `src/lib/` — api (tRPC client + streaming), auth (device registration →
  bearer token in SecureStore), chat-thread, date, tokens, documents, health,
  focus.
- `app/document/[id]`, `app/reminders`, `app/focus-setup` — the three screens
  reachable from inside chat (document cards, reminder "see all", focus setup
  tool).
- Assets: `chat-header.webp`, `sidekick-pfp.webp`, Diatype-Rounded font;
  tailwind theme entries merged.
- `app/_layout.tsx` gains QueryClientProvider + AuthGate + font loading;
  `app/index.tsx` swaps `<Chat>` for `<ChatSheet>` wiring.

Adaptations:

- Asset `require()` paths gain one `../` (code now lives under `src/`).
- Expo SDK 53 → 54 dep bumps (`npx expo install` versions).
- Health (`read_health`) and focus (`focus_*`) device tools are kept, incl.
  `@kingstinct/react-native-healthkit` and `react-native-device-activity`;
  both already degrade to `{error: "device_unavailable"}` off-device. The
  Family Controls Swift shield targets from the branch are NOT brought over —
  building with entitlements is a separate follow-up (see
  `apps/mobile/BUILD-REQUIREMENTS.md` on the branch).
- `EXPO_PUBLIC_API_URL` points the app at the server (default
  `http://localhost:8787`).

## Server env (see packages/server/src/env.ts)

`DATABASE_URL` (required), `ANTHROPIC_API_KEY` (chat), optional:
`SIDEKICK_CHAT_MODEL`, `SIDEKICK_DISABLED_TOOLS`, `CRON_SECRET`,
`PUBLIC_API_URL`, `BLOB_READ_WRITE_TOKEN`, `LOCAL_BLOB_DIR`, `OPENAI_API_KEY`
(voice transcription), `GRAVITY_API_KEY` (ads), `WEATHER_API_KEY`,
`EXPO_ACCESS_TOKEN` (push), `MUSIC_TOKEN_KEY`, `APPLE_MUSIC_*`, `PORT`.
Everything optional degrades gracefully; tests run on PGlite with mocked
models (no keys needed).

## Verification

- `pnpm install`, `pnpm -r typecheck`, `pnpm test` (vitest, PGlite-backed).
- Expo: typecheck; manual smoke via dev server + `EXPO_PUBLIC_API_URL`.
