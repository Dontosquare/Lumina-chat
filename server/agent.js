// The budget agent. Runs fully locally: no API calls, no cost.
//
// It follows the same shape as an LLM-powered agent so the pattern is easy to learn:
//   1. TOOLS    - small functions that each observe or compute one thing
//   2. decide() - the "brain": looks at what it knows so far and picks the next tool (or stops)
//   3. runAgent - the loop: decide -> call tool -> remember result -> repeat, with a step limit
// In an LLM version, decide() is the part you would replace with a model call.

import { snapshot, goalStatus, projectMonth, roundDown, roundUp, fmt, fmtMonth, unallocated } from './finance.js';

export const MODES = {
  balanced: { label: 'Balanced', freeCashShare: 0.8, slackShare: 0.7, trimShare: 0.05 },
  saver: { label: 'Max savings', freeCashShare: 1, slackShare: 0.9, trimShare: 0.15 },
  lifestyle: { label: 'Protect lifestyle', freeCashShare: 0.6, slackShare: 0.4, trimShare: 0 },
};

const MAX_STEPS = 10;
const MIN_MOVE = 100; // kr. Smaller moves aren't worth a suggestion.

// ---------------------------------------------------------------- tools

const TOOLS = {
  read_snapshot: {
    description: 'Load income, budgets, goals and spending history',
    run(ctx) {
      const s = snapshot(ctx.db, ctx.now);
      return {
        data: s,
        summary: `Income ${fmt(s.income)}/mo · ${fmt(s.budgeted)} budgeted · ${fmt(s.saving)} to goals · ${fmt(s.unallocated)} unassigned.`,
      };
    },
  },

  analyze_spending: {
    description: 'Compare real spending (3-month average) against each budget',
    run(ctx) {
      const { categories } = ctx.memory.read_snapshot;
      const slack = [];
      const pressure = [];
      const watch = [];
      for (const c of categories) {
        const diff = c.monthly - c.avgMonthly;
        if (c.kind === 'discretionary' && diff >= MIN_MOVE) slack.push({ ...c, slack: diff });
        if (-diff > c.monthly * 0.03) {
          const shortfall = roundUp(-diff);
          (c.kind === 'essential' ? pressure : watch).push({ ...c, shortfall });
        }
      }
      slack.sort((a, b) => b.slack - a.slack);
      const parts = [];
      if (slack.length) parts.push(`slack in ${slack.map((c) => `${c.name} (~${fmt(c.slack)})`).join(', ')}`);
      if (pressure.length) parts.push(`essentials over budget: ${pressure.map((c) => `${c.name} (+${fmt(c.shortfall)})`).join(', ')}`);
      if (watch.length) parts.push(`overspending on ${watch.map((c) => c.name).join(', ')}`);
      return { data: { slack, pressure, watch }, summary: parts.length ? `Found ${parts.join('; ')}.` : 'Spending matches budgets closely.' };
    },
  },

  assess_goals: {
    description: 'Work out how much each goal needs per month to hit its deadline',
    run(ctx) {
      const { goals } = ctx.memory.read_snapshot;
      const focus = ctx.intent.focusGoalId;
      const ordered = [...goals].sort(
        (a, b) => (b.id === focus) - (a.id === focus) || a.priority - b.priority || a.deadline.localeCompare(b.deadline),
      );
      const behind = ordered.filter((g) => g.gap > 0);
      const totalGap = behind.reduce((s, g) => s + g.gap, 0);
      return {
        data: { ordered, behind, totalGap },
        summary: behind.length
          ? `${behind.length} of ${goals.length} goals are behind: ${behind.map((g) => `${g.name} short ${fmt(g.gap)}/mo`).join(', ')}.`
          : `All ${goals.length} goals are on track.`,
      };
    },
  },

  find_funding: {
    description: 'List money that can be moved, scaled by the chosen intent',
    run(ctx) {
      const mode = MODES[ctx.intent.mode];
      const { unallocated: free } = ctx.memory.read_snapshot;
      const { slack, watch } = ctx.memory.analyze_spending;
      const sources = [];

      const freeAmount = roundDown(free * mode.freeCashShare);
      if (freeAmount >= MIN_MOVE)
        sources.push({ kind: 'unallocated', id: null, label: 'Unassigned income', available: freeAmount, confidence: 'high',
          why: `${fmt(free)} of your income isn't assigned to anything yet` });

      for (const c of slack) {
        const amount = roundDown(c.slack * mode.slackShare);
        if (amount >= MIN_MOVE)
          sources.push({ kind: 'budget', id: c.id, label: c.name, available: amount, confidence: 'high',
            why: `you've spent ~${fmt(c.avgMonthly)} of your ${fmt(c.monthly)} ${c.name.toLowerCase()} budget on average` });
      }

      if (mode.trimShare > 0) {
        const overspending = new Set(watch.map((c) => c.id));
        for (const c of ctx.memory.read_snapshot.categories) {
          if (c.kind !== 'discretionary' || overspending.has(c.id)) continue;
          const amount = roundDown(c.avgMonthly * mode.trimShare);
          if (amount >= MIN_MOVE)
            sources.push({ kind: 'trim', id: c.id, label: c.name, available: amount, confidence: 'medium',
              why: `a ${Math.round(mode.trimShare * 100)}% cut to what you really spend on ${c.name.toLowerCase()}` });
        }
      }

      const total = sources.reduce((s, x) => s + x.available, 0);
      return {
        data: { sources, total },
        summary: sources.length
          ? `${fmt(total)}/mo can move from ${sources.length} sources (${mode.label} intent).`
          : 'Nothing can move without changing how you spend.',
      };
    },
  },

  draft_plan: {
    description: 'Match funding sources to needs: essentials first, then goals in priority order',
    run(ctx) {
      const { pressure } = ctx.memory.analyze_spending;
      const { ordered, behind } = ctx.memory.assess_goals;
      const pool = ctx.memory.find_funding.sources.map((s) => ({ ...s, left: s.available }));
      const suggestions = [];
      let n = 0;

      const take = (need, { allowTrim }) => {
        const moves = [];
        for (const s of pool) {
          if (need <= 0) break;
          if (!allowTrim && s.kind === 'trim') continue;
          const amount = Math.min(s.left, need);
          if (amount < MIN_MOVE && amount < need) continue;
          if (amount <= 0) continue;
          s.left -= amount;
          need -= amount;
          moves.push({ kind: s.kind === 'trim' ? 'budget' : s.kind, id: s.id, label: s.label, amount, why: s.why, confidence: s.confidence });
        }
        return moves;
      };
      const total = (moves) => moves.reduce((s, m) => s + m.amount, 0);
      const confidenceOf = (moves) => (moves.some((m) => m.confidence === 'medium') ? 'medium' : 'high');

      // 1. Unrealistic essential budgets. Better to be honest than to "save" money that gets spent anyway.
      for (const c of pressure) {
        const moves = take(c.shortfall, { allowTrim: false });
        if (!moves.length) continue;
        suggestions.push({
          id: `s${++n}`, type: 'reallocate', target: { kind: 'budget', id: c.id, label: c.name }, amount: total(moves), moves,
          confidence: confidenceOf(moves),
          title: `Raise ${c.name} to ${fmt(c.monthly + total(moves))}`,
          rationale: `You've spent ~${fmt(c.avgMonthly)}/mo on ${c.name.toLowerCase()} against a ${fmt(c.monthly)} budget. ` +
            `It's an essential, so the budget should match reality instead of quietly eating into savings.`,
          impact: `${c.name} budget covers your real spending`,
        });
      }

      // 2. Goals that are behind, focus goal first, then by priority.
      const unfunded = [];
      for (const g of behind) {
        const moves = take(g.gap, { allowTrim: g.priority <= 2 || g.id === ctx.intent.focusGoalId });
        const amount = total(moves);
        const newContribution = g.monthlyContribution + amount;
        const newProjected = projectMonth(g.remaining, newContribution, ctx.now);
        if (amount > 0)
          suggestions.push({
            id: `s${++n}`, type: 'reallocate', target: { kind: 'goal', id: g.id, label: g.name }, amount, moves,
            confidence: confidenceOf(moves),
            title: `Put ${fmt(amount)}/mo more toward ${g.name}`,
            rationale: `${g.name} needs ${fmt(g.required)}/mo to reach ${fmt(g.target)} by ${fmtMonth(g.deadline)}, ` +
              `but only ${fmt(g.monthlyContribution)}/mo is set aside. ` +
              moves.map((m) => `${fmt(m.amount)} from ${m.label}: ${m.why}.`).join(' '),
            impact: amount >= g.gap
              ? `On track for ${fmtMonth(g.deadline)} (was ${fmtMonth(g.projected)})`
              : `Done by ${fmtMonth(newProjected)} instead of ${fmtMonth(g.projected)}`,
          });
        if (amount < g.gap) unfunded.push({ ...g, newContribution, newProjected });
      }

      // 3. Goals that still can't make it: suggest a realistic deadline instead of pretending.
      for (const g of unfunded) {
        if (!g.newProjected) continue;
        const [y, m] = g.newProjected.split('-');
        suggestions.push({
          id: `s${++n}`, type: 'extend_deadline', target: { kind: 'goal', id: g.id, label: g.name },
          deadline: `${y}-${m}-28`, confidence: 'high',
          title: `Move the ${g.name} deadline to ${fmtMonth(g.newProjected)}`,
          rationale: `Even after the other changes, ${g.name} is ${fmt(g.required - g.newContribution)}/mo short of its ` +
            `${fmtMonth(g.deadline)} deadline. At ${fmt(g.newContribution)}/mo it lands in ${fmtMonth(g.newProjected)}. ` +
            `A deadline you can hit beats one you keep missing.`,
          impact: `Goal becomes achievable without cutting essentials`,
        });
      }

      // 4. Leftover free cash: let the top goal finish early (unless the user wants to protect lifestyle).
      const leftoverFree = pool.find((s) => s.kind === 'unallocated')?.left ?? 0;
      const top = ordered.find((g) => g.remaining > 0);
      if (ctx.intent.mode !== 'lifestyle' && leftoverFree >= 2 * MIN_MOVE && top) {
        const existing = suggestions.find((s) => s.type === 'reallocate' && s.target.id === top.id);
        const base = top.monthlyContribution + (existing?.amount ?? 0);
        suggestions.push({
          id: `s${++n}`, type: 'reallocate', target: { kind: 'goal', id: top.id, label: top.name }, amount: leftoverFree,
          moves: [{ kind: 'unallocated', id: null, label: 'Unassigned income', amount: leftoverFree }], confidence: 'high',
          title: `Boost ${top.name} with ${fmt(leftoverFree)}/mo of idle cash`,
          rationale: `After everything else, ${fmt(leftoverFree)}/mo is still unassigned. ${top.name} is your top priority, so it's the best home for it.`,
          impact: `Done by ${fmtMonth(projectMonth(top.remaining, base + leftoverFree, ctx.now))} instead of ${fmtMonth(projectMonth(top.remaining, base, ctx.now))}`,
        });
      }

      const moved = suggestions.reduce((s, x) => s + (x.amount || 0), 0);
      return { data: { suggestions }, summary: `Drafted ${suggestions.length} suggestions moving ${fmt(moved)}/mo.` };
    },
  },

  review_plan: {
    description: 'Check the plan against guardrails before showing it',
    run(ctx) {
      const mode = MODES[ctx.intent.mode];
      const { categories, unallocated: free } = ctx.memory.read_snapshot;
      const { suggestions } = ctx.memory.draft_plan;
      const issues = [];
      const cut = {};
      let freeUsed = 0;
      for (const s of suggestions)
        for (const m of s.moves || []) {
          if (m.kind === 'budget') cut[m.id] = (cut[m.id] || 0) + m.amount;
          else freeUsed += m.amount;
        }
      for (const [id, amount] of Object.entries(cut)) {
        const c = categories.find((x) => x.id === id);
        const floor = c.avgMonthly * (1 - mode.trimShare);
        if (c.monthly - amount < floor - 1)
          issues.push(`${c.name} would drop to ${fmt(c.monthly - amount)}, below the ${fmt(floor)} floor`);
      }
      if (freeUsed > free) issues.push(`uses ${fmt(freeUsed)} of unassigned income but only ${fmt(free)} exists`);
      return {
        data: { ok: issues.length === 0, issues },
        summary: issues.length ? `Problems: ${issues.join('; ')}.` : 'Passed: no budget drops below real spending, nothing exceeds income.',
      };
    },
  },
};

