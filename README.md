# 🧪 Potionality - If You Were a Potion

<div align="center">

**A potion-themed personality test with an editorial UI, data-driven questions, conditional results, and shareable cards.**

[![GitHub Pages](https://img.shields.io/badge/demo-live-success?style=flat-square)](https://seaboiii.github.io/potionality/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Live Demo](https://seaboiii.github.io/potionality/) | [Report Issue](https://github.com/SeaBoiii/potionality/issues)

</div>

---

## 📖 About

Potionality is a reflective personality assessment that reveals your dominant brew across eight forces: **calm**, **courage**, **focus**, **charm**, **tempo**, **insight**, **resolve**, and **wonder**. Through a series of thoughtfully crafted questions, discover which mystical potion best represents your unique personality.

Built for fast iteration on content and weights, this project features a beautiful editorial design with smooth animations, data-driven architecture, and sharable result cards perfect for social media.

## 📋 Table of Contents

- [Features](#-features)
- [Technologies Used](#-technologies-used)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Run Locally](#run-locally)
- [Project Structure](#-project-structure)
- [Customization Guide](#-customization-guide)
  - [Settings Configuration](#settings-configuration)
  - [Question Format](#question-format)
  - [Result Format](#result-format)
  - [Result Conditions](#result-conditions)
- [Tools](#-tools)
  - [Result Path Finder](#result-path-finder)
  - [Reachability Checker](#reachability-checker)
- [Share Cards](#-share-cards)
- [Deployment](#-deployment)
  - [GitHub Pages](#github-pages)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

- **Data-Driven Architecture** - Questions, dimensions, and results are all configurable via JSON files
- **Conditional Result Logic** - Sophisticated matching system with priority-based resolution
- **Smooth Animations** - Beautiful progress transitions and choice interactions
- **Live Profile Updates** - See your dimensional profile evolve as you answer questions
- **Downloadable Share Cards** - Generate beautiful cards to share your results on social media
- **Shareable Result Links** - Copy direct links to your specific result
- **Sound Effects** - Optional audio feedback for interactions (toggleable)
- **Responsive Design** - Works seamlessly on desktop and mobile devices
- **Editorial Typography** - Elegant Cormorant Garamond and Mulish font pairing
- **Result Lore** - Each potion includes tasting notes, lore, and ritual labels

## 🛠 Technologies Used

- **HTML5** - Semantic markup structure
- **CSS3** - Custom properties, animations, and responsive design
- **Vanilla JavaScript** - No frameworks, pure ES6+ JavaScript
- **JSON** - Data-driven content configuration
- **Canvas API** - Share card generation
- **GitHub Actions** - Automated deployment pipeline
- **GitHub Pages** - Static site hosting

## 🚀 Getting Started

### Prerequisites

No build tools or dependencies required! This is a static web application that runs entirely in the browser.

### Run Locally

Use any static file server. Here are a few options:

**Using Python:**
```bash
python -m http.server 8080
```

**Using Node.js (with http-server):**
```bash
npx http-server -p 8080
```

**Using PHP:**
```bash
php -S localhost:8080
```

Then open `http://localhost:8080` in your browser.

## 📁 Project Structure

```
potionality/
├── index.html                 # Main app shell and structure
├── assets/
│   ├── css/
│   │   └── style.css         # All styles and animations
│   ├── js/
│   │   └── app.js            # Application logic and interactions
│   ├── icons/                # SVG ingredient icons
│   └── images/               # Potion result images
├── data/
│   ├── settings.json         # Title, subtitle, and dimension definitions
│   ├── questions.json        # Question prompts and weighted options
│   └── results.json          # Result profiles with conditions and priority
├── tools/
│   ├── ideal_result_path.py  # Find answer paths for specific results
│   └── reachability_check.py # Validate result reachability and probabilities
└── .github/
    └── workflows/
        └── pages.yml         # GitHub Pages deployment workflow
```

## 🎨 Customization Guide

### Settings Configuration

Edit `data/settings.json` to change the title, subtitle, and dimension definitions:

```json
{
  "title": "If You Were a Potion",
  "subtitle": "A reflective personality test...",
  "dimensions": [
    {
      "id": "calm",
      "label": "Calm",
      "left": "Still",
      "right": "Stirred",
      "description": "How you steady yourself"
    }
  ]
}
```

### Question Format

Add or modify questions in `data/questions.json`. Each question includes a prompt, options with weighted impacts, and an optional image:

```json
{
  "id": "q1",
  "prompt": "You open a locked chest. What's inside?",
  "options": [
    {
      "text": "A bowl of still water that never spills.",
      "weights": { 
        "calm": 3, 
        "resolve": 2, 
        "tempo": -1 
      }
    }
  ],
  "image": ""
}
```

**Weight Guidelines:**
- Positive values increase the dimension score
- Negative values decrease the dimension score
- Typical range: -3 to +3
- Use weights strategically to shape result outcomes

### Result Format

Define result profiles in `data/results.json`. Each result includes metadata, conditions for matching, and display content:

```json
{
  "id": "potion_crownfire",
  "title": "Crownfire",
  "summary": "Bold and radiant, you're meant to be seen.",
  "lore": "Forged in the heart of a volcanic summer...",
  "tastingNotes": "Ash and citrus with a finish of spun gold.",
  "ritual": "Light a candle at dawn...",
  "priority": 18,
  "conditions": [
    { "type": "min", "dim": "courage", "value": 16 },
    { "type": "diff_abs_lte", "a": "courage", "b": "tempo", "value": 6 }
  ],
  "image": "/assets/images/potion_crownfire.png"
}
```

### Result Conditions

The matching system supports sophisticated condition logic:

**Dimension-Based Conditions:**
- `{ "type": "min", "dim": "calm", "value": 3 }` - Minimum score required
- `{ "type": "max_le", "dim": "focus", "value": 2 }` - Maximum score allowed

**Comparison Conditions:**
- `{ "type": "diff_greater", "a": "calm", "b": "courage", "value": 2 }` - Difference between dimensions
- `{ "type": "diff_abs_lte", "a": "focus", "b": "charm", "value": 1 }` - Absolute difference check

**Top Dimension Conditions:**
- `{ "type": "top_is", "dim": "charm" }` - Specific dimension must be highest
- `{ "type": "top_diff_gte", "value": 3 }` - Top dimension must lead by at least X
- `{ "type": "top_diff_lte", "value": 1 }` - Top dimension must be close (within X)

**Total Score Conditions:**
- `{ "type": "total_min", "value": 5 }` - Minimum total across all dimensions
- `{ "type": "total_max", "value": -2 }` - Maximum total allowed

**Legacy Format (Still Supported):**
- `{ "dim": "calm", "op": "gte", "value": 3 }` - Greater than or equal
- `{ "dim": "focus", "min": -2, "max": 2 }` - Range check

**Matching Priority:**
When multiple results match all conditions, the highest `priority` value wins. Ties are resolved by order in the JSON file.

## 🔧 Tools

The `tools/` directory contains Python utility scripts to help validate and analyze your quiz configuration.

### Result Path Finder

**Script:** `tools/ideal_result_path.py`

This tool uses constraint solving (Z3) to find a concrete set of answer choices that will lead to a specific quiz result. This is invaluable for testing whether a particular result is achievable and understanding what combination of answers leads to it.

**Prerequisites:**
```bash
python -m pip install z3-solver
```

**Usage:**

List all available result IDs:
```bash
python tools/ideal_result_path.py --list-results
```

Find answer path for a specific result:
```bash
python tools/ideal_result_path.py --result-id potion_velvet
```

**Example Output:**
```
Target result: potion_velvet (Velvet)

Pick these choices:
Q1: option 2 - A bowl of still water that never spills.
Q2: option 1 - Stay and listen.
Q3: option 3 - Write it down in a leather journal.
...

Final scores:
calm: 8
courage: 2
focus: 5
...
```

**Options:**
- `--questions` - Path to questions JSON (default: `data/questions.json`)
- `--results` - Path to results JSON (default: `data/results.json`)
- `--settings` - Path to settings JSON (default: `data/settings.json`)
- `--result-id` - Target result ID to find path for
- `--list-results` - List all available result IDs and exit

### Reachability Checker

**Script:** `tools/reachability_check.py`

This tool performs two types of analysis on your quiz:

1. **Exhaustive Reachability Check** - Uses SMT solving to determine which results can actually be reached by any combination of answers
2. **Probability Estimation** - Uses random sampling to estimate the likelihood of each result

This helps identify unreachable results (which might indicate configuration issues) and understand the distribution of outcomes.

**Prerequisites:**
```bash
python -m pip install z3-solver  # Required for reachability check
```

**Usage:**

Run both reachability and probability analysis:
```bash
python tools/reachability_check.py --samples 200000
```

Check reachability only (faster):
```bash
python tools/reachability_check.py --reachability-only
```

Run probability sampling only:
```bash
python tools/reachability_check.py --sampling-only --samples 1000000
```

Show witness answer paths for reachable results:
```bash
python tools/reachability_check.py --show-witness
```

Use a specific random seed for reproducibility:
```bash
python tools/reachability_check.py --samples 500000 --seed 42
```

**Example Output:**
```
Running exhaustive reachability check (SMT)...
Reachable results: 24/24 (100.00%)
Unreachable: none
Reachability check time: 3.45s

Running random sampling: n=200000, seed=42, workers=7

Estimated result probabilities
------------------------------
potion_crownfire         8.234%  (16468/200000)
potion_velvet            7.891%  (15782/200000)
potion_moonthread        6.543%  (13086/200000)
...
```

**Options:**
- `--questions` - Path to questions JSON (default: `data/questions.json`)
- `--results` - Path to results JSON (default: `data/results.json`)
- `--settings` - Path to settings JSON (default: `data/settings.json`)
- `--samples` - Number of random samples for probability estimation (default: 200000)
- `--seed` - Random seed for reproducible sampling (default: 42)
- `--sampling-only` - Skip exhaustive reachability check
- `--reachability-only` - Skip probability sampling
- `--show-witness` - Show one answer-index witness per reachable result
- `--workers` - Number of parallel worker processes (default: CPU count - 1)

**Use Cases:**
- **Validate Configuration** - Ensure all results are reachable
- **Balance Results** - Check if certain outcomes are too rare or too common
- **Test Changes** - Verify that modifications to questions/conditions don't break reachability
- **Debug Conditions** - Identify which results are impossible due to conflicting conditions

## 🎴 Share Cards

Click the "Download Share Card" button on any result to generate a custom image perfect for social sharing.

**Customize Card Generation:**
Edit the `downloadShareCard()` function in `assets/js/app.js` to modify:
- Canvas dimensions
- Layout and positioning
- Colors and fonts
- Image composition

The generated card includes the potion name, a visual representation, and is automatically downloaded as PNG.

## 🌐 Deployment

### GitHub Pages

This repository includes an automated GitHub Actions workflow for deployment.

**Setup Steps:**

1. **Enable GitHub Pages:**
   - Go to your repository Settings → Pages
   - Under "Source", select **GitHub Actions**

2. **Push to Main:**
   ```bash
   git push origin main
   ```

3. **Deployment:**
   - The workflow automatically triggers on push to `main`
   - Your site will be available at: `https://[username].github.io/potionality/`

4. **Manual Deployment:**
   - Go to Actions tab in your repository
   - Select "Deploy to GitHub Pages" workflow
   - Click "Run workflow"

**Custom Domain (Optional):**
Add a `CNAME` file to the repository root with your custom domain name.

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Test locally** to ensure everything works
5. **Commit your changes** (`git commit -m 'Add some amazing feature'`)
6. **Push to the branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

**Ideas for Contributions:**
- New potion results with unique conditions
- Additional questions that explore different personality facets
- UI/UX improvements and animations
- Accessibility enhancements
- Performance optimizations
- Documentation improvements
- Translation/internationalization

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built for reflective decision-making.**

Made with ✨ by [SeaBoiii](https://github.com/SeaBoiii)

[⬆ Back to Top](#-potionality---if-you-were-a-potion)

</div>
