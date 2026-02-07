# Signal & Pattern — Personality Test

A potion-themed personality test with an editorial UI, data-driven questions, conditional results, and shareable cards. Built for fast iteration on content and weights.

## Features
- Data-driven questions, dimensions, and results
- Conditional result logic with priorities
- Animated progress and choice transitions
- Share card download
- Result lore, tasting notes, and ritual labels

## Structure
- `index.html`: App shell
- `assets/css/style.css`: Styles
- `assets/js/app.js`: App logic
- `data/settings.json`: Title, subtitle, dimensions
- `data/questions.json`: Questions and options
- `data/results.json`: Result profiles and conditions

## Run Locally
Use any static server. Example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in the browser.

## Customize
- Update the title/subtitle/dimensions in `data/settings.json`.
- Add questions and options with `weights` mapped to dimension IDs in `data/questions.json`.
- Update result cards, lore, and conditions in `data/results.json`.

## Question Format
```json
{
  "id": "q1",
  "prompt": "You open a locked chest. What’s inside?",
  "options": [
    {
      "text": "A bowl of still water that never spills.",
      "weights": { "calm": 3, "resolve": 2, "tempo": -1 }
    }
  ],
  "image": ""
}
```

## Result Format
```json
{
  "id": "potion_crownfire",
  "title": "Crownfire",
  "summary": "...",
  "lore": "...",
  "priority": 18,
  "conditions": [
    { "type": "min", "dim": "courage", "value": 16 },
    { "type": "diff_abs_lte", "a": "courage", "b": "tempo", "value": 6 }
  ],
  "image": "/assets/images/potion_crownfire.png"
}
```

## Result Conditions
Supported condition forms:
- `{ "type": "min", "dim": "calm", "value": 3 }`
- `{ "type": "max_le", "dim": "focus", "value": 2 }`
- `{ "type": "diff_greater", "a": "calm", "b": "courage", "value": 2 }`
- `{ "type": "diff_abs_lte", "a": "focus", "b": "charm", "value": 1 }`
- `{ "type": "top_is", "dim": "charm" }`
- `{ "type": "top_diff_gte", "value": 3 }`
- `{ "type": "top_diff_lte", "value": 1 }`
- `{ "type": "total_min", "value": 5 }`
- `{ "type": "total_max", "value": -2 }`

Backwards-compatible condition format (still supported):
- `{ "dim": "calm", "op": "gte", "value": 3 }`
- `{ "dim": "focus", "min": -2, "max": 2 }`

When multiple results match, the highest `priority` wins (ties resolve by order).

## Share Cards
Use the “Share” button on results to generate a downloadable share card. The card size and layout are controlled in `assets/js/app.js` inside `downloadShareCard()`.

## GitHub Pages Deploy
This repo includes a Pages workflow using GitHub Actions.

1. Commit the workflow in `.github/workflows/pages.yml`.
2. In GitHub ? Settings ? Pages, select **GitHub Actions** as the source.
3. Push to `main` to trigger a deployment.

## Icons
Ingredient icons live in `assets/icons/` and are simple inline SVGs.
