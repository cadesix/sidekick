# Plan 14 — Deep Talks implementation notes

## Session state (no migration): message markers + reward rows
- Start: a `messages` row `role='deep_talk'`, content `start:<slug>`, inserted by `deepTalks.start`.
- Complete: a `messages` row `role='deep_talk'`, content `complete:<slug>`, inserted synchronously by
  the `complete_deep_talk` server tool (it has `db`).
- Active = latest `deep_talk` marker in the conversation, phase `start`, within 48h. Cleared the
  instant a `complete` marker is written; expires at 48h.
- `deep_talk` rows are invisible to the model (`assembleTail` ignores non user/assistant/tool roles)
  and filtered from the client thread in `lib/api.ts`.
- Cache: the ACTIVE DEEP TALK block is injected in `context.ts` in region B (alongside memory), the
  last region-B block carries the breakpoint. Stable during a session, one break on start/complete.

## Score (shared pure fn) + recompute hook
- `computeContextScore(counts)` = round(100 × Σ w_k·min(n_k,c_k)/c_k), weights/caps from plan table.
- `recomputeContextScore(db, userId)` (server): count active memories by kind, compute, clamp to never
  drop below stored `users.contextScore`, store, grant one event cosmetic per crossed 25-pt band.
- Hooked after extraction in `jobs/idle.ts` and in the immediate `finishDeepTalk` path.

## Completion path (immediate extraction can't run inside the tool — no model in ToolContext)
- Tool writes the complete marker only.
- `chat.send` detects the `complete_deep_talk` call on the turn's assistant message and schedules
  `finishDeepTalk` (extraction → rescore → grant sparks). Idle sweep settles the streaming path.

## Import (paste v1)
- `deepTalks.import.stage(text)` → model extraction → staged candidates (not applied).
- `deepTalks.import.commit(candidates)` → write memories `source:'import'`, rescore, one reaction msg.

## Zip path: left as a seam (paste is v1).
</content>
</invoke>
