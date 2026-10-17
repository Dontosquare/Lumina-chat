// The budget agent. Runs fully locally: no API calls, no cost.
//
// It follows the same shape as an LLM-powered agent so the pattern is easy to learn:
//   1. TOOLS    - small functions that each observe or compute one thing
//   2. decide() - the "brain": looks at what it knows so far and picks the next tool (or stops)
//   3. runAgent - the loop: decide -> call tool -> remember result -> repeat, with a step limit
// In an LLM version, decide() is the part you would replace with a model call.
// All user-facing text is Danish.

import { snapshot, goalStatus, projectMonth, roundDown, roundUp, fmt, fmtMonth, unallocated } from './finance.js';

export const MODES = {
  // deficitTrim: how hard to cut real spending on wants when the plan costs more than you earn.
  balanced: { label: 'Balanceret', freeCashShare: 0.8, slackShare: 0.7, trimShare: 0.05, deficitTrim: 0.2 },
  saver: { label: 'Maks. opsparing', freeCashShare: 1, slackShare: 0.9, trimShare: 0.15, deficitTrim: 0.35 },
  lifestyle: { label: 'Bevar livsstil', freeCashShare: 0.6, slackShare: 0.4, trimShare: 0, deficitTrim: 0.1 },
};
const PRIORITY_DA = { 1: 'høj', 2: 'mellem', 3: 'lav' };

const MAX_STEPS = 10;
const MIN_MOVE = 100; // kr. Smaller moves aren't worth a suggestion.
const lower = (s) => s.toLocaleLowerCase('da-DK');
// "kr." already ends in a dot, so a sentence ending on an amount would get "kr..".
const tidy = (s) => (typeof s === 'string' ? s.replace(/kr\.\./g, 'kr.') : s);

// ---------------------------------------------------------------- tools

