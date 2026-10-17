// Pure money math shared by the API and the agent. No I/O here.

export const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
// Amounts are Danish kroner; the agent moves money in whole 50 kr. steps.
const MONEY_STEP = 50;
const currency = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 });
export const roundDown = (x, step = MONEY_STEP) => Math.max(0, Math.floor(x / step) * step);
export const roundUp = (x, step = MONEY_STEP) => Math.ceil(x / step) * step;
export const fmt = (n) => currency.format(Math.round(n));
export const fmtMonth = (ym) =>
  ym ? parseDate(ym).toLocaleString('da-DK', { month: 'short', year: 'numeric' }) : 'aldrig';

export function monthsUntil(dateStr, now) {
  const d = parseDate(dateStr);
  const months =
    (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth()) + (d.getDate() - now.getDate()) / 30;
  return Math.max(0, months);
}

/** Month ("YYYY-MM") in which `remaining` is reached saving `perMonth`, or null if never. */
export function projectMonth(remaining, perMonth, now) {
  if (remaining <= 0) return monthKey(now);
  if (perMonth <= 0) return null;
  const months = Math.ceil(remaining / perMonth);
  return monthKey(new Date(now.getFullYear(), now.getMonth() + months, 1));
}

export function goalStatus(goal, now) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const monthsLeft = monthsUntil(goal.deadline, now);
  const required = remaining === 0 ? 0 : Math.ceil(remaining / Math.max(monthsLeft, 1));
  const gap = Math.max(0, required - goal.monthlyContribution);
  const projected = projectMonth(remaining, goal.monthlyContribution, now);
  const onTrack = remaining === 0 || (projected !== null && projected <= goal.deadline.slice(0, 7));
  return { ...goal, remaining, monthsLeft: Math.round(monthsLeft * 10) / 10, required, gap, projected, onTrack };
}

/** Per-budget spending: this month so far, projected month total, and the average of the last 3 full months. */
export function categoryStats(db, now) {
  const current = monthKey(now);
  const history = [1, 2, 3].map((i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const totals = {};
  const monthsSeen = new Set();
  for (const t of db.transactions) {
    const k = t.date.slice(0, 7);
    monthsSeen.add(k);
    totals[t.category] ??= {};
    totals[t.category][k] = (totals[t.category][k] || 0) + t.amount;
  }
  const fullMonths = history.filter((k) => monthsSeen.has(k));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthFraction = now.getDate() / daysInMonth;

  return db.budgets.map((b) => {
    const byMonth = totals[b.id] || {};
    const monthToDate = byMonth[current] || 0;
    const projected = monthToDate / monthFraction;
    const avgMonthly = fullMonths.length
      ? fullMonths.reduce((sum, k) => sum + (byMonth[k] || 0), 0) / fullMonths.length
      : projected;
    return {
      ...b,
      monthToDate: Math.round(monthToDate),
      projected: Math.round(projected),
      avgMonthly: Math.round(avgMonthly),
      monthsOfHistory: fullMonths.length,
    };
  });
}

export function unallocated(db) {
  const budgeted = db.budgets.reduce((s, b) => s + b.monthly, 0);
  const saving = db.goals.reduce((s, g) => s + g.monthlyContribution, 0);
  return db.income - budgeted - saving;
}

export function snapshot(db, now = new Date()) {
  const categories = categoryStats(db, now);
  const goals = db.goals.map((g) => goalStatus(g, now));
  return {
    today: toISODate(now),
    income: db.income,
    budgeted: db.budgets.reduce((s, b) => s + b.monthly, 0),
    saving: db.goals.reduce((s, g) => s + g.monthlyContribution, 0),
    unallocated: unallocated(db),
    spentThisMonth: categories.reduce((s, c) => s + c.monthToDate, 0),
    categories,
    goals,
  };
}
