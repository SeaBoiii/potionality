# Migration to Vite + React + TypeScript

This repository was migrated from a static HTML/CSS/vanilla-JS site to a Vite + React + TypeScript SPA.

## What changed

- New app runtime:
  - `index.html` is now a Vite entry (`/src/main.tsx`)
  - React app lives in `src/App.tsx`
  - Shared quiz logic lives in `src/lib/quiz.ts`
  - Types are defined in `src/types.ts`
- Legacy snapshot:
  - Previous static entry copied to `legacy/index.static.html`
  - Previous script copied to `legacy/assets/js/app.js`
- Build/deploy:
  - `vite.config.ts` sets `base: "/potionality/"`
  - Static `assets/` and `data/` are copied into build output via `vite-plugin-static-copy`
  - GitHub Actions workflow now builds with Node and deploys `dist/`

## Behavior parity preserved

The React app keeps the same core behavior as the vanilla implementation:

- Question flow with transitions and answer locking
- Dimension scoring and weighted options
- Conditional result resolution with priority tie-breaks
- Fallback top-dimension result mapping
- Result rendering (title, summary, lore, labels, tasting notes, signals)
- Dimension analysis panel toggle
- Sound toggle/chime
- Share-card PNG generation via `<canvas>`
- Copy result link functionality

## URL share state

Two formats are supported:

1. New format (`state`):
   - Query param: `state=<base64url-json>`
   - Encodes version, `resultId`, normalized `scores`, and `answers`
   - Restored on load

2. Legacy compatibility format:
   - Query params: `result=<resultId>&scores=<encoded-json>`
   - Existing shared links still resolve

When a result is shown, URL query state is synced with `history.replaceState`.

## Data model and where to edit content

Quiz content remains JSON-driven and source-of-truth stays in:

- `data/settings.json`
- `data/questions.json`
- `data/results.json`

### Add/edit questions

1. Open `data/questions.json`.
2. Add/update objects in `questions`.
3. For each option, define `weights` using dimension IDs from `data/settings.json`.
4. Optional images should reference project-relative paths like `assets/images/q17.png`.

Question shape:

```json
{
  "id": "q17",
  "prompt": "Your prompt",
  "image": "assets/images/q17.png",
  "options": [
    {
      "text": "Choice A",
      "image": "assets/images/q17/a.png",
      "weights": {
        "calm": 2,
        "courage": -1,
        "focus": 1,
        "charm": 0,
        "tempo": 1,
        "insight": 0,
        "resolve": 1,
        "wonder": -1
      }
    }
  ]
}
```

### Add/edit results

1. Open `data/results.json`.
2. Add/update entries in `results`.
3. Define `conditions` and `priority`.
4. Include optional `palette`, `tasting_notes`, `side_effect`, `signature_ritual`, and `signals`.

Condition types preserved from previous app logic:

- `min`, `max_le`, `max_ge`
- `diff_greater`, `diff_abs_lte`
- `top_is`, `not_top_is`, `rank_is`
- `top_diff_gte`, `top_diff_lte`
- `total_min`, `total_max`
- `sum_min`, `sum_max`
- `spread_between`

## Local development

```bash
npm install
npm run dev
npm run build
npm run preview
```

`vite.config.ts` already includes the GitHub Pages base path.

## Notes

- The content editor under `editor-ui/` still reads from `data/*.json`.
- If you add new static files (images/icons/etc), place them under `assets/` or `data/` so they are copied into `dist/` by the Vite build.
