# Architecture cleanup — collapsing to one app

The `packages/` layout was designed for the two-app world (web develops, expo
ships). With one universal Expo app, most of it is vestigial. Rule going
forward: **`packages/` holds genuinely separate deployables** — expo (the
product), landing (marketing), web (until deleted). Everything else is a
directory inside the app that owns it — except authored art, which belongs to
the product rather than to any app and moves to a top-level `assets/`.

## Verdicts

| Package | Real consumers | Verdict |
| --- | --- | --- |
| `expo` | — (it's the product) | **Keep.** Absorbs core. |
| `shared/core` | expo only (web declares the dep, imports it 0×) | **Dissolve** → `expo/src/core/` |
| `config/tsconfig` | web + shared/core only (expo extends `expo/tsconfig.base`; landing has its own) | **Delete** — zero consumers once those two are gone |
| `config/tailwind` | expo + web (landing has no tailwind at all) | **Decide** — one consumer after web dies; same not-a-package argument |
| `landing` | independent, zero workspace deps | **Keep, untouched** |
| `web` | deprecated reference | **Delete** after Phase 2–3 unblock it |

Not-a-package test, for the record: one consumer, no build step (`main` →
`src/index.ts`), no version, zero deps, and no enforced boundary — core can
`import { View } from 'react-native'` today and typecheck clean, because
`node-linker=hoisted` resolves it from the root. The `package.json` buys
exactly one thing: making `@sidekick/core` resolve. Expo already has
`~/*` → `./src/*`, so `~/core` is the same ergonomics for free.

Same reasoning kills **`@sidekick/three`** before it's built — it would have
exactly one consumer. `CLAUDE.md` currently promises it as architecture;
drop the promise. The scene stays at `expo/src/three/`.

## Phase 1 — dissolve core (no blockers, do first)

- `git mv packages/shared/core/src` → `packages/expo/src/core/`
- Rewrite 20 import sites: `@sidekick/core` → `~/core` (mechanical)
- Delete `packages/shared/`, its `packages/shared/*` workspace glob, and
  **web's phantom `@sidekick/core` dep** (0 imports, ever — that one line is
  the entire evidence for the "shared" story)
- Add eslint `no-restricted-imports` on `src/core/**` (ban `react-native`,
  `expo*`, `three*`, `~/components`, `~/store`). The boundary becomes real for
  the first time — today it's enforced by nothing.
- Docs: drop `@sidekick/three` from `CLAUDE.md`; fix the "so every platform
  computes identically" framing in core's header + `docs/MONOREPO.md`. True
  reason: **rules stay separable from UI/renderer, and testable without Metro.**
  Membership rule: *is it pure and platform-free?*
- Prune 4 stale git worktrees (`cade+3d-environment`, `cade+onboarding`,
  `cade+onboarding-port`, `cade+onboarding71`) — each holds a full stale copy of
  `CLAUDE.md` + `docs/`, which is an agent-confusion hazard when grepping.

## Phase 2 — canonical art moves to top-level `assets/` (the real blocker)

`packages/web/public/` is still the art source: the Blender char-pipeline
writes there, `expo/scripts/sync-cosmetics.mjs` derives from there. **Deleting
web today deletes the art source.**

**Decision: top-level `assets/`.** It's the *product's* art, not the app's —
it predates expo, it outlives expo, and the char-pipeline that authors it isn't
a workspace package either. Burying it in `packages/expo/assets/source/` would
mean moving it again the next time the app package changes shape, and would put
authored source next to `expo/assets/` derived output — the exact distinction
that has to stay obvious.

This is a **sort, not a move.** `web/public` is ~50 entries and most of it is
funnel/design-system cruft that should die with web (`quiz-*`, `welcome-*`,
`scenes/`, `icons-y2k` + `icons-macos9` (15M of style-guide experiments),
`backdrops/`, `choose-color/`, `faces/`, `types/`, `fonts/`, `chat-header`,
`meet-sidekick`, `masktest`, `sidekick-3d.glb`, superseded `face-sheet`
v2/v3/v4/base, and the 2 unused world-map variants).

Move only what the product actually derives from — **and keep the relative
layout identical**, so the script repoint is a one-line const change rather
than a rewrite:

