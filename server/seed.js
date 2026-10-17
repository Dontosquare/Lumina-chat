// Deterministic demo data, generated relative to "today" so it never goes stale.
import { toISODate } from './finance.js';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUDGETS = [
  { id: 'housing', name: 'Bolig', monthly: 10000, kind: 'essential' },
  { id: 'groceries', name: 'Dagligvarer', monthly: 3600, kind: 'essential' },
  { id: 'utilities', name: 'Forsyning', monthly: 1400, kind: 'essential' },
  { id: 'transport', name: 'Transport', monthly: 1800, kind: 'essential' },
  { id: 'dining', name: 'Restaurant og café', monthly: 2600, kind: 'discretionary' },
  { id: 'shopping', name: 'Shopping', monthly: 2000, kind: 'discretionary' },
  { id: 'entertainment', name: 'Underholdning', monthly: 1200, kind: 'discretionary' },
  { id: 'subscriptions', name: 'Abonnementer', monthly: 650, kind: 'discretionary' },
  { id: 'travel', name: 'Rejser', monthly: 1000, kind: 'discretionary' },
];

// How the demo user actually behaves: share of each budget really spent per month.
const PATTERNS = {
  housing: { ratio: 1, count: 1, notes: ['Husleje'] },
  groceries: { ratio: 1.1, count: 7, notes: ['Supermarked', 'Torvehal', 'Grossist', 'Kiosk'] },
  utilities: { ratio: 0.92, count: 3, notes: ['El', 'Internet', 'Vand'] },
  transport: { ratio: 0.8, count: 5, notes: ['Rejsekort', 'Benzin', 'Taxa'] },
  dining: { ratio: 0.58, count: 6, notes: ['Ramenbar', 'Kaffe', 'Pizzaaften', 'Sushi', 'Brunch'] },
  shopping: { ratio: 0.86, count: 4, notes: ['Tøj', 'Boligudstyr', 'Elektronik', 'Bøger'] },
  entertainment: { ratio: 0.5, count: 3, notes: ['Biograf', 'Koncert', 'Bowling'] },
  subscriptions: { ratio: 1, count: 3, notes: ['Streaming', 'Musik', 'Cloudlager'] },
  travel: { ratio: 0.2, count: 1, notes: ['Weekendtur med tog', 'Hotelovernatning'] },
};

const inMonths = (now, n) => toISODate(new Date(now.getFullYear(), now.getMonth() + n, Math.min(now.getDate(), 28)));

export function createSeed(now = new Date()) {
  const rand = rng(42);
  const transactions = [];
  let id = 1;
  for (let back = 3; back >= 0; back--) {
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (const b of BUDGETS) {
      const p = PATTERNS[b.id];
      const total = b.monthly * p.ratio * (0.92 + rand() * 0.16);
      const weights = Array.from({ length: p.count }, () => 0.5 + rand());
      const wSum = weights.reduce((a, w) => a + w, 0);
      weights.forEach((w, i) => {
        const day = b.id === 'housing' ? 1 : 1 + Math.floor(rand() * days);
        if (back === 0 && day > now.getDate()) return; // current month: only days that already happened
        transactions.push({
          id: `t${id++}`,
          date: toISODate(new Date(first.getFullYear(), first.getMonth(), day)),
          category: b.id,
          amount: Math.round(((total * w) / wSum) * 100) / 100,
          note: p.notes[i % p.notes.length],
        });
      });
    }
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    income: 32000,
    budgets: BUDGETS.map((b) => ({ ...b })),
    goals: [
      { id: 'g1', name: 'Nødopsparing', target: 70000, saved: 43000, deadline: inMonths(now, 8), priority: 1, monthlyContribution: 2000 },
      { id: 'g2', name: 'Rejse til Japan', target: 25000, saved: 9500, deadline: inMonths(now, 6), priority: 2, monthlyContribution: 1000 },
      { id: 'g3', name: 'Udbetaling til bolig', target: 280000, saved: 60000, deadline: inMonths(now, 50), priority: 3, monthlyContribution: 2800 },
    ],
    transactions,
    lastRun: null,
  };
}
