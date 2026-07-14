# Config presets

Look-dev states for `/sidekick-3d`, recovered (2026-07-13) from the browser
localStorage of earlier dev-server origins — each port was a separate origin,
so each kept its own saved state. Checked in here so they survive browser
storage and are selectable from the panel's **Config presets** folder
(applying one overwrites the saved localStorage state and reloads).

Top-level `*.json` files are auto-discovered by `sidekick-3d.tsx` via
`import.meta.glob` — drop a new file here (e.g. from the panel's
"download config" button) and it shows up in the picker with no code change.

| File | Origin | Look |
|---|---|---|
| `cel-scenes-3100.json` | :3100 (monorepo era, most recent) | cel + outline, full day/evening/night scene presets, evening active |
| `cel-bloom-tilt-5173.json` | :5173 (original standalone era) | cel, bloom + tilt-shift, pulled-back camera, full scenes |
| `cel-ao-shafts-3104.json` | :3104 (worktree) | cel + AO + light shafts + tilt (some fields predate the current schema and are ignored) |
| `toon-flat-3104v3.json` | :3104 (`-v3` experiment) | 2-band toon, flat ground colors |
| `sss-bloom-3103.json` | :3103 (worktree) | sss shading + bloom, amber shirt |
| `sss-bloom-3105.json` | :3105 (worktree) | sss shading + bloom variant |
| `physical-amber-3103v1.json` | :3103 (pre-`v2` key) | early physical-material amber look (partial — defaults fill the rest) |

`legacy/` holds recovered non-settings keys from the :5173 era (`sidekick-poses-v1`
phone-hold pose, `sidekick-wardrobe-v1`) — kept for reference, not loaded by the app.