const TOOLS = {
  read_snapshot: {
    description: 'Henter indkomst, budgetter, mål og forbrugshistorik',
    run(ctx) {
      const s = snapshot(ctx.db, ctx.now);
      return {
        data: s,
        summary: `Indkomst ${fmt(s.income)}/md. · ${fmt(s.budgeted)} budgetteret · ${fmt(s.saving)} til mål · ${fmt(s.unallocated)} ufordelt.`,
      };
    },
  },

  analyze_spending: {
    description: 'Sammenligner faktisk forbrug (3-måneders gennemsnit) med hvert budget',
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
      if (slack.length) parts.push(`luft i ${slack.map((c) => `${c.name} (~${fmt(c.slack)})`).join(', ')}`);
      if (pressure.length) parts.push(`nødvendige udgifter over budget: ${pressure.map((c) => `${c.name} (+${fmt(c.shortfall)})`).join(', ')}`);
      if (watch.length) parts.push(`overforbrug på ${watch.map((c) => c.name).join(', ')}`);
      return { data: { slack, pressure, watch }, summary: parts.length ? `Fandt ${parts.join('; ')}.` : 'Forbruget passer tæt på budgetterne.' };
    },
  },

  assess_goals: {
    description: 'Beregner, hvor meget hvert mål skal have om måneden for at nå sin deadline',
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
          ? `${behind.length} af ${goals.length} mål halter: ${behind.map((g) => `${g.name} mangler ${fmt(g.gap)}/md.`).join(', ')}`
          : `Alle ${goals.length} mål er på sporet.`,
      };
    },
  },

  find_funding: {
    description: 'Finder penge, der kan flyttes, skaleret efter den valgte hensigt',
    run(ctx) {
      const mode = MODES[ctx.intent.mode];
      const { unallocated: free } = ctx.memory.read_snapshot;
      const { slack, watch } = ctx.memory.analyze_spending;
      const sources = [];

      const freeAmount = roundDown(free * mode.freeCashShare);
      if (freeAmount >= MIN_MOVE)
        sources.push({ kind: 'unallocated', id: null, label: 'Ufordelt indkomst', available: freeAmount, confidence: 'high',
          why: `${fmt(free)} af din indkomst er ikke fordelt endnu` });

      for (const c of slack) {
        const amount = roundDown(c.slack * mode.slackShare);
        if (amount >= MIN_MOVE)
          sources.push({ kind: 'budget', id: c.id, label: c.name, available: amount, confidence: 'high',
            why: `du bruger i snit ~${fmt(c.avgMonthly)} af dit budget på ${fmt(c.monthly)} til ${lower(c.name)}` });
      }

      if (mode.trimShare > 0) {
        const overspending = new Set(watch.map((c) => c.id));
        for (const c of ctx.memory.read_snapshot.categories) {
          if (c.kind !== 'discretionary' || overspending.has(c.id)) continue;
          const amount = roundDown(c.avgMonthly * mode.trimShare);
          if (amount >= MIN_MOVE)
            sources.push({ kind: 'trim', id: c.id, label: c.name, available: amount, confidence: 'medium',
              why: `en besparelse på ${Math.round(mode.trimShare * 100)} % af det, du faktisk bruger på ${lower(c.name)}` });
        }
      }

      const total = sources.reduce((s, x) => s + x.available, 0);
      return {
        data: { sources, total },
        summary: sources.length
          ? `${fmt(total)}/md. kan flyttes fra ${sources.length} kilder (hensigt: ${mode.label}).`
          : 'Intet kan flyttes uden at ændre dit forbrug.',
      };
    },
  },

  draft_plan: {
    description: 'Matcher kilder med behov: nødvendige udgifter først, derefter mål efter prioritet',
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
          title: `Hæv ${c.name} til ${fmt(c.monthly + total(moves))}`,
          rationale: `Du har brugt ~${fmt(c.avgMonthly)}/md. på ${lower(c.name)} mod et budget på ${fmt(c.monthly)}. ` +
            `Det er en nødvendig udgift, så budgettet bør passe til virkeligheden i stedet for stille at tære på opsparingen.`,
          impact: `Budgettet til ${lower(c.name)} dækker dit faktiske forbrug`,
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
            title: `Sæt ${fmt(amount)}/md. mere af til ${g.name}`,
            rationale: `${g.name} kræver ${fmt(g.required)}/md. for at nå ${fmt(g.target)} inden ${fmtMonth(g.deadline)}, ` +
              `men der sættes kun ${fmt(g.monthlyContribution)}/md. af. ` +
              moves.map((m) => `${fmt(m.amount)} fra ${m.label}: ${m.why}.`).join(' '),
            impact: amount >= g.gap
              ? `På sporet til ${fmtMonth(g.deadline)} (før ${fmtMonth(g.projected)})`
              : `Nået i ${fmtMonth(newProjected)} i stedet for ${fmtMonth(g.projected)}`,
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
          title: `Flyt deadline for ${g.name} til ${fmtMonth(g.newProjected)}`,
          rationale: `Selv efter de andre ændringer mangler ${g.name} ${fmt(g.required - g.newContribution)}/md. for at nå ` +
            `deadline i ${fmtMonth(g.deadline)}. Med ${fmt(g.newContribution)}/md. når du målet i ${fmtMonth(g.newProjected)}. ` +
            `En deadline, du kan nå, er bedre end en, du bliver ved med at misse.`,
          impact: `Målet bliver realistisk uden at skære i nødvendige udgifter`,
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
          moves: [{ kind: 'unallocated', id: null, label: 'Ufordelt indkomst', amount: leftoverFree }], confidence: 'high',
          title: `Giv ${top.name} et skub med ${fmt(leftoverFree)}/md. af de ledige penge`,
          rationale: `Efter alt det andet er ${fmt(leftoverFree)}/md. stadig ufordelt. ${top.name} har højest prioritet, så det er det bedste sted at sætte dem.`,
          impact: `Nået i ${fmtMonth(projectMonth(top.remaining, base + leftoverFree, ctx.now))} i stedet for ${fmtMonth(projectMonth(top.remaining, base, ctx.now))}`,
        });
      }

      const moved = suggestions.reduce((s, x) => s + (x.amount || 0), 0);
      return { data: { suggestions }, summary: `Lavede ${suggestions.length} forslag, der flytter ${fmt(moved)}/md.` };
    },
  },

  cover_deficit: {
    description: 'Finder besparelser, der lukker et underskud: ubrugte budgetter, mindre forbrug, lavere opsparing',
    run(ctx) {
      const mode = MODES[ctx.intent.mode];
      const { categories, goals, unallocated: free, income } = ctx.memory.read_snapshot;
      const deficit = -free;
      let left = deficit;
      const suggestions = [];
      let n = 0;
      const take = (max) => {
        const amount = Math.min(max, roundUp(left));
        if (amount <= 0 || (amount < MIN_MOVE && amount < left)) return 0;
        left -= amount;
        return amount;
      };

      // 1. Budget you don't use anyway: lower it to real spending (essentials too, never below what you spend).
      // 2. Then real cuts on wants, scaled by the chosen intent.
      const plan = categories.map((c) => ({ c, unused: roundDown(c.monthly - roundUp(c.avgMonthly)), unusedCut: 0, trimCut: 0 }));
      for (const p of [...plan].sort((a, b) => b.unused - a.unused)) {
        if (left > 0 && p.unused >= MIN_MOVE) p.unusedCut = take(p.unused);
      }
      for (const p of [...plan].sort((a, b) => b.c.avgMonthly - a.c.avgMonthly)) {
        if (left > 0 && p.c.kind === 'discretionary') p.trimCut = take(roundDown(p.c.avgMonthly * mode.deficitTrim));
      }
      for (const { c, unusedCut, trimCut } of plan) {
        const amount = unusedCut + trimCut;
        if (!amount) continue;
        const parts = [];
        if (unusedCut) parts.push(`Du bruger i snit ~${fmt(c.avgMonthly)}, så ${fmt(unusedCut)} af budgettet bliver alligevel ikke brugt.`);
        if (trimCut) parts.push(`De sidste ${fmt(trimCut)} kræver, at du bruger ca. ${Math.round((trimCut / c.avgMonthly) * 100)} % mindre på ${lower(c.name)} end i dag.`);
        suggestions.push({
          id: `s${++n}`, type: 'reduce', target: { kind: 'budget', id: c.id, label: c.name }, amount,
          confidence: trimCut ? 'medium' : 'high',
          title: `Sænk ${c.name} til ${fmt(c.monthly - amount)}`,
          rationale: `Din plan bruger ${fmt(deficit)} mere om måneden, end du tjener. ${parts.join(' ')}`,
          impact: `Underskuddet falder med ${fmt(amount)}/md.`,
        });
      }

      // 3. You can't save money you don't have: lower goal contributions, lowest priority first.
      for (const g of [...goals].sort((a, b) => b.priority - a.priority)) {
        if (left <= 0 || g.monthlyContribution <= 0) continue;
        const amount = take(g.monthlyContribution);
        if (!amount) continue;
        suggestions.push({
          id: `s${++n}`, type: 'reduce', target: { kind: 'goal', id: g.id, label: g.name }, amount, confidence: 'high',
          title: amount === g.monthlyContribution
            ? `Sæt opsparingen til ${g.name} på pause`
            : `Sænk opsparingen til ${g.name} til ${fmt(g.monthlyContribution - amount)}/md.`,
          rationale: `Du kan ikke spare op med penge, du ikke har. Indtil budgettet balancerer, er det bedre at sætte mindre af til ` +
            `de mål, der har lavest prioritet. ${g.name} har ${PRIORITY_DA[g.priority]} prioritet.`,
          impact: `Underskuddet falder med ${fmt(amount)}/md.`,
        });
      }

      // 4. Still short: say so honestly. No budget shuffle can fix this.
      const remaining = Math.max(0, left);
      if (remaining > 0) {
        const essentials = categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.avgMonthly, 0);
        suggestions.push({
          id: `s${++n}`, type: 'advice', target: { kind: 'plan', id: null, label: 'Budget' }, amount: 0, confidence: 'high',
          title: `Der mangler stadig ${fmt(remaining)}/md.`,
          rationale: essentials > income
            ? `Dine nødvendige udgifter alene koster ~${fmt(essentials)}/md., mere end din indkomst på ${fmt(income)}. ` +
              `Det kan ikke løses ved at flytte rundt på budgettet. Det kræver højere indkomst eller lavere faste udgifter, f.eks. billigere bolig.`
            : `Selv med alle besparelserne bruger din plan mere, end du tjener. Tjek, om indkomsten er sat rigtigt, ` +
              `eller hvilke udgifter du kan fjerne helt.`,
          impact: 'Kræver en større beslutning',
        });
      }
      return {
        data: { suggestions, remaining, deficit },
        summary: remaining > 0
          ? `Fandt besparelser for ${fmt(deficit - remaining)}/md. af underskuddet på ${fmt(deficit)}. Der mangler stadig ${fmt(remaining)}/md.`
          : `Fandt besparelser, der dækker hele underskuddet på ${fmt(deficit)}/md.`,
      };
    },
  },

  review_plan: {
    description: 'Tjekker planen mod sikkerhedsregler, før den vises',
    run(ctx) {
      const mode = MODES[ctx.intent.mode];
      const { categories, unallocated: free } = ctx.memory.read_snapshot;
      const deficitMode = !ctx.memory.draft_plan;
      const { suggestions } = ctx.memory.draft_plan ?? ctx.memory.cover_deficit;
      const issues = [];
      const cut = {};
      let freeUsed = 0;
      for (const s of suggestions) {
        if (s.type === 'reduce' && s.target.kind === 'budget') cut[s.target.id] = (cut[s.target.id] || 0) + s.amount;
        for (const m of s.moves || []) {
          if (m.kind === 'budget') cut[m.id] = (cut[m.id] || 0) + m.amount;
          else freeUsed += m.amount;
        }
      }
      for (const [id, amount] of Object.entries(cut)) {
        const c = categories.find((x) => x.id === id);
        // Essentials are never cut below what you really spend; wants only by the intent's share.
        const share = deficitMode ? (c.kind === 'essential' ? 0 : mode.deficitTrim) : mode.trimShare;
        const floor = c.avgMonthly * (1 - share);
        if (c.monthly - amount < floor - 1)
          issues.push(`${c.name} ville falde til ${fmt(c.monthly - amount)}, under grænsen på ${fmt(floor)}`);
      }
      if (freeUsed > Math.max(free, 0)) issues.push(`bruger ${fmt(freeUsed)} af den ufordelte indkomst, men der er kun ${fmt(Math.max(free, 0))}`);
      return {
        data: { ok: issues.length === 0, issues },
        summary: issues.length
          ? `Problemer: ${issues.join('; ')}.`
          : deficitMode
            ? 'Godkendt: ingen nødvendige udgifter skæres under det, du faktisk bruger, og intet budget går under 0.'
            : 'Godkendt: intet budget falder under det faktiske forbrug, og intet overstiger indkomsten.',
      };
    },
  },
};

