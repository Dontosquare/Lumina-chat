import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, save, reset, clear } from './store.js';
import { snapshot, toISODate } from './finance.js';
import { runAgent, applySuggestion, MODES } from './agent.js';
import { handleMessage, undoMessage } from './chat.js';

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
    chat: db.chat ?? [],
    modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])),
  };
}

app.get('/api/state', wrap(async (req, res) => res.json(await state())));

app.patch('/api/income', wrap(async (req, res) => {
  const income = Number(req.body.income);
  if (!Number.isFinite(income) || income < 0) throw fail(400, 'Indkomsten skal være et positivt tal');
  (await load()).income = Math.round(income);
  await save();
  res.json(await state());
}));

app.post('/api/transactions', wrap(async (req, res) => {
  const db = await load();
  const { category, note = '' } = req.body;
  const amount = Number(req.body.amount);
  const date = req.body.date || toISODate(new Date());
  if (!db.budgets.some((b) => b.id === category)) throw fail(400, 'Ukendt kategori');
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Beløbet skal være større end 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Datoen skal have formatet ÅÅÅÅ-MM-DD');
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

app.patch('/api/budgets/:id', wrap(async (req, res) => {
  const db = await load();
  const budget = db.budgets.find((b) => b.id === req.params.id);
  if (!budget) throw fail(404, 'Budgettet blev ikke fundet');
  const monthly = Number(req.body.monthly);
  if (!Number.isFinite(monthly) || monthly < 0) throw fail(400, 'Budgettet skal være 0 eller mere');
  budget.monthly = Math.round(monthly);
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
  if (!name) throw fail(400, 'Giv målet et navn');
  if (!(target > 0) || saved < 0 || monthlyContribution < 0) throw fail(400, 'Beløb skal være positive');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || '')) throw fail(400, 'Vælg en deadline');
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

app.post('/api/chat', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) throw fail(400, 'Skriv en besked til rådgiveren');
  const db = await load();
  handleMessage(db, text);
  await save();
  res.json(await state());
}));

app.post('/api/chat/:id/undo', wrap(async (req, res) => {
  const db = await load();
  try {
    undoMessage(db, req.params.id);
  } catch (err) {
    throw fail(409, err.message);
  }
  await save();
  res.json(await state());
}));

app.post('/api/agent/suggestions/:id/:action(apply|dismiss)', wrap(async (req, res) => {
  const db = await load();
  const s = db.lastRun?.suggestions.find((x) => x.id === req.params.id);
  if (!s) throw fail(404, 'Forslaget blev ikke fundet');
  if (s.status !== 'pending') throw fail(409, s.status === 'applied' ? 'Forslaget er allerede accepteret' : 'Forslaget er allerede afvist');
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

app.post('/api/clear', wrap(async (req, res) => {
  await clear();
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
