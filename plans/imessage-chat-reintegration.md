# Reintegrate the iMessage chat (post-merge)

The `origin/main` merge took main's side of `app/_layout.tsx` and `app/index.tsx`,
which unwired the native iMessage chat. Everything else survived in the tree:

- `src/imessage/` — ChatScreen (TrueSheet), MessageRow, TapbackOverlay, ReplyChain,
  TypingIndicator, TimestampSeparator, VoiceRecorder/AudioBubble, theme, useSidekickChat.
- `packages/server` — chat/turn.ts, chat/compaction.ts (invisible compaction),
  memory/, integrations, ads, device tools. Untouched by the merge.
- `app/settings.tsx`, `focus-setup`, `health-setup`, `dev/ad-preview` routes.
- `assets/images/sidekick-contact-avatar.png` — already referenced by ChatScreen;
  same mascot image as current `sidekick-pfp.webp`. No icon work needed.

## Changes

1. **`app/_layout.tsx`** — restore the pre-merge provider stack verbatim
   (QueryClientProvider, KeyboardProvider, AuthGate, NotificationObserver,
   useForegroundSync, Diatype font), keeping main's `sidekick-3d` modal route
   alongside the branch's modal routes.

2. **`app/index.tsx`** — keep main's home exactly (gamification, biomes, daily box,
   world map — "the vibes we've got right now"), but swap the Animated chat drawer
   for the pre-merge native sheet wiring: `chatSheet` ref + `chatOpen`,
   `<ChatScreen sheetRef onWillDismiss>`, tap-band sized by `CHAT_SHEET_DETENT`,
   pre-merge `CHAT_FRAMING` ([0, 1.0, 7.7] / fov 31, tuned for the 75% sheet).
   Local-chat-store couplings go away: unread badge, `clearUnread`,
   `pushSidekickMessage` (travel lines keep the `speak()` bubble), `talking`.

3. **Delete** now-unused local chat: `src/components/Chat.tsx`, `src/store/chat.ts`,
   `src/lib/chat-api.ts`.

## Verify

- `pnpm --filter @sidekick/expo typecheck`
- iOS sim against real backend per memory: local pg (sidekick-pg :55432),
  `tsx watch --env-file=.env src/dev.ts` in packages/server,
  `EXPO_PUBLIC_DISABLE_3D=1 expo start --dev-client --clear`, cold-launch
  (TrueSheet breaks on fast refresh). Web: TrueSheet is native-only — report behavior.
