import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, save, reset, clear } from './store.js';
import { snapshot, toISODate } from './finance.js';
import { runAgent, applySuggestion, MODES } from './agent.js';
import { previewImport } from './csv.js';

const app = express();
app.use(express.json({ limit: '5mb' })); // room for a year of bank statement CSV

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
  if (!Number.isFinite(income) || income < 0) throw fail(400, 'Indkomsten skal være et positivt tal');
  (await load()).income = Math.round(income);
  await save();
  res.json(await state());
}));

function toTransaction(db, { category, note = '', ...body }, id) {
  const amount = Number(body.amount);
  const date = body.date || toISODate(new Date());
  if (!db.budgets.some((b) => b.id === category)) throw fail(400, 'Ukendt kategori');
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Beløbet skal være større end 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Datoen skal have formatet ÅÅÅÅ-MM-DD');
  return { id, date, category, amount: Math.round(amount * 100) / 100, note: String(note).slice(0, 80) };
}

app.post('/api/transactions', wrap(async (req, res) => {
  const db = await load();
  db.transactions.unshift(toTransaction(db, req.body, `t${Date.now()}`));
  db.transactions.sort((a, b) => b.date.localeCompare(a.date));
  await save();
  res.json(await state());
}));

// CSV import in two steps: preview (nothing is saved) and import of the rows you kept.
app.post('/api/import/preview', wrap(async (req, res) => {
  const db = await load();
  const m = req.body.mapping;
  const mapping = m && ['date', 'amount', 'text'].every((k) => Number.isInteger(m[k])) ? m : undefined;
  try {
    res.json(previewImport(req.body.text, db, mapping));
  } catch (err) {
    throw fail(400, err.message);
  }
}));

app.post('/api/import', wrap(async (req, res) => {
  const db = await load();
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw fail(400, 'Vælg mindst én postering');
  if (rows.length > 5000) throw fail(400, 'Højst 5000 posteringer ad gangen');
  const stamp = Date.now();
  // Validate every row before saving any, so a bad row never leaves half an import behind.
  const added = rows.map((r, i) => toTransaction(db, r, `t${stamp}-${i}`));
  db.transactions.push(...added);
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
