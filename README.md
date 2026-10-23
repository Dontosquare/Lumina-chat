# Lumina-chat
This repository is to practice my skills in agentic coding.

## Lumina Wealth

A personal wealth manager that doesn't just track spending: a **budget agent** (*Budgethjælper* in the app) reads your real spending and your goals, then suggests budget reallocations. You pick an *intent* (Balanced, Max savings, Protect lifestyle, or focus on one goal), watch the agent reason step by step, and accept or dismiss each suggestion.

The interface is in Danish and amounts are in DKK. You can add spending by hand or [import it from your bank's CSV export](#importing-a-bank-csv).

Everything runs locally. There are no API keys and no paid services, and the app never contacts the internet.

### Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Demo data is created on first run in `data/db.json`. Use **Reset demo data** in the app (or `npm run reset`) to start over.

For a production build: `npm run build && npm start`, then open http://localhost:3001.

### Importing a bank CSV

In the **Seneste forbrug** panel, click **Importér CSV** and choose the file your bank lets you export. You review everything before anything is saved:

- **Formats:** comma, semicolon or tab separated; UTF-8 or the older Windows-1252 encoding; Danish numbers (`-1.234,56`) and dates (`24.10.2026`). Files without a header row work too.
- **Columns:** date, amount and text are detected from the header names or from what the values look like. If it guesses wrong, change them with the dropdowns.
- **Only spending is imported.** Incoming payments (salary, refunds) are skipped, and lines that can't be read are counted in the summary.
- **Categories are guessed** from how you filed the same text before, then from a list of common Danish shops and services. Rows it can't place have a dashed border and default to Shopping. Fixing one row also fixes the untouched rows with the same text.
- **Duplicates** (same date, amount and text as something you already have) start unticked, so importing the same file twice adds nothing.
- The import is all-or-nothing: if any row is invalid, nothing is saved.

To try it, import [samples/demo-bank-export.csv](samples/demo-bank-export.csv). Not supported yet: banks that put money in and out in separate columns.

### How it's built

| Part | Where | What it does |
|---|---|---|
| Frontend | `client/` | Vue 3 + Vite. `store.js` holds app state; one component per panel |
| API | `server/index.js` | Express. Every endpoint returns the full app state |
| Money math | `server/finance.js` | Pure functions: averages, goal pace, unassigned income |
| Agent | `server/agent.js` | Tools + a decision policy + a loop with guardrails |
| CSV import | `server/csv.js`, `client/src/components/CsvImport.vue` | Parses a bank export, detects columns, guesses categories. A preview endpoint changes nothing; a second call saves the rows you kept |
| Storage | `server/store.js` | A JSON file, nothing to install |

### How the agent works

`server/agent.js` follows the same shape as an LLM agent:

1. **Tools**: small functions that each observe or compute one thing (`read_snapshot`, `analyze_spending`, `assess_goals`, `find_funding`, `draft_plan`, `review_plan`).
2. **`decide()`**: the "brain". It looks at what it has learned so far and picks the next tool, or stops, explaining its thought.
3. **`runAgent()`**: the loop. Decide → run tool → remember result → repeat, with a step limit.
4. **Human in the loop**: suggestions are proposals. Data only changes when you accept one, and stale suggestions are rejected.

Its rules, in order: fix essential budgets that don't match reality, fund goals by priority using unassigned income and unused budget, and propose a realistic deadline when a goal can't be funded rather than pretending.

To make it a "real" AI agent later, replace `decide()` with a model call that chooses among the same tools. Note that this would cost money per run.
