// Ready-made budgets. Each template gives every budget category a share of income;
// whatever is left over is meant for savings and goals.

export const TEMPLATES = {
  su_ude: {
    label: 'SU (udeboende)',
    income: 7400, // approximate, before tax. SU rates change every year, so check su.dk.
    shares: { housing: 0.45, groceries: 0.17, utilities: 0.05, transport: 0.04, dining: 0.04, shopping: 0.04, entertainment: 0.04, subscriptions: 0.03, travel: 0.02 },
    tip: 'Bolig æder det meste af SU, så de øvrige poster er stramme. SU-satserne ændres hvert år, så tjek dit beløb på su.dk.',
  },
  su_hjemme: {
    label: 'SU (hjemmeboende)',
    income: 3400, // approximate, before tax
    shares: { housing: 0.1, groceries: 0.2, utilities: 0.03, transport: 0.1, dining: 0.1, shopping: 0.1, entertainment: 0.08, subscriptions: 0.05, travel: 0.05 },
    tip: 'Du bor hjemme, så boligudgiften er lille, og der er plads til at spare op. SU-satserne ændres hvert år, så tjek dit beløb på su.dk.',
  },
  generic: {
    label: 'din indkomst',
    income: null,
    shares: { housing: 0.33, groceries: 0.12, utilities: 0.06, transport: 0.07, dining: 0.05, shopping: 0.05, entertainment: 0.04, subscriptions: 0.02, travel: 0.04 },
    tip: 'Tommelfingerregel: cirka halvdelen til faste udgifter, en tredjedel til det, du har lyst til, og resten til opsparing.',
  },
};