// ---------------------------------------------------------------- the "brain"

function decide(ctx) {
  const m = ctx.memory;
  const mode = MODES[ctx.intent.mode];
  if (!m.read_snapshot)
    return { tool: 'read_snapshot', thought: "First I need the current picture: income, budgets and goals." };
  if (!m.analyze_spending)
    return { tool: 'analyze_spending', thought: 'Budgets are plans. Let me check what you actually spend to find slack and pressure points.' };
  if (!m.assess_goals) {
    const focus = m.read_snapshot.goals.find((g) => g.id === ctx.intent.focusGoalId);
    return { tool: 'assess_goals', thought: `Now the goals: what does each one need per month?${focus ? ` You asked me to focus on ${focus.name}, so it goes first.` : ''}` };
  }
  const gap = m.assess_goals.totalGap;
  const pressure = m.analyze_spending.pressure.length;
  if (gap === 0 && pressure === 0)
    return { done: true, thought: 'Every goal is on track and no essential budget is under pressure. No changes needed.' };
  if (!m.find_funding)
    return { tool: 'find_funding', thought: `Needs: ${gap ? `${fmt(gap)}/mo for goals` : ''}${gap && pressure ? ' and ' : ''}${pressure ? `${pressure} underfunded essential(s)` : ''}. Looking for money to move, respecting the "${mode.label}" intent.` };
  if (!m.find_funding.sources.length)
    return { done: true, thought: "There's no slack or free cash to move. The real options are more income or changing a goal; I won't invent savings." };
  if (!m.draft_plan)
    return { tool: 'draft_plan', thought: 'Matching sources to needs: essentials first, then goals in priority order. Anything still short gets an honest deadline.' };
  if (!m.review_plan)
    return { tool: 'review_plan', thought: 'Before showing you anything, I check the plan against my guardrails.' };
  if (!m.review_plan.ok) {
    // Guardrail tripped: drop the risky suggestions rather than show them.
    m.draft_plan.suggestions = m.draft_plan.suggestions.filter((s) => !(s.moves || []).some((mv) => mv.confidence === 'medium'));
    m.review_plan.ok = true;
    return { done: true, thought: 'Review found problems, so I removed the suggestions that relied on spending cuts.' };
  }
  const s = m.draft_plan.suggestions;
  return { done: true, thought: `Done. ${s.length} suggestion${s.length === 1 ? '' : 's'} ready. Nothing changes until you accept one.` };
}

