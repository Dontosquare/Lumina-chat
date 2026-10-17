import { createSeed } from './server/seed.js';
import { runAgent, applySuggestion } from './server/agent.js';
import { unallocated } from './server/finance.js';

for (const mode of ['balanced', 'saver', 'lifestyle']) {
  const db = createSeed();
  const run = runAgent(db, { mode });
  console.log(`\n=== ${mode} ===`);
  for (const t of run.trace) console.log(`${t.step}. ${t.tool ?? 'DONE'} | ${t.thought}\n   -> ${t.summary ?? ''}`);
  for (const s of run.suggestions) {
    console.log(`* [${s.confidence}] ${s.title}\n  ${s.impact}`);
    applySuggestion(db, s);
  }
  console.log('unallocated after applying all:', unallocated(db));
}
