// The rådgiver chat. No AI: it recognises key words and amounts in what you write,
// changes your budgets directly, and remembers the old values so every change can be undone.

import { fmt, roundDown, unallocated } from './finance.js';
import { TEMPLATES } from './templates.js';

const MAX_MESSAGES = 40;

// Words people use for each budget. Matched against whole words in the message.
const ALIASES = {
  housing: ['bolig', 'husleje', 'leje', 'boligen'],
  groceries: ['dagligvarer', 'mad', 'indkøb', 'supermarked'],
  utilities: ['forsyning', 'el', 'vand', 'varme', 'internet'],
  transport: ['transport', 'bus', 'tog', 'bil', 'benzin', 'rejsekort'],
  dining: ['restaurant', 'restauranter', 'café', 'cafe', 'takeaway', 'spise ude'],
  shopping: ['shopping', 'tøj'],
  entertainment: ['underholdning', 'fritid', 'hobby', 'hobbyer', 'biograf'],
  subscriptions: ['abonnementer', 'abonnement', 'streaming', 'netflix'],
  travel: ['rejser', 'ferie', 'rejse'],
};

const HELP =
  'Jeg forstår f.eks.:\n' +
  '• "Lav et budget med SU" (eller "SU hjemmeboende", "budget med 25000 kr.")\n' +
  '• "Sæt dagligvarer til 2000"\n' +
  '• "Sænk restaurant med 300" / "Hæv transport med 200"\n' +
  '• "Min indkomst er 12000"';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^a-zæøå])${escape(word)}($|[^a-zæøå])`).test(text);

function findBudget(db, text) {
  for (const b of db.budgets) {
    const words = [b.name.toLowerCase(), ...(ALIASES[b.id] ?? [])];
    if (words.some((w) => hasWord(text, w))) return b;
  }
  return null;
}

/** All amounts in the text: "2000", "2.000", "25.000 kr." -> numbers. */
const amountsIn = (text) => [...text.matchAll(/\d{1,3}(?:\.\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/\./g, '')));

// ---------------------------------------------------------------- intents

function templateReply(db, text) {
  const su = /(^|[^a-zæøå])su($|[^a-zæøå])|studerende/.test(text);
  const home = /hjemmeboende|bor hjemme/.test(text);
  const amount = amountsIn(text).find((n) => n >= 1000);
  const wantsBudget = /budget|skabelon|fordel/.test(text);
  if (!su && !(wantsBudget && amount)) return null;

  const tpl = TEMPLATES[su ? (home ? 'su_hjemme' : 'su_ude') : 'generic'];
  const income = amount ?? tpl.income;
  db.income = income;
  for (const b of db.budgets) b.monthly = roundDown(income * (tpl.shares[b.id] ?? 0));
  // What's left after the budgets, before what's already promised to goals.
  const afterBudgets = income - db.budgets.reduce((s, b) => s + b.monthly, 0);
  const toGoals = db.goals.reduce((s, g) => s + g.monthlyContribution, 0);
  const savings = toGoals > afterBudgets
    ? `Efter budgetterne er der ${fmt(afterBudgets)}/md. tilbage, men dine mål er sat til ${fmt(toGoals)}/md. ` +
      'Sænk opsparingen til dine mål, eller bed rådgiveren nedenfor om at gennemgå planen.'
    : `Der er ${fmt(afterBudgets - toGoals)}/md. tilbage til opsparing${toGoals ? ` ud over de ${fmt(toGoals)}, der går til dine mål` : ''}.`;
  return (
    `Jeg har lavet et budget ud fra ${tpl.label} med en indkomst på ${fmt(income)}/md.` +
    `${amount ? '' : ' Beløbet er et skøn, så ret det, hvis dit er anderledes.'} ` +
    `${savings} ${tpl.tip}`
  );
}

function incomeReply(db, text) {
  if (!/indkomst|tjener|løn|får udbetalt/.test(text)) return null;
  const amount = amountsIn(text)[0];
  if (amount === undefined) return 'Hvor meget er din indkomst om måneden? Skriv f.eks. "min indkomst er 12000".';
  db.income = amount;
  const free = unallocated(db);
  return `Din indkomst er nu ${fmt(amount)}/md. ${free < 0 ? `Dine budgetter og mål koster ${fmt(-free)} mere, end du tjener.` : `Der er ${fmt(free)}/md., som ikke er fordelt.`}`;
}

function budgetReply(db, text) {
  const b = findBudget(db, text);
  const amount = amountsIn(text)[0];
  if (!b) return null;
  if (amount === undefined) return `Hvad skal der ske med ${b.name}? Skriv f.eks. "sæt ${b.name.toLowerCase()} til 2000" eller "sænk ${b.name.toLowerCase()} med 300".`;

  const before = b.monthly;
  const says = (words) => words.some((w) => hasWord(text, w));
  const relative = says(['med']); // "sænk X med 300" changes by an amount; "sæt X til 300" sets it
  if (relative && says(['sænk', 'sænke', 'skær', 'skære', 'reducer', 'reducere', 'mindre', 'ned'])) b.monthly = Math.max(0, before - amount);
  else if (relative && says(['hæv', 'hæve', 'øg', 'øge', 'forhøj', 'forhøje', 'mere', 'op'])) b.monthly = before + amount;
  else b.monthly = amount;

  const free = unallocated(db);
  return `${b.name} er ændret fra ${fmt(before)} til ${fmt(b.monthly)}/md. ` +
    (free < 0 ? `Du har nu planlagt ${fmt(-free)} mere, end du tjener.` : `Der er ${fmt(free)}/md. tilbage, som ikke er fordelt.`);
}

// ---------------------------------------------------------------- entry points

export function handleMessage(db, rawText) {
  const text = rawText.toLowerCase();
  const undo = { income: db.income, budgets: db.budgets.map((b) => ({ id: b.id, monthly: b.monthly })) };

  let reply = templateReply(db, text) ?? incomeReply(db, text) ?? budgetReply(db, text);
  if (!reply) reply = /hjælp|hvad kan du/.test(text) ? HELP : `Det forstod jeg ikke helt.\n${HELP}`;

  // Record exactly what changed so the panel can show it and the user can undo it.
  const changes = [];
  if (db.income !== undo.income) changes.push({ label: 'Indkomst', from: undo.income, to: db.income });
  for (const b of db.budgets) {
    const old = undo.budgets.find((x) => x.id === b.id)?.monthly;
    if (old !== undefined && old !== b.monthly) changes.push({ label: b.name, from: old, to: b.monthly });
  }

  db.chat ??= [];
  const stamp = Date.now();
  db.chat.push({ id: `m${stamp}u`, role: 'user', text: rawText });
  db.chat.push({ id: `m${stamp}a`, role: 'advisor', text: reply, changes, undo: changes.length ? undo : null, undone: false });
  db.chat = db.chat.slice(-MAX_MESSAGES);
}

export function undoMessage(db, id) {
  const lastWithChanges = [...(db.chat ?? [])].reverse().find((m) => m.undo && !m.undone);
  if (!lastWithChanges || lastWithChanges.id !== id)
    throw new Error('Kun den seneste ændring kan fortrydes.');
  db.income = lastWithChanges.undo.income;
  for (const { id: budgetId, monthly } of lastWithChanges.undo.budgets) {
    const b = db.budgets.find((x) => x.id === budgetId);
    if (b) b.monthly = monthly;
  }
  lastWithChanges.undone = true;
}