// ---------------------------------------------------------------- the loop

export function runAgent(db, intent = {}, now = new Date()) {
  const ctx = {
    db, now, memory: {},
    intent: { mode: MODES[intent.mode] ? intent.mode : 'balanced', focusGoalId: intent.focusGoalId || null },
  };
  const trace = [];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const decision = decide(ctx);
    if (decision.done) {
      trace.push({ step, thought: decision.thought, tool: null, summary: null });
      break;
    }
    const tool = TOOLS[decision.tool];
    const result = tool.run(ctx);
    ctx.memory[decision.tool] = result.data;
    trace.push({ step, thought: decision.thought, tool: decision.tool, description: tool.description, summary: result.summary });
  }
  return {
    id: `run_${Date.now()}`,
    createdAt: now.toISOString(),
    intent: ctx.intent,
    trace,
    suggestions: (ctx.memory.draft_plan?.suggestions ?? []).map((s) => ({ ...s, status: 'pending' })),
  };
}

// ---------------------------------------------------------------- applying a suggestion

export function applySuggestion(db, s) {
  if (s.type === 'extend_deadline') {
    const goal = db.goals.find((g) => g.id === s.target.id);
    if (!goal) throw new Error('That goal no longer exists. Run the agent again.');
    goal.deadline = s.deadline;
    return;
  }
  // Validate on a copy first so a stale suggestion can't leave data half-changed.
  const budgets = db.budgets.map((b) => ({ ...b }));
  for (const m of s.moves) {
    if (m.kind !== 'budget') continue;
    const b = budgets.find((x) => x.id === m.id);
    if (!b || b.monthly < m.amount) throw new Error(`${m.label} no longer has ${fmt(m.amount)} to move. Run the agent again.`);
    b.monthly -= m.amount;
  }
  const goals = db.goals.map((g) => ({ ...g }));
  const target = (s.target.kind === 'goal' ? goals : budgets).find((x) => x.id === s.target.id);
  if (!target) throw new Error(`${s.target.label} no longer exists. Run the agent again.`);
  if (s.target.kind === 'goal') target.monthlyContribution += s.amount;
  else target.monthly += s.amount;
  if (unallocated({ ...db, budgets, goals }) < 0) throw new Error('Not enough unassigned income left for this one. Run the agent again.');
  db.budgets = budgets;
  db.goals = goals;
}

export { goalStatus };
