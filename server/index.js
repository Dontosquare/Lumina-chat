import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, save, reset } from './store.js';
import { snapshot, toISODate } from './finance.js';
import { runAgent, applySuggestion, MODES } from './agent.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(err.status || 500).json({ error: err.message }));
const fail = (status, message) => Object.assign(new Error(message), { status });

async function state() {
  const db = await load();
  return {
    ...snapshot(db),
    transactions: db.transactions.slice(0, 40),
    lastRun: db.lastRun,
    modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])),
  };
}

app.get('/api/state', wrap(async (req, res) => res.json(await state())));

app.patch('/api/income', wrap(async (req, res) => {
  const income = Number(req.body.income);
  if (!Number.isFinite(income) || income < 0) throw fail(400, 'Income must be a positive number');
  (await load()).income = Math.round(income);
  await save();
  res.json(await state());
}));

app.post('/api/transactions', wrap(async (req, res) => {
  const db = await load();
  const { category, note = '' } = req.body;
  const amount = Number(req.body.amount);
  const date = req.body.date || toISODate(new Date());
  if (!db.budgets.some((b) => b.id === category)) throw fail(400, 'Unknown category');
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Amount must be greater than 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Date must be YYYY-MM-DD');
  db.transactions.unshift({ id: `t${Date.now()}`, date, category, amount: Math.round(amount * 100) / 100, note: String(note).slice(0, 80) });
  db.transactions.sort((a, b) => b.date.localeCompare(a.date));
  await save();
  res.json(await state());
}));

app.delete('/api/transactions/:id', wrap(async (req, res) => {
  const db = await load();
  db.transactions = db.transactions.filter((t) => t.id !== req.params.id);
  await save();
  res.json(await state());
}));

app.post('/api/goals', wrap(async (req, res) => {
  const db = await load();
  const name = String(req.body.name || '').trim().slice(0, 40);
  const target = Number(req.body.target);
  const saved = Number(req.body.saved || 0);
  const monthlyContribution = Number(req.body.monthlyContribution || 0);
  const priority = Math.min(3, Math.max(1, Number(req.body.priority) || 2));
  const { deadline } = req.body;
  if (!name) throw fail(400, 'Give the goal a name');
  if (!(target > 0) || saved < 0 || monthlyContribution < 0) throw fail(400, 'Amounts must be positive');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || '')) throw fail(400, 'Pick a deadline');
  db.goals.push({ id: `g${Date.now()}`, name, target, saved, deadline, priority, monthlyContribution });
  await save();
  res.json(await state());
}));

app.delete('/api/goals/:id', wrap(async (req, res) => {
  const db = await load();
  db.goals = db.goals.filter((g) => g.id !== req.params.id);
  await save();
  res.json(await state());
}));

app.post('/api/agent/run', wrap(async (req, res) => {
  const db = await load();
  db.lastRun = runAgent(db, req.body);
  await save();
  res.json(await state());
}));

app.post('/api/agent/suggestions/:id/:action(apply|dismiss)', wrap(async (req, res) => {
  const db = await load();
  const s = db.lastRun?.suggestions.find((x) => x.id === req.params.id);
  if (!s) throw fail(404, 'Suggestion not found');
  if (s.status !== 'pending') throw fail(409, `Already ${s.status}`);
  if (req.params.action === 'apply') {
    try {
      applySuggestion(db, s);
    } catch (err) {
      throw fail(409, err.message);
    }
    s.status = 'applied';
  } else {
    s.status = 'dismissed';
  }
  await save();
  res.json(await state());
}));

app.post('/api/reset', wrap(async (req, res) => {
  await reset();
  res.json(await state());
}));

// In production (`npm run build && npm start`) the API also serves the built frontend.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Lumina API on http://localhost:${PORT}`));
