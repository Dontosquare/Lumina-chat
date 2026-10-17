# Lumina-chat
This repository is to practice my skills in agentic coding.

## Lumina Wealth

A personal wealth manager that doesn't just track spending: a **budget agent** reads your real spending and your goals, then suggests budget reallocations. You pick an *intent* (Balanced, Max savings, Protect lifestyle, or focus on one goal), watch the agent reason step by step, and accept or dismiss each suggestion.

Everything runs locally. There are no API keys and no paid services, and the app never contacts the internet.

### Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Demo data is created on first run in `data/db.json`. Use **Reset demo data** in the app (or `npm run reset`) to start over.

For a production build: `npm run build && npm start`, then open http://localhost:3001.

### How it's built

| Part | Where | What it does |
|---|---|---|
| Frontend | `client/` | Vue 3 + Vite. `store.js` holds app state; one component per panel |
| API | `server/index.js` | Express. Every endpoint returns the full app state |
| Money math | `server/finance.js` | Pure functions: averages, goal pace, unassigned income |
| Agent | `server/agent.js` | Tools + a decision policy + a loop with guardrails |
| Storage | `server/store.js` | A JSON file, nothing to install |

### How the agent works

`server/agent.js` follows the same shape as an LLM agent:

1. **Tools**: small functions that each observe or compute one thing (`read_snapshot`, `analyze_spending`, `assess_goals`, `find_funding`, `draft_plan`, `review_plan`).
2. **`decide()`**: the "brain". It looks at what it has learned so far and picks the next tool, or stops, explaining its thought.
3. **`runAgent()`**: the loop. Decide → run tool → remember result → repeat, with a step limit.
4. **Human in the loop**: suggestions are proposals. Data only changes when you accept one, and stale suggestions are rejected.

Its rules, in order: fix essential budgets that don't match reality, fund goals by priority using unassigned income and unused budget, and propose a realistic deadline when a goal can't be funded rather than pretending.

To make it a "real" AI agent later, replace `decide()` with a model call that chooses among the same tools. Note that this would cost money per run.
