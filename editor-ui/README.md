# Potionality Data Builder

This standalone UI lets you build and edit:
- `settings.json`
- `questions.json`
- `results.json`

## Run

Serve the repo with any static server, then open:
- `http://localhost:8080/editor-ui/`

Example:

```bash
python -m http.server 8080
```

## Workflow

1. Click **Load Starter Example** for a minimal template dataset.
2. Or click **Load ../data/*.json** to load your current project files.
3. Use tabs to edit **Settings**, **Questions**, and **Results** separately.
4. In Results, use **Condition Wiki** for condition meanings/examples.
5. Potion-only fields are hidden by default; enable **Show potion-specific result fields** only when needed.
6. You can edit JSON in each tab and apply it back to forms.
7. Download each file with the download buttons.

## Notes

- Browsers cannot directly overwrite files on disk from a static page, so this tool outputs downloadable JSON files.
- You can also import local JSON files back into the UI.