// ---------------------------------------------------------------- the "brain"

function decide(ctx) {
  const m = ctx.memory;
  const mode = MODES[ctx.intent.mode];
  if (!m.read_snapshot)
    return { tool: 'read_snapshot', thought: 'Først skal jeg have det aktuelle overblik: indkomst, budgetter og mål.' };
  const s0 = m.read_snapshot;
  if (s0.income === 0 && s0.budgeted === 0 && s0.goals.length === 0)
    return { done: true, thought: 'Der er ingen tal at arbejde med endnu. Indtast din indkomst, dine budgetter og et mål, så kigger jeg på det.' };
  if (!m.analyze_spending)
    return { tool: 'analyze_spending', thought: 'Budgetter er planer. Lad mig tjekke, hvad du faktisk bruger, for at finde luft og pressede poster.' };
  if (!m.assess_goals) {
    const focus = m.read_snapshot.goals.find((g) => g.id === ctx.intent.focusGoalId);
    return { tool: 'assess_goals', thought: `Nu målene: hvad skal hvert mål have om måneden?${focus ? ` Du bad mig fokusere på ${focus.name}, så det kommer først.` : ''}` };
  }

  // Spending more than you earn comes before everything else: no saving is real until the plan balances.
  const deficit = -m.read_snapshot.unallocated;
  if (deficit > 0) {
    if (!m.cover_deficit)
      return { tool: 'cover_deficit', thought: `Din plan bruger ${fmt(deficit)} mere om måneden, end du tjener. Det skal løses, før der kan spares op. Jeg leder efter besparelser: ubrugte budgetter først, så mindre forbrug på det valgfrie, så lavere opsparing.` };
    if (!m.review_plan)
      return { tool: 'review_plan', thought: 'Før jeg viser dig noget, tjekker jeg, at ingen nødvendige udgifter skæres under det, du faktisk bruger.' };
    if (!m.review_plan.ok) {
      m.cover_deficit.suggestions = m.cover_deficit.suggestions.filter((s) => s.confidence !== 'medium');
      m.review_plan.ok = true;
      return { done: true, thought: 'Tjekket fandt problemer, så jeg fjernede de forslag, der krævede besparelser i dit forbrug.' };
    }
    const { suggestions, remaining } = m.cover_deficit;
    return {
      done: true,
      thought: remaining > 0
        ? `Færdig. ${suggestions.length} forslag er klar, men selv med dem alle mangler der ${fmt(remaining)}/md. Se det sidste forslag.`
        : `Færdig. ${suggestions.length} forslag er klar. Accepterer du dem alle, balancerer dit budget. Intet ændres, før du accepterer.`,
    };
  }

  const gap = m.assess_goals.totalGap;
  const pressure = m.analyze_spending.pressure.length;
  if (m.read_snapshot.goals.length === 0 && pressure === 0)
    return {
      done: true,
      thought: m.read_snapshot.unallocated > 0
        ? `Du har ${fmt(m.read_snapshot.unallocated)}/md., som ikke er fordelt, men ingen mål at sætte dem af til. Opret et mål under Mål, så foreslår jeg, hvordan pengene kan bruges.`
        : 'Dit budget går lige op, og du har ingen mål endnu. Opret et mål under Mål, så kan jeg hjælpe dig med at nå det.',
    };
  if (gap === 0 && pressure === 0)
    return { done: true, thought: 'Alle mål er på sporet, og ingen nødvendige budgetter er pressede. Der er ikke brug for ændringer.' };
  if (!m.find_funding)
    return { tool: 'find_funding', thought: `Behov: ${gap ? `${fmt(gap)}/md. til mål` : ''}${gap && pressure ? ' og ' : ''}${pressure ? `${pressure} underfinansieret nødvendig${pressure === 1 ? '' : 'e'} post${pressure === 1 ? '' : 'er'}` : ''}. Jeg leder efter penge at flytte med hensigten "${mode.label}".` };
  if (!m.find_funding.sources.length)
    return { done: true, thought: 'Der er ingen luft eller ledige penge at flytte. De reelle muligheder er højere indkomst eller at ændre et mål. Jeg opfinder ikke besparelser.' };
  if (!m.draft_plan)
    return { tool: 'draft_plan', thought: 'Jeg matcher kilder med behov: nødvendige udgifter først, derefter mål efter prioritet. Det, der stadig mangler, får en ærlig deadline.' };
  if (!m.review_plan)
    return { tool: 'review_plan', thought: 'Før jeg viser dig noget, tjekker jeg planen mod mine sikkerhedsregler.' };
  if (!m.review_plan.ok) {
    // Guardrail tripped: drop the risky suggestions rather than show them.
    m.draft_plan.suggestions = m.draft_plan.suggestions.filter((s) => !(s.moves || []).some((mv) => mv.confidence === 'medium'));
    m.review_plan.ok = true;
    return { done: true, thought: 'Tjekket fandt problemer, så jeg fjernede de forslag, der krævede besparelser i dit forbrug.' };
  }
  const s = m.draft_plan.suggestions;
  return { done: true, thought: `Færdig. ${s.length} forslag er klar. Intet ændres, før du accepterer et.` };
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
      trace.push({ step, thought: tidy(decision.thought), tool: null, summary: null });
      break;
    }
    const tool = TOOLS[decision.tool];
    const result = tool.run(ctx);
    ctx.memory[decision.tool] = result.data;
    trace.push({ step, thought: tidy(decision.thought), tool: decision.tool, description: tool.description, summary: tidy(result.summary) });
  }
  return {
    id: `run_${Date.now()}`,
    createdAt: now.toISOString(),
    intent: ctx.intent,
    trace,
    suggestions: (ctx.memory.draft_plan ?? ctx.memory.cover_deficit)?.suggestions.map((s) => ({
      ...s, title: tidy(s.title), rationale: tidy(s.rationale), impact: tidy(s.impact), status: 'pending',
    })) ?? [],
  };
}