```
assets/                     canonical source art (authored; expo/assets is derived)
  cosmetics/                slot GLBs + variant .webp + manifest.json + its *.md contracts
  shop-renders/             product art (410 files land in expo)
  props/                    lootbox-v1.glb
  3d-assets/                the *.md contracts (facesprite, phone, shirt, cosmetics-system)
  sidekick-rigged.glb       the rig
  face-sheet-v6.png         current atlas
  world-map-{day,quests,quests-evening,quests-night}.webp
```

- Repoint `sync-cosmetics.mjs`: `WEB_PUBLIC = join(EXPO,'..','web','public')`
  → `join(ROOT,'assets')`. With the layout preserved, `COS_SRC` / `RENDER_SRC` /
  `lootSrc` follow for free.
- Repoint `tools/char-pipeline` output paths + `CHARACTER.md` / `README.md`
- **Finish the job while you're in there:** derivation is currently half
  scripted, half hand-copied. `sync-cosmetics.mjs` covers cosmetics,
  shop-renders, and the lootbox — but `sidekick-rigged.glb`, `phone.glb`,
  `face-sheet-v6.png`, the world maps, and `sidekick-pfp.webp` are copied into
  `expo/assets/` **by hand**, undocumented. That's the same hand-copy drift
  hazard this whole refactor exists to kill. Fold them into the script.
- Move `packages/web/.illustrate/` — the /illustrate skill's style profile
  (config, character spec, reference images). Its `outDir`/ref paths are
  package-relative, so this breaks silently if forgotten. `assets/.illustrate/`
  keeps it next to the art it describes.
- Decide: `web/design-system/` (static style-guide HTML) and
  `web/src/config-presets/` — port, relocate, or drop.
- **Sequencing note:** moving `public/` out breaks web's *rendering* (Vite
  serves art from there), while Phase 4 is what deletes it. Fine if you only
  ever read web's source — but if you still want it runnable for visual
  comparison until deletion, symlink `packages/web/public/cosmetics` →
  `../../../assets/cosmetics` (and siblings) for the interim.
- Stale while you're here: `expo/README.md` claims the bundled atlas is
  `face-sheet-v3.png`; the code requires `face-sheet-v6.png`. Expo's boilerplate
  `react-logo*.png` / `partial-react-logo.png` can go too.

## Phase 3 — the chat/API question (bigger than it looks)

**The deprecated app is the only one doing this correctly.** `web/api/chat.js`
is a serverless proxy that exists to keep the key server-side. Expo calls
`api.openai.com` **directly** with `EXPO_PUBLIC_OPENAI_API_KEY` — and
`EXPO_PUBLIC_*` is inlined into the client bundle at build time. So the
surviving app ships the OpenAI key to every user, and deleting web deletes the
only proxy. Fine for dev; not fine for the App Store, and guided sessions add
an LLM extraction pass on top.

- Port `api/chat.js` into an endpoint expo can call, before or alongside web's
  deletion. Don't let the proxy die with the package.
- Decide the Vercel project's fate (root dir is `packages/web`): repoint to an
  Expo Web export, or shut it down and deploy separately.
- **Note the convergence:** if this API surface exists, it's also where
  server-side economy validation would live (a client-authoritative token
  economy wants it eventually) — and at that point pure rules get a second
  consumer and `core` becomes a genuine package again. That's the trigger to
  extract it back out. Cheap both directions; it's a directory either way.

## Phase 4 — delete web

- `rm -rf packages/web`
- Delete `packages/config/tsconfig` (zero consumers by now)
- Decide `config/tailwind`: fold into `expo/tailwind.preset.js`, or keep the
  package if landing ever adopts brand tokens (it currently has no tailwind)
- Delete `docs/SYNC-PLAN.md` (already marked historical)
- Root `build` script still points at web's build — repoint to the expo export
- Regenerate `docs/index.html` (`node docs/build-index.mjs`)

## Worth doing, unscheduled

**Tests.** Zero in the repo. `expo/src/core/` will be pure with no external
imports — `node --test` works on it with no harness. It's also the code where
bugs are silent and expensive: `todaysShop` is a date-seeded Fisher–Yates that
must restock at midnight and stay stable all day; `daily-box` odds; mulberry32
determinism; ISO week boundaries; streak resets; session-ladder gating. Roughly
55% of core is catalogs, but that other 45% decides what users are offered and
what they pay.