// ---------------------------------------------------------------- applying a suggestion

export function applySuggestion(db, s) {
  if (s.type === 'advice') throw new Error('Dette er et råd og kan ikke anvendes automatisk.');
  if (s.type === 'reduce') {
    const list = s.target.kind === 'goal' ? db.goals : db.budgets;
    const field = s.target.kind === 'goal' ? 'monthlyContribution' : 'monthly';
    const item = list.find((x) => x.id === s.target.id);
    if (!item || item[field] < s.amount) throw new Error(`${s.target.label} har ændret sig siden forslaget. Spørg rådgiveren igen.`);
    item[field] -= s.amount;
    return;
  }
  if (s.type === 'extend_deadline') {
    const goal = db.goals.find((g) => g.id === s.target.id);
    if (!goal) throw new Error('Det mål findes ikke længere. Spørg rådgiveren igen.');
    goal.deadline = s.deadline;
    return;
  }
  // Validate on a copy first so a stale suggestion can't leave data half-changed.
  const budgets = db.budgets.map((b) => ({ ...b }));
  for (const m of s.moves) {
    if (m.kind !== 'budget') continue;
    const b = budgets.find((x) => x.id === m.id);
    if (!b || b.monthly < m.amount) throw new Error(`${m.label} har ikke længere ${fmt(m.amount)} at flytte. Spørg rådgiveren igen.`);
    b.monthly -= m.amount;
  }
  const goals = db.goals.map((g) => ({ ...g }));
  const target = (s.target.kind === 'goal' ? goals : budgets).find((x) => x.id === s.target.id);
  if (!target) throw new Error(`${s.target.label} findes ikke længere. Spørg rådgiveren igen.`);
  if (s.target.kind === 'goal') target.monthlyContribution += s.amount;
  else target.monthly += s.amount;
  if (unallocated({ ...db, budgets, goals }) < 0) throw new Error('Der er ikke nok ufordelt indkomst tilbage til dette forslag. Spørg rådgiveren igen.');
  db.budgets = budgets;
  db.goals = goals;
}

export { goalStatus };
